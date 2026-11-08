"""Email accounts and isolated administrator sessions. No credentials in source."""
import base64,hashlib,hmac,io,json,os,re,secrets,smtplib,sqlite3,ssl,time
from email.message import EmailMessage
from http import cookies
from urllib.parse import urlsplit,parse_qs

class Error(ValueError):
    def __init__(self,status,message,**details):self.status=status;self.details=details;super().__init__(message)

def migrate(db):
    columns={r[1] for r in db.execute('PRAGMA table_info(users)')}
    for name,sql in {'email':'TEXT COLLATE NOCASE','email_verified':'INTEGER NOT NULL DEFAULT 0','is_admin':'INTEGER NOT NULL DEFAULT 0','blocked':'INTEGER NOT NULL DEFAULT 0','created_at':'INTEGER NOT NULL DEFAULT 0'}.items():
        if name not in columns:db.execute(f'ALTER TABLE users ADD COLUMN {name} {sql}')
    db.executescript('''CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique ON users(email) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
    CREATE TABLE IF NOT EXISTS email_tokens(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),purpose TEXT,expires INTEGER);
    CREATE TABLE IF NOT EXISTS icon_assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,png BLOB NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_events(id INTEGER PRIMARY KEY,actor INTEGER,action TEXT,target TEXT,created_at INTEGER);''')
    if 'tags' not in {r[1] for r in db.execute('PRAGMA table_info(icon_assets)')}:db.execute("ALTER TABLE icon_assets ADD COLUMN tags TEXT NOT NULL DEFAULT ''")
    db.execute('CREATE TABLE IF NOT EXISTS icon_categories(id TEXT PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE NOT NULL,kind TEXT NOT NULL)')
    db.executemany('INSERT OR IGNORE INTO icon_categories VALUES(?,?,?)',[('general','General','general'),('weapon','Weapons','weapon'),('armor','Armor','armor')])
    db.executescript("""CREATE TRIGGER IF NOT EXISTS icon_category_insert BEFORE INSERT ON icon_assets WHEN NOT EXISTS(SELECT 1 FROM icon_categories WHERE id=NEW.category) BEGIN SELECT RAISE(ABORT,'Unknown icon category');END;
    CREATE TRIGGER IF NOT EXISTS icon_category_update BEFORE UPDATE OF category ON icon_assets WHEN NOT EXISTS(SELECT 1 FROM icon_categories WHERE id=NEW.category) BEGIN SELECT RAISE(ABORT,'Unknown icon category');END;""")
    db.execute('CREATE TABLE IF NOT EXISTS icon_fingerprints(fingerprint TEXT PRIMARY KEY,icon_id TEXT REFERENCES icon_assets(id) ON DELETE CASCADE)')
    for ident,png in db.execute('SELECT id,png FROM icon_assets WHERE id NOT IN(SELECT icon_id FROM icon_fingerprints) ORDER BY created_at,id'):
        db.execute('INSERT OR IGNORE INTO icon_fingerprints VALUES(?,?)',(image_fingerprint(png),ident))


def email(value):
    if not isinstance(value,str) or len(value)>254 or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}",value.strip()):raise Error(400,'Enter a valid email address')
    return value.strip().lower()

def rate_limit(db,key,limit=20):
    now=time.time();row=db.execute('SELECT count,until FROM attempts WHERE key=?',(key,)).fetchone()
    if row and row[1]>now and row[0]>=limit:raise Error(429,'Too many attempts. Try again in 15 minutes.')
    db.execute('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END,until=CASE WHEN until<? THEN excluded.until ELSE until END',(key,now+900,now,now));db.commit()

def credential(db,data,password_hash,admin=False):
    identity=data.get('login') or data.get('email') or '';password=data.get('password','')
    if not isinstance(identity,str) or len(identity)>254 or not isinstance(password,str) or not 8<=len(password)<=128:raise Error(401,'Incorrect email or password')
    row=db.execute('SELECT id,salt,password,blocked,is_admin,email_verified,email FROM users WHERE login=? OR email=?',(identity.strip(),identity.strip().lower())).fetchone()
    hashed=password_hash(password,row[1] if row else '00'*16)
    if not row or not hmac.compare_digest(row[2],hashed) or row[3] or (admin and not row[4]):raise Error(401,'Incorrect email or password')
    if not admin and verification_required() and row[6] and not row[5]:raise Error(403,'Please verify your email before logging in')
    return row[0]

