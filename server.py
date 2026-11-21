import wowhead_items
from combat_rules import ADVANCED_TYPES, validate_advanced_effect, aura_metadata
import struct
import copy
"""TalentForge HTTP server. Python 3.12+, SQLite; Pillow for admin icon uploads."""
import accounts
import site_content
import hashlib
import hmac
import json
import math
import publications
from urllib.parse import urlsplit, parse_qs, unquote
from routing import dependency_routes
from rpg_profile import validate_rpg
from functools import lru_cache
import os
import re
import secrets
import sys
import unicodedata
import sqlite3
import time
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
DB = os.environ.get('TALENT_DB', str(ROOT / 'data' / 'talents.sqlite3'))

class ClosingConnection(sqlite3.Connection):
    """Keep SQLite commit/rollback semantics and release the file on context exit."""
    def __exit__(self, *exc):
        try:
            return super().__exit__(*exc)
        finally:
            self.close()


def connect():
    db = sqlite3.connect(DB, factory=ClosingConnection)
    try:
        db.execute('PRAGMA foreign_keys=ON')
    except BaseException:
        db.close()
        raise
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
        if 'show_3d' not in {row[1] for row in db.execute('PRAGMA table_info(users)')}:
            db.execute('ALTER TABLE users ADD COLUMN show_3d INTEGER NOT NULL DEFAULT 0')
        if 'language' not in {row[1] for row in db.execute('PRAGMA table_info(users)')}:
            db.execute("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'")
        accounts.migrate(db)
        site_content.migrate(db)
        publications.migrate(db)
        publications.purge_archived(db)

def profile_info(db, uid):
    row=db.execute('SELECT login,avatar,show_3d,language,email,email_verified,is_admin FROM users WHERE id=?',(uid,)).fetchone()
    return {'login':row[0],'avatar':publications.avatar_value(row[1]),'show3d':bool(row[2]),'language':row[3],'email':row[4],'emailVerified':bool(row[5]),'isAdmin':bool(row[6])}

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
    return {item['id'] for name in ('icon-catalog.json','retail-icons.json') for item in json.loads((ROOT / 'static' / name).read_text(encoding='utf-8'))}

def validate_icon(value):
    if isinstance(value,str) and value.startswith('retail:') and value not in avatar_catalog():raise ValueError('Выбери иконку из каталога')
    if isinstance(value,str) and value.startswith('custom:'):
        if not re.fullmatch(r'custom:[a-f0-9]{32}',value):raise ValueError('Invalid icon')
        with connect() as db:
            if not db.execute('SELECT 1 FROM icon_assets WHERE id=?',(value[7:],)).fetchone():raise ValueError('Icon not found')
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
    return {'id': row[0], 'name': row[1],'subtitle':document.get('subtitle',''), 'updated': row[2], 'classIcon': document.get('classIcon'), 'icon': icon,'archived':row[4] is not None,'archivedAt':row[4],'expiresAt':row[4]+30*86400 if row[4] is not None else None,'published':bool(row[5])}

def draft_title_key(document):
    return ' '.join(unicodedata.normalize('NFKC',document['name']+' '+document.get('subtitle','')).casefold().split())

def duplicate_draft(db,uid,document,exclude=None):
    key=draft_title_key(document)
    for pid,raw in db.execute('SELECT id,document FROM projects WHERE user_id=? AND archived_at IS NULL AND id<>?',(uid,exclude or '')):
        if draft_title_key(json.loads(raw))==key:return pid
    return None


def preset_catalog():
    directory=ROOT/'static'/'presets'
    try:index=json.loads((directory/'index.json').read_text(encoding='utf-8'))
    except (OSError,ValueError):index=[]
    known={item['id']:item for item in index if isinstance(item,dict) and isinstance(item.get('id'),str) and (directory/(item['id']+'.json')).is_file()}
    for path in sorted(directory.glob('*.json')):
        if path.stem=='index':continue
        document=json.loads(path.read_text(encoding='utf-8'));version=document.get('source',{}).get('version','3.3.5a')
        known[path.stem]={'id':path.stem,'name':known.get(path.stem,{}).get('name') or document['name'].removesuffix(' · '+version),'version':version,'talents':sum(len(b['talents']) for b in document['branches'])}
    return list(known.values())

def validate_class_icon(value):
    color=lambda c:isinstance(c,str) and re.fullmatch(r'#[0-9a-fA-F]{6}',c)
    number=lambda v,lo,hi:type(v) in (int,float) and math.isfinite(v) and lo<=v<=hi
    if not isinstance(value,dict) or 'layers' not in value or set(value)-{'background','layers','glow'} or ('background' in value and not color(value['background'])):
        raise ValueError('Проверь фон иконки класса')
    if 'glow' in value:
        g=value['glow']
        if not isinstance(g,dict) or set(g)!={'color','radius','strength'} or not color(g['color']) or not number(g['radius'],0,100) or not number(g['strength'],0,100):
            raise ValueError('Проверь свечение фона')
    layers=value['layers']
    if not isinstance(layers,list) or not 1<=len(layers)<=2:
        raise ValueError('Иконка класса: один или два слоя')
    for layer in layers:
        if not isinstance(layer,dict) or not {'icon','opacity'}<=set(layer) or set(layer)-{'icon','opacity','x','y','scale','rotation'} or not isinstance(layer['icon'],str) or not 1<=len(layer['icon'])<=350000 or not number(layer['opacity'],0,1):
            raise ValueError('Проверь слой и его непрозрачность')
        for key,lo,hi in [('x',-100,100),('y',-100,100),('scale',.75,1.5),('rotation',-180,180)]:
            if key in layer and not number(layer[key],lo,hi):raise ValueError('Проверь положение, масштаб 75–150% и угол слоя')
        icon=layer['icon']
        if not (re.fullmatch(r'[A-Za-z0-9_-]{1,100}',icon) or icon.startswith(('wotlk:','custom:','retail:')) or icon in builtin_images()):raise ValueError('Выбери иконку из каталога')
        if icon.startswith('wotlk:') and not re.fullmatch(r"wotlk:shared/global/talents/[a-z]+/images/[a-z]+/[a-z0-9'_,.\-]+\.jpg",icon):raise ValueError('Неверная иконка класса')
        validate_icon(icon)
    return value


