"""Read the observed Wowhead /cata XML format; no source HTML is executed.

This is an importer for a changing website format, not an official API client.
"""
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from http.client import HTTPException
import json
import queue
import re
import socket
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4
from xml.etree import ElementTree

VERSION = 'cataclysm'
MAX_BYTES = 2_000_000
TIMEOUT = 8
TOTAL_SECONDS = 12
HOST = 'www.wowhead.com'
FETCH_SLOTS = threading.BoundedSemaphore(4)
CLASSES = {1:'warrior',2:'paladin',3:'hunter',4:'rogue',5:'priest',6:'deathknight',7:'shaman',8:'mage',9:'warlock',11:'druid'}
QUALITY = {0:'poor',1:'common',2:'uncommon',3:'rare',4:'epic',5:'legendary'}
WEAPONS = {0:'axe',1:'axe2',2:'bow',3:'gun',4:'mace',5:'mace2',6:'polearm',7:'sword1',8:'sword2',10:'staff',13:'fist',15:'dagger',18:'crossbow',19:'wand'}
TWO_HAND = {'sword2','axe2','mace2','polearm','staff'}
RANGED = {'bow','gun','crossbow','wand'}
ARMOR = {1:'cloth',2:'leather',3:'mail',4:'plate',6:'shield',0:'holdable'}
SLOTS = {1:['head'],2:['neck'],3:['shoulders'],5:['chest'],6:['waist'],7:['legs'],8:['feet'],9:['wrists'],10:['hands'],11:['ring1','ring2'],12:['trinket1','trinket2'],13:['mainHand','offHand'],14:['offHand'],15:['ranged'],16:['back'],17:['mainHand'],20:['chest'],21:['mainHand'],22:['offHand'],23:['offHand'],26:['ranged']}
STATS = {
    'str':['strength'],'agi':['agility'],'sta':['stamina'],'int':['intellect'],'spi':['spirit'],
    'atkpwr':['attackPower'],'splpwr':['spellPower'],'splheal':['healingPower'],'splpen':['spellPenetration'],'health':['maxHealth'],
    'hitrtng':['hitRating','spellHitRating'],'critstrkrtng':['critRating'],'hastertng':['hasteRating'],
    'exprtng':['expertiseRating'],'mastrtng':['masteryRating'],'dodgertng':['dodgeRating'],'parryrtng':['parryRating'],'blockrtng':['blockRating'],
    'arcres':['arcaneResistance'],'firres':['fireResistance'],'frores':['frostResistance'],'natres':['natureResistance'],'shares':['shadowResistance'],
    'fireres':['fireResistance'],'frostres':['frostResistance'],'natureres':['natureResistance'],'shadowres':['shadowResistance'],
}
# These are requirements that the existing class profile cannot enforce.
UNSUPPORTED_REQUIREMENTS = {'reqskill','reqskillrank','reqspell','reqrep','reqrepfaction','reqrepvalue','reqraces','races','reqfaction'}
UNSUPPORTED_STATS = {'rgdatkpwr','manargn','resirtng','armorpenrtng','splhitrtng','splcritstrkrtng','splhastertng','mana','block'}
KNOWN_NON_STATS = {'armor','dmgmin1','dmgmax1','dmgtype1','dmgmin2','dmgmax2','dmgtype2','speed','dps','mledps','rgddps','mlespeed','rgdspeed','mledmgmin','mledmgmax','rgddmgmin','rgddmgmax','reqlevel','reqclass','classes','slot','classs','subclass','itemset','socket1','socket2','socket3','socketbonus','durability','sellprice','buyprice','stack','unique','uniqueequipped','uniquecount','rand','randprop','randsuffix','randomProperty','randomSuffix'}

class ImportError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code,self.status = code,status


def canonical_url(item_id):
    return f'https://{HOST}/cata/item={item_id}'


