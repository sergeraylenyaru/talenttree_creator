import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {abilityUnlocked, blank, normalize, placeAbilityTalent} from '../static/engine.js';
import {abilityReadiness} from '../static/combat/ability-readiness.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {attackProfile} from '../static/world/combat/spatial-combat.js';

const damages = {id:'impact',type:'damage',trigger:'onHit',school:'arcane',scalingStat:'none',coefficient:0,baseAmount:135,canCrit:false};
const ability = (id,effects=[damages])=>({id,name:'Same name',icon:'forge-arcane',description:'Same text',kind:'active',
  learningMode:'talent',cast:0,cooldown:4,range:30,resourceCosts:[{resourceId:'legacy:0',amount:20,unit:'points'}],
  presentation:{targeting:'dummy',delivery:'ranged',projectile:'straight'},combatEffects:effects});

test('replacement preserves the talent ID and keeps both library items and build ranks',()=>{
  let doc=blank();
  doc.abilities=[ability('original'),ability('replacement')];
  const branch=doc.branches[0];
  doc=placeAbilityTalent(doc,'original',branch.id,0,0);
  const id=doc.branches[0].talents[0].id;
  doc.abilities[0].talentId=id;
  doc.build[id]=1;
  doc=placeAbilityTalent(doc,'replacement',branch.id,0,0,true);
  assert.deepEqual(doc.abilities.map(a=>a.id),['original','replacement']);
  assert.equal(doc.branches[0].talents[0].id,id);
  assert.equal(doc.abilities[0].talentId,'');
  assert.equal(abilityUnlocked(doc,doc.abilities[0]),false);
  assert.equal(abilityUnlocked(doc,doc.abilities[1]),true);
  assert.equal(doc.build[id],1);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(doc))),doc);
});

test('broken legacy links remain repairable and duplicate IDs are rejected',()=>{
  const doc=blank();
  doc.abilities=[ability('valid')];
  const branch=doc.branches[0];
  branch.talents.push({id:'node',row:0,col:0,name:'Lost link',icon:'forge-arcane',maxRank:1,descriptions:['Details'],grantedAbilityId:'missing'});
  assert.throws(()=>normalize(structuredClone(doc)),/Способность таланта/);
  assert.equal(normalize(structuredClone(doc),{allowLegacy:true}).branches[0].talents[0].grantedAbilityId,'missing');
  assert.equal(abilityReadiness(doc,undefined).state,'broken');
  assert.equal(placeAbilityTalent(doc,'valid',branch.id,0,0,true).branches[0].talents[0].grantedAbilityId,'valid');
  doc.abilities.push(ability('valid'));
  assert.throws(()=>normalize(doc),/Повторяющийся идентификатор/);
});

test('learned projectile pays once and only a confirmed hit changes health, log and statistics',()=>{
  let doc=blank();
  doc.abilities=[ability('bolt'),{...ability('empty',[]),learningMode:'base'}];
  doc=placeAbilityTalent(doc,'bolt',doc.branches[0].id,0,0);
  assert.equal(createCombatRuntime(compileCombatBuild(doc)).cast('bolt').reason,'locked');
  doc.build[doc.branches[0].talents[0].id]=1;
  const runtime=createCombatRuntime(compileCombatBuild(doc));
  assert.equal(runtime.cast('empty').reason,'noEffects');
  assert.equal(runtime.state.player.resources['legacy:0'].current,100);
  assert.equal(runtime.state.globalCooldownUntil,0);
  let impact;
  assert.equal(runtime.cast('bolt',()=>({projectile:true,validate(){},launch(_,resolve){impact=resolve;}})).ok,true);
  assert.equal(runtime.state.player.resources['legacy:0'].current,80);
  assert.equal(runtime.state.dummy.health,runtime.state.dummy.maxHealth);
  assert.equal(runtime.cast('bolt').reason,'cooldown');
  impact('hit');impact('hit');
  assert.equal(runtime.state.dummy.health,runtime.state.dummy.maxHealth-135);
  assert.equal(runtime.state.statistics.damageByAbility.bolt,135);
  assert.equal(runtime.state.combatLog.filter(event=>event.type==='projectileHit').length,1);
  assert.equal(runtime.state.combatLog.filter(event=>event.type==='resourceSpent').length,1);
});

