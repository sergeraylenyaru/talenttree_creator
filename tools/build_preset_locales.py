"""Rebuild static Russian preset text from pinned sources and the reviewed project cache.

Put source files listed in preset-locale-sources.json in work/sources/locales.
Run from the project root: python3 tools/build_preset_locales.py
Node is used only to read the source calculator's data registration inside a VM.
No translation model, network call, or new server dependency is used by this builder.
"""
import hashlib,subprocess
from pathlib import Path
import json,re,xml.etree.ElementTree as E
source_dir=Path('work/sources/locales')
manifest=json.loads(Path('tools/preset-locale-sources.json').read_text())
for source in manifest:
    path=source_dir/source['file']
    if not path.is_file():raise SystemExit('Missing source: '+str(path)+'; see tools/preset-locale-sources.json')
    if hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n').rstrip(b'\n')+b'\n').hexdigest()!=source['sha256']:raise SystemExit('Source checksum mismatch: '+str(path))
for source in manifest:
    if source['file'].endswith('.js'):
        path=source_dir/source['file']
        js="const fs=require('node:fs'),vm=require('node:vm');let result;vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),{$WowheadTalentCalculator:{registerClass:(id,data)=>result=data}},{timeout:1000});process.stdout.write(JSON.stringify(result));"
        path.with_suffix('.json').write_text(subprocess.check_output(['node','-e',js,str(path)],text=True))
names,descriptions={},{}
def source_text(value):return re.sub(r'\s+',' ',re.sub('<[^>]*>','',value)).strip()
for source in manifest:
    file=source['file']
    if file.startswith('wotlk-') and file.endswith('-en.xml'):
        path=source_dir/file;en=E.parse(path);ru=E.parse(source_dir/file.replace('-en.xml','-ru.xml'));rts={t.get('key'):t for t in ru.findall('.//talent')}
        for t in en.findall('.//talent'):
            translated=rts.get(t.get('key'))
            if translated is not None:
                names[source_text(t.get('name'))]=translated.get('name')
                for a,b in zip(t.findall('rank'),translated.findall('rank')):descriptions[source_text(a.get('description'))]=b.get('description')
for source in manifest:
    file=source['file']
    if file.startswith('cata-') and file.endswith('-en.js'):
        path=source_dir/file.replace('.js','.json');en=json.loads(path.read_text());ru=json.loads((source_dir/file.replace('-en.js','-ru.json')).read_text());rts={t['i']:t for tree in ru for t in tree['t']}
        for tree in en:
            for t in tree['t']:
                translated=rts.get(t['i'])
                if translated:
                    names[source_text(t['n'])]=translated['n']
                    for a,b in zip(t['d'],translated['d']):descriptions[source_text(a)]=source_text(b)
(source_dir/'paired-texts.json').write_text(json.dumps({'names':names,'descriptions':descriptions},ensure_ascii=False))

import re,json,html,xml.etree.ElementTree as E,ast
from collections import Counter
from pathlib import Path
R=Path('work/sources/locales');B=Path('static/presets')
def clean(s):return html.unescape(re.sub('<[^>]*>','',s)).strip()
def norm(s):return re.sub(r'[^\w%]+','',clean(s).lower())
num=r'\d+(?:\.\d+)?'
def numbers(s):return re.findall(num,s)
def stem(s):return norm(re.sub(num,'#',s))
pairs=json.loads((R/'paired-texts.json').read_text());exact={norm(k):clean(v) for k,v in pairs['descriptions'].items() if Counter(numbers(k))==Counter(numbers(clean(v)))};names={norm(k):v for k,v in pairs['names'].items()};branches={};official={};abilities={}
for f in R.glob('wotlk-*-en.xml'):
 cls=f.name.split('-')[1];en=E.parse(f);ru=E.parse(str(f).replace('-en.xml','-ru.xml'));rt={t.get('key'):t for t in ru.findall('.//talent')};official[cls]={}
 for a,b in zip(en.findall('.//tree'),ru.findall('.//tree')):branches[(cls,norm(a.get('name')))]=b.get('name')
 for t in en.findall('.//talent'):
  r=rt.get(t.get('key'))
  if r is not None:official[cls][norm(t.get('name'))]={'name':r.get('name'),'descriptions':[clean(x.get('description')) for x in r.findall('rank')]}