def parse_reference(value, version=VERSION):
    if version != VERSION:
        raise ImportError('wrong_version','Поддерживается только Wowhead Cataclysm (/cata).')
    if type(value) is int:
        text=str(value)
    elif isinstance(value,str):
        text=value.strip()
    else:
        raise ImportError('invalid_reference','Введите ссылку Wowhead Cataclysm или числовой ID.')
    if len(text)>2048 or not text:
        raise ImportError('invalid_reference','Введите ссылку Wowhead Cataclysm или числовой ID.')
    if re.fullmatch(r'[0-9]+',text):
        item_id=int(text) if len(text)<=10 else 0
    else:
        try:parts=urlsplit(text)
        except ValueError:raise ImportError('invalid_reference','Неверная ссылка Wowhead.') from None
        if parts.scheme!='https' or parts.netloc.lower() not in ('wowhead.com',HOST) or parts.username or parts.password:
            raise ImportError('invalid_reference','Принимаются только HTTPS-ссылки wowhead.com без порта и авторизации.')
        if not parts.path.startswith('/cata/'):
            raise ImportError('wrong_version','Ссылка относится к другой версии WoW. Выберите /cata/item=… .')
        if parts.query not in ('','xml'):
            raise ImportError('unsupported_variant','Параметры уровня, bonus и случайных вариантов не поддерживаются. Используйте базовый ID предмета.')
        match=re.fullmatch(r'/cata/(?:(?:en|ru|de|fr|es|it|pt|ko|cn|tw)/)?item=([0-9]{1,10})(?:/[^/?#&]+)?(?:&xml)?',parts.path)
        if not match:raise ImportError('invalid_reference','В ссылке должен быть /cata/item=числовой-ID.')
        item_id=int(match[1])
    if not 1<=item_id<=2147483647:raise ImportError('invalid_reference','ID предмета должен быть положительным целым числом.')
    return item_id

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ImportError('source_redirect','Wowhead изменил адрес ответа; автоматический переход запрещён.',502)


def _download_item(item_id):
    """Only one server-constructed HTTPS URL; no redirect or arbitrary URL."""
    started=time.monotonic()
    try:
        request=Request(canonical_url(item_id)+'&xml',headers={'Accept':'application/xml,text/xml','Accept-Encoding':'identity','User-Agent':'TalentForge-Equipment-Importer/1.0'})
        with build_opener(NoRedirect()).open(request,timeout=TIMEOUT) as response:
            if response.status!=200:raise ImportError('source_unavailable','Wowhead вернул неожиданный статус.',502)
            length=response.headers.get('Content-Length')
            if length and (not length.isdigit() or int(length)>MAX_BYTES):raise ImportError('source_too_large','Ответ Wowhead превышает допустимый размер.',502)
            if response.headers.get('Content-Encoding','identity').lower() not in ('identity',''):raise ImportError('source_format','Неподдерживаемая упаковка ответа Wowhead.',502)
            parts=[];size=0
            while True:
                remaining=TOTAL_SECONDS-(time.monotonic()-started)
                if remaining<=0:raise ImportError('source_timeout','Wowhead не ответил вовремя.',504)
                # urllib's HTTPResponse uses the same socket for read1; renew its
                # deadline for each read, including slow streaming responses.
                source_socket=getattr(getattr(getattr(response,'fp',None),'raw',None),'_sock',None)
                if source_socket is not None:source_socket.settimeout(min(TIMEOUT,remaining))
                chunk=response.read1(min(16384,MAX_BYTES-size+1))
                if not chunk:break
                size+=len(chunk)
                if size>MAX_BYTES:raise ImportError('source_too_large','Ответ Wowhead превышает допустимый размер.',502)
                parts.append(chunk)
            return b''.join(parts)
    except HTTPError as error:
        if error.code==404:raise ImportError('not_found','Предмет не найден в Wowhead Cataclysm.',404) from None
        if error.code in (403,429):raise ImportError('source_blocked','Wowhead блокирует загрузку или ограничивает число запросов.',502) from None
        raise ImportError('source_unavailable','Wowhead временно недоступен.',502) from None
    except (TimeoutError,socket.timeout):raise ImportError('source_timeout','Wowhead не ответил вовремя.',504) from None
    except URLError as error:
        if isinstance(error.reason,(TimeoutError,socket.timeout)):raise ImportError('source_timeout','Wowhead не ответил вовремя.',504) from None
        raise ImportError('source_unavailable','Не удалось подключиться к Wowhead. Проверьте сеть или повторите позже.',502) from None
    except (OSError,HTTPException):raise ImportError('source_unavailable','Не удалось подключиться к Wowhead. Проверьте сеть или повторите позже.',502) from None

