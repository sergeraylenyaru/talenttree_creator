"""Immutable publications, discovery and private author vote metrics."""
import json
import time
import secrets

def migrate(db):
    columns={r[1] for r in db.execute('PRAGMA table_info(shares)')}
    for name, declaration in {'owner_id':'INTEGER','project_id':'TEXT','publication_version':'INTEGER NOT NULL DEFAULT 1','visibility':"TEXT NOT NULL DEFAULT 'unlisted'",'published_at':'INTEGER'}.items():
        if name not in columns:
            db.execute(f'ALTER TABLE shares ADD COLUMN {name} {declaration}')
    db.execute('UPDATE shares SET published_at=created WHERE published_at IS NULL')
    db.executescript('''
    CREATE TABLE IF NOT EXISTS share_views(token TEXT REFERENCES shares(token), visitor TEXT, PRIMARY KEY(token,visitor));
    CREATE TABLE IF NOT EXISTS share_votes(token TEXT REFERENCES shares(token), user_id INTEGER REFERENCES users(id), vote INTEGER NOT NULL CHECK(vote IN(-1,1)), PRIMARY KEY(token,user_id));
    CREATE INDEX IF NOT EXISTS publication_visibility ON shares(visibility,published_at);
    CREATE INDEX IF NOT EXISTS publication_owner ON shares(owner_id,published_at);
    ''')

def info(db,token,user_id=None):
    row=db.execute('SELECT document,owner_id,publication_version,visibility,published_at,project_id FROM shares WHERE token=?',(token,)).fetchone()
    if not row:return None
    document=json.loads(row[0]);owner=row[1]
    author=db.execute('SELECT login FROM users WHERE id=?',(owner,)).fetchone() if owner else None
    result={'token':token,'name':document['name'],'author':author[0] if author else None,'version':row[2],'visibility':row[3],'published':row[4], 'isOwner':user_id is not None and owner==user_id,
            'branches':[{'name':b['name'],'icon':b.get('icon') or (b['talents'][0].get('icon','inv_misc_questionmark') if b['talents'] else 'inv_misc_questionmark')} for b in document['branches']]}
    for key,table in [('views','share_views'),('allocated','share_allocations'),('saved','share_saves')]:
        result[key]=db.execute(f'SELECT COUNT(*) FROM {table} WHERE token=?',(token,)).fetchone()[0]
    result['likes']=db.execute('SELECT COUNT(*) FROM share_votes WHERE token=? AND vote=1',(token,)).fetchone()[0]
    own=db.execute('SELECT vote FROM share_votes WHERE token=? AND user_id=?',(token,user_id)).fetchone() if user_id else None
    result['myVote']=own[0] if own else 0
    if result['isOwner']:
        result['projectId']=row[5] if row[5] and db.execute('SELECT 1 FROM projects WHERE id=? AND user_id=?',(row[5],owner)).fetchone() else None
        result['dislikes']=db.execute('SELECT COUNT(*) FROM share_votes WHERE token=? AND vote=-1',(token,)).fetchone()[0]
    return result

def create(db,document,owner_id,project_id=None,visibility='unlisted'):
    if visibility not in ('public','unlisted'):raise ValueError('Неверная видимость')
    version=db.execute('SELECT COALESCE(MAX(publication_version),0)+1 FROM shares WHERE owner_id=? AND project_id=?',(owner_id,project_id)).fetchone()[0] if project_id else 1
    token=secrets.token_urlsafe(24);now=int(time.time())
    db.execute('INSERT INTO shares(token,document,created,owner_id,project_id,publication_version,visibility,published_at) VALUES(?,?,?,?,?,?,?,?)',(token,json.dumps(document),now,owner_id,project_id,version,visibility,now))
    return token

def listing(db,user_id=None,sort='views',page=0,owned=False):
    if sort not in ('likes','views','usage','latest') or type(page) is not int or not 0<=page<=100000:raise ValueError('Неверная сортировка или страница')
    where,args=('owner_id=?',[user_id]) if owned else ("visibility='public'",[])
    order={'likes':'like_count DESC,published_at DESC,token','views':'view_count DESC,published_at DESC,token','usage':'usage_count DESC,published_at DESC,token','latest':'published_at DESC,rowid DESC'}[sort]
    rows=db.execute(f'SELECT token,published_at,(SELECT COUNT(*) FROM share_views v WHERE v.token=shares.token) view_count,(SELECT COUNT(*) FROM share_allocations a WHERE a.token=shares.token) usage_count,(SELECT COUNT(*) FROM share_votes l WHERE l.token=shares.token AND l.vote=1) like_count FROM shares WHERE {where} ORDER BY {order} LIMIT 13 OFFSET ?',(*args,page*12)).fetchall()
    return {'publications':[info(db,r[0],user_id) for r in rows[:12]],'hasMore':len(rows)>12,'page':page}
