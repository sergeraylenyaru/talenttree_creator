"""Immutable publications, discovery and private author vote metrics."""
import json
import time
import secrets

def avatar_value(value):
    # The existing TEXT column stores either a legacy icon name or a layered model.
    if isinstance(value,str) and value.startswith('{'):
        try:return json.loads(value)
        except (ValueError,TypeError):return 'inv_misc_questionmark'
    return value

def without_build(document):
    """Keep allocations in the visitor browser, including for legacy documents."""
    return {**document, "build": {}}

def migrate(db):
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'").fetchone() and 'archived_at' not in {r[1] for r in db.execute('PRAGMA table_info(projects)')}:db.execute('ALTER TABLE projects ADD COLUMN archived_at INTEGER')
    columns={r[1] for r in db.execute('PRAGMA table_info(shares)')}
    for name, declaration in {'owner_id':'INTEGER','project_id':'TEXT','publication_version':'INTEGER NOT NULL DEFAULT 1','visibility':"TEXT NOT NULL DEFAULT 'unlisted'",'published_at':'INTEGER','archived_at':'INTEGER','archived_by_project':'INTEGER NOT NULL DEFAULT 0'}.items():
        if name not in columns:
            db.execute(f'ALTER TABLE shares ADD COLUMN {name} {declaration}')
    db.execute('UPDATE shares SET published_at=created WHERE published_at IS NULL')
    db.executescript('''
    CREATE TABLE IF NOT EXISTS share_views(token TEXT REFERENCES shares(token), visitor TEXT, PRIMARY KEY(token,visitor));
    CREATE TABLE IF NOT EXISTS share_votes(token TEXT REFERENCES shares(token), user_id INTEGER REFERENCES users(id), vote INTEGER NOT NULL CHECK(vote IN(-1,1)), PRIMARY KEY(token,user_id));
    CREATE INDEX IF NOT EXISTS publication_visibility ON shares(visibility,published_at);
    CREATE INDEX IF NOT EXISTS publication_owner ON shares(owner_id,published_at);
    ''')
    db.execute('CREATE TABLE IF NOT EXISTS publication_sequences(owner_id INTEGER,project_id TEXT,latest INTEGER NOT NULL,PRIMARY KEY(owner_id,project_id))')
    db.execute('INSERT INTO publication_sequences SELECT owner_id,project_id,MAX(publication_version) FROM shares WHERE owner_id IS NOT NULL AND project_id IS NOT NULL GROUP BY owner_id,project_id ON CONFLICT(owner_id,project_id) DO UPDATE SET latest=MAX(latest,excluded.latest)')
    db.execute('CREATE INDEX IF NOT EXISTS publication_archive ON shares(archived_at)')

def purge_archived(db,now=None):
    cutoff=int(time.time() if now is None else now)-30*86400
    tokens=[r[0] for r in db.execute('SELECT token FROM shares WHERE archived_at IS NOT NULL AND archived_at<=?',(cutoff,))]
    for token in tokens:
        for table in ('share_votes','share_views','share_allocations','share_saves'):
            db.execute(f'DELETE FROM {table} WHERE token=?',(token,))
        db.execute('DELETE FROM shares WHERE token=?',(token,))
    db.execute('DELETE FROM projects WHERE archived_at IS NOT NULL AND archived_at<=?',(cutoff,))
    return len(tokens)

