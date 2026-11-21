import test from 'node:test';
import assert from 'node:assert/strict';
import {blank,normalize} from '../static/engine.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {conditionMatches} from '../static/combat/conditions.js';
import {createProcEngine} from '../static/combat/proc-engine.js';
const damage={id:'hit',type:'damage',trigger:'onHit',school:'fire',baseAmount:100,coefficient:0,scalingStat:'none',canCrit:false};
const skill=(id,effects=[damage],extra={})=>({id,name:id,description:'Authored mechanic test',icon:'forge-ember',kind:'active',learningMode:'base',cast:0,cooldown:0,range:30,resourceCosts:[],combatEffects:effects,workshop:{version:1,noGcd:true},...extra});
function document(abilities){const doc=blank();doc.abilities=abilities;doc.rpg={version:1,level:85,attributes:{spellHitRating:10000,masteryRating:179.28},combatRules:{version:'cataclysm-4.3.4',classId:'mage',targetLevel:85}};return doc;}
const runtime=doc=>createCombatRuntime(compileCombatBuild(normalize(JSON.parse(JSON.stringify(doc)))),{seed:13});
const aura=(id,amount=10)=>({id,type:'status',trigger:'onCast',target:'player',name:id,stat:'damageDone',amount,duration:8,category:'power'});

test('a saved composite modifier and mastery behavior affect the chosen build and expose their arithmetic',()=>{
  const doc=document([skill('strike'),skill('drain',[{id:'drain',type:'resource',trigger:'onCast',resourceId:'legacy:0',unit:'points',amount:60,direction:'drain'}])]);
  doc.rpg.states={stance:'battle'};
  doc.rpg.bonuses=[{id:'mastery-bonus',owner:{kind:'ability',id:'strike'},stat:'damage',spell:'strike',amount:10,masteryScale:2,
    condition:{type:'all',conditions:[{type:'state',key:'stance',value:'battle'},{type:'resourceAbove',resource:'legacy:0',value:50}]}}];
  const rt=runtime(doc);assert.equal(rt.sheet().combatRules.mastery,9);rt.cast('strike');rt.cast('drain');rt.cast('strike');
  const hits=rt.state.combatLog.filter(e=>e.type==='damage');assert.deepEqual(hits.map(e=>e.amount),[128,100]);
  assert.equal(hits[0].modifiers[0].masteryPoints,9);assert.equal(hits[0].modifiers[0].amount,28);assert.deepEqual(hits[1].modifiers,[]);
  rt.reset();rt.cast('strike');assert.equal(rt.state.statistics.totalDamage,128);assert.equal(doc.rpg.bonuses[0].amount,10);
});

test('conditions read aura stacks, weapon, talent rank and only preceding events inside their window',()=>{
  const state={combatTime:10,player:{health:20,maxHealth:100,resources:{}},dummy:{health:40,maxHealth:100},combatLog:[{id:1,time:8,type:'damage',abilityId:'bolt'},{id:2,time:10,type:'damage',abilityId:'now'}]};
  const statuses=[{target:'player',stacks:2,effect:{id:'power'},ability:{id:'buff'}}];
  const condition={type:'all',conditions:[{type:'auraStacks',target:'player',value:'power',stacks:2},{type:'weapon',value:'sword1'},
    {type:'talentRank',value:'talent',rank:2},{type:'previousEvent',value:'damage',window:3,abilityId:'bolt'}]};
  assert.equal(conditionMatches(condition,{id:2},state,statuses,{type:'sword1'},{talents:{talent:2}}),true);
  state.combatTime=12;assert.equal(conditionMatches(condition,{id:3},state,statuses,{type:'sword1'},{talents:{talent:2}}),false);
  assert.equal(conditionMatches({type:'previousEvent',value:'damage',window:3,abilityId:'now'},{id:2},{...state,combatTime:10},[],{}),false);
});