const preset = name=>JSON.parse(readFileSync(new URL('../static/presets/'+name+'.json',import.meta.url)));
test('the catalog keeps every library ID and loads audited effects only into unconfigured records',()=>{
  const index=preset('index');
  let configured=0;
  for(const descriptor of index){
    const doc=preset(descriptor.id);
    const parsed=normalize(structuredClone(doc),{allowLegacy:true});
    assert.deepEqual(parsed.abilities.map(a=>a.id),doc.abilities.map(a=>a.id));
    configured+=parsed.abilities.filter(a=>a.combatEffects?.length).length;
  }
  assert.equal(configured,15);
  const mage=preset('cata-mage');
  const [barrage]=mage.abilities;
  barrage.combatEffects=[];
  assert.deepEqual(normalize(mage).abilities[0].combatEffects,[]);
});

test('restored Cataclysm damage, a school passive and a channel make measurable changes',()=>{
  const mage=normalize(preset('cata-mage'));
  mage.primaryBranchId=mage.branches[0].id;
  const options={stats:{critChance:0},globalCooldown:0};
  const caster=createCombatRuntime(compileCombatBuild(mage,options),options);
  caster.cast('cata-mage-0-spec-44425');
  assert.equal(caster.state.dummy.maxHealth-caster.state.dummy.health,529);
  const priest=normalize(preset('cata-priest'));
  priest.primaryBranchId=priest.branches[2].id;
  const channel=createCombatRuntime(compileCombatBuild(priest,options),options);
  assert.equal(channel.cast('cata-priest-2-spec-15407').ok,true);
  channel.advance(3);
  assert.equal(channel.state.dummy.maxHealth-channel.state.dummy.health,30);
  assert.equal(channel.state.combatLog.filter(event=>event.type==='damage').length,3);
  assert.ok(channel.state.combatLog.some(event=>event.type==='castCompleted'));
});

test('legacy debuffs use hostile spatial delivery and legacy shields are self utility',()=>{
  assert.equal(attackProfile({range:8,combatEffects:[{id:'debuff',type:'status',target:'dummy'}]}).targeting,'dummy');
  assert.equal(attackProfile({range:0,combatEffects:[{id:'ward',type:'shield'}]}).kind,'utility');
});

test('each stock active with audited effects changes actual dummy HP under its specialization',()=>{
  const options={stats:{critChance:0},globalCooldown:0};
  let executed=0;
  for(const presetInfo of preset('index')){
    const doc=normalize(preset(presetInfo.id),{allowLegacy:true});
    for(const active of doc.abilities.filter(a=>a.kind!=='passive'&&a.combatEffects?.some(effect=>effect.type==='damage'))){
      const scenario=structuredClone(doc);
      scenario.primaryBranchId=active.branchId;
      for(const resource of scenario.character?.resources??[])resource.current=resource.max;
      if(active.presentation?.delivery==='ranged'){
        const item={id:'audit-bow',name:'Audit bow',icon:'forge-steel',type:'bow',slot:'ranged',quality:'common',level:1,
          minDamage:100,maxDamage:100,speed:2};
        scenario.rpg={version:1,items:[item],equipped:{ranged:item.id}};
      }
      const runtime=createCombatRuntime(compileCombatBuild(scenario,options),options);
      assert.equal(runtime.cast(active.id).ok,true,active.id);
      runtime.advance(20);
      assert.ok(runtime.state.dummy.health<runtime.state.dummy.maxHealth,active.id);
      assert.ok(runtime.state.combatLog.some(e=>e.type==='damage'&&e.abilityId===active.id),active.id);
      executed++;
    }
  }
  assert.equal(executed,11);
});