def new_session(db,uid,admin=False):
    table='admin_sessions' if admin else 'sessions';name='admin_session' if admin else 'session';ttl=7200 if admin else 604800
    raw=secrets.token_urlsafe(32);db.execute(f'DELETE FROM {table} WHERE expires<?',(time.time(),));db.execute(f'INSERT INTO {table} VALUES(?,?,?)',(hashlib.sha256(raw.encode()).hexdigest(),uid,time.time()+ttl));db.commit()
    return f"{name}={raw}; HttpOnly; SameSite={'Strict' if admin else 'Lax'}; Path=/; Max-Age={ttl}"+('; Secure' if os.environ.get('COOKIE_SECURE')=='1' else '')

def cookie_token(handler,name):
    jar=cookies.SimpleCookie()
    try:jar.load(handler.headers.get('Cookie',''));return jar[name].value if name in jar else ''
    except cookies.CookieError:return ''

def admin_id(handler,db):
    raw=cookie_token(handler,'admin_session')
    row=db.execute('SELECT users.id FROM admin_sessions JOIN users ON users.id=admin_sessions.user_id WHERE token=? AND expires>? AND users.is_admin=1 AND users.blocked=0',(hashlib.sha256(raw.encode()).hexdigest(),time.time())).fetchone()
    return row[0] if row else None

def mail_enabled():return bool(os.environ.get('SMTP_HOST') and os.environ.get('SMTP_FROM') and os.environ.get('APP_URL'))
def verification_required():return os.environ.get('REQUIRE_EMAIL_VERIFICATION')=='1'

def send_mail(to,subject,body):
    if not mail_enabled():raise Error(503,'Email delivery is not configured. Contact the administrator.')
    message=EmailMessage();message['From']=os.environ['SMTP_FROM'];message['To']=to;message['Subject']=subject;message.set_content(body)
    use_ssl=os.environ.get('SMTP_SSL')=='1';cls=smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    try:
        with cls(os.environ['SMTP_HOST'],int(os.environ.get('SMTP_PORT','465' if use_ssl else '587')),timeout=15,**({'context':ssl.create_default_context()} if use_ssl else {})) as smtp:
            if not use_ssl:smtp.starttls(context=ssl.create_default_context())
            if os.environ.get('SMTP_USER'):smtp.login(os.environ['SMTP_USER'],os.environ.get('SMTP_PASSWORD',''))
            smtp.send_message(message)
    except (OSError,smtplib.SMTPException):raise Error(503,'Email could not be sent. Please try again later.') from None

def issue_mail(db,uid,purpose):
    origin=os.environ.get('APP_URL','').rstrip('/');url=urlsplit(origin)
    if not mail_enabled() or not url.hostname or url.username or url.password or url.path not in ('','/') or url.query or url.fragment or url.scheme not in ('https','http') or (url.scheme=='http' and url.hostname not in ('localhost','127.0.0.1')):raise Error(503,'Email delivery is not configured. Contact the administrator.')
    row=db.execute('SELECT email,blocked FROM users WHERE id=?',(uid,)).fetchone()
    if not row or not row[0] or row[1]:return
    raw=secrets.token_urlsafe(32);hashed=hashlib.sha256(raw.encode()).hexdigest()
    db.execute('DELETE FROM email_tokens WHERE user_id=? AND purpose=?',(uid,purpose));db.execute('INSERT INTO email_tokens VALUES(?,?,?,?)',(hashed,uid,purpose,time.time()+(1800 if purpose=='reset' else 86400)));db.commit()
    try:send_mail(row[0],'TalentForge — '+('Reset password' if purpose=='reset' else 'Verify email'),f"Open this link to {'reset your password' if purpose=='reset' else 'verify your email'}:\n{origin}/account.html#{purpose}={raw}\n\nIf you did not request this, ignore this email.")
    except Error:db.execute('DELETE FROM email_tokens WHERE token=?',(hashed,));db.commit();raise