test('refresh preserves or restarts the periodic timer according to the authored policy',()=>{
  for(const [policy,expected] of [['preserve',[1,2,3,4]],['restart',[1.5,2.5,3.5,4.5]]]){
    const rt=runtime(document([skill('dot',[{...damage,duration:4,interval:1,tickPolicy:policy}])]));
    rt.cast('dot');rt.advance(.5);rt.cast('dot');rt.advance(4);
    assert.deepEqual(rt.state.combatLog.filter(e=>e.type==='damage').map(e=>e.time),expected);
  }
});

test('a buff category replaces a different ability but keeps unrelated categories',()=>{
  const rt=runtime(document([skill('one',[aura('first')]),skill('two',[aura('second',20)]),skill('other',[{...aura('third'),category:'other'}])]));
  rt.cast('one');rt.cast('other');rt.cast('two');assert.deepEqual(rt.statuses.map(s=>s.effect.id),['third','second']);
  assert.equal(rt.state.combatLog.filter(e=>e.type==='statusExpired').length,1);
});

test('PPM uses base weapon speed and unrelated school events do not reset consecutive counters',()=>{
  const events=[],state={combatTime:0,classStates:{}},rule={id:'ppm',event:'damage',chance:1,ppm:6,attackType:'auto',cooldown:0};
  const proc=createProcEngine([rule],()=>.19);
  proc.dispatch({id:1,type:'damage',auto:true,weaponSpeed:2},state,[],{},()=>0,p=>{events.push(p.resolvedChance);return true;});assert.deepEqual(events,[.2]);
  const seen=[],crits=createProcEngine([{id:'crits',event:'criticalDamage',chance:1,cooldown:0,every:2,consecutive:true,school:'fire'}],()=>0);
  for(const e of [{id:1,type:'damage',isCritical:true,school:'fire'},{id:2,type:'damage',isCritical:false,school:'frost'},{id:3,type:'damage',isCritical:true,school:'fire'}])crits.dispatch(e,state,[],{},()=>0,()=>{seen.push(e.id);return true;});
  assert.deepEqual(seen,[3]);
});

test('the same dummy exposes a controlled cast, interrupt and school lockout without another entity',()=>{
  const control={id:'interrupt',type:'control',trigger:'onHit',target:'dummy',name:'Interrupt',controlType:'interrupt',duration:4,school:'fire'};
  const doc=document([skill('interrupt',[control])]);doc.rpg.incoming={school:'fire',amount:50,castTime:2};
  const rt=runtime(doc),health=rt.state.player.health;assert.equal(rt.incoming(),true);rt.advance(1);rt.cast('interrupt');
  assert.equal(rt.state.dummyCast,null);rt.advance(2);assert.equal(rt.state.player.health,health);assert.equal(rt.incoming(),false);
  rt.advance(2);assert.equal(rt.incoming(),true);rt.advance(2);assert.equal(rt.state.player.health,health-50);
  assert.equal(rt.state.combatLog.filter(e=>e.type==='dummyCastInterrupted').length,1);
});

test('a successful multi-component attack generates hit resources once',()=>{
  const doc=document([skill('combo',[damage,{...damage,id:'second',school:'frost'}])]);
  doc.character.resources[0].current=0;doc.rpg.resources={'legacy:0':{onHit:5,kind:'custom'}};
  const rt=runtime(doc);rt.cast('combo');assert.equal(rt.state.player.resources['legacy:0'].current,5);
});