PRESENTATION_ANIMATIONS = ('sword', 'twoHand', 'bow', 'cast', 'area', 'channel', 'guard', 'movement', 'hurt')
EFFECT_PRESETS = (
    'fireball', 'fireImpact', 'burning', 'flameBurst', 'frostbolt', 'frostImpact', 'frostNova', 'iceShards',
    'arcaneProjectile', 'arcaneImpact', 'arcaneExplosion', 'natureProjectile', 'poisonImpact', 'natureBurst',
    'shadowProjectile', 'shadowImpact', 'darkEnergy', 'weaponTrail', 'meleeImpact', 'heavyStrike', 'rangedProjectile',
)
ANIMATION_FIELDS = ('animation', 'castingAnimation', 'attackAnimation', 'startAnimation', 'finishAnimation', 'impactAnimation')
PRESENTATION_OPTIONS = {
    'category': ('attack', 'spell', 'healing', 'area', 'defense', 'movement', 'physical', 'magical', 'support', 'utility'),
    'delivery': ('melee', 'ranged'),
    **dict.fromkeys(ANIMATION_FIELDS, PRESENTATION_ANIMATIONS),
    'projectileOrigin': ('caster', 'hand', 'weapon'),
    'trajectory': ('linear', 'arc'),
    'impactAnchor': ('contact', 'target', 'caster', 'ground'),
    'effectPreset': EFFECT_PRESETS,
    'projectilePreset': EFFECT_PRESETS,
    'projectile': ('none', 'straight', 'homing'),
    'impact': ('none', 'melee', 'fire', 'frost', 'arcane', 'holy', 'nature', 'shadow', 'healing', 'defense'),
    'hitReaction': ('normal', 'heavy', 'none'),
    'sound': ('strike', 'spark', 'chime'),
    'targeting': ('dummy', 'self', 'area', 'targetArea', 'ground'),
}
PRESENTATION_LIMITS = {'projectileSpeed': (1, 100), 'channelDuration': (0, 120), 'arcHeight': (0, 5)}


def validate_presentation(ability):
    if 'presentation' not in ability:
        return
    data = ability['presentation']
    if not isinstance(data, dict):
        raise ValueError('Проверь оформление способности')
    for key, value in data.items():
        if key in ANIMATION_FIELDS and isinstance(value,str):
            if value == 'none' or value.startswith('clip:') and 5 < len(value) <= 155 and not re.search(r'[\x00-\x1f\x7f]',value):
                continue
        if key in PRESENTATION_OPTIONS and value in PRESENTATION_OPTIONS[key]:
            continue
        if key in PRESENTATION_LIMITS and type(value) in (int, float):
            lo, hi = PRESENTATION_LIMITS[key]
            if lo <= value <= hi:
                continue
        raise ValueError('Проверь оформление способности')