def register(db,data,password_hash,bootstrap=False):
    address=email(data.get('email'));login=data.get('login','');password=data.get('password','')
    if not isinstance(login,str) or not re.fullmatch(r'[A-Za-z0-9_\-]{3,32}',login) or not isinstance(password,str) or not 8<=len(password)<=128:raise Error(400,'Use a 3–32 character nickname and an 8–128 character password')
    if not bootstrap and verification_required() and not mail_enabled():raise Error(503,'Email delivery is not configured. Contact the administrator.')
    salt=secrets.token_hex(16)
    try:uid=db.execute('INSERT INTO users(login,email,salt,password,created_at,is_admin,email_verified) VALUES(?,?,?,?,?,?,?)',(login,address,salt,password_hash(password,salt),int(time.time()),int(bootstrap),int(bootstrap))).lastrowid
    except sqlite3.IntegrityError:raise Error(409,'Email or nickname is already in use') from None
    db.commit()
    if not bootstrap and mail_enabled():
        try:issue_mail(db,uid,'verify')
        except Error:
            # An existing unverified account can request another message; never claim it was sent.
            if verification_required():raise
    return uid

def categories(db):return [{'id':r[0],'name':r[1],'kind':r[2]} for r in db.execute('SELECT id,name,kind FROM icon_categories ORDER BY name COLLATE NOCASE,id')]

def public_icons(db):return [{'id':'custom:'+r[0],'label':r[1],'category':r[2],'categoryKind':r[3],'tags':r[4]} for r in db.execute('SELECT a.id,a.name,a.category,c.kind,a.tags FROM icon_assets a JOIN icon_categories c ON c.id=a.category WHERE a.enabled=1 ORDER BY a.created_at DESC,a.id')]

def icon_tags(value):
    if not isinstance(value,str) or len(value)>1000:raise Error(400,'Tags must be text up to 1000 characters')
    result=[];seen=set()
    for part in re.split(r'[,;\n]+',value):
        tag=' '.join(part.split()).strip().lstrip('#').strip()
        if not tag:continue
        if len(tag)>50:raise Error(400,'Each tag must be no longer than 50 characters')
        if tag.casefold() not in seen:seen.add(tag.casefold());result.append(tag)
    if len(result)>30:raise Error(400,'Use up to 30 tags per icon')
    normalized=', '.join(result)
    if len(normalized)>1000:raise Error(400,'Tags must be text up to 1000 characters')
    return normalized

def image_fingerprint(png):
    from PIL import Image
    with Image.open(io.BytesIO(png)) as image:return hashlib.sha256(image.convert('RGBA').tobytes()).hexdigest()

def sanitize_image(encoded,icon=True):
    from PIL import Image,ImageOps,UnidentifiedImageError
    if not isinstance(encoded,str):raise Error(400,'Invalid image file')
    try:
        raw=base64.b64decode(encoded.split(',',1)[-1],validate=True)
        if not 1<=len(raw)<=1_000_000:raise Error(400,'Images must be no larger than 1 MB')
        with Image.open(io.BytesIO(raw)) as image:
            limit=1024 if icon else 2048
            if image.format not in ('PNG','JPEG','WEBP') or max(image.size)>limit or min(image.size)<(16 if icon else 1) or getattr(image,'is_animated',False):raise Error(400,f'Use a static PNG, JPEG or WebP image, {16 if icon else 1}–{limit} pixels')
            cleaned=ImageOps.exif_transpose(image).convert('RGBA')
            if icon:cleaned=ImageOps.fit(cleaned,(128,128))
            else:cleaned.thumbnail((1600,1600))
            output=io.BytesIO();cleaned.save(output,format='PNG');png=output.getvalue()
    except Error:raise
    except (ValueError,OSError,UnidentifiedImageError,Image.DecompressionBombError):raise Error(400,'Invalid image file') from None
    return png

