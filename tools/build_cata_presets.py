"""Rebuild Cata presets from work/cata-source.json and work/sources/dbc434/*.dbc.

See SOURCES.md for upstream files, hashes and tooltip limitations.
Run from the repository root. No downloads or game code execute here.
"""
import ast,collections,hashlib,html,json,math,re,struct
from pathlib import Path
from cata_dbc import DBC
root=Path('static/presets');data=json.loads(Path('work/cata-source.json').read_text());tabs=DBC('TalentTab');spells=DBC('Spell');primary=DBC('TalentTreePrimarySpells');icons=DBC('SpellIcon');effects=DBC('SpellEffect');durations=DBC('SpellDuration');casts=DBC('SpellCastTimes');cooldowns=DBC('SpellCooldowns');powers=DBC('SpellPower');ranges=DBC('SpellRange');auras=DBC('SpellAuraOptions');variables=DBC('SpellDescriptionVariables');radii=DBC('SpellRadius');rune_costs=DBC('SpellRuneCost')
fx=collections.defaultdict(dict)
for r in effects.rows:fx[r[24]][r[25]]=r
signed=lambda x:struct.unpack('<i',struct.pack('<I',x))[0]
def duration(id):
 s=spells.by_id.get(id);r=durations.by_id.get(s[13]) if s else None
 return max(0,signed(r[1])/1000) if r else 0

def token(id,kind,index=1):
 s=spells.by_id.get(id);e=fx[id].get(index-1)
 if kind.lower()=='d':return duration(id)
 if kind.lower() in ('h','n','u'):
  a=auras.by_id.get(s[32]) if s else None
  return (a[{'h':2,'n':3,'u':1}[kind.lower()]] if a else 0)
 if not e:return 0
 if kind.lower()=='t':return e[4]/1000
 if kind.lower()=='a':
  r=radii.by_id.get(e[15]);return radii.f(r[1]) if r else 0
 if kind.lower()=='x':return e[8]
 value=signed(e[5])+(max(0,signed(e[9])) if kind.lower() in ('s','o') else 0)
 if kind.lower()=='o' and e[4]:value*=duration(id)*1000/e[4]
 return abs(value)

def numeric(expr):
 node=ast.parse(expr,mode='eval')
 def visit(n):
  if isinstance(n,ast.Expression):return visit(n.body)
  if isinstance(n,ast.Constant) and type(n.value) in (int,float):return n.value
  if isinstance(n,ast.UnaryOp) and isinstance(n.op,(ast.USub,ast.UAdd)):return -visit(n.operand) if isinstance(n.op,ast.USub) else visit(n.operand)
  if isinstance(n,ast.BinOp) and isinstance(n.op,(ast.Add,ast.Sub,ast.Mult,ast.Div)):
   a,b=visit(n.left),visit(n.right);return {ast.Add:lambda:a+b,ast.Sub:lambda:a-b,ast.Mult:lambda:a*b,ast.Div:lambda:a/b}[type(n.op)]()
  raise ValueError(expr)
 return visit(node)

def bracket(text,start):
 assert text[start]=='[';depth=1;i=start+1
 while depth:
  if text[i]=='[':depth+=1
  if text[i]==']':depth-=1
  i+=1
 return text[start+1:i-1],i

def conditionals(text,mastery=False):
 pattern=re.compile(r'\$?\?[as](\d+)\[')
 while m:=pattern.search(text):
  yes,end=bracket(text,m.end()-1)
  # Cata client condition chains have the next ?s... as the false branch.
  if end<len(text) and text[end]=='[':no,end=bracket(text,end)
  elif end<len(text) and text[end]=='?':
   no=text[end:];end=len(text)
  else:no=''
  selected=yes if mastery and int(m[1])>=76000 else no
  text=text[:m.start()]+selected+text[end:]
 return text

num_re=re.compile(r'\$(?:(\d+))?([sSmMoOdDtTaAxXhHnNuU])(\d*)(?![A-Za-z])')
def replace_tokens(text,id):
 return num_re.sub(lambda m:format(token(int(m[1]) if m[1] else id,m[2],int(m[3]) if m[3] else 1),'.6g')+(' sec' if m[2].lower()=='d' else ''),text)