def fetch_xml(item_id):
    # Bound total request time even if OS DNS resolution ignores socket timeout.
    # Timed-out workers keep their permit until their IO finishes: at most four
    # daemon workers can outlive a request; never create an unbounded executor.
    if not FETCH_SLOTS.acquire(blocking=False):raise ImportError('source_busy','Загрузка занята. Повторите позже.',503)
    result=queue.Queue(maxsize=1)
    def worker():
        try:result.put((True,_download_item(item_id)))
        except Exception as error:result.put((False,error))
        finally:FETCH_SLOTS.release()
    thread=threading.Thread(target=worker,name='wowhead-download',daemon=True)
    try:thread.start()
    except BaseException:FETCH_SLOTS.release();raise
    try:ok,value=result.get(timeout=TOTAL_SECONDS)
    except queue.Empty:raise ImportError('source_timeout','Wowhead не ответил вовремя.',504) from None
    if not ok:raise value
    return value

class PlainTooltip(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=True);self.parts=[];self.hidden=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style','iframe','object','svg'):self.hidden+=1
        if not self.hidden and tag in ('br','div','tr','td','li','p'):self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style','iframe','object','svg') and self.hidden:self.hidden-=1
        if not self.hidden and tag in ('div','tr','td','li','p'):self.parts.append('\n')
    def handle_data(self,data):
        if not self.hidden:self.parts.append(data)
    def text(self):return '\n'.join(line.strip() for line in ''.join(self.parts).splitlines() if line.strip())[:20000]


def fragment(text):
    if not text or not text.strip():return {}
    def pairs(values):
        result={}
        for key,value in values:
            if key in result:raise ValueError('duplicate JSON key')
            result[key]=value
        return result
    try:
        raw=text.strip()
        result=json.loads(raw if raw.startswith('{') else '{'+raw+'}',object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('non-finite')))
    except (ValueError,RecursionError):raise ImportError('source_format','Wowhead вернул непонятный JSON-фрагмент.',502) from None
    if not isinstance(result,dict) or len(result)>300:raise ImportError('source_format','Неверный формат данных предмета.',502)
    return result


def number(value,field,lo=0,hi=100000000,integer=False):
    if isinstance(value,str) and re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?',value):value=float(value)
    if type(value) not in (int,float) or not lo<=value<=hi or integer and int(value)!=value:
        raise ImportError('source_format','Неверное числовое поле Wowhead: '+field,502)
    return int(value) if integer else value