def duplicate_icon(db,fingerprint):
    row=db.execute('SELECT a.id,a.name,a.enabled FROM icon_fingerprints f JOIN icon_assets a ON a.id=f.icon_id WHERE f.fingerprint=?',(fingerprint,)).fetchone()
    return {'id':'custom:'+row[0],'name':row[1],'enabled':bool(row[2])} if row else None

def upload_icon(db,data):
    name=data.get('name','');category=data.get('category','general')
    if not isinstance(name,str) or not 1<=len(name.strip())<=80 or not isinstance(category,str) or not db.execute('SELECT 1 FROM icon_categories WHERE id=?',(category,)).fetchone():raise Error(400,'Check the icon name and category')
    tags=icon_tags(data.get('tags',''));png=sanitize_image(data.get('image'));fingerprint=image_fingerprint(png)
    db.execute('BEGIN IMMEDIATE')
    duplicate=duplicate_icon(db,fingerprint)
    if duplicate:raise Error(409,'This image is already in the icon library',duplicate=duplicate)
    ident=secrets.token_hex(16);db.execute('INSERT INTO icon_assets(id,name,category,png,enabled,created_at,tags) VALUES(?,?,?,?,1,?,?)',(ident,name.strip(),category,png,int(time.time()),tags))
    db.execute('INSERT INTO icon_fingerprints VALUES(?,?)',(fingerprint,ident));return ident

def audit(db,actor,action,target):db.execute('INSERT INTO admin_events(actor,action,target,created_at) VALUES(?,?,?,?)',(actor,action,str(target),int(time.time())))