def describe(id,mastery=False):
 s=spells.by_id[id];text=conditionals(spells.text(s[23]),False)
 text=re.sub(r'\$/([0-9.]+);([sSmM])(\d+)',lambda m:str(token(id,m[2],int(m[3]))/float(m[1])),text)
 text=re.sub(r'\$\*([0-9.]+);([sSmM])(\d+)',lambda m:str(token(id,m[2],int(m[3]))*float(m[1])),text)
 varrow=variables.by_id.get(s[28]);vartext=variables.text(varrow[1]) if varrow else ''
 varmap=dict(re.findall(r'\$?(\w+)\s*=\s*([^\r\n]+)',vartext))
 for _ in range(10):
  text=re.sub(r'\$<(\w+)>',lambda m:varmap.get(m[1],'a value based on your stats'),text)
  text=conditionals(text,False)
 text=replace_tokens(text,id)
 def formula(m):
  expr=m[1];precision=int(m[2]) if m[2] else None
  try:
   value=numeric(expr);return format(value,'.'+str(precision)+'f') if precision is not None else format(value,'.4g')
  except (ValueError,TypeError,SyntaxError,ZeroDivisionError):
   if '$AP' in expr:
    try:return format(numeric(expr.replace('$AP','1')),'.4g')+' × attack power'
    except Exception:pass
   return 'a value based on your stats'
 for _ in range(5):text=re.sub(r'\$\{([^{}]+)\}(?:\.([0-9]))?',formula,text)
 text=re.sub(r'(?<![\w.])(\d+)\.0+(?![\w.])',r'\1',text)
 text=html.unescape(re.sub(r'<[^>]+>','',text)).replace('\r','').strip()
 text=re.sub(r' +',' ',text)
 # The original values for level-scaling spell effects are intentionally described symbolically.
 if s[31]:
  text=re.sub(r'(?<!\d)0(?= (?:Spellstorm|Nature|Arcane|Fire|Frost|Holy|Shadow) damage)', 'level-scaled',text)
  text=re.sub(r'for 0(?=[.,])','for an amount that scales with level and spell power',text)
 if id==76808:text='Increases the damage of your finishing moves and the effectiveness of Slice and Dice. The bonus increases with Mastery.'
 if not text:text='Specialization ability: '+spells.text(s[21])+'.'
 assert '$' not in text,(id,text,vartext)
 return text

