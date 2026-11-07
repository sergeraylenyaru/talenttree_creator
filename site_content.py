"""Administrator-edited public project description and support cards."""
import json,re,secrets,hashlib,time
from urllib.parse import urlsplit
import accounts

DEFAULT_CONTENT={
    'description':{
        'en':'TalentForge is a workshop for imaginary World of Warcraft classes. Create talent trees, invent abilities, choose icons and resources, and experiment with builds in the calculator. Save drafts, publish versions and explore ideas shared by the community.\n\nThe calculator works without an account. Sign up to save your trees, keep favorites and publish your creations. TalentForge is an unofficial fan project and is not affiliated with Blizzard Entertainment.',
        'ru':'TalentForge — мастерская вымышленных классов World of Warcraft. Создавай деревья талантов, придумывай способности, выбирай иконки и ресурсы, экспериментируй с билдами в калькуляторе. Сохраняй черновики, публикуй версии и изучай идеи сообщества.\n\nКалькулятор работает без аккаунта. Регистрация позволяет сохранять свои деревья, собирать избранное и публиковать работы. TalentForge — неофициальный фанатский проект, не связанный с Blizzard Entertainment.'},
    'methods':[
        {'id':'share','title':{'en':'Share the project','ru':'Расскажи о проекте'},'text':{'en':'Invite friends, share your talent trees and help more creators discover TalentForge.','ru':'Приглашай друзей, делись своими деревьями талантов и помогай другим авторам найти TalentForge.'}},
        {'id':'feedback','title':{'en':'Report an issue or suggest an idea','ru':'Сообщи об ошибке или предложи идею'},'text':{'en':'Found a problem or have an idea? Describe it in the project repository.','ru':'Нашёл проблему или придумал улучшение? Опиши его в репозитории проекта.'},'linkUrl':'https://github.com/sergeraylenyaru/talenttree_creator/issues','linkLabel':{'en':'Open GitHub Issues','ru':'Открыть GitHub Issues'}},
        {'id':'contribute','title':{'en':'Contribute to development','ru':'Помоги в разработке'},'text':{'en':'Code, interface improvements and well-tested talent sets all help the workshop grow.','ru':'Код, улучшения интерфейса и проверенные наборы талантов помогают мастерской развиваться.'},'linkUrl':'https://github.com/sergeraylenyaru/talenttree_creator','linkLabel':{'en':'Project repository','ru':'Репозиторий проекта'}}
    ]}

def migrate(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS project_content(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS project_images(id TEXT PRIMARY KEY,png BLOB NOT NULL,fingerprint TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL);''')
    db.execute('INSERT OR IGNORE INTO project_content(id,document) VALUES(1,?)',(json.dumps(DEFAULT_CONTENT,ensure_ascii=False),))

def content(db):
    row=db.execute('SELECT document,revision FROM project_content WHERE id=1').fetchone()
    return {'content':json.loads(row[0]),'revision':row[1]}

def translated(value,limit):
    if value is None:return {'en':'','ru':''}
    if not isinstance(value,dict):raise accounts.Error(400,'Use English and Russian text fields')
    result={}
    for lang in ('en','ru'):
        text=value.get(lang,'')
        if not isinstance(text,str) or len(text)>limit:raise accounts.Error(400,f'Text must be no longer than {limit} characters')
        result[lang]=text.strip()
    return result

def safe_url(value,image=False):
    if value in ('',None):return ''
    if not isinstance(value,str) or len(value)>2048 or any(c.isspace() or ord(c)<32 for c in value):raise accounts.Error(400,'Enter a valid http or https URL')
    if image and re.fullmatch(r'/media/project/[a-f0-9]{32}\.png',value):return value
    try:
        parsed=urlsplit(value)
        if parsed.scheme.lower() in ('http','https') and parsed.hostname and not parsed.username and not parsed.password:
            parsed.port
            return value
    except ValueError:pass
    raise accounts.Error(400,'Use a complete http or https URL')

def validate(db,value):
    if not isinstance(value,dict):raise accounts.Error(400,'Check the project settings')
    result={'description':translated(value.get('description'),8000),'methods':[]}
    if not any(result['description'].values()):raise accounts.Error(400,'Add a project description')
    methods=value.get('methods',[])
    if not isinstance(methods,list) or len(methods)>30:raise accounts.Error(400,'Use up to 30 support cards')
    ids=set()
    for method in methods:
        if not isinstance(method,dict):raise accounts.Error(400,'Check the support card')
        ident=method.get('id')
        if not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',ident) or ident in ids:raise accounts.Error(400,'Invalid or repeated support card identifier')
        ids.add(ident)
        card={'id':ident,**{key:translated(method.get(key),limit) for key,limit in [('title',120),('text',5000),('linkLabel',120),('imageAlt',240)]},**{key:safe_url(method.get(key,''),image=key=='imageUrl') for key in ('linkUrl','imageUrl','imageLink')}}
        if not any(card['title'].values()):raise accounts.Error(400,'Give each support card a title')
        if not any(card['text'].values()) and not card['linkUrl'] and not card['imageUrl']:raise accounts.Error(400,'Add text, a link or an image to each support card')
        if card['imageLink'] and not card['imageUrl']:raise accounts.Error(400,'Add an image before setting its link')
        if card['imageUrl'].startswith('/media/project/') and not db.execute('SELECT 1 FROM project_images WHERE id=?',(card['imageUrl'].split('/')[-1][:-4],)).fetchone():raise accounts.Error(400,'Project image not found')
        result['methods'].append(card)
    return result

def admin_route(handler,db,actor,method,path,data):
    if path=='/api/admin/project' and method=='GET':handler.reply(200,content(db));return True
    if path=='/api/admin/project' and method=='POST':
        document=validate(db,data.get('content'));revision=data.get('revision')
        db.execute('BEGIN IMMEDIATE')
        if type(revision) is not int or db.execute('SELECT revision FROM project_content WHERE id=1').fetchone()[0]!=revision:raise accounts.Error(409,'Project settings changed. Reload them before saving.')
        db.execute('UPDATE project_content SET document=?,revision=revision+1 WHERE id=1',(json.dumps(document,ensure_ascii=False),))
        accounts.audit(db,actor,'edit_project_settings','about');db.commit();handler.reply(200,content(db));return True
    if path=='/api/admin/project/images' and method=='POST':
        png=accounts.sanitize_image(data.get('image'),icon=False);fingerprint=hashlib.sha256(png).hexdigest();ident=secrets.token_hex(16)
        db.execute('INSERT OR IGNORE INTO project_images VALUES(?,?,?,?)',(ident,png,fingerprint,int(time.time())))
        ident=db.execute('SELECT id FROM project_images WHERE fingerprint=?',(fingerprint,)).fetchone()[0]
        accounts.audit(db,actor,'upload_project_image',ident);db.commit();handler.reply(201,{'url':'/media/project/'+ident+'.png'});return True
    raise accounts.Error(404,'Not found')