def admin_route(handler,db,method,path,data,password_hash,profile):
    if not path.startswith('/api/admin/'):return False
    actor=admin_id(handler,db)
    if path=='/api/admin/login' and method=='POST':
        rate_limit(db,'admin:'+handler.client_address[0],10);actor=credential(db,data,password_hash,True);handler.reply(200,{'admin':profile(db,actor)},new_session(db,actor,True));return True
    if path=='/api/admin/me' and method=='GET':handler.reply(200,{'admin':profile(db,actor) if actor else None});return True
    if not actor:raise Error(403,'Administrator login required')
    if path.startswith('/api/admin/project'):
        import site_content
        return site_content.admin_route(handler,db,actor,method,path,data)
    if path=='/api/admin/logout' and method=='POST':
        db.execute('DELETE FROM admin_sessions WHERE token=?',(hashlib.sha256(cookie_token(handler,'admin_session').encode()).hexdigest(),));db.commit();handler.reply(200,{'ok':True},'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return True
    if path=='/api/admin/users' and method=='GET':
        query=parse_qs(urlsplit(handler.path).query);page=max(0,min(100000,int(query.get('page',['0'])[0])));term=query.get('q',[''])[0][:100];rows=db.execute('SELECT id,login,email,email_verified,is_admin,blocked,created_at FROM users WHERE login LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT 21 OFFSET ?',('%'+term+'%','%'+term+'%',page*20)).fetchall();handler.reply(200,{'users':[dict(zip(('id','login','email','emailVerified','isAdmin','blocked','created'),r)) for r in rows[:20]],'hasMore':len(rows)>20,'page':page});return True
    match=re.fullmatch(r'/api/admin/users/(\d+)',path)
    if match and method=='POST':
        db.execute('BEGIN IMMEDIATE');uid=int(match[1]);row=db.execute('SELECT is_admin,blocked,login FROM users WHERE id=?',(uid,)).fetchone()
        if not row:raise Error(404,'User not found')
        action=data.get('action')
        if action in ('block','demote','delete') and (uid==actor or (row[0] and not row[1] and db.execute('SELECT COUNT(*) FROM users WHERE is_admin=1 AND blocked=0').fetchone()[0]<=1)):raise Error(409,'You cannot disable yourself or the last administrator')
        if action in ('block','unblock'):db.execute('UPDATE users SET blocked=? WHERE id=?',(int(action=='block'),uid))
        elif action in ('promote','demote'):db.execute('UPDATE users SET is_admin=? WHERE id=?',(int(action=='promote'),uid))
        elif action=='nickname':
            name=data.get('login','')
            if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_\-]{3,32}',name):raise Error(400,'Use a 3–32 character nickname')
            try:db.execute('UPDATE users SET login=? WHERE id=?',(name,uid))
            except sqlite3.IntegrityError:raise Error(409,'Nickname is already in use') from None
        elif action=='email':
            address=email(data.get('email'))
            try:db.execute('UPDATE users SET email=?,email_verified=0 WHERE id=?',(address,uid))
            except sqlite3.IntegrityError:raise Error(409,'Email is already in use') from None
        elif action=='delete':
            if data.get('confirm')!=row[2]:raise Error(400,'Type the nickname to confirm deletion')
            for table in ('share_views','share_votes','share_saves','share_allocations'):db.execute(f'DELETE FROM {table} WHERE token IN (SELECT token FROM shares WHERE owner_id=?)',(uid,))
            for table in ('share_votes','share_saves'):db.execute(f'DELETE FROM {table} WHERE user_id=?',(uid,))
            db.execute('DELETE FROM shares WHERE owner_id=?',(uid,));db.execute('DELETE FROM publication_sequences WHERE owner_id=?',(uid,))
            for table in ('projects','favorites','sessions','admin_sessions','email_tokens'):db.execute(f'DELETE FROM {table} WHERE user_id=?',(uid,))
            db.execute('DELETE FROM users WHERE id=?',(uid,))
        elif action!='revoke':raise Error(400,'Unknown user action')
        for table in ('sessions','admin_sessions','email_tokens'):db.execute(f'DELETE FROM {table} WHERE user_id=?',(uid,))
        audit(db,actor,action,uid);db.commit();handler.reply(200,{'ok':True});return True
    if path=='/api/admin/categories' and method=='GET':handler.reply(200,{'categories':categories(db)});return True
    if path=='/api/admin/categories' and method=='POST':
        name=data.get('name','');kind=data.get('kind','general')
        if not isinstance(name,str) or not 1<=len(name.strip())<=60 or kind not in ('general','weapon','armor'):raise Error(400,'Check the category name and type')
        ident='cat_'+secrets.token_hex(8)
        try:db.execute('INSERT INTO icon_categories VALUES(?,?,?)',(ident,name.strip(),kind))
        except sqlite3.IntegrityError:raise Error(409,'Category name is already in use') from None
        audit(db,actor,'create_category',ident);db.commit();handler.reply(201,{'id':ident});return True
    match=re.fullmatch(r'/api/admin/categories/([a-z0-9_]+)',path)
    if match and method in ('POST','DELETE'):
        ident=match[1];db.execute('BEGIN IMMEDIATE')
        if not db.execute('SELECT 1 FROM icon_categories WHERE id=?',(ident,)).fetchone():raise Error(404,'Category not found')
        if method=='DELETE':
            if ident in ('general','weapon','armor'):raise Error(409,'Default categories cannot be deleted')
            if db.execute('SELECT 1 FROM icon_assets WHERE category=?',(ident,)).fetchone():raise Error(409,'Reassign the icons before deleting this category')
            db.execute('DELETE FROM icon_categories WHERE id=?',(ident,))
        else:
            name=data.get('name','');kind=data.get('kind','general')
            if not isinstance(name,str) or not 1<=len(name.strip())<=60 or kind not in ('general','weapon','armor'):raise Error(400,'Check the category name and type')
            if ident in ('general','weapon','armor') and kind!=ident:raise Error(409,'Default category types cannot be changed')
            try:db.execute('UPDATE icon_categories SET name=?,kind=? WHERE id=?',(name.strip(),kind,ident))
            except sqlite3.IntegrityError:raise Error(409,'Category name is already in use') from None
        audit(db,actor,'delete_category' if method=='DELETE' else 'edit_category',ident);db.commit();handler.reply(200,{'ok':True});return True
    if path=='/api/admin/icons' and method=='GET':
        rows=db.execute('SELECT id,name,category,enabled,created_at,tags FROM icon_assets ORDER BY created_at DESC,id').fetchall();handler.reply(200,{'icons':[{'id':'custom:'+r[0],'name':r[1],'category':r[2],'enabled':bool(r[3]),'created':r[4],'tags':r[5]} for r in rows]});return True
    if path=='/api/admin/icons/check' and method=='POST':
        png=sanitize_image(data.get('image'));fingerprint=image_fingerprint(png)
        handler.reply(200,{'fingerprint':fingerprint,'duplicate':duplicate_icon(db,fingerprint)});return True
    if path=='/api/admin/icons' and method=='POST':
        try:ident=upload_icon(db,data)
        except ImportError:raise Error(503,'Install the image dependencies from requirements.txt') from None
        audit(db,actor,'upload_icon',ident);db.commit();handler.reply(201,{'id':'custom:'+ident});return True
    match=re.fullmatch(r'/api/admin/icons/([a-f0-9]{32})',path)
    if match and method in ('POST','DELETE'):
        if not db.execute('SELECT 1 FROM icon_assets WHERE id=?',(match[1],)).fetchone():raise Error(404,'Icon not found')
        if method=='POST' and ('category' in data or 'tags' in data):
            updates={}
            if 'category' in data:
                category=data['category']
                if not isinstance(category,str) or not db.execute('SELECT 1 FROM icon_categories WHERE id=?',(category,)).fetchone():raise Error(400,'Unknown icon category')
                updates['category']=category
            if 'tags' in data:updates['tags']=icon_tags(data['tags'])
            db.execute('UPDATE icon_assets SET '+','.join(key+'=?' for key in updates)+' WHERE id=?',(*updates.values(),match[1]));audit(db,actor,'edit_icon_metadata',match[1]);db.commit();handler.reply(200,{'ok':True});return True
        enabled=method=='POST';db.execute('UPDATE icon_assets SET enabled=? WHERE id=?',(int(enabled),match[1]));audit(db,actor,'restore_icon' if enabled else 'remove_icon',match[1]);db.commit();handler.reply(200,{'ok':True});return True
    raise Error(404,'Not found')