def parse_item_xml(raw,item_id,fetched_at=None):
    if not isinstance(raw,bytes) or len(raw)>MAX_BYTES:raise ImportError('source_too_large','Ответ Wowhead превышает допустимый размер.',502)
    if re.search(br'<html(?:\s|>)|<!doctype\s+html|cf-chl-',raw[:4096],re.I):raise ImportError('source_blocked','Источник вернул HTML-страницу блокировки вместо XML.',502)
    if b'\x00' in raw or re.search(br'<!\s*(?:DOCTYPE|ENTITY)',raw,re.I):raise ImportError('source_format','Небезопасный XML-ответ отклонён.',502)
    try:
        text=raw.decode('utf-8-sig');root=ElementTree.fromstring(text)
    except (UnicodeError,ElementTree.ParseError,RecursionError):
        code='source_blocked' if re.search(br'<html|captcha|cloudflare',raw[:4096],re.I) else 'source_format'
        raise ImportError(code,'Источник вернул страницу блокировки или неподдерживаемый XML.',502) from None
    if root.find('error') is not None:
        message=root.findtext('error') or ''
        if re.search(r'not found|notfound|no item|does not exist',message,re.I):raise ImportError('not_found','Предмет не найден в Wowhead Cataclysm.',404)
        raise ImportError('source_unavailable','Wowhead вернул ошибку источника.',502)
    item=root.find('item') if root.tag!='item' else root
    if item is None:raise ImportError('source_format','В XML нет записи предмета.',502)
    if number(item.get('id'), 'id',1,2147483647,True)!=item_id:raise ImportError('source_format','ID в ответе не совпадает с запрошенным.',502)
    data=fragment(item.findtext('json'));equip=fragment(item.findtext('jsonEquip'))
    if 'id' in data and number(data['id'],'id',1,2147483647,True)!=item_id:raise ImportError('source_format','ID JSON не совпадает с XML.',502)
    def xml_int(tag,key=None,default=None):
        node=item.find(tag)
        value=(node.get('id') if key=='id' else node.text) if node is not None else default
        return number(value,tag,0,2147483647,True) if value is not None else None
    category=xml_int('class','id',data.get('classs'));subclass=xml_int('subclass','id',data.get('subclass'))
    inventory=xml_int('inventorySlot','id',data.get('slot'))
    if category is None or subclass is None or inventory is None:raise ImportError('source_format','В ответе отсутствует тип или слот предмета.',502)
    if inventory not in SLOTS:raise ImportError('unsupported_type','Этот слот предмета пока не поддерживается конструктором.')
    for key,value in [('classs',category),('subclass',subclass),('slot',inventory)]:
        if key in data and number(data[key],key,0,2147483647,True)!=value:raise ImportError('source_format','Поля XML и JSON не согласованы: '+key,502)
    allowed=SLOTS[inventory]
    if category==2:
        kind=WEAPONS.get(subclass)
        if not kind:raise ImportError('unsupported_type','Этот тип оружия пока не поддерживается.')
        valid=inventory in (15,26) if kind in RANGED else inventory==17 if kind in TWO_HAND else inventory in (13,21,22)
        if not valid:raise ImportError('unsupported_type','Слот и тип оружия не согласуются; предмет не подменяется другим типом.')
    elif category==4:
        kind='ring' if inventory==11 else 'trinket' if inventory==12 else 'necklace' if inventory==2 else 'cloak' if inventory==16 else ARMOR.get(subclass)
        if not kind or (kind=='shield')!=(inventory==14) or kind=='holdable' and inventory!=23 or inventory==23 and kind!='holdable' or inventory in (13,15,17,21,22,26):
            raise ImportError('unsupported_type','Этот тип брони или предмета второй руки пока не поддерживается.')
    else:raise ImportError('unsupported_type','Поддерживаются только предметы экипировки и оружие.')
    name=(item.findtext('name') or '').strip();icon=(item.findtext('icon') or '').strip().lower()
    quality=QUALITY.get(xml_int('quality','id'));level=xml_int('level',default=data.get('level'))
    if quality is None:raise ImportError('unsupported_type','Это качество или масштабируемый предмет пока не поддерживается.')
    if not name or len(name)>100 or not re.fullmatch(r'[a-z0-9_-]{1,100}',icon) or not quality or level is None or not 1<=level<=1000:
        raise ImportError('source_format','Название, иконка, качество или уровень предмета не поддерживаются.',502)
    imported=['name','icon','quality','level','slot','type'];unmodeled=[]
    result={'id':str(uuid4()),'name':name,'icon':icon,'quality':quality,'level':level,'slot':allowed[0],'allowedSlots':list(allowed),'type':kind,'stats':{}}
    reqlevel=xml_int('requiredLevel',default=equip.get('reqlevel',data.get('reqlevel',0)))
    if reqlevel and reqlevel>85 or 'expansion' in data and number(data['expansion'],'expansion')>3:
        raise ImportError('wrong_version','Ответ не соответствует максимальному уровню Cataclysm; импорт отклонён.')
    if reqlevel:result['requiredLevel']=reqlevel;imported.append('requiredLevel')
    for tag in ('requiredSkill','requiredFaction','requiredReputation','requiredRace','requiredSpell'):
        if item.find(tag) is not None:raise ImportError('unsupported_requirement','Не поддерживается требование предмета: '+tag)
    for key in UNSUPPORTED_REQUIREMENTS:
        if equip.get(key) not in (None,0,'0',-1,'-1',[],{}) or data.get(key) not in (None,0,'0',-1,'-1',[],{}):
            raise ImportError('unsupported_requirement','Не поддерживается требование предмета: '+key+'. Импорт отклонён без подмены ограничений.')
    class_groups=[]
    class_ids=[number(n.get('id'),'class requirement',1,11,True) for n in item.findall('classes/class')]
    if class_ids:class_groups.append(set(class_ids))
    raw_classes=equip.get('classes',data.get('classes'))
    if raw_classes is not None:
        if not isinstance(raw_classes,list):raise ImportError('unsupported_requirement','Неизвестный формат классового ограничения.')
        parsed=[number(c,'class requirement',1,11,True) for c in raw_classes]
        if parsed:class_groups.append(set(parsed))
        class_ids.extend(parsed)
    mask=equip.get('reqclass',data.get('reqclass'))
    if mask not in (None,0,-1,'0','-1'):
        mask=number(mask,'reqclass',1,2147483647,True)
        if mask & ~sum(1<<(key-1) for key in CLASSES):raise ImportError('unsupported_requirement','Классовое ограничение содержит неподдерживаемый класс.')
        parsed=[key for key in CLASSES if mask & (1<<(key-1))];class_groups.append(set(parsed));class_ids.extend(parsed)
    if class_groups and any(group!=class_groups[0] for group in class_groups):raise ImportError('source_format','Противоречивые классовые требования.',502)
    if any(key not in CLASSES for key in class_ids):raise ImportError('wrong_version','В ответе найден класс вне Cataclysm.')
    if class_ids:result['requiredClasses']=list(dict.fromkeys(CLASSES[key] for key in class_ids));imported.append('requiredClasses')
    for key,targets in STATS.items():
        if key not in equip:continue
        value=number(equip[key],key,-100000000)
        for target in targets:
            if target in result['stats'] and result['stats'][target]!=value:raise ImportError('source_format','Противоречивые значения характеристики '+target,502)
            result['stats'][target]=value;imported.append('stats.'+target)
    if 'armor' in equip:result['armor']=number(equip['armor'],'armor');imported.append('armor')
    if category==2:
        if number(equip.get('dmgtype1',0),'dmgtype1')!=0:raise ImportError('unsupported_type','Основной урон оружия другой школы пока нельзя точно представить в модели предмета.')
        result['minDamage']=number(equip.get('dmgmin1'),'dmgmin1');result['maxDamage']=number(equip.get('dmgmax1'),'dmgmax1',result['minDamage'])
        result['speed']=number(equip.get('speed'),'speed',.4,30);imported.extend(['minDamage','maxDamage','speed'])
        if equip.get('dmgmin2',0) or equip.get('dmgmax2',0):unmodeled.append('additionalDamage')
    unsupported=[key for key in UNSUPPORTED_STATS if equip.get(key) not in (None,0,'0')]
    if unsupported:raise ImportError('unsupported_stats','Характеристики пока нельзя точно перенести: '+', '.join(sorted(unsupported))+'. Импорт отклонён.')
    tooltip=PlainTooltip();tooltip.feed(item.findtext('htmlTooltip') or '');tooltip_text=tooltip.text()
    if tooltip_text:unmodeled.append('tooltipEffects')
    if any(key.startswith('socket') and value for key,value in equip.items()):unmodeled.append('sockets')
    if equip.get('itemset') or data.get('itemset'):unmodeled.append('setBonus')
    if any(equip.get(key) or data.get(key) for key in ('rand','randprop','randsuffix','randomProperty','randomSuffix')):unmodeled.append('randomProperties')
    unique=equip.get('uniqueequipped') in (True,1,'1') or any(re.fullmatch(r'(?:Unique(?:-Equipped)?|Уникальный(?: используемый)?)(?:\s*\(1\))?',line,re.I) for line in tooltip_text.splitlines())
    if unique:result['uniqueGroup']=f'wowhead-cata-{item_id}';imported.append('uniqueGroup')
    if any('Unique-Equipped:' in line for line in tooltip_text.splitlines()):raise ImportError('unsupported_requirement','Групповой лимит уникальных предметов пока не поддерживается.')
    unknown=[key for key,value in equip.items() if key not in STATS and key not in KNOWN_NON_STATS and key not in UNSUPPORTED_REQUIREMENTS and value not in (0,None,'0','')]
    required=[key for key in unknown if key.startswith('req')]
    if required:raise ImportError('unsupported_requirement','Неизвестные требования предмета: '+', '.join(required))
    unknown_stats=[key for key in unknown if type(equip[key]) in (int,float)]
    if unknown_stats:raise ImportError('unsupported_stats','Неизвестные числовые поля экипировки: '+', '.join(unknown_stats))
    unmodeled.extend('unknown:'+key[:190] for key in unknown)
    result['description']=tooltip_text[:3000]
    result['source']={'provider':'wowhead','version':VERSION,'itemId':item_id,'url':canonical_url(item_id),
      'fetchedAt':fetched_at or datetime.now(timezone.utc).isoformat(timespec='seconds'),'responseSha256':sha256(raw).hexdigest(),
      'inventorySlot':inventory,'subclass':subclass,'tooltipText':tooltip_text,'imported':list(dict.fromkeys(imported)),'unmodeled':unmodeled}
    return result


def preview(value,version=VERSION):
    item_id=parse_reference(value,version)
    return parse_item_xml(fetch_xml(item_id),item_id)
