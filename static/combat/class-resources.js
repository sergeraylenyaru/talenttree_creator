// Resource definitions transcribed from the existing Cataclysm preset documents.
const sourceResources = {
  "warrior": [
    {
      "id": "cata:rage",
      "name": "Ярость",
      "max": 100,
      "current": 0,
      "unit": "points",
      "display": "bar",
      "shape": "diamond",
      "color": "#b84e42"
    }
  ],
  "paladin": [
    {
      "id": "cata:mana",
      "name": "Мана",
      "max": 100,
      "current": 100,
      "unit": "percent",
      "display": "bar",
      "shape": "diamond",
      "color": "#397de1"
    },
    {
      "id": "cata:holy",
      "name": "Светлая сила",
      "max": 3,
      "current": 0,
      "unit": "count",
      "display": "icons",
      "shape": "diamond",
      "color": "#b84e42"
    }
  ],
  "hunter": [
    {
      "id": "cata:focus",
      "name": "Фокус",
      "max": 100,
      "current": 100,
      "unit": "points",
      "display": "bar",
      "shape": "diamond",
      "color": "#b84e42"
    }
  ],
  "rogue": [
    {
      "id": "cata:energy",
      "name": "Энергия",
      "max": 100,
      "current": 100,
      "unit": "points",
      "display": "bar",
      "shape": "diamond",
      "color": "#b84e42"
    },
    {
      "id": "cata:combo",
      "name": "Приёмы",
      "max": 5,
      "current": 0,
      "unit": "count",
      "display": "icons",
      "shape": "diamond",
      "color": "#b84e42"
    }
  ],
  "priest": [
    {
      "id": "cata:mana",
      "name": "Мана",
      "max": 100,
      "current": 100,
      "unit": "percent",
      "display": "bar",
      "shape": "diamond",
      "color": "#397de1"
    }
  ],
  "shaman": [
    {
      "id": "cata:mana",
      "name": "Мана",
      "max": 100,
      "current": 100,
      "unit": "percent",
      "display": "bar",
      "shape": "diamond",
      "color": "#397de1"
    }
  ],
  "mage": [
    {
      "id": "cata:mana",
      "name": "Мана",
      "max": 100,
      "current": 100,
      "unit": "percent",
      "display": "bar",
      "shape": "diamond",
      "color": "#397de1"
    }
  ],
  "warlock": [
    {
      "id": "cata:mana",
      "name": "Мана",
      "max": 100,
      "current": 100,
      "unit": "percent",
      "display": "bar",
      "shape": "diamond",
      "color": "#397de1"
    },
    {
      "id": "cata:shards",
      "name": "Осколки души",
      "max": 3,
      "current": 3,
      "unit": "count",
      "display": "icons",
      "shape": "diamond",
      "color": "#b84e42"
    }
  ],
  "druid": [
    {
      "id": "cata:mana",
      "name": "Мана",
      "max": 100,
      "current": 100,
      "unit": "percent",
      "display": "bar",
      "shape": "diamond",
      "color": "#397de1"
    },
    {
      "id": "cata:rage",
      "name": "Ярость",
      "max": 100,
      "current": 0,
      "unit": "points",
      "display": "bar",
      "shape": "diamond",
      "color": "#b84e42"
    },
    {
      "id": "cata:energy",
      "name": "Энергия",
      "max": 100,
      "current": 100,
      "unit": "points",
      "display": "bar",
      "shape": "diamond",
      "color": "#b84e42"
    },
    {
      "id": "cata:combo",
      "name": "Приёмы",
      "max": 5,
      "current": 0,
      "unit": "count",
      "display": "icons",
      "shape": "diamond",
      "color": "#b84e42"
    },
    {
      "id": "cata:eclipse",
      "name": "Энергия затмения",
      "max": 100,
      "current": 0,
      "unit": "points",
      "display": "bar",
      "shape": "diamond",
      "color": "#b84e42"
    }
  ],
  "deathknight": [
    {
      "id": "cata:runes",
      "name": "Руны",
      "max": 6,
      "current": 6,
      "unit": "count",
      "display": "icons",
      "shape": "diamond",
      "color": "#b84e42"
    },
    {
      "id": "cata:runic",
      "name": "Сила рун",
      "max": 100,
      "current": 0,
      "unit": "points",
      "display": "bar",
      "shape": "diamond",
      "color": "#b84e42"
    }
  ]
};

const extraResources = {
  priest:[['cata:orbs','Shadow Orbs',3,0]],shaman:[['cata:maelstrom','Maelstrom Weapon',5,0]],
  deathknight:[['cata:bloodRunes','Blood Runes',2,2],['cata:frostRunes','Frost Runes',2,2],['cata:unholyRunes','Unholy Runes',2,2]]
};
const defaults={warrior:{rage:{onHit:3}},hunter:{focus:{regen:4}},rogue:{energy:{regen:10}},druid:{energy:{regen:10}}};
const aliases={mana:['mana','мана'],rage:['rage','ярость'],focus:['focus','фокус','концентрация'],energy:['energy','энергия'],runic:['runic power','сила рун'],holy:['holy power','светлая сила'],combo:['combo points','приёмы'],shards:['soul shards','осколки души']};
const states={warrior:{stance:'battle'},hunter:{aspect:'hawk'},priest:{mode:'holy'},druid:{form:'caster'}};

export function configureCataclysmClass(document,classId) {
  if(!Object.hasOwn(sourceResources,classId))throw Error('Unknown class');
  const next=structuredClone(document);
  next.character??={hp:10000,race:'Human',gender:'Male',armory:'',resources:[]};
  const existing=next.character.resources;
  existing.forEach((resource,index)=>{resource.id??='legacy:'+index;});
  const prototype=structuredClone(sourceResources[classId]).filter(resource=>classId!=='deathknight'||resource.id!=='cata:runes');
  for(const [id,name,max,current] of extraResources[classId]??[]){
    prototype.push({id,name,max,current,unit:'count',display:'bar',shape:'diamond',color:'#639ed5'});
  }
  next.rpg??={version:1};
  next.rpg.level??=85;
  next.rpg.combatRules={version:'cataclysm-4.3.4',classId,targetLevel:(next.rpg.level??85)+3};
  next.rpg.states={...states[classId],...next.rpg.states};
  next.rpg.resources??={};
  for(const resource of prototype){
    let match=existing.find(value=>value.id===resource.id||value.name.toLowerCase()===resource.name.toLowerCase()||
      aliases[resource.id.split(':').at(-1)]?.includes(value.name.toLowerCase()));
    if(!match){match=resource;existing.push(match);}
    const tail=resource.id.split(':').at(-1);
    const recovery=tail.endsWith('Runes')?{rune:true,recharge:10}:defaults[classId]?.[tail]??{};
    next.rpg.resources[match.id]={kind:tail.endsWith('Runes')?'rune':['mana','energy','rage','focus'].includes(tail)?tail:'custom',...recovery,...next.rpg.resources[match.id]};
  }
  next.rpg.hasteUses=[...new Set([...(next.rpg.hasteUses??[]),'swing','cast','channel','gcd',...(classId==='deathknight'?['rune']:[])])];
  return next;
}