names={'Warrior':('warrior','Воин'),'Paladin':('paladin','Паладин'),'Hunter':('hunter','Охотник'),'Rogue':('rogue','Разбойник'),'Priest':('priest','Жрец'),'Shaman':('shaman','Шаман'),'Mage':('mage','Маг'),'Warlock':('warlock','Чернокнижник'),'Druid':('druid','Друид'),'Death Knight':('deathknight','Рыцарь смерти')}
resources={k:[('mana','Мана',100,'percent','bar')] for k in names}
resources['Warrior']=[('rage','Ярость',100,'points','bar')];resources['Hunter']=[('focus','Фокус',100,'points','bar')];resources['Rogue']=[('energy','Энергия',100,'points','bar'),('combo','Приёмы',5,'count','icons')];resources['Death Knight']=[('runes','Руны',6,'count','icons'),('runic','Сила рун',100,'points','bar')];resources['Druid'] += [('rage','Ярость',100,'points','bar'),('energy','Энергия',100,'points','bar'),('combo','Приёмы',5,'count','icons'),('eclipse','Энергия затмения',100,'points','bar')];resources['Paladin'] += [('holy','Светлая сила',3,'count','icons')];resources['Warlock'] += [('shards','Осколки души',3,'count','icons')]
point_power={0:'mana',1:'rage',2:'focus',3:'energy',5:'runes',6:'runic',9:'holy'}
manifest=[x for x in json.loads((root/'index.json').read_text()) if x.get('version')!='4.3.4'];bonus_count=0
for klass,cls in data['classes'].items():
 slug,label=names[klass];doc={'version':1,'name':label+' · 4.3.4','budget':41,'budgetAuto':False,'rowCost':5,'specialization':{'requiredPoints':31},'branches':[],'abilities':[],'build':{},'character':{'hp':10000,'race':'Человек','gender':'Мужской','armory':'','resources':[{'id':'cata:'+rid,'name':name,'max':maximum,'current':0 if rid in ('rage','runic','holy','combo','eclipse') else maximum,'unit':unit,'display':display,'shape':'diamond','color':'#397de1' if rid=='mana' else '#b84e42'} for rid,name,maximum,unit,display in resources[klass]]},'source':{'version':'4.3.4','url':'https://github.com/fooxytv/cplus-talents/blob/main/src/editions/cata.json','dataBlob':'a6ce40095cb8ca84926e81bca6c70db88a0f6bfa','generated':data['generated'],'language':'en','primarySpells':'https://github.com/caicaicai/dbc434','notes':['Level/stat dependent specialization effects are represented symbolically.','Arcane contains 21 named talents; one stale unnamed Wowhead entry overlaps Improved Arcane Explosion and is excluded.'] if klass=='Mage' else ['Level/stat dependent specialization effects are represented symbolically.']}}
 for bi,tree in enumerate(cls['trees']):
  bid=f'cata-{slug}-{bi}';branch={'id':bid,'name':tree['name'],'icon':tree['icon'],'rows':7,'talents':[]};idmap={t['id']:f'{bid}-{i}' for i,t in enumerate(tree['talents'])}
  for i,t in enumerate(tree['talents']):branch['talents'].append({'id':idmap[t['id']],'name':t['name'],'icon':t['icon'],'maxRank':t['maxRank'],'row':ord(t['pos'][0])-97,'col':int(t['pos'][1])-1,'descriptions':t['ranks'],'requires':idmap.get(t.get('prereq'),'')})
  doc['branches'].append(branch);tab=tabs.by_id[tree['bg']];primary_ids=[r[2] for r in primary.rows if r[1]==tree['bg']];mastery_ids=list(filter(None,tab[9:11]))
  for sid in primary_ids+mastery_ids:
   sp=spells.by_id[sid];icon=icons.by_id.get(sp[19]);iconname=icons.text(icon[1]).replace('\\','/').split('/')[-1].lower() if icon else tree['icon'];power=powers.by_id.get(sp[42]);powerkey=point_power.get(sp[14]);costs=[]
   if power and powerkey and any(r['id']=='cata:'+powerkey for r in doc['character']['resources']):
    amount=power[3] or power[1];unit='percent' if power[3] else 'points'
    if not power[3] and powerkey in ('rage','runic'):amount/=10
    if amount:costs=[{'resourceId':'cata:'+powerkey,'resourceName':next(r['name'] for r in doc['character']['resources'] if r['id']=='cata:'+powerkey),'amount':amount,'unit':unit}]
   rune=rune_costs.by_id.get(sp[26])
   if klass=='Death Knight' and rune and sum(rune[1:4]):costs.append({'resourceId':'cata:runes','resourceName':'Руны','amount':sum(rune[1:4]),'unit':'count'})
   cast=casts.by_id.get(sp[12]);cooldown=cooldowns.by_id.get(sp[37]);range_=ranges.by_id.get(sp[15]);mastery=sid in mastery_ids
   ability={'id':f'{bid}-spec-{sid}','name':spells.text(sp[21]),'icon':iconname,'description':describe(sid,mastery),'kind':'passive' if sp[1]&64 or mastery else 'active','branchId':bid,'learningMode':'specialization','resourceCosts':costs,'cast':max(0,signed(cast[1])/1000) if cast else 0,'cooldown':max(cooldown[1:3])/1000 if cooldown else 0,'range':max(ranges.f(range_[3]),ranges.f(range_[4])) if range_ else 0,'requirements':'Level 80 · Mastery' if mastery else '', 'sourceSpellId':sid}
   doc['abilities'].append(ability);bonus_count+=1
 (root/f'cata-{slug}.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n');manifest.append({'id':'cata-'+slug,'name':label,'talents':sum(len(b['talents']) for b in doc['branches']),'version':'4.3.4'});print(klass,len(doc['abilities']),sum(len(b['talents']) for b in doc['branches']))
(root/'index.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print('Specialization abilities',bonus_count)