for f in R.glob('cata-*-en.json'):
 cls=f.stem.removesuffix('-en');ens=json.loads(f.read_text());rus=json.loads(Path(str(f).replace('-en.json','-ru.json')).read_text());rt={t['i']:t for tree in rus for t in tree['t']};official[cls]={}
 for a,b in zip(ens,rus):
  branches[(cls,norm(a['n']))]=b['n']
  for k in ('spells','rating'):
   for x in b.get('mastery',{}).get(k,[]):abilities[x['id']]=x
  for t in a['t']:
   r=rt.get(t['i'])
   if r:official[cls][norm(t['n'])]={'name':r['n'],'descriptions':[clean(s) for s in r['d']]}
# Stable English spell names are kept as glossary entries for project translations.
q=r'"(?:\\.|[^"\\])*"'
for a,b in re.findall(r'\[('+q+r')\]\s*=\s*('+q+r')',(R/'spell-names-ru.lua').read_text()):
 try:names.setdefault(norm(ast.literal_eval(a)),ast.literal_eval(b))
 except ValueError:pass
numeric={}
for en,ru in pairs['descriptions'].items():
 en,ru=clean(en),clean(ru)
 if numbers(en)==numbers(ru):numeric.setdefault(stem(en),(en,ru))
queue={};queue_keys={};plans={};stats={}
def request(text):
 key=stem(text)
 if key not in queue_keys:queue_keys[key]=len(queue);queue[text]=len(queue)
 return {'translation':queue_keys[key],'numbers':numbers(text)}
def translate(text):
 if norm(text) in exact:return exact[norm(text)]
 candidate=numeric.get(stem(text))
 if candidate and len(numbers(text))==len(numbers(candidate[0])):
  vals=iter(numbers(text));return re.sub(num,lambda m:next(vals),candidate[1])
 return request(text)
for f in sorted(B.glob('*.json')):
 if f.stem=='index':continue
 d=json.loads(f.read_text());key=f.stem;local=official.get(key,{});plan={'name':d['name'],'branches':[],'abilities':[]}
 for b in d['branches']:
  rn=branches.get((key,norm(b['name']))) or next((v for (k,n),v in branches.items() if n==norm(b['name'])),None)
  rb={'id':b['id'],'name':rn or request(b['name']),'talents':[]}
  for t in b['talents']:
   r=local.get(norm(t['name']));same=r and len(r['descriptions'])==t['maxRank']
   rb['talents'].append({'id':t['id'],'name':r['name'] if r else names.get(norm(t['name'])) or request(t['name']),'descriptions':[ru if Counter(numbers(ru))==Counter(numbers(en)) else translate(en) for en,ru in zip(t['descriptions'],r['descriptions'])] if same else [translate(s) for s in t['descriptions']]})
  plan['branches'].append(rb)
 for a in d['abilities']:
  sid=int(a['id'].rsplit('-',1)[-1]) if a['id'].rsplit('-',1)[-1].isdigit() else None;r=abilities.get(sid,{})
  plan['abilities'].append({'id':a['id'],'name':r.get('name') or names.get(norm(a['name'])) or request(a['name']),'description':translate(a['description'])})
 plans[key]=plan
print('plans',len(plans),'translation strings',len(queue),'characters',sum(map(len,queue)))
Path('work/locale-translation-queue.json').write_text(json.dumps(list(queue),ensure_ascii=False,indent=2));Path('work/locale-plans.json').write_text(json.dumps(plans,ensure_ascii=False));Path('work/locale-glossary.json').write_text(json.dumps(names,ensure_ascii=False))

