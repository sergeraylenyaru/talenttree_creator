"""Talent Forge development server. Python 3.12+, no dependencies."""
import hashlib
import hmac
import json
import math
import publications
from urllib.parse import urlsplit, parse_qs
from routing import dependency_routes
from functools import lru_cache
import os
import re
import secrets
import sqlite3
import time
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
DB = os.environ.get('TALENT_DB', str(ROOT / 'data' / 'talents.sqlite3'))

def connect():
    db = sqlite3.connect(DB)
    db.execute('PRAGMA foreign_keys=ON')
    return db

def initialize():
    Path(DB).parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, login TEXT UNIQUE COLLATE NOCASE, salt TEXT, password TEXT);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER);
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT, document TEXT, updated INTEGER);
        CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY, count INTEGER, until INTEGER);
        CREATE TABLE IF NOT EXISTS favorites(id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), kind TEXT, item TEXT, created INTEGER);
        CREATE TABLE IF NOT EXISTS share_allocations(token TEXT REFERENCES shares(token), visitor TEXT, PRIMARY KEY(token,visitor));
        CREATE TABLE IF NOT EXISTS share_saves(token TEXT REFERENCES shares(token), user_id INTEGER REFERENCES users(id), PRIMARY KEY(token,user_id));
        CREATE TABLE IF NOT EXISTS shares(token TEXT PRIMARY KEY, document TEXT, created INTEGER);
        ''')
        if 'avatar' not in {row[1] for row in db.execute('PRAGMA table_info(users)')}:
            db.execute("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT 'inv_misc_questionmark'")
        publications.migrate(db)

def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def share_stats(db, token):
    allocated = db.execute('SELECT COUNT(*) FROM share_allocations WHERE token=?', (token,)).fetchone()[0]
    saved = db.execute('SELECT COUNT(*) FROM share_saves WHERE token=?', (token,)).fetchone()[0]
    return {'allocated': allocated, 'saved': saved}

@lru_cache(maxsize=1)
def builtin_images():
    return {t['icon'] for path in (ROOT / 'static' / 'presets').glob('forever-*.json') for b in json.loads(path.read_text(encoding='utf-8'))['branches'] for t in b['talents']}

@lru_cache(maxsize=1)
def avatar_catalog():
    return {item['id'] for item in json.loads((ROOT / 'static' / 'icon-catalog.json').read_text(encoding='utf-8'))}

def validate_icon(value):
    if isinstance(value, str) and value.startswith('data:') and value not in builtin_images():
        raise ValueError('Загрузка собственных иконок отключена. Выбери иконку из каталога.')

def render_rank_template(model, count):
    if not isinstance(model, dict) or not isinstance(model.get('text'), str) or len(model['text']) > 5000 or not isinstance(model.get('variables'), list) or len(model['variables']) > 32:
        raise ValueError('Проверь общее описание')
    variables = {}
    for variable in model['variables']:
        if not isinstance(variable, dict) or not isinstance(variable.get('key'), str) or not re.fullmatch(r'число[0-9]+', variable['key']) or variable['key'] in variables or not isinstance(variable.get('label'), str) or len(variable['label']) > 60 or not isinstance(variable.get('values'), list) or len(variable['values']) < count:
            raise ValueError('Проверь меняющиеся числа')
        for value in variable['values'][:count]:
            if not isinstance(value, str) or len(value) > 32 or not re.fullmatch(r'[-+]?[0-9]+(?:[.,][0-9]+)?', value) or not math.isfinite(float(value.replace(',', '.'))):
                raise ValueError('Заполни значения всех рангов числами')
        variables[variable['key']] = variable['values']
    for key in re.findall(r'\{([^{}]+)\}', model['text']):
        if key not in variables:
            raise ValueError('Неизвестное меняющееся число')
    return [re.sub(r'\{([^{}]+)\}', lambda match: variables[match.group(1)][rank], model['text']) for rank in range(count)]

def project_summary(row):
    document = json.loads(row[3])
    branch = document['branches'][0]
    icon = branch.get('icon') or next(iter(branch.get('talents', [])), {}).get('icon', 'inv_misc_questionmark')
    return {'id': row[0], 'name': row[1], 'updated': row[2], 'classIcon': document.get('classIcon'), 'icon': icon}


def validate_class_icon(value):
    if not isinstance(value, dict) or set(value) != {'background', 'layers'} or not isinstance(value['background'], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value['background']):
        raise ValueError('Проверь фон иконки класса')
    layers = value['layers']
    if not isinstance(layers, list) or not 1 <= len(layers) <= 2:
        raise ValueError('Иконка класса: один или два слоя')
    for layer in layers:
        if not isinstance(layer, dict) or set(layer) != {'icon', 'opacity'} or not isinstance(layer['icon'], str) or len(layer['icon']) > 350000 or not layer['icon'] or type(layer['opacity']) not in (int, float) or not math.isfinite(layer['opacity']) or not 0 <= layer['opacity'] <= 1:
            raise ValueError('Проверь слой иконки класса и прозрачность от 0 до 100%')
        icon = layer['icon']
        if not (re.fullmatch(r'[A-Za-z0-9_]{1,100}', icon) or icon.startswith('wotlk:') or icon in builtin_images()):
            raise ValueError('Выбери иконку класса из каталога')
        if icon.startswith('wotlk:') and not re.fullmatch(r"wotlk:shared/global/talents/[a-z]+/images/[a-z]+/[a-z0-9'_,.\-]+\.jpg", icon):
            raise ValueError('Неверная иконка класса')
        validate_icon(icon)
    return value


def validate(document):
    if not isinstance(document, dict):
        raise ValueError('Неверный документ')
    if not isinstance(document.get('name'), str) or not 1 <= len(document['name'].strip()) <= 100:
        raise ValueError('Название: от 1 до 100 символов')
    if 'classIcon' in document:
        validate_class_icon(document['classIcon'])
    branches = document.get('branches')
    if not isinstance(branches, list) or not 1 <= len(branches) <= 4:
        raise ValueError('Допустимо от 1 до 4 веток')
    ability_list = document.get('abilities')
    if not isinstance(ability_list, list) or any(not isinstance(a, dict) or not isinstance(a.get('id'), str) for a in ability_list):
        raise ValueError('Неверный список способностей')
    ability_by_id = {a['id']: a for a in ability_list}
    if len(ability_by_id) != len(ability_list):
        raise ValueError('Повторяющийся идентификатор способности')
    for branch in branches:
        for talent in branch.get('talents', []):
            if isinstance(talent, dict) and talent.get('grantedAbilityId'):
                linked = ability_by_id.get(talent['grantedAbilityId'])
                if not linked or any(not isinstance(linked.get(k), str) for k in ('name', 'icon', 'description')):
                    raise ValueError('Способность таланта не найдена')
                talent.update(name=linked['name'], icon=linked['icon'], maxRank=1, descriptions=[linked['description']])
                talent.pop('rankTemplate', None)
    ids = set()
    branch_ids = set()
    for branch in branches:
        if not isinstance(branch, dict) or not isinstance(branch.get('id'), str) or branch['id'] in branch_ids or not isinstance(branch.get('name'), str):
            raise ValueError('Неверная ветка')
        branch_ids.add(branch['id'])
        if 'icon' in branch:
            if not isinstance(branch['icon'], str):
                raise ValueError('Неверная иконка ветки')
            validate_icon(branch['icon'])
        rows = branch.get('rows')
        if type(rows) is not int or not 1 <= rows <= 1000:
            raise ValueError('Допустимо от 1 до 1000 рядов')
        positions = set()
        for talent in branch.get('talents', []):
            if not isinstance(talent, dict) or not isinstance(talent.get('name'), str) or not isinstance(talent.get('icon'), str):
                raise ValueError('Неверный талант')
            validate_icon(talent.get('icon'))
            position = (talent.get('row'), talent.get('col'))
            if any(type(x) is not int for x in position) or not 0 <= position[0] < rows or not 0 <= position[1] < 4 or position in positions:
                raise ValueError('Неверная позиция таланта')
            positions.add(position)
            if not isinstance(talent.get('id'), str) or talent['id'] in ids:
                raise ValueError('Повторяющийся идентификатор таланта')
            ids.add(talent['id'])
            if type(talent.get('maxRank')) is not int or not 1 <= talent['maxRank'] <= 100:
                raise ValueError('Ранги: от 1 до 100')
            if not isinstance(talent.get('descriptions'), list) or len(talent['descriptions']) != talent['maxRank'] or any(not isinstance(d, str) for d in talent['descriptions']):
                raise ValueError('Нужно описание каждого ранга')
            if 'rankTemplate' in talent and render_rank_template(talent['rankTemplate'], talent['maxRank']) != talent['descriptions']:
                raise ValueError('Описания рангов не совпадают с общим текстом')
        by_id = {t['id']: t for t in branch.get('talents', [])}
        for talent in by_id.values():
            parent = talent.get('requires')
            seen = {talent['id']}
            current = talent
            while current.get('requires'):
                parent = by_id.get(current['requires'])
                if not parent or parent['row'] > current['row'] or parent['id'] in seen:
                    raise ValueError('Зависимость должна вести к таланту в этом или предыдущем ряду, без циклов')
                seen.add(parent['id'])
                current = parent
        if any(path is None for path in dependency_routes(branch).values()):
            raise ValueError('Стрелки зависимостей пересекаются или нет свободного пути. Измени зависимость.')
    for field in ('budget', 'rowCost'):
        if type(document.get(field)) is not int or not 0 <= document[field] <= 100000:
            raise ValueError('Неверные правила очков')
    abilities = document.get('abilities')
    if document.get('version') != 1 or not isinstance(abilities, list) or any(not isinstance(a, dict) or any(not isinstance(a.get(k), str) for k in ('id', 'name', 'description', 'icon')) for a in abilities):
        raise ValueError('Неверный формат класса или способностей')
    for ability in abilities:
        if 'kind' in ability and ability['kind'] not in ('active', 'passive'):
            raise ValueError('Неверный тип способности')
        if 'branchId' in ability and ability['branchId'] not in ('', 'auto') and ability['branchId'] not in branch_ids:
            raise ValueError('Ветка способности не найдена')
        validate_icon(ability.get('icon'))
        if 'resourceType' in ability:
            if not isinstance(ability['resourceType'], str) or not 1 <= len(ability['resourceType']) <= 100:
                raise ValueError('Неверный ресурс способности')
            for field in ('resource', 'cast', 'cooldown', 'range'):
                value = ability.get(field)
                if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1000000000:
                    raise ValueError('Параметры способности должны быть неотрицательными числами')
    return document

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'static'), **kwargs)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('X-Frame-Options', 'DENY')
        super().end_headers()

    def reply(self, status, data, cookie=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def session(self, db):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            token = jar['session'].value if 'session' in jar else ''
        except cookies.CookieError:
            token = ''
        return db.execute('SELECT users.id, users.login, users.avatar FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()

    def do_GET(self):
        if self.path.startswith('/api/'):
            self.api('GET')
        else:
            super().do_GET()

    def do_POST(self):
        self.api('POST')

    def do_DELETE(self):
        self.api('DELETE')

    def api(self, method):
        try:
            data = {}
            if method != 'GET':
                origin = self.headers.get('Origin')
                if origin and origin.split('://', 1)[-1] != self.headers.get('Host'):
                    return self.reply(403, {'error': 'Недопустимый источник запроса'})
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    return self.reply(415, {'error': 'Требуется application/json'})
                size = int(self.headers.get('Content-Length', 0))
                if not 0 <= size <= 2_000_000:
                    return self.reply(413, {'error': 'Максимальный размер — 2 МБ'})
                data = json.loads(self.rfile.read(size) or '{}')
                if not isinstance(data, dict):
                    raise ValueError('Ожидается JSON-объект')
            with connect() as db:
                user = self.session(db)
                uid = user[0] if user else None
                parsed = urlsplit(self.path)
                if parsed.path == '/api/rankings' and method == 'GET':
                    query = parse_qs(parsed.query)
                    return self.reply(200, publications.listing(db, uid, query.get('sort', ['views'])[0], int(query.get('page', ['0'])[0])))
                if self.path == '/api/me' and method == 'GET':
                    return self.reply(200, {'user': {'login': user[1], 'avatar': user[2]} if user else None})
                if self.path.startswith('/api/shared/'):
                    parts = self.path.removeprefix('/api/shared/').split('/')
                    token = parts[0]
                    row = db.execute('SELECT document,owner_id,visibility FROM shares WHERE token=?', (token,)).fetchone()
                    if not row or row[2]=='private' and (uid is None or row[1]!=uid):
                        return self.reply(404, {'error': 'Ссылка не найдена или доступна только автору'})
                    jar = cookies.SimpleCookie()
                    try:
                        jar.load(self.headers.get('Cookie', ''))
                    except cookies.CookieError:
                        jar = cookies.SimpleCookie()
                    visitor = jar['visitor'].value if 'visitor' in jar else ''
                    if not re.fullmatch(r'[A-Za-z0-9_-]{32,64}', visitor):
                        visitor = secrets.token_urlsafe(32)
                    secure = '; Secure' if os.environ.get('COOKIE_SECURE') == '1' else ''
                    cookie = f'visitor={visitor}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000{secure}'
                    if len(parts) == 1 and method == 'GET':
                        db.execute('INSERT OR IGNORE INTO share_views VALUES(?,?)', (token, hashlib.sha256(visitor.encode()).hexdigest()))
                        db.commit()
                        return self.reply(200, {'document': json.loads(row[0]), 'stats': share_stats(db, token), 'publication': publications.info(db, token, uid)}, cookie)
                    if len(parts) == 2 and parts[1] == 'interact' and method == 'POST':
                        db.execute('INSERT OR IGNORE INTO share_allocations VALUES(?,?)', (token, hashlib.sha256(visitor.encode()).hexdigest()))
                        db.commit()
                        return self.reply(200, {'stats': share_stats(db, token), 'publication': publications.info(db, token, uid)}, cookie)
                    if len(parts) == 2 and parts[1] == 'vote' and method == 'POST':
                        if not user:
                            return self.reply(401, {'error': 'Для голосования войдите в аккаунт'})
                        owner = db.execute('SELECT owner_id FROM shares WHERE token=?', (token,)).fetchone()[0]
                        if owner == uid:
                            return self.reply(403, {'error': 'Нельзя оценивать собственную публикацию'})
                        vote = data.get('vote')
                        if type(vote) is not int or vote not in (-1, 0, 1):
                            raise ValueError('Неверная оценка')
                        previous = db.execute('SELECT vote FROM share_votes WHERE token=? AND user_id=?', (token, uid)).fetchone()
                        if vote == 0 or previous and previous[0] == vote:
                            db.execute('DELETE FROM share_votes WHERE token=? AND user_id=?', (token, uid))
                        else:
                            db.execute('INSERT INTO share_votes VALUES(?,?,?) ON CONFLICT(token,user_id) DO UPDATE SET vote=excluded.vote', (token, uid, vote))
                        db.commit()
                        return self.reply(200, {'publication': publications.info(db, token, uid)})
                    return self.reply(404, {'error': 'Не найдено'})
                if self.path in ('/api/register', '/api/login') and method == 'POST':
                    login, password = data.get('login', ''), data.get('password', '')
                    if not isinstance(login, str) or not isinstance(password, str) or not re.fullmatch(r'[A-Za-z0-9_\-]{3,32}', login) or not 8 <= len(password) <= 128:
                        raise ValueError('Логин: 3–32 латинские буквы, цифры, _ или -. Пароль: 8–128 символов.')
                    key = self.client_address[0]
                    attempt = db.execute('SELECT count, until FROM attempts WHERE key=?', (key,)).fetchone()
                    if attempt and attempt[1] > time.time() and attempt[0] >= 20:
                        return self.reply(429, {'error': 'Слишком много попыток. Повторите через 15 минут.'})
                    db.execute('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<? THEN 1 ELSE count+1 END, until=CASE WHEN until<? THEN excluded.until ELSE until END', (key, time.time()+900, time.time(), time.time()))
                    db.commit()
                    if self.path == '/api/register':
                        salt = secrets.token_hex(16)
                        try:
                            cursor = db.execute('INSERT INTO users(login,salt,password) VALUES(?,?,?)', (login, salt, password_hash(password, salt)))
                        except sqlite3.IntegrityError:
                            return self.reply(409, {'error': 'Логин уже занят'})
                        uid = cursor.lastrowid
                    else:
                        row = db.execute('SELECT id,salt,password FROM users WHERE login=?', (login,)).fetchone()
                        actual = password_hash(password, row[1] if row else '00'*16)
                        if not row or not hmac.compare_digest(row[2], actual):
                            return self.reply(401, {'error': 'Неверный логин или пароль'})
                        uid = row[0]
                    token = secrets.token_urlsafe(32)
                    db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
                    db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), uid, time.time()+604800))
                    db.commit()
                    secure = '; Secure' if os.environ.get('COOKIE_SECURE') == '1' else ''
                    profile = db.execute('SELECT login,avatar FROM users WHERE id=?', (uid,)).fetchone()
                    return self.reply(200, {'user': {'login': profile[0], 'avatar': profile[1]}}, f'session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800{secure}')
                if not user:
                    return self.reply(401, {'error': 'Войдите в аккаунт'})
                if self.path == '/api/profile/avatar' and method == 'POST':
                    avatar = data.get('avatar')
                    if not isinstance(avatar, str) or len(avatar) > 350000 or not (re.fullmatch(r'[A-Za-z0-9_]{1,100}', avatar) or avatar in avatar_catalog()):
                        raise ValueError('Выбери аватар из каталога иконок')
                    validate_icon(avatar)
                    db.execute('UPDATE users SET avatar=? WHERE id=?', (avatar, uid))
                    db.commit()
                    return self.reply(200, {'user': {'login': user[1], 'avatar': avatar}})
                if parsed.path == '/api/publications' and method == 'GET':
                    query = parse_qs(parsed.query)
                    return self.reply(200, publications.listing(db, uid, 'latest', int(query.get('page', ['0'])[0]), owned=True))
                if self.path == '/api/publish' and method == 'POST':
                    pid, visibility = data.get('projectId'), data.get('visibility', 'unlisted')
                    if not isinstance(pid, str):
                        raise ValueError('Сначала сохраните класс')
                    db.execute('BEGIN IMMEDIATE')
                    saved = db.execute('SELECT document FROM projects WHERE id=? AND user_id=?', (pid, uid)).fetchone()
                    if not saved:
                        return self.reply(404, {'error': 'Сохранённый класс не найден'})
                    document = validate(json.loads(saved[0]))
                    token = publications.create(db, document, uid, pid, visibility)
                    db.commit()
                    return self.reply(200, {'token': token, 'publication': publications.info(db, token, uid)})
                if self.path.startswith('/api/publications/') and self.path.endswith('/visibility') and method == 'POST':
                    token = self.path.removeprefix('/api/publications/').removesuffix('/visibility')
                    owner = db.execute('SELECT owner_id FROM shares WHERE token=?', (token,)).fetchone()
                    if not owner or owner[0] != uid:
                        return self.reply(404, {'error': 'Публикация не найдена'})
                    visibility = data.get('visibility')
                    if visibility not in ('public', 'unlisted', 'private'):
                        raise ValueError('Неверная видимость')
                    db.execute('UPDATE shares SET visibility=? WHERE token=?', (visibility, token))
                    db.commit()
                    return self.reply(200, {'publication': publications.info(db, token, uid)})
                if self.path == '/api/favorites' and method == 'GET':
                    rows = db.execute('SELECT id,kind,item FROM favorites WHERE user_id=? ORDER BY created DESC', (user[0],)).fetchall()
                    return self.reply(200, {'favorites': [{'id': r[0], 'kind': r[1], 'item': json.loads(r[2])} for r in rows]})
                if self.path == '/api/favorites' and method == 'POST':
                    kind, item = data.get('kind'), data.get('item')
                    if kind not in ('talent', 'ability') or not isinstance(item, dict):
                        raise ValueError('Неверный элемент избранного')
                    check = {'version': 1, 'name': 'Избранное', 'budget': 71, 'rowCost': 5, 'build': {}, 'branches': [{'id': 'favorite', 'name': 'Избранное', 'rows': 1, 'talents': []}], 'abilities': []}
                    item = dict(item)
                    item['id'] = secrets.token_hex(12)
                    if kind == 'talent':
                        item.update(row=0, col=0, requires='')
                        item.pop('grantedAbilityId', None)
                        check['branches'][0]['talents'] = [item]
                    else:
                        item['talentId'] = ''
                        item['branchId'] = ''
                        check['abilities'] = [item]
                    validate(check)
                    fid = secrets.token_hex(12)
                    db.execute('INSERT INTO favorites VALUES(?,?,?,?,?)', (fid, user[0], kind, json.dumps(item), int(time.time())))
                    db.commit()
                    return self.reply(200, {'id': fid})
                if self.path.startswith('/api/favorites/') and method == 'DELETE':
                    fid = self.path.removeprefix('/api/favorites/')
                    deleted = db.execute('DELETE FROM favorites WHERE id=? AND user_id=?', (fid, user[0])).rowcount
                    db.commit()
                    return self.reply(200, {}) if deleted else self.reply(404, {'error': 'Элемент не найден'})
                if self.path == '/api/share' and method == 'POST':
                    document = validate(data['document'])
                    token = publications.create(db, document, uid, visibility=data.get('visibility', 'unlisted'))
                    db.commit()
                    return self.reply(200, {'token': token})
                if self.path == '/api/logout' and method == 'POST':
                    jar = cookies.SimpleCookie(self.headers.get('Cookie', ''))
                    if 'session' in jar:
                        db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(jar['session'].value.encode()).hexdigest(),))
                    db.commit()
                    return self.reply(200, {}, 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
                if self.path == '/api/projects' and method == 'GET':
                    rows = db.execute('SELECT id,name,updated,document FROM projects WHERE user_id=? ORDER BY updated DESC', (user[0],)).fetchall()
                    return self.reply(200, {'projects': [project_summary(r) for r in rows]})
                if self.path == '/api/projects' and method == 'POST':
                    document = validate(data['document'])
                    pid = data.get('id')
                    if pid is None:
                        pid = secrets.token_hex(12)
                    if not isinstance(pid, str) or not re.fullmatch(r'[a-f0-9]{24}', pid):
                        raise ValueError('Неверный идентификатор проекта')
                    shared_from = data.get('sourceShare')
                    if isinstance(shared_from, str):
                        source = db.execute('SELECT owner_id,visibility FROM shares WHERE token=?', (shared_from,)).fetchone()
                        if source and source[1]=='private' and source[0]!=uid:
                            return self.reply(404, {'error': 'Публикация доступна только автору'})
                    existing = db.execute('SELECT user_id FROM projects WHERE id=?', (pid,)).fetchone()
                    if existing and existing[0] != user[0]:
                        return self.reply(404, {'error': 'Проект не найден'})
                    db.execute('INSERT INTO projects VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated=excluded.updated', (pid,user[0],document['name'],json.dumps(document),int(time.time())))
                    shared_from = data.get('sourceShare')
                    if isinstance(shared_from, str) and db.execute('SELECT 1 FROM shares WHERE token=?', (shared_from,)).fetchone():
                        db.execute('INSERT OR IGNORE INTO share_saves VALUES(?,?)', (shared_from, user[0]))
                    db.commit()
                    return self.reply(200, {'id': pid})
                if self.path.startswith('/api/projects/'):
                    pid = self.path.removeprefix('/api/projects/')
                    row = db.execute('SELECT document FROM projects WHERE id=? AND user_id=?', (pid,user[0])).fetchone()
                    if not row:
                        return self.reply(404, {'error': 'Проект не найден'})
                    if method == 'GET':
                        return self.reply(200, {'document': json.loads(row[0]), 'id': pid})
                    if method == 'DELETE':
                        db.execute('DELETE FROM projects WHERE id=? AND user_id=?', (pid,user[0]))
                        db.commit()
                        return self.reply(200, {})
                self.reply(404, {'error': 'Не найдено'})
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            self.reply(400, {'error': str(error) or 'Неверный запрос'})

if __name__ == '__main__':
    initialize()
    port = int(os.environ.get('PORT', '8000'))
    print(f'Talent Forge: http://localhost:{port}', flush=True)
    ThreadingHTTPServer((os.environ.get('HOST', '127.0.0.1'), port), Handler).serve_forever()