def email_route(handler,db,method,path,data,password_hash,uid):
    if path=='/api/auth/config' and method=='GET':handler.reply(200,{'emailEnabled':mail_enabled(),'verificationRequired':verification_required()});return True
    if method!='POST' or path not in ('/api/auth/forgot','/api/auth/resend','/api/auth/verify','/api/auth/reset'):return False
    rate_limit(db,'email:'+handler.client_address[0],10)
    if path in ('/api/auth/forgot','/api/auth/resend'):
        if not mail_enabled():raise Error(503,'Email delivery is not configured. Contact the administrator.')
        address=email(data.get('email'));row=db.execute('SELECT id,email_verified FROM users WHERE email=? AND blocked=0',(address,)).fetchone()
        if row and (path.endswith('forgot') or not row[1]):issue_mail(db,row[0],'reset' if path.endswith('forgot') else 'verify')
        handler.reply(202,{'ok':True});return True
    raw=data.get('token','')
    if not isinstance(raw,str) or not 32<=len(raw)<=100:raise Error(400,'Invalid or expired link')
    purpose='reset' if path.endswith('reset') else 'verify';hashed=hashlib.sha256(raw.encode()).hexdigest()
    db.execute('BEGIN IMMEDIATE')
    row=db.execute('SELECT email_tokens.user_id FROM email_tokens JOIN users ON users.id=email_tokens.user_id WHERE token=? AND purpose=? AND expires>? AND users.blocked=0',(hashed,purpose,time.time())).fetchone()
    if not row:raise Error(400,'Invalid or expired link')
    if purpose=='reset':
        password=data.get('password','')
        if not isinstance(password,str) or not 8<=len(password)<=128:raise Error(400,'Use an 8–128 character password')
        salt=secrets.token_hex(16);db.execute('UPDATE users SET password=?,salt=?,email_verified=1 WHERE id=?',(password_hash(password,salt),salt,row[0]))
        for table in ('sessions','admin_sessions','email_tokens'):db.execute(f'DELETE FROM {table} WHERE user_id=?',(row[0],))
    else:db.execute('UPDATE users SET email_verified=1 WHERE id=?',(row[0],));db.execute('DELETE FROM email_tokens WHERE token=?',(hashed,))
    db.commit();handler.reply(200,{'ok':True});return True
