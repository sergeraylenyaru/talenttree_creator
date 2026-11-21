import {blank,placeAbilityTalent,normalize} from '../static/engine.js';
import {configureCataclysmClass} from '../static/combat/class-resources.js';
import {classSpellTemplates,classTemplateLabels} from '../static/combat/class-spell-templates.js';
import {copyAbility} from '../static/combat/ability-instance.js';

const builds={};
for(const key of Object.keys(classTemplateLabels)){
  let doc=blank();
  delete doc.character;
  doc.name='Task 17 '+classTemplateLabels[key][1];
  doc.rpg={version:1,level:85,seed:13,attributes:{strength:10,agility:10,intellect:10,stamina:20,
    hitRating:10000,spellHitRating:10000,expertiseRating:10000,critChance:0}};
  doc=configureCataclysmClass(doc,key);
  doc.rpg.incoming={school:'physical',amount:200};
  doc.rpg.items=[{id:'test-weapon',name:'Training weapon',slot:'mainHand',type:'sword1',icon:'forge-steel',level:85,quality:'rare',
    minDamage:20,maxDamage:30,speed:1.8,stats:{attackPower:10,spellPower:10}},
    {id:'test-head',name:'Training hood',slot:'head',type:'cloth',icon:'forge-arcane',level:85,quality:'rare',setId:'test-set',stats:{intellect:5}},
    {id:'test-chest',name:'Training robe',slot:'chest',type:'cloth',icon:'forge-arcane',level:85,quality:'rare',setId:'test-set',stats:{stamina:5}}];
  doc.rpg.equipped={mainHand:'test-weapon',head:'test-head',chest:'test-chest'};
  if(['hunter','mage','priest','warlock'].includes(key)){
    doc.rpg.items.push({id:'test-ranged',name:'Training ranged',slot:'ranged',type:key==='hunter'?'bow':'wand',icon:'forge-arcane',
      level:85,quality:'rare',minDamage:20,maxDamage:30,speed:1.8,stats:{}});
    doc.rpg.equipped.ranged='test-ranged';doc.rpg.autoSlot='ranged';
  }
  doc.rpg.setBonuses=[{id:'two-piece',name:'Training two-piece',setId:'test-set',pieces:2,stats:{spellPower:20}}];
  const templates=classSpellTemplates(key,doc.character,'en'),roles={};
  doc.abilities=templates.map(template=>{
    const role=template.id.slice(('tf-class-'+key+'-').length);
    const instance=copyAbility(template);roles[role]=instance.id;return instance;
  });
  const heavy=doc.abilities.find(ability=>ability.id===roles.heavy);
  const resourceId=heavy.resourceCosts[0].resourceId;
  if(key==='deathknight')doc.rpg.resources[resourceId]={...doc.rpg.resources[resourceId],onHit:3};
  const discipline=doc.abilities.find(ability=>ability.id===roles.discipline);
  discipline.combatEffects.push({id:'proc-resource',type:'resource',trigger:'onCast',resourceId,amount:1,unit:'points'});
  doc.rpg.procs=[{id:'class-resource',owner:{kind:'passive',id:discipline.id},name:'Class resource trigger',
    event:'damage',sourceAbilityId:roles.strike,chance:1,cooldown:0,spell:discipline.id,effect:'proc-resource'}];
  doc=placeAbilityTalent(doc,heavy.id,doc.branches[0].id,0,0);
  doc.build[doc.branches[0].talents[0].id]=1;
  doc.rpg.bonuses=[{id:'heavy-talent',owner:{kind:'talent',id:doc.branches[0].talents[0].id},spell:heavy.id,stat:'damage',amount:10}];
  doc.rpg.builds=[{id:'first',name:'First',talents:{...doc.build},equipped:{...doc.rpg.equipped}},
    {id:'second',name:'Second',talents:{...doc.build},equipped:{...doc.rpg.equipped}}];
  builds[key]={document:normalize(doc),roles,resourceId};
}
process.stdout.write(JSON.stringify(builds));