test('converted runes retain their original serial pair and can substitute a typed rune cost once',()=>{
  const doc=document([skill('blood',[],{resourceCosts:[{resourceId:'blood',amount:1,unit:'count'}],combatEffects:[{id:'convert',type:'rune',trigger:'onCast',fromResource:'blood',toResource:'death',count:1}]}),
    skill('spend',[damage],{resourceCosts:[{resourceId:'blood',amount:2,unit:'count'}],workshop:{version:1,noGcd:true,runeSubstitute:'death'}})]);
  doc.character.resources=[{id:'blood',name:'Blood',max:2,current:2,unit:'count',display:'icons',shape:'circle',color:'#ff0000'},
    {id:'death',name:'Death',max:6,current:0,unit:'count',display:'icons',shape:'circle',color:'#aa00ff'}];
  doc.rpg.resources={blood:{rune:true,kind:'rune',recharge:10},death:{rune:true,kind:'rune',recharge:10}};
  const rt=runtime(doc);assert.equal(rt.cast('blood').ok,true);rt.advance(10);
  assert.equal(rt.state.player.resources.blood.current,1);assert.equal(rt.state.player.resources.death.current,1);
  assert.equal(rt.cast('spend').ok,true);assert.equal(rt.state.player.resources.blood.current,0);assert.equal(rt.state.player.resources.death.current,0);
  assert.deepEqual(rt.runeState().blood,[20,30]);rt.advance(10);assert.equal(rt.state.player.resources.blood.current,1);rt.advance(10);
  assert.equal(rt.state.player.resources.blood.current,2);assert.equal(rt.state.player.resources.death.current,0);
  rt.reset();assert.deepEqual(rt.runeDetails().convertedReady,{});
});

test('rune haste changes preserve remaining progress and return to normal when the aura ends',()=>{
  const doc=document([skill('spend',[damage],{resourceCosts:[{resourceId:'legacy:0',amount:1,unit:'count'}]}),
    skill('haste',[{id:'haste',type:'status',trigger:'onCast',name:'Haste',stat:'haste',target:'player',amount:100,duration:2}])]);
  doc.character.resources[0].max=2;doc.character.resources[0].current=2;doc.rpg.resources={'legacy:0':{rune:true,recharge:10}};doc.rpg.hasteUses=['rune'];
  const rt=runtime(doc);rt.cast('spend');rt.advance(2);rt.cast('haste');rt.advance(2);assert.equal(rt.state.player.resources['legacy:0'].current,1);
  rt.advance(3.99);assert.equal(rt.state.player.resources['legacy:0'].current,1);rt.advance(.01);assert.equal(rt.state.player.resources['legacy:0'].current,2);
});

test('a school condition modifies only its matching component in a mixed-school attack',()=>{
  const doc=document([skill('mixed',[damage,{...damage,id:'frost',school:'frost'}])]);
  doc.rpg.bonuses=[{id:'fire-only',owner:{kind:'ability',id:'mixed'},stat:'damage',amount:50,condition:{type:'school',value:'fire'}}];
  const rt=runtime(doc);rt.cast('mixed');assert.deepEqual(rt.state.combatLog.filter(e=>e.type==='damage').map(e=>e.amount),[150,100]);
});

test('report exports include their rules provenance and cannot mutate live state through nested data',()=>{
  const doc=document([skill('strike')]);doc.rpg.bonuses=[{id:'bonus',owner:{kind:'ability',id:'strike'},stat:'damage',amount:10}];
  const rt=runtime(doc);rt.cast('strike');const report=rt.report();assert.equal(report.conditions.combatRules.version,'cataclysm-4.3.4');assert.equal(report.conditions.ruleEvidence.clientTablesAvailable,false);
  report.timeline.find(e=>e.type==='damage').modifiers[0].amount=999;report.conditions.combatRules.classId='warrior';
  assert.equal(rt.report().timeline.find(e=>e.type==='damage').modifiers[0].amount,10);assert.equal(rt.sheet().combatRules.classId,'mage');
});

test('reset invalidates cached statistics after a form change',()=>{
  const doc=document([skill('shift',[{id:'form',type:'state',trigger:'onCast',key:'form',value:'cat'}])]);
  doc.rpg.attributes.armor=100;doc.rpg.states={form:'human'};doc.rpg.bonuses=[{id:'cat-armor',owner:{kind:'ability',id:'shift'},stat:'armor',amount:100,state:{key:'form',value:'cat'}}];
  const rt=runtime(doc);assert.equal(rt.sheet().armor,100);rt.cast('shift');assert.equal(rt.sheet().armor,200);rt.reset();assert.equal(rt.sheet().armor,100);assert.equal(rt.state.classStates.form,'human');
});