def info(db,token,user_id=None):
    row=db.execute('SELECT document,owner_id,publication_version,visibility,published_at,project_id,archived_at FROM shares WHERE token=?',(token,)).fetchone()
    if not row:return None
    document=json.loads(row[0]);owner=row[1]
    if (row[3]=='private' or row[6] is not None) and (user_id is None or user_id!=owner):return None
    author=db.execute('SELECT login,avatar FROM users WHERE id=?',(owner,)).fetchone() if owner else None
    result={'token':token,'name':document['name'],'author':author[0] if author else None,'avatar':avatar_value(author[1]) if author else 'inv_misc_questionmark','classIcon':document.get('classIcon'),'archived':row[6] is not None,'archivedAt':row[6],'expiresAt':row[6]+30*86400 if row[6] is not None else None,'version':row[2],'visibility':row[3],'published':row[4], 'isOwner':user_id is not None and owner==user_id,
            'branches':[{'name':b['name'],'icon':b.get('icon') or (b['talents'][0].get('icon','inv_misc_questionmark') if b['talents'] else 'inv_misc_questionmark')} for b in document['branches']]}
    for key,table in [('views','share_views'),('allocated','share_allocations'),('saved','share_saves')]:
        result[key]=db.execute(f'SELECT COUNT(*) FROM {table} WHERE token=?',(token,)).fetchone()[0]
    result['likes']=db.execute('SELECT COUNT(*) FROM share_votes WHERE token=? AND vote=1',(token,)).fetchone()[0]
    own=db.execute('SELECT vote FROM share_votes WHERE token=? AND user_id=?',(token,user_id)).fetchone() if user_id else None
    result['myVote']=own[0] if own else 0
    if result['isOwner']:
        result['projectId']=row[5] if row[5] and db.execute('SELECT 1 FROM projects WHERE id=? AND user_id=? AND archived_at IS NULL',(row[5],owner)).fetchone() else None
        result['archivedProjectId']=row[5] if row[5] and db.execute('SELECT 1 FROM projects WHERE id=? AND user_id=? AND archived_at IS NOT NULL',(row[5],owner)).fetchone() else None
        result['dislikes']=db.execute('SELECT COUNT(*) FROM share_votes WHERE token=? AND vote=-1',(token,)).fetchone()[0]
    return result

def create(db,document,owner_id,project_id=None,visibility='unlisted'):
    if visibility not in ('public','unlisted','private'):raise ValueError('Неверная видимость')
    if visibility=='private' and owner_id is None:raise ValueError('Для личной публикации нужен автор')
    version=1
    if project_id:
        db.execute('INSERT INTO publication_sequences VALUES(?,?,1) ON CONFLICT(owner_id,project_id) DO UPDATE SET latest=latest+1',(owner_id,project_id))
        version=db.execute('SELECT latest FROM publication_sequences WHERE owner_id=? AND project_id=?',(owner_id,project_id)).fetchone()[0]
    token=secrets.token_urlsafe(24);now=int(time.time())
    db.execute('INSERT INTO shares(token,document,created,owner_id,project_id,publication_version,visibility,published_at) VALUES(?,?,?,?,?,?,?,?)',(token,json.dumps(without_build(document)),now,owner_id,project_id,version,visibility,now))
    return token

def listing(db,user_id=None,sort='views',page=0,owned=False,archived=False):
    if sort not in ('likes','views','usage','latest') or type(page) is not int or not 0<=page<=100000:raise ValueError('Неверная сортировка или страница')
    where,args=('owner_id=? AND archived_at IS '+('NOT NULL' if archived else 'NULL'),[user_id]) if owned else ("visibility='public' AND archived_at IS NULL",[])
    order={'likes':'like_count DESC,published_at DESC,token','views':'view_count DESC,published_at DESC,token','usage':'usage_count DESC,published_at DESC,token','latest':'published_at DESC,rowid DESC'}[sort]
    if owned and archived:order='archived_at DESC,published_at DESC,token'
    rows=db.execute(f'SELECT token,published_at,(SELECT COUNT(*) FROM share_views v WHERE v.token=shares.token) view_count,(SELECT COUNT(*) FROM share_allocations a WHERE a.token=shares.token) usage_count,(SELECT COUNT(*) FROM share_votes l WHERE l.token=shares.token AND l.vote=1) like_count FROM shares WHERE {where} ORDER BY {order} LIMIT 21 OFFSET ?',(*args,page*20)).fetchall()
    items=[item for r in rows[:20] if (item:=info(db,r[0],user_id)) is not None and (owned or item['visibility']=='public' and not item['archived'])]
    return {'publications':items,'hasMore':len(rows)>20,'page':page}