import re,json,html,ast
from pathlib import Path
from collections import Counter
root=Path('work/sources/locales');plans=json.loads(Path('work/locale-plans.json').read_text());queue=json.loads(Path('work/locale-translation-queue.json').read_text());mt=json.loads(Path('tools/preset-locale-translations.json').read_text());overrides=json.loads(Path('tools/preset-locale-overrides.json').read_text());num=r'\d+(?:[.,]\d+)?'
manual={}
for en,ru in mt.items():
 if en.startswith('While Water Shield is active, you recover mana'):
  groups=re.findall(r'\([^)]*\)',en);manual[en]='Пока активен «Водный щит», критические эффекты прямого исцеления восстанавливают ману. «Волна исцеления» и «Великая волна исцеления» восстанавливают '+groups[0]+' ед. маны, «Исцеляющий всплеск», «Быстрина» и «Высвободить чары жизни» — '+groups[1]+' ед., а «Цепное исцеление» — '+groups[2]+' ед.'
 if en.startswith('Your Searing Pain generates'):
  vals=re.findall(num,en);formulas=re.findall(r'\$\{[^}]+\}',en);manual[en]=f'«Жгучая боль» создает на {vals[0]}% меньше угрозы и накладывает на цель клеймо на {vals[1]} сек. Следующие {vals[2]} атаки питомца по цели создают высокий уровень угрозы и наносят от {formulas[0]} до {formulas[1]} ед. урона от огня или Тьмы в зависимости от питомца.'
 if en.startswith('HHurls a holy shield'):manual[en]='Бросает во врага священный щит, нанося от 270 до 331 ед. урона от светлой магии и вызывая головокружение, после чего щит перескакивает на ближайших противников. Поражает 3 цели. Длительность — 6 сек.'
 if en.startswith('Ignites a target that is already afflicted by your Immolate, dealing 240'):manual[en]='Поджигает цель, на которую уже действует «Жертвенный огонь», нанося от 240 до 307 ед. урона от огня и поглощая эффект «Жертвенного огня».'
manual.update(json.loads(Path('tools/preset-locale-text-overrides.json').read_text()));mt.update(manual)
glossary=json.loads((root/'paired-texts.json').read_text())['names'];glossary.update(overrides['names'])
q=r'"(?:\\.|[^"\\])*"'
for a,b in re.findall(r'\[('+q+r')\]\s*=\s*('+q+r')',(root/'spell-names-ru.lua').read_text()):
 try:glossary.setdefault(ast.literal_eval(a),ast.literal_eval(b))
 except ValueError:pass
glossary.update({'Spirit':'дух','Strength':'сила','Agility':'ловкость','Stamina':'выносливость','Intellect':'интеллект','Attack Power':'сила атаки','Spell Power':'сила заклинаний','Mana':'мана','Energy':'энергия','Rage':'ярость'})
glossary.update({'Eye':'Око','Seal':'Печать','Succubus': 'Суккуб', 'Felhunter': 'Охотник Скверны', 'Voidwalker': 'Демон Бездны', 'Imp': 'Бес', 'Incubus': 'Инкуб', 'Felguard': 'Страж Скверны', 'Warlock': 'чернокнижник', 'Frostfire Bolt': 'Стрела ледяного огня', 'Frostfire': 'ледяного огня', 'Combo Points': 'приемы', 'Combo': 'приемов', 'Soul Shard': 'осколок души', 'Soul Shards': 'осколки душ', 'Shard': 'осколок', 'Shards': 'осколки', 'Dire Bear': 'лютый медведь', 'Bear': 'медведь', 'Arcane': 'тайной магии', 'Fire': 'огня', 'Frost': 'льда', 'Shadow': 'Тьмы', 'Nature': 'природы', 'Holy': 'светлой магии', 'Soul': 'души', 'Bolt': 'стрела', 'Nova': 'кольцо', 'Pain': 'боль', 'Entangleing Roots': 'Гнев деревьев', 'Chill': 'Окоченение', 'Inginerat': 'Испепеление', 'Melee': 'ближнего боя', 'Strike': 'удар', 'Axe': 'топор', 'Sword': 'меч', 'Flametongue': 'Язык пламени', 'Totemans': 'тотемов', 'Arcaele': 'чародейских', 'Harvest': 'жатва', 'Expose': 'раскрытие', 'Shot': 'выстрел', 'Burning Ember': 'Горящий уголь', 'Burning': 'горения', 'Ember': 'уголь', 'Impairing': 'замедления', 'Stoneclaw': 'Каменный коготь', 'Water': 'воды', 'Elemental': 'стихий', 'Friebolt': 'Огненная стрела', 'Range': 'дальность', 'Vash': 'ваш', 'Sedduction': 'Соблазнение', 'Hingerrate': 'Испепеление', 'Glyph': 'Символ', 'Flash': 'вспышка', 'Sepent Sting': 'Укус змеи', 'Sting': 'укус', 'Shoap': 'Укус', 'Shadowflame': 'Пламя Тьмы', 'Magma': 'магма', 'Mind Fay': 'Пытка разума', 'Firestones': 'камни огня', 'Firestone': 'камень огня', 'Spellstone': 'камень чар', 'Priest': 'жрец', 'Leap of Faith': 'Духовное рвение', 'Cobra': 'Кобра', 'Hot Striea': 'Путь огня', 'Pickpocket': 'Обшаривание карманов', 'Summon': 'призыв', 'Demon': 'демон', 'Paladin': 'паладин', 'Fury': 'ярость', 'Dvouring Plague': 'Всепожирающая чума', 'Hunter': 'охотник', 'Evicrate': 'Потрошение', 'Rogue': 'разбойник', 'Ronnk': 'ранга', 'Beacon': 'Частица', 'Reuires': 'Требуется', 'Point': 'очко', 'Power Word': 'Слово силы', 'Rank': 'Ранг', 'Icy Touch': 'Ледяное прикосновение', 'Mage': 'маг', 'sec': 'сек.', 'and': 'и', 'for': 'на', 'per': 'за'})
terms=re.compile(r'(?<!\w)('+ '|'.join(re.escape(k) for k in sorted(glossary,key=len,reverse=True) if k)+r')(?!\w)',re.I);glossary_lower={k.lower():v for k,v in glossary.items()}
replacements={'время отливки':'время произнесения','время литья':'время произнесения','домашними животными':'питомцами','ущерб':'урон','ущерба':'урона','ущербу':'урону','ущербом':'уроном','забастовка':'удар','забастовки':'удары','забастовку':'удар','забастовок':'ударов','уплотнение':'печать','уплотнения':'печати','уплотнений':'печатей','уплотнением':'печатью','Атакующая мощность':'Сила атаки','домашние животные':'питомцы','домашних животных':'питомцев','домашним животным':'питомцам','домашнее животное':'питомец','домашнего животного':'питомца','Каждая точка мастерства':'Каждое очко искусности','Каждая точка Мастерства':'Каждое очко искусности'}
fixes=re.compile('|'.join(r'(?<!\w)'+re.escape(k)+r'(?!\w)' for k in sorted(replacements,key=len,reverse=True)),re.I);fix_lower={k.lower():v for k,v in replacements.items()}
errors=[]
def clean_project(text):
 text=terms.sub(lambda m:glossary_lower[m.group().lower()],text);text=fixes.sub(lambda m:fix_lower[m.group().lower()],text)
 return text