def validate_combat_effects(ability):
    if 'combatEffects' not in ability:
        return
    effects = ability['combatEffects']
    common = {'id', 'type', 'trigger'}
    timing = {'duration', 'interval', 'stacks', 'refresh', 'snapshot', 'tickPolicy'}
    bonuses = {'flatBonus', 'multiplier', 'critMultiplier', 'attackCoefficient', 'spellCoefficient'}
    def invalid():
        raise ValueError('Проверь боевые эффекты')
    def bounded(value, lo, hi):
        return type(value) in (int, float) and lo <= value <= hi
    if not isinstance(effects, list) or len(effects) > 32:
        invalid()
    ids = set()
    for effect in effects:
        if not isinstance(effect, dict):
            invalid()
        eid = effect.get('id')
        if not isinstance(eid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', eid) or eid in ids:
            invalid()
        ids.add(eid)
        if effect.get('trigger') not in ('onCast', 'onHit'):
            invalid()
        kind = effect.get('type')
        if kind in ADVANCED_TYPES:
            validate_advanced_effect(effect)
            continue
        aura_metadata(effect)
        if kind in ('damage', 'healing'):
            fields = {'baseAmount', 'scalingStat', 'coefficient', 'canCrit'} | timing | bonuses
            if kind == 'damage':
                fields.update(('school', 'minAmount', 'maxAmount','weaponCoefficient','damageKind','cap'))
                if ('damageKind' in effect and (effect['damageKind'] != 'bleed' or effect.get('school') != 'physical')
                        or 'cap' in effect and not bounded(effect['cap'],0,1e9)):
                    invalid()
                lo = effect.get('minAmount', effect.get('baseAmount'))
                hi = effect.get('maxAmount', effect.get('baseAmount'))
                if (effect.get('school') not in ('physical', 'fire', 'frost', 'arcane', 'nature', 'shadow', 'holy')
                        or not bounded(lo, 0, 1e9) or not bounded(hi, lo, 1e9)):
                    invalid()
            if (effect.get('scalingStat') not in ('none', 'spellPower', 'attackPower','healingPower')
                    or not bounded(effect.get('baseAmount'), 0, 1e9) or not bounded(effect.get('coefficient'), 0, 1000)
                    or type(effect.get('canCrit')) is not bool):
                invalid()
            for key in bonuses & effect.keys():
                if not bounded(effect[key], 0, 1e9 if key == 'flatBonus' else 1000):
                    invalid()
            if 'tickPolicy' in effect and ('interval' not in effect or effect['tickPolicy'] not in ('preserve','restart')):
                invalid()
            if ('weaponCoefficient' in effect and not bounded(effect['weaponCoefficient'],0,1000)
                    or 'snapshot' in effect and (type(effect['snapshot']) is not bool or 'interval' not in effect)):
                invalid()
            if ('duration' in effect) != ('interval' in effect):
                invalid()
            if 'interval' in effect and (not bounded(effect.get('duration'), .25, 300)
                                         or not bounded(effect['interval'], .25, effect['duration'])):
                invalid()
        elif kind == 'status':
            fields = {'target', 'name', 'description','icon', 'stat', 'amount', 'duration', 'stacks', 'refresh','school','consumeOnHit'}
            target = effect.get('target')
            stats = ('armor','damageTaken','physicalTaken','magicalTaken') if target == 'dummy' else (
                'attackPower','spellPower','healingPower','critChance','haste','movementSpeed','healingTaken',
                'armor','damageTaken','healthRegen','resourceRegen','maxHealth','maxResource','healingDone','damageDone','reflectDamage','criticalReduction')
            if ('school' in effect and (effect.get('stat') != 'damageDone'
                    or effect['school'] not in ('physical', 'fire', 'frost', 'arcane', 'nature', 'shadow', 'holy'))
                    or 'consumeOnHit' in effect and (effect.get('stat') != 'damageDone' or type(effect['consumeOnHit']) is not bool)):
                invalid()
            if 'icon' in effect and (not isinstance(effect['icon'], str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', effect['icon'])):
                invalid()
            if (target not in ('player', 'dummy') or effect.get('stat') not in stats
                    or not bounded(effect.get('amount'), -100, 500) or not bounded(effect.get('duration'), .25, 300)
                    or not isinstance(effect.get('name'), str) or not 1 <= len(effect['name'].strip()) <= 100
                    or len(effect['name']) > 100):
                invalid()
        elif kind == 'shield':
            if (effect.get('target','player') not in ('player','dummy')
                    or 'school' in effect and effect['school'] not in ('physical','fire','frost','arcane','nature','shadow','holy')):
                invalid()
            fields = {'target','school','name','description','icon','amount','fraction','coefficient','priority','duration','stacks','refresh'}
            if (not isinstance(effect.get('name'),str) or not effect['name'].strip() or len(effect['name'])>100
                    or not bounded(effect.get('amount'),0,1e9) or not bounded(effect.get('fraction'),.01,1)
                    or not bounded(effect.get('coefficient'),0,1000) or type(effect.get('priority')) is not int
                    or not bounded(effect['priority'],0,100) or not bounded(effect.get('duration'),.25,300)):
                invalid()
        elif kind == 'resource':
            fields = {'resourceId', 'amount', 'unit', 'direction'}
            if (not isinstance(effect.get('resourceId'), str) or not 1 <= len(effect['resourceId']) <= 100
                    or effect['resourceId'] == 'health' or effect.get('unit') not in ('points', 'percent', 'count')
                    or not bounded(effect.get('amount'), 0, 1e9) or effect.get('direction', 'gain') not in ('gain', 'drain')):
                invalid()
        else:
            invalid()
        if 'description' in effect and (not isinstance(effect['description'],str) or len(effect['description'])>3000):
            invalid()
        if 'icon' in effect and (not isinstance(effect['icon'],str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',effect['icon'])):
            invalid()
        if 'stacks' in effect and (type(effect['stacks']) is not int or not 1 <= effect['stacks'] <= 10):
            invalid()
        if 'refresh' in effect and effect['refresh'] not in ('refresh','refreshOnly','keep','replace','extend','independent'):
            invalid()
        if effect.get('duration'):
            fields.update(('dispelType','removable','breakOnDamage','category'))
        if 'category' in effect and (not effect.get('duration') or not isinstance(effect['category'],str) or not 1 <= len(effect['category'].strip()) or len(effect['category']) > 60):
            invalid()
        if set(effect) - common - fields:
            invalid()


WORKSHOP_LIMITS = {
    'groupCooldown':(0,3600),'finisherScale':(0,100), 'requiredLevel':(1,1000), 'baseLevel':(1,1000), 'levelScale':(0,100),
    'rank': (1, 100), 'rankScale': (0, 100), 'talentRank': (1, 100), 'minRange': (0, 100), 'charges': (1, 10),
    'recharge': (.25, 3600), 'gcdDuration': (0, 3), 'tickInterval': (.25, 120), 'radius': (.25, 30),
    'projectileLifetime': (.25, 30), 'collisionRadius': (.02, 1), 'projectileSize': (.02, 2),
    'homingStrength': (.1, 30), 'effectScale': (.1, 4), 'effectDuration': (.05, 5),
    'effectSpeed': (.1, 5), 'effectIntensity': (.1, 2), 'opacity': (0, 1), 'playback': (.25, 3), 'blend': (0, 1), 'volume': (0, 1), 'variation': (0, .5),
}
WORKSHOP_FLAGS = {'disabled', 'hidden', 'noGcd', 'interruptMovement', 'uninterruptible', 'facing', 'loopAnimation','consumeFreeAura','normalizedWeapon'}
WORKSHOP_SOUNDS = {event + 'Sound' for event in ('activation', 'cast', 'launch', 'impact', 'critical', 'tick', 'buff', 'debuff', 'heal')}


def validate_workshop(ability):
    if 'workshop' not in ability:
        return
    rules = ability['workshop']
    if not isinstance(rules, dict) or type(rules.get('version')) is not int or rules['version'] != 1:
        raise ValueError('Неверная версия настроек мастерской')
    for key, value in rules.items():
        if key == 'version' or key in WORKSHOP_FLAGS and type(value) is bool:
            continue
        if key in WORKSHOP_LIMITS and type(value) in (int, float):
            lo, hi = WORKSHOP_LIMITS[key]
            if lo <= value <= hi and (key not in ('rank', 'talentRank', 'charges') or type(value) is int):
                continue
        if key in WORKSHOP_SOUNDS and value in PRESENTATION_OPTIONS['sound']:
            continue
        if key in ('casterEffect', 'weaponEffect', 'projectileEffect') and value in PRESENTATION_OPTIONS['impact']:
            continue
        if key == 'flightDirection' and value in ('aim', 'forward'):
            continue
        if key == 'areaShape' and value in ('circle', 'cone'):
            continue
        if key == 'color' and isinstance(value, str) and re.fullmatch(r'#[a-fA-F0-9]{6}', value):
            continue
        if key == 'cooldownGroup' and isinstance(value,str) and 1 <= len(value.strip()) <= 60:
            continue
        if key == 'channelPayment' and value in ('start','firstTick'):
            continue
        if key == 'swingPolicy' and value in ('continue','pause','reset'):
            continue
        if key == 'attackType' and value in ('melee','ranged','spell'):
            continue
        if key == 'weaponHand' and value in ('mainHand','offHand','ranged'):
            continue
        if key == 'attackSchool' and value in ('physical','fire','frost','arcane','nature','shadow','holy'):
            continue
        if key == 'requiredClass' and value in ('warrior','paladin','hunter','rogue','priest','shaman','mage','warlock','druid','deathknight'):
            continue
        if key == 'requiredStateKey' and value in ('form','stance','aspect','seal','mode'):
            continue
        if key in ('freeWithAura','finisherResource','runeSubstitute') and isinstance(value,str) and 1 <= len(value) <= 200:
            continue
        if key == 'requiredStateValue' and isinstance(value,str) and 1 <= len(value) <= 60:
            continue
        if key == 'tier' and isinstance(value, str) and len(value) <= 40:
            continue
        raise ValueError('Проверь настройку способности: ' + key)
    if 'groupCooldown' in rules and not rules.get('cooldownGroup'):
        raise ValueError('Укажи группу перезарядки')
    presentation = ability.get('presentation', {})
    effects = ability.get('combatEffects', [])
    projectile = presentation.get('projectile') in ('straight', 'homing')
    melee = presentation.get('delivery') == 'melee'
    if rules.get('tickInterval') and (rules['tickInterval'] > presentation.get('channelDuration', 0) or melee or projectile):
        raise ValueError('Интервал должен помещаться в длительность канала. Для тиков нужна мгновенная доставка.')
    for key in ('cast', 'cooldown', 'range'):
        value = ability.get(key)
        if type(value) not in (int, float) or not 0 <= value <= 1e9:
            raise ValueError('Проверь время применения, перезарядку и дальность')
    target = presentation.get('targeting')
    max_range = min(ability['range'] or 2, 2) if melee else ability['range'] or (8 if target == 'area' else 30)
    if rules.get('minRange', 0) > max_range:
        raise ValueError('Минимальная дальность превышает максимальную')
    category = presentation.get('category')
    if category == 'healing' and not any(e['type'] == 'healing' for e in effects):
        raise ValueError('Добавь эффект лечения')
    if category == 'attack' and not any(e['type'] == 'damage' for e in effects):
        raise ValueError('Добавь эффект урона')
    if target == 'self' and any(e['type'] == 'damage' or e.get('target') == 'dummy' for e in effects):
        raise ValueError('Урон и ослабления требуют враждебную цель')
    if target == 'ground' and (melee or projectile):
        raise ValueError('Для точки на земле выбери мгновенную доставку')


def validate(document):
    if not isinstance(document, dict):
        raise ValueError('Неверный документ')
    if not isinstance(document.get('name'), str) or not 1 <= len(document['name'].strip()) <= 100:
        raise ValueError('Название: от 1 до 100 символов')
    for field,limit in (('subtitle',120),('description',10000)):
        if field in document and (not isinstance(document[field],str) or len(document[field])>limit):raise ValueError('Проверь дополнительную строку и описание класса')
    if 'specialization' in document:
        spec=document['specialization']
        if not isinstance(spec,dict) or type(spec.get('requiredPoints')) is not int or not 1<=spec['requiredPoints']<=100000:raise ValueError('Неверные правила специализации')
    if 'primaryBranchEnabled' in document and type(document['primaryBranchEnabled']) is not bool:raise ValueError('Проверь настройку основной ветки')
    if 'classIcon' in document:
        validate_class_icon(document['classIcon'])
    branches = document.get('branches')
    if not isinstance(branches, list) or not 1 <= len(branches) <= 4:
        raise ValueError('Допустимо от 1 до 4 веток')
    ability_list = document.get('abilities')
    if not isinstance(ability_list, list) or any(not isinstance(a, dict) or not isinstance(a.get('id'), str) or not a['id'] for a in ability_list):
        raise ValueError('Неверный список способностей')
    ability_by_id = {a['id']: a for a in ability_list}
    if len(ability_by_id) != len(ability_list):
        raise ValueError('Повторяющийся идентификатор способности')
    for branch in branches:
        for talent in branch.get('talents', []):
            if isinstance(talent, dict) and 'grantedAbilityId' in talent:
                granted = talent['grantedAbilityId']
                if not isinstance(granted, str):
                    raise ValueError('Способность таланта не найдена')
                if not granted:
                    continue
                linked = ability_by_id.get(granted)
                if not linked or any(not isinstance(linked.get(k), str) for k in ('name', 'icon', 'description')):
                    raise ValueError('Способность таланта не найдена')
                rules = linked.get('workshop')
                rank = rules.get('rank', 1) if isinstance(rules, dict) else 1
                if type(rank) is not int or not 1 <= rank <= 100:
                    raise ValueError('Проверь ранг способности')
                talent.update(name=linked['name'], icon=linked['icon'], maxRank=rank,
                              descriptions=[linked['description']] * rank)
                talent.pop('rankTemplate', None)
    ids = set()
    branch_ids = set()
    for branch in branches:
        if not isinstance(branch, dict) or not isinstance(branch.get('id'), str) or branch['id'] in branch_ids or not isinstance(branch.get('name'), str):
            raise ValueError('Неверная ветка')
        if 'color' in branch and (not isinstance(branch['color'],str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',branch['color'])):
            raise ValueError('Неверный цвет фона ветки')
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
            if 'requiredLevel' in talent and (type(talent['requiredLevel']) is not int or not 1 <= talent['requiredLevel'] <= 1000):
                raise ValueError('Неверный требуемый уровень таланта')
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
        current=ability
        owner_chain={ability['id']}
        while 'instanceOwnerId' in current:
            owner=current['instanceOwnerId']
            if not isinstance(owner,str) or owner in owner_chain or owner not in ability_by_id:
                raise ValueError('Invalid ability instance owner')
            owner_chain.add(owner)
            current=ability_by_id[owner]
        if 'templateSource' in ability:
            source = ability['templateSource']
            if (not isinstance(source, dict) or set(source) != {'id', 'name'}
                    or any(not isinstance(source[key], str) or not 1 <= len(source[key]) <= 200 for key in ('id', 'name'))):
                raise ValueError('Проверь источник шаблона способности')
        validate_combat_effects(ability)
        for effect in ability.get('combatEffects', []):
            if (effect['type'] == 'cooldown' and effect['abilityId'] != 'self'
                    and not any(entry['id'] == effect['abilityId'] for entry in abilities)):
                raise ValueError('Способность для изменения перезарядки не найдена')
        validate_workshop(ability)
        validate_presentation(ability)
        if 'channeled' in ability and type(ability['channeled']) is not bool:raise ValueError('Проверь настройку поддерживаемого заклинания')
        if 'learningMode' in ability and ability['learningMode'] not in ('base','talent','specialization'):raise ValueError('Неверный способ изучения способности')
        if 'requirements' in ability and ((len(ability['requirements'])>1000) if isinstance(ability['requirements'],str) else (not isinstance(ability['requirements'],list) or len(ability['requirements'])>40 or any(not isinstance(item,str) or not item.strip() or len(item)>100 for item in ability['requirements']) or len(set(ability['requirements']))!=len(ability['requirements']))):raise ValueError('Проверь требования способности')
        if ability.get('learningMode')=='specialization' and ('specialization' not in document or ability.get('branchId') not in branch_ids):raise ValueError('Выбери ветку для способности специализации')
        if 'branchOnly' in ability and type(ability['branchOnly']) is not bool:raise ValueError('Проверь ограничение способности по ветке')
        if ability.get('branchOnly') and ability.get('branchId') not in branch_ids:raise ValueError('Выбери ветку для способности')
        if 'resourceUnit' in ability and ability['resourceUnit'] not in ('points','percent','count'):raise ValueError('Неверные единицы ресурса')
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
    if 'character' in document:
        c=document['character']
        if isinstance(c,dict) and 'hpDescription' in c and (not isinstance(c['hpDescription'],str) or len(c['hpDescription'])>3000):raise ValueError('Описание ресурса: до 3000 символов')
        if not isinstance(c,dict) or type(c.get('hp')) is not int or not 1<=c['hp']<=100000000 or any(not isinstance(c.get(k),str) for k in ('race','gender','armory')) or not isinstance(c.get('resources'),list):raise ValueError('Неверные настройки персонажа')
        for key,allowed in [('armorTypes',['cloth','leather','mail','plate','shield']),('weaponTypes',['sword1','sword2','axe1','axe2','mace1','mace2','dagger','staff','polearm','fist','bow','crossbow','gun','wand','thrown','offhand'])]:
            if key in c and (not isinstance(c[key],list) or any(not isinstance(v,str) or v not in allowed for v in c[key]) or len(set(c[key]))!=len(c[key])):raise ValueError('Неверная экипировка')
        for key in ('customArmorTypes','customWeaponTypes'):
            if key in c:
                if not isinstance(c[key],list):raise ValueError('Неверная экипировка')
                ids=set()
                for item in c[key]:
                    if not isinstance(item,dict) or not isinstance(item.get('id'),str) or item['id'] in ids or not isinstance(item.get('name'),str) or not 1<=len(item['name'].strip())<=60 or type(item.get('enabled')) is not bool:raise ValueError('Неверная экипировка')
                    ids.add(item['id']);validate_class_icon({'layers':[{'icon':item.get('icon'),'opacity':1}]})
        for r in c['resources']:
            if isinstance(r,dict) and 'description' in r and (not isinstance(r['description'],str) or len(r['description'])>3000):raise ValueError('Описание ресурса: до 3000 символов')
            if isinstance(r,dict) and r.get('display')=='icons' and type(r.get('max')) is int and r['max']>20:raise ValueError('Для фигур допустимо не более 20')
            if not isinstance(r,dict) or not isinstance(r.get('name'),str) or not r['name'].strip() or type(r.get('max')) is not int or not 1<=r['max']<=100000000 or type(r.get('current')) is not int or not 0<=r['current']<=r['max'] or r.get('unit','points') not in ('points','percent','count') or r.get('display') not in ('bar','icons') or r.get('shape') not in ('circle','diamond','triangle','crystal','gem','orb','flame','star') or not isinstance(r.get('color'),str) or not re.fullmatch('#[0-9a-fA-F]{6}',r['color']) or (r['display']=='icons' and r['max']>20):raise ValueError('Неверный ресурс')
    resources=document.get('character',{}).get('resources',[{'name':'Мана'}])
    resource_ids={'health'}
    for i,resource in enumerate(resources):
        rid=resource.get('id','legacy:'+str(i))
        if not isinstance(rid,str) or not 1<=len(rid)<=100 or rid in resource_ids:raise ValueError('Неверный ресурс')
        resource_ids.add(rid)
    for ability in abilities:
        if ability.get('workshop',{}).get('finisherResource') not in (None,*resource_ids):
            raise ValueError('Выбери ресурс финишера')
        if any(effect['type'] == 'resource' and effect['resourceId'] not in resource_ids
               for effect in ability.get('combatEffects', [])):
            raise ValueError('Выбери ресурс класса для восстановления')
        if 'resourceCosts' not in ability:continue
        costs=ability['resourceCosts']
        if not isinstance(costs,list):raise ValueError('Проверь затраты ресурсов')
        seen=set()
        for cost in costs:
            if not isinstance(cost,dict) or not isinstance(cost.get('resourceId'),str) or cost['resourceId'] not in resource_ids or cost['resourceId'] in seen or type(cost.get('amount')) not in (int,float) or not math.isfinite(cost['amount']) or not 0<=cost['amount']<=1000000000 or cost.get('unit') not in ('points','percent','count') or ('resourceName' in cost and (not isinstance(cost['resourceName'],str) or len(cost['resourceName'])>100)):raise ValueError('Выбери ресурсы класса для каждой затраты и проверь количество')
            seen.add(cost['resourceId'])
        for field in ('cast','cooldown','range'):
            value=ability.get(field)
            if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1000000000:raise ValueError('Параметры способности должны быть неотрицательными числами')
    validate_rpg(document,resource_ids)
    for saved in document.get('rpg',{}).get('builds',[]):
        if 'combatSnapshot' in saved:
            validate(saved['combatSnapshot'])
    return publications.without_build(document)

def prepare_favorite_ability(source):
    """Detach a template bundle, remap its root and validate every owned rule."""
    item=copy.deepcopy(source)
    original=item.get('id')
    item['id']=secrets.token_hex(12)
    item.update(talentId='',branchId='',branchOnly=False,learningMode='base')
    dependencies=item.get('templateAbilities',[])
    if (not isinstance(dependencies,list) or len(dependencies)>128
            or any(not isinstance(entry,dict) or 'templateAbilities' in entry or 'templateRules' in entry for entry in dependencies)):
        raise ValueError('Invalid template dependency bundle')
    rules=item.get('templateRules',{})
    if not isinstance(rules,dict) or set(rules)-{'bonuses','procs'}:
        raise ValueError('Invalid template rules')
    records=[item,*dependencies]
    for record in records:
        if record.get('instanceOwnerId')==original:record['instanceOwnerId']=item['id']
        for effect in record.get('combatEffects',[]):
            if effect.get('type')=='cooldown' and effect.get('abilityId')==original:
                effect['abilityId']=item['id']
    for entries in rules.values():
        if not isinstance(entries,list):raise ValueError('Invalid template rules')
        for rule in entries:
            if not isinstance(rule,dict):raise ValueError('Invalid template rule')
            if isinstance(rule.get('owner'),dict) and rule['owner'].get('id')==original:
                rule['owner']['id']=item['id']
            for field in ('spell','sourceAbilityId'):
                if rule.get(field)==original:rule[field]=item['id']
            def remap_condition(condition,depth=0):
                if condition is None:return
                if depth>2 or not isinstance(condition,dict):raise ValueError('Invalid combat condition')
                if condition.get('type') in ('playerStatus','dummyStatus','auraStacks') and condition.get('value')==original:condition['value']=item['id']
                if condition.get('abilityId')==original:condition['abilityId']=item['id']
                for child in condition.get('conditions',[]):remap_condition(child,depth+1)
                if 'condition' in condition:remap_condition(condition['condition'],depth+1)
            remap_condition(rule.get('condition'))
    refs={}
    def add_resource(rid,name=None):
        if not isinstance(rid,str) or not 1<=len(rid)<=100:raise ValueError('Invalid template resource')
        refs[rid]=name if isinstance(name,str) and name else rid
    for record in records:
        if record.get('workshop',{}).get('runeSubstitute'):add_resource(record['workshop']['runeSubstitute'])
        for cost in record.get('resourceCosts',[]):
            if isinstance(cost,dict):add_resource(cost.get('resourceId'),cost.get('resourceName'))
        for effect in record.get('combatEffects',[]):
            if isinstance(effect,dict) and effect.get('type')=='resource':add_resource(effect.get('resourceId'))
            if isinstance(effect,dict) and effect.get('type')=='rune':
                for key in ('fromResource','toResource'):add_resource(effect.get(key))
    for rule in rules.get('procs',[]):
        cost=rule.get('cost')
        if isinstance(cost,dict):add_resource(cost.get('resourceId'))
    def condition_resources(condition):
        if not condition:return
        if condition.get('type') in ('resourceAbove','resourceBelow'):add_resource(condition.get('resource'))
        for child in condition.get('conditions',[]):condition_resources(child)
        if 'condition' in condition:condition_resources(condition['condition'])
    for entries in rules.values():
        for rule in entries:condition_resources(rule.get('condition'))
    refs.pop('health',None)
    if any(not isinstance(key,str) for key in refs):raise ValueError('Invalid template resource')
    check={'version':1,'name':'Favorite template','budget':71,'rowCost':5,'build':{},
      'branches':[{'id':'favorite','name':'Favorite','rows':1,'talents':[]}],
      'character':{'hp':100,'race':'Human','gender':'Male','armory':'','resources':[
        {'id':rid,'name':name,'max':100,'current':100,'unit':'points','display':'bar','shape':'circle','color':'#397de1'} for rid,name in refs.items()]},
      'abilities':records,'rpg':{'version':1,**rules,'resources':{rid:{'rune':True} for rid in refs if any(record.get('workshop',{}).get('runeSubstitute') or any(effect.get('type')=='rune' for effect in record.get('combatEffects',[])) for record in records)}}}
    validate(check)
    return item

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
        return db.execute('SELECT users.id, users.login, users.avatar FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>? AND users.blocked=0 AND (users.email IS NULL OR users.email_verified=1 OR ?=0)', (hashlib.sha256(token.encode()).hexdigest(), time.time(),int(accounts.verification_required()))).fetchone()

    def serve_local_world_asset(self, resource_path, animation_only=False):
        # Local exports are opt-in and available only through a direct loopback request.
        local_host = re.fullmatch(r'(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?', self.headers.get('Host', ''), re.I)
        if (os.environ.get('TALENT_LOCAL_WOW_ASSETS') != '1'
                or self.server.server_address[0] not in ('127.0.0.1', '::1')
                or self.client_address[0] not in ('127.0.0.1', '::1')
                or not local_host or any(name in self.headers for name in ('Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host'))):
            return self.send_error(404)
        name = unquote(resource_path)
        parts = name.split('/')
        if (any(not segment or segment in ('.', '..') or re.search(r'[\\:\x00-\x1f]', segment) for segment in parts)
                or name != 'manifest.json' and (parts[0] not in ('character', 'targets', 'weapons', 'world') or len(parts) < 2)):
            return self.send_error(404)
        types = {
            '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json',
            '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg', '.webp': 'image/webp',
        }
        extension = Path(name).suffix.lower()
        if extension not in types or (extension == '.json' and name != 'manifest.json'):
            return self.send_error(404)
        root = ROOT.resolve() / 'local-assets' / 'wow'
        try:
            path = root.joinpath(*parts).resolve(strict=True)
            allowed = root / parts[0]
            if ((name == 'manifest.json' and path != allowed)
                    or (name != 'manifest.json' and not path.is_relative_to(allowed))
                    or path.suffix.lower() != extension or not path.is_file()):
                return self.send_error(404)
            stream = path.open('rb')
        except (OSError, RuntimeError, ValueError):
            return self.send_error(404)
        if animation_only:
            with stream:
                try:
                    if parts[0] not in ('character', 'targets') or extension not in ('.glb', '.gltf'):
                        return self.send_error(404)
                    if extension == '.glb':
                        magic, version, _, size, chunk_type = struct.unpack('<4sIIII', stream.read(20))
                        if magic != b'glTF' or version != 2 or chunk_type != 0x4e4f534a or size > 64 * 1024 * 1024:
                            raise ValueError('Invalid GLB metadata')
                        model = json.loads(stream.read(size))
                    else:
                        model = json.loads(stream.read(64 * 1024 * 1024))
                    names = sorted({clip['name'] for clip in model.get('animations', [])
                                    if isinstance(clip, dict) and isinstance(clip.get('name'), str)
                                    and 0 < len(clip['name']) <= 150})
                except (ValueError, OSError, struct.error, AttributeError, TypeError):
                    return self.send_error(400)
                return self.reply(200, {'animations': names})
        with stream:
            stat = os.fstat(stream.fileno())
            etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
            not_modified = self.headers.get('If-None-Match') == etag
            self.send_response(304 if not_modified else 200)
            self.send_header('Cache-Control', 'private, no-cache')
            self.send_header('ETag', etag)
            self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
            if not not_modified:
                self.send_header('Content-Type', types[extension])
                self.send_header('Content-Length', str(stat.st_size))
            self.end_headers()
            if not not_modified:
                try:
                    self.copyfile(stream, self.wfile)
                except (BrokenPipeError, ConnectionResetError):
                    # Closing a preview or the arena aborts its local model requests.
                    return

    def do_GET(self):
        parsed=urlsplit(self.path)
        if parsed.path.startswith('/local-world-assets/'):
            return self.serve_local_world_asset(parsed.path.removeprefix('/local-world-assets/'), parsed.query == 'animations=1')
        if parsed.path in ('/admin','/admin/'):
            self.path='/admin.html';return super().do_GET()
        match=re.fullmatch(r'/media/project/([a-f0-9]{32})\.png',parsed.path)
        if match:
            with connect() as db:row=db.execute('SELECT png FROM project_images WHERE id=?',(match[1],)).fetchone()
            if not row:return self.send_error(404)
            self.send_response(200);self.send_header('Content-Type','image/png');self.send_header('Content-Length',str(len(row[0])));self.send_header('Cache-Control','public, max-age=86400, immutable');self.end_headers();self.wfile.write(row[0]);return
        match=re.fullmatch(r'/media/icons/([a-f0-9]{32})\.png',parsed.path)
        if match:
            with connect() as db:row=db.execute('SELECT png FROM icon_assets WHERE id=?',(match[1],)).fetchone()
            if not row:return self.send_error(404)
            self.send_response(200);self.send_header('Content-Type','image/png');self.send_header('Content-Length',str(len(row[0])));self.send_header('Cache-Control','public, max-age=86400, immutable');self.end_headers();self.wfile.write(row[0]);return
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
                publications.purge_archived(db)
                db.commit()
                user = self.session(db)
                uid = user[0] if user else None
                parsed = urlsplit(self.path)
                if accounts.admin_route(self,db,method,parsed.path,data,password_hash,profile_info):return
                if accounts.email_route(self,db,method,parsed.path,data,password_hash,uid):return
                if parsed.path=='/api/about' and method=='GET':return self.reply(200,site_content.content(db))
                if parsed.path=='/api/presets' and method=='GET':return self.reply(200,{'classes':preset_catalog()})
                if parsed.path=='/api/icons' and method=='GET':return self.reply(200,{'icons':accounts.public_icons(db),'categories':accounts.categories(db)})
                if parsed.path == '/api/rankings' and method == 'GET':
                    query = parse_qs(parsed.query)
                    return self.reply(200, publications.listing(db, uid, query.get('sort', ['views'])[0], int(query.get('page', ['0'])[0])))
                if self.path == '/api/me' and method == 'GET':
                    return self.reply(200, {'user': profile_info(db,user[0]) if user else None})
                if self.path.startswith('/api/shared/'):
                    parts = self.path.removeprefix('/api/shared/').split('/')
                    token = parts[0]
                    row = db.execute('SELECT document,owner_id,visibility,archived_at FROM shares WHERE token=?', (token,)).fetchone()
                    if not row or (row[2]=='private' or row[3] is not None) and (uid is None or row[1]!=uid):
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
                        return self.reply(200, {'document': publications.without_build(json.loads(row[0])), 'stats': share_stats(db, token), 'publication': publications.info(db, token, uid)}, cookie)
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
                    accounts.rate_limit(db,'login:'+self.client_address[0])
                    if self.path=='/api/register':
                        uid=accounts.register(db,data,password_hash)
                        if accounts.verification_required():return self.reply(201,{'user':None,'verificationPending':True})
                    else:uid=accounts.credential(db,data,password_hash)
                    return self.reply(200,{'user':profile_info(db,uid)},accounts.new_session(db,uid))
                if not user:
                    return self.reply(401, {'error': 'Войдите в аккаунт'})
                if parsed.path=='/api/items/wowhead/preview' and method=='POST':
                    if set(data)-{'reference','version'}:raise ValueError('Неизвестные параметры импорта')
                    # Validate before network access and release the SQLite write lock.
                    item_id=wowhead_items.parse_reference(data.get('reference'),data.get('version'))
                    accounts.rate_limit(db,'wowhead:'+str(uid),60);db.commit()
                    imported=wowhead_items.parse_item_xml(wowhead_items.fetch_xml(item_id),item_id)
                    from rpg_profile import validate_item
                    try:validate_item(imported)
                    except ValueError as error:raise wowhead_items.ImportError('source_format','Данные Wowhead не соответствуют модели предмета: '+str(error),502) from None
                    return self.reply(200,{'item':imported,'version':'cataclysm'})
                if parsed.path=='/api/auth/email' and method=='POST':
                    accounts.rate_limit(db,'email-change:'+str(uid),10)
                    row=db.execute('SELECT salt,password FROM users WHERE id=?',(uid,)).fetchone()
                    password=data.get('password','')
                    if not isinstance(password,str) or not 8<=len(password)<=128 or not hmac.compare_digest(row[1],password_hash(password,row[0])):raise accounts.Error(401,'Incorrect password')
                    address=accounts.email(data.get('email'))
                    try:db.execute('UPDATE users SET email=?,email_verified=0 WHERE id=?',(address,uid))
                    except sqlite3.IntegrityError:raise accounts.Error(409,'Email is already in use') from None
                    for table in ('sessions','admin_sessions','email_tokens'):db.execute(f'DELETE FROM {table} WHERE user_id=?',(uid,))
                    db.commit()
                    sent=False
                    if accounts.mail_enabled():
                        try:accounts.issue_mail(db,uid,'verify');sent=True
                        except accounts.Error:pass
                    if accounts.verification_required():return self.reply(200,{'user':None,'verificationSent':sent,'verificationPending':True},'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
                    return self.reply(200,{'user':profile_info(db,uid),'verificationSent':sent},accounts.new_session(db,uid))
                if self.path == '/api/profile/settings' and method == 'POST':
                    if not data or set(data)-{'show3d','language'} or ('show3d' in data and type(data['show3d']) is not bool) or ('language' in data and data['language'] not in ('en','ru')):
                        raise ValueError('Проверь настройку 3D-просмотра')
                    if 'show3d' in data:db.execute('UPDATE users SET show_3d=? WHERE id=?',(int(data['show3d']),uid))
                    if 'language' in data:db.execute('UPDATE users SET language=? WHERE id=?',(data['language'],uid))
                    db.commit()
                    return self.reply(200,{'user':profile_info(db,uid)})
                if self.path == '/api/profile/avatar' and method == 'POST':
                    avatar = data.get('avatar')
                    if isinstance(avatar,dict):
                        validate_class_icon(avatar)
                        avatar={"layers":avatar["layers"]}
                        stored_avatar=json.dumps(avatar)
                    else:
                        if not isinstance(avatar, str) or len(avatar) > 350000 or not (re.fullmatch(r'[A-Za-z0-9_-]{1,100}', avatar) or avatar in avatar_catalog() or avatar.startswith('custom:')):
                            raise ValueError('Выбери аватар из каталога иконок')
                        validate_icon(avatar)
                        stored_avatar=avatar
                    db.execute('UPDATE users SET avatar=? WHERE id=?', (stored_avatar, uid))
                    db.commit()
                    return self.reply(200, {'user': profile_info(db,uid)})
                if parsed.path == '/api/publications' and method == 'GET':
                    query = parse_qs(parsed.query)
                    return self.reply(200, publications.listing(db, uid, 'latest', int(query.get('page', ['0'])[0]), owned=True, archived=query.get('archived',['0'])[0]=='1'))
                if self.path == '/api/publish' and method == 'POST':
                    pid, visibility = data.get('projectId'), data.get('visibility', 'unlisted')
                    if not isinstance(pid, str):
                        raise ValueError('Сначала сохраните класс')
                    db.execute('BEGIN IMMEDIATE')
                    saved = db.execute('SELECT document FROM projects WHERE id=? AND user_id=? AND archived_at IS NULL', (pid, uid)).fetchone()
                    if not saved:
                        return self.reply(404, {'error': 'Сохранённый класс не найден'})
                    document = validate(json.loads(saved[0]))
                    token = publications.create(db, document, uid, pid, visibility)
                    db.commit()
                    return self.reply(200, {'token': token, 'publication': publications.info(db, token, uid)})
                if parsed.path.startswith('/api/publications/') and method=='POST' and parsed.path.rsplit('/',1)[-1] in ('archive','restore'):
                    token,action=parsed.path.removeprefix('/api/publications/').rsplit('/',1)
                    owner=db.execute('SELECT owner_id FROM shares WHERE token=?',(token,)).fetchone()
                    if not owner or owner[0]!=uid:return self.reply(404,{'error':'Публикация не найдена'})
                    if action=='archive':db.execute('UPDATE shares SET archived_at=COALESCE(archived_at,?) WHERE token=?',(int(time.time()),token))
                    else:
                        if db.execute('SELECT 1 FROM shares s JOIN projects p ON p.id=s.project_id AND p.user_id=s.owner_id WHERE s.token=? AND p.archived_at IS NOT NULL',(token,)).fetchone():return self.reply(409,{'error':'Restore the working tree first'})
                        db.execute('UPDATE shares SET archived_at=NULL,archived_by_project=0 WHERE token=?',(token,))
                    db.commit()
                    return self.reply(200,{'publication':publications.info(db,token,uid)})
                if self.path.startswith('/api/publications/') and self.path.endswith('/visibility') and method == 'POST':
                    token = self.path.removeprefix('/api/publications/').removesuffix('/visibility')
                    owner = db.execute('SELECT owner_id,archived_at FROM shares WHERE token=?', (token,)).fetchone()
                    if not owner or owner[0] != uid:
                        return self.reply(404, {'error': 'Публикация не найдена'})
                    if owner[1] is not None:return self.reply(409, {'error':'Сначала восстанови публикацию из архива'})
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
                    if kind not in ('talent', 'ability', 'tree') or not isinstance(item, dict):
                        raise ValueError('Неверный элемент избранного')
                    if kind == 'tree':
                        source=item.get('sourceShare')
                        if source is not None:
                            if not isinstance(source,str):raise ValueError('Неверная ссылка на дерево')
                            original=db.execute('SELECT document,owner_id,visibility,archived_at FROM shares WHERE token=?',(source,)).fetchone()
                            if not original or ((original[2]=='private' or original[3] is not None) and original[1]!=uid):
                                return self.reply(404,{'error':'Публикация не найдена'})
                            document=publications.without_build(json.loads(original[0]))
                        else:
                            document=validate(item.get('document'))
                        favorite={'name':document['name'],'document':document,'sourceShare':source}
                        for existing in db.execute("SELECT id,item FROM favorites WHERE user_id=? AND kind='tree'",(uid,)):
                            previous=json.loads(existing[1])
                            if (source and previous.get('sourceShare')==source) or previous==favorite:
                                return self.reply(200,{'id':existing[0]})
                        fid=secrets.token_hex(12)
                        db.execute('INSERT INTO favorites VALUES(?,?,?,?,?)',(fid,uid,kind,json.dumps(favorite),int(time.time())))
                        db.commit()
                        return self.reply(200,{'id':fid})
                    check = {'version': 1, 'name': 'Избранное', 'budget': 71, 'rowCost': 5, 'build': {}, 'branches': [{'id': 'favorite', 'name': 'Избранное', 'rows': 1, 'talents': []}], 'abilities': []}
                    item = dict(item)
                    item['id'] = secrets.token_hex(12)
                    if kind == 'talent':
                        item.update(row=0, col=0, requires='')
                        item.pop('grantedAbilityId', None)
                        check['branches'][0]['talents'] = [item]
                    else:
                        item=prepare_favorite_ability(data['item'])
                    if kind=='talent':validate(check)
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
                if parsed.path=='/api/projects' and method=='GET':
                    archived=parse_qs(parsed.query).get('archived',['0'])[0]=='1'
                    rows=db.execute('SELECT p.id,p.name,p.updated,p.document,p.archived_at,EXISTS(SELECT 1 FROM shares s WHERE s.project_id=p.id AND s.owner_id=p.user_id AND s.archived_at IS NULL) FROM projects p WHERE p.user_id=? AND p.archived_at IS '+('NOT NULL' if archived else 'NULL')+' ORDER BY p.updated DESC,p.id',(uid,)).fetchall()
                    return self.reply(200,{'projects':[project_summary(r) for r in rows]})
                match=re.fullmatch(r'/api/projects/([A-Za-z0-9_-]+)/restore',parsed.path)
                if match and method=='POST':
                    pid=match[1];db.execute('BEGIN IMMEDIATE')
                    saved=db.execute('SELECT document FROM projects WHERE id=? AND user_id=?',(pid,uid)).fetchone()
                    if not saved:return self.reply(404,{'error':'Проект не найден'})
                    if duplicate_draft(db,uid,json.loads(saved[0]),pid):return self.reply(409,{'error':'Уже есть активный черновик с таким полным названием. Переименуй его перед восстановлением.'})
                    db.execute('UPDATE projects SET archived_at=NULL WHERE id=? AND user_id=?',(pid,uid))
                    db.execute('UPDATE shares SET archived_at=NULL,archived_by_project=0 WHERE project_id=? AND owner_id=? AND archived_by_project=1',(pid,uid));db.commit();return self.reply(200,{'ok':True})
                if self.path == '/api/projects' and method == 'POST':
                    document = validate(data['document'])
                    db.execute('BEGIN IMMEDIATE')
                    pid = data.get('id')
                    if pid is None:
                        pid = secrets.token_hex(12)
                    if not isinstance(pid, str) or not re.fullmatch(r'[a-f0-9]{24}', pid):
                        raise ValueError('Неверный идентификатор проекта')
                    shared_from = data.get('sourceShare')
                    if isinstance(shared_from, str):
                        source = db.execute('SELECT owner_id,visibility,archived_at FROM shares WHERE token=?', (shared_from,)).fetchone()
                        if source and (source[1]=='private' or source[2] is not None) and source[0]!=uid:
                            return self.reply(404, {'error': 'Публикация доступна только автору'})
                    existing = db.execute('SELECT user_id,archived_at FROM projects WHERE id=?', (pid,)).fetchone()
                    if existing and existing[0] != user[0]:
                        return self.reply(404, {'error': 'Проект не найден'})
                    if existing and existing[1] is not None:return self.reply(409,{'error':'Restore the tree before editing it'})
                    duplicate=duplicate_draft(db,uid,document,pid)
                    if duplicate and data.get('copy') is True and data.get('id') is None:
                        base=document['name'];index=2
                        while duplicate:
                            suffix=' ('+str(index)+')';document['name']=base[:100-len(suffix)]+suffix;index+=1
                            duplicate=duplicate_draft(db,uid,document,pid)
                    if duplicate:return self.reply(409,{'error':'У тебя уже есть черновик с таким названием и дополнительной строкой. Измени название или дополнительную строку.','existingProjectId':duplicate})
                    db.execute('INSERT INTO projects(id,user_id,name,document,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated=excluded.updated', (pid,user[0],document['name'],json.dumps(document),int(time.time())))
                    shared_from = data.get('sourceShare')
                    if isinstance(shared_from, str) and db.execute('SELECT 1 FROM shares WHERE token=?', (shared_from,)).fetchone():
                        db.execute('INSERT OR IGNORE INTO share_saves VALUES(?,?)', (shared_from, user[0]))
                    db.commit()
                    return self.reply(200, {'id': pid,'name':document['name']})
                if self.path.startswith('/api/projects/'):
                    pid = self.path.removeprefix('/api/projects/')
                    row = db.execute('SELECT document FROM projects WHERE id=? AND user_id=? AND archived_at IS NULL', (pid,user[0])).fetchone()
                    if not row:
                        return self.reply(404, {'error': 'Проект не найден'})
                    if method == 'GET':
                        return self.reply(200, {'document': publications.without_build(json.loads(row[0])), 'id': pid})
                    if method == 'DELETE':
                        db.execute('UPDATE projects SET archived_at=COALESCE(archived_at,?) WHERE id=? AND user_id=?',(int(time.time()),pid,uid))
                        db.execute('UPDATE shares SET archived_at=?,archived_by_project=1 WHERE project_id=? AND owner_id=? AND archived_at IS NULL',(db.execute('SELECT archived_at FROM projects WHERE id=? AND user_id=?',(pid,uid)).fetchone()[0],pid,uid))
                        db.commit()
                        return self.reply(200, {})
                self.reply(404, {'error': 'Не найдено'})
        except wowhead_items.ImportError as error:
            self.reply(error.status,{'error':str(error),'code':error.code})
        except accounts.Error as error:
            self.reply(error.status,{'error':str(error),**error.details})
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            self.reply(400, {'error': str(error) or 'Неверный запрос'})

class ArchiveHTTPServer(ThreadingHTTPServer):
    def service_actions(self):
        if time.monotonic()>=getattr(self,'_next_archive_cleanup',0):
            self._next_archive_cleanup=time.monotonic()+60
            try:
                with connect() as db:publications.purge_archived(db)
            except sqlite3.Error as error:
                print(f'Archive cleanup: {error}',file=sys.stderr)

if __name__ == '__main__':
    initialize()
    if '--create-admin' in sys.argv:
        import getpass
        address=accounts.email(input('Admin email: '));login=input('Public nickname: ').strip();password=getpass.getpass('Admin password: ');repeat=getpass.getpass('Repeat password: ')
        if password!=repeat:raise SystemExit('Passwords do not match')
        with connect() as db:
            accounts.register(db,{'email':address,'login':login,'password':password},password_hash,bootstrap=True)
        print('Administrator created. Open /admin');raise SystemExit(0)
    port = int(os.environ.get('PORT', '8000'))
    print(f'Talent Forge: http://localhost:{port}', flush=True)
    ArchiveHTTPServer((os.environ.get('HOST', '127.0.0.1'), port), Handler).serve_forever()