def resolve(value):
 if isinstance(value,dict) and 'translation' in value:
  en=queue[value['translation']];ru=mt.get(en)
  if ru is None:errors.append(('missing',en));return en
  source=re.findall(num,en);target=re.findall(num,ru);target=[n.replace(',','.') for n in target]
  if source!=target:
   errors.append(('numbers',en,ru));return ru
  vals=iter(value['numbers']);ru=re.sub(num,lambda m:next(vals),ru)
  return clean_project(ru)
 if isinstance(value,list):return [resolve(x) for x in value]
 if isinstance(value,dict):return {k:resolve(v) for k,v in value.items()}
 return value
out=Path('static/preset-locales/ru');out.mkdir(parents=True,exist_ok=True)
resolved={key:resolve(plan) for key,plan in plans.items()}
if errors:raise SystemExit('Missing or invalid reviewed translations: '+json.dumps(errors[:5],ensure_ascii=False))
for key,result in resolved.items():
 base=json.loads(Path('static/presets/'+key+'.json').read_text());lookup={t['id']:t for b in base['branches'] for t in b['talents']}
 for b,original in zip(result['branches'],base['branches']):
  b['name']=overrides['branches'].get(original['name'],b['name'])
  for t in b['talents']:t['name']=overrides['names'].get(lookup[t['id']]['name'],t['name']);t['descriptions']=[clean_project(text) for text in t['descriptions']]
 for a,original in zip(result['abilities'],base['abilities']):
  a['name']=overrides['names'].get(original['name'],a['name'])
  if original.get('requirements')=='Level 80 · Mastery':a['requirements']='Уровень 80 · Искусность'
 result.update(language='ru',presetId=key,provenance={'kind':'game-texts-and-project-translation','sources':['https://github.com/Shadez/wowarmory','https://github.com/Shadez/wowhead'],'projectTranslation':True})
 (out/(key+'.json')).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
Path('work/locale-final-review.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2));print('written',len(plans),'errors',len(errors))
for e in errors[:12]:print(e)

