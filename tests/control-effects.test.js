import test from 'node:test';
import assert from 'node:assert/strict';
import {blank,normalize} from '../static/engine.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';

const control=(controlType,target='dummy',extra={})=>({id:'control',type:'control',trigger:'onHit',
  name:controlType,target,controlType,duration:4,dispelType:'magic',...extra});
const spell=(id,effects,extra={})=>({id,name:id,description:'Test',icon:'forge-arcane',kind:'active',learningMode:'base',
  cast:0,cooldown:0,range:20,resourceCosts:[],combatEffects:effects,...extra});
const create=(abilities,extra={})=>{
  const doc=blank();
  doc.abilities=abilities;
  doc.rpg.incoming={school:'physical',amount:100};
  Object.assign(doc.rpg,extra);
  return createCombatRuntime(compileCombatBuild(normalize(doc)),{globalCooldown:0,random:()=>.99});
};

test('control durations diminish per target and category then reset after removal plus 18 seconds',()=>{
  const rt=create([spell('stun',[control('stun','dummy',{drGroup:'stun'})])]);
  for(const expected of [4,2,1]){
    assert.equal(rt.cast('stun').ok,true);
    assert.equal(rt.statuses.at(-1).expires-rt.state.combatTime,expected);
    rt.advance(expected);
  }
  rt.cast('stun');
  assert.equal(rt.statuses.length,0);
  assert.equal(rt.state.combatLog.at(-1).type,'controlImmune');
  rt.advance(18);
  rt.cast('stun');
  assert.equal(rt.statuses.at(-1).expires-rt.state.combatTime,4);
});

test('a removable magic root can be cleansed, poison does not remove it, and movement resumes',()=>{
  const rt=create([
    spell('root',[control('root','player')]),
    spell('wrong',[{id:'dispel',type:'dispel',trigger:'onCast',target:'player',dispelType:'poison',count:1}]),
    spell('cleanse',[{id:'dispel',type:'dispel',trigger:'onCast',target:'player',dispelType:'magic',count:1}])
  ]);
  rt.cast('root');
  assert.equal(rt.movementScale(),0);
  rt.cast('wrong');
  assert.equal(rt.movementScale(),0);
  rt.cast('cleanse');
  assert.equal(rt.movementScale(),1);
  assert.equal(rt.state.combatLog.filter(event=>event.type==='dispelled').at(-1).amount,1);
});

test('stun interrupts without resource payment and expires on the combat clock',()=>{
  const rt=create([
    spell('cast',[{id:'heal',type:'healing',trigger:'onCast',baseAmount:10,scalingStat:'none',coefficient:0,canCrit:false}],
      {cast:3,resourceCosts:[{resourceId:'legacy:0',amount:20,unit:'points'}]}),
    spell('stun',[control('stun','player')])
  ]);
  rt.cast('stun');
  const pool=rt.state.player.resources['legacy:0'].current;
  assert.equal(rt.cast('cast').reason,'stun');
  rt.advance(4);
  rt.cast('cast');
  rt.cancel();
  assert.equal(rt.state.player.resources['legacy:0'].current,pool);
});

test('immunity prevents the controlled incoming strike and fear can break on actual damage',()=>{
  const rt=create([
    spell('immunity',[control('immunity','player')]),
    spell('fear',[control('fear','dummy',{breakOnDamage:true})]),
    spell('hit',[{id:'damage',type:'damage',trigger:'onHit',school:'physical',baseAmount:100,scalingStat:'none',coefficient:0,canCrit:false}])
  ]);
  rt.cast('immunity');
  const health=rt.state.player.health;
  rt.incoming();
  assert.equal(rt.state.player.health,health);
  assert.equal(rt.state.combatLog.at(-1).type,'immune');
  rt.cast('fear');
  rt.cast('hit');
  assert.equal(rt.statuses.filter(status=>status.target==='dummy').length,0);
  assert.equal(rt.state.statistics.totalDamage,100);
});

test('cooldown effects reduce recovery and restore charges through the ordinary cast path',()=>{
  const rt=create([
    spell('burst',[control('slow')],{cooldown:20,workshop:{version:1,charges:2,recharge:10}}),
    spell('reset',[{id:'reset',type:'cooldown',trigger:'onCast',abilityId:'burst',seconds:0,reset:true}])
  ]);
  rt.cast('burst');
  assert.equal(rt.availability('burst').reason,'cooldown');
  assert.equal(rt.chargeCount('burst'),1);
  rt.cast('reset');
  assert.equal(rt.availability('burst').reason,undefined);
  assert.equal(rt.chargeCount('burst'),2);
  rt.cast('burst');
  assert.equal(rt.state.combatLog.filter(event=>event.type==='cooldownChanged').length,1);
});

test('school shields preserve capacity against other schools and reflection uses the common damage path',()=>{
  const rt=create([
    spell('ward',[{id:'shield',type:'shield',trigger:'onCast',name:'Physical ward',school:'physical',
      amount:50,fraction:1,coefficient:0,priority:10,duration:5}]),
    spell('mirror',[{id:'reflect',type:'status',trigger:'onCast',name:'Mirror',target:'player',
      stat:'reflectDamage',amount:50,duration:5}])
  ]);
  rt.cast('ward');
  rt.cast('mirror');
  const health=rt.state.player.health;
  rt.incoming();
  assert.equal(health-rt.state.player.health,50);
  assert.equal(rt.state.statistics.totalDamage,25);
  assert.equal(rt.state.combatLog.find(event=>event.type==='absorbed').amount,50);
  assert.equal(rt.state.combatLog.find(event=>event.type==='reflected').amount,25);
});

test('proc chains opt in, respect their path, priority and charge limits',()=>{
  const doc=blank();
  doc.abilities=[
    spell('hit',[{id:'damage',type:'damage',trigger:'onHit',school:'fire',baseAmount:1,scalingStat:'none',coefficient:0,canCrit:false}]),
    {...spell('passive',[{id:'gain',type:'resource',trigger:'onCast',resourceId:'legacy:0',unit:'points',amount:1}]),kind:'passive'}
  ];
  doc.character.resources[0].current=50;
  doc.rpg.procs=[
    {id:'a',owner:{kind:'passive',id:'passive'},name:'First',event:'damage',chance:1,cooldown:0,
      spell:'passive',effect:'gain',priority:10,charges:1},
    {id:'b',owner:{kind:'passive',id:'passive'},name:'Second',event:'resourceGained',chance:1,cooldown:0,
      spell:'passive',effect:'gain',chain:true,charges:1}
  ];
  const rt=createCombatRuntime(compileCombatBuild(normalize(doc)),{random:()=>0,globalCooldown:0});
  rt.cast('hit');
  rt.cast('hit');
  assert.equal(rt.state.player.resources['legacy:0'].current,52);
  assert.deepEqual(rt.state.combatLog.filter(event=>event.type==='procTriggered').map(event=>[event.procId,event.depth]),
    [['a',1],['b',2]]);
  assert.ok(rt.state.combatLog.length<30);
});

test('rune pairs recover serially, separate schools recover concurrently, and pause freezes recovery',()=>{
  const doc=blank();
  doc.character.resources=[
    {id:'blood',name:'Blood',max:2,current:2,unit:'count',display:'bar',shape:'diamond',color:'#ff0000'},
    {id:'frost',name:'Frost',max:2,current:2,unit:'count',display:'bar',shape:'diamond',color:'#0000ff'}
  ];
  doc.rpg.resources={blood:{rune:true,recharge:10},frost:{rune:true,recharge:10}};
  doc.abilities=[spell('strike',[control('slow')],{resourceCosts:[
    {resourceId:'blood',amount:2,unit:'count'},{resourceId:'frost',amount:1,unit:'count'}
  ]})];
  const rt=createCombatRuntime(compileCombatBuild(normalize(doc)),{globalCooldown:0});
  rt.cast('strike');
  assert.equal(rt.state.player.resources.blood.current,0);
  assert.deepEqual(rt.runeState(),{blood:[10,20],frost:[10]});
  rt.setPaused(true);rt.advance(30);
  assert.equal(rt.state.player.resources.blood.current,0);
  rt.setPaused(false);rt.advance(10);
  assert.equal(rt.state.player.resources.blood.current,1);
  assert.equal(rt.state.player.resources.frost.current,2);
  rt.advance(10);
  assert.equal(rt.state.player.resources.blood.current,2);
  assert.equal(rt.state.combatLog.filter(event=>event.type==='resourceGained').length,3);
});


test('form requirements gate abilities, level scaling applies, and changing state refreshes the sheet',()=>{
  const doc=blank();
  doc.rpg={version:1,level:85,attributes:{strength:50,agility:100},states:{form:'caster'},
    combatRules:{version:'cataclysm-4.3.4',classId:'druid',targetLevel:85}};
  doc.abilities=[
    spell('cat',[{id:'cat',type:'state',trigger:'onCast',key:'form',value:'cat'}]),
    spell('bear',[{id:'bear',type:'state',trigger:'onCast',key:'form',value:'bear'}]),
    spell('claw',[{id:'damage',type:'damage',trigger:'onHit',school:'physical',baseAmount:100,scalingStat:'none',coefficient:0,canCrit:false}],
      {workshop:{version:1,requiredStateKey:'form',requiredStateValue:'cat',requiredClass:'druid',requiredLevel:85,baseLevel:80,levelScale:10}})
  ];
  const rt=createCombatRuntime(compileCombatBuild(normalize(doc)),{globalCooldown:0,random:()=>.99});
  assert.equal(rt.cast('claw').reason,'stateRequired');
  rt.cast('cat');
  assert.equal(rt.state.classStates.form,'cat');
  assert.equal(rt.cast('claw').ok,true);
  assert.equal(rt.state.statistics.totalDamage,150);
  assert.equal(rt.sheet().source.attackPower,200);
  rt.cast('bear');
  assert.equal(rt.sheet().source.attackPower,100);
  assert.equal(rt.cast('claw').reason,'stateRequired');
});

test('a selected survival scenario advances only on Combat Clock and shields reduce scheduled strikes',()=>{
  const rt=create([
    spell('ward',[{id:'shield',type:'shield',trigger:'onCast',name:'Ward',amount:150,fraction:1,coefficient:0,priority:1,duration:8}])
  ],{trainingMode:'survival',incoming:{school:'physical',amount:100,interval:2}});
  const health=rt.state.player.health;
  rt.cast('ward');
  rt.advance(2);
  assert.equal(rt.state.player.health,health);
  rt.setPaused(true);rt.advance(20);
  assert.equal(rt.state.combatTime,2);
  rt.setPaused(false);rt.advance(2);
  assert.equal(rt.state.player.health,health-50);
  const report=rt.report();
  assert.equal(report.metrics.absorbed,150);
  assert.equal(report.metrics.incoming,50);
});

test('critical reduction affects an incoming critical strike before absorption',()=>{
  const rt=create([
    spell('guard',[{id:'reduction',type:'status',trigger:'onCast',target:'player',name:'Crit guard',
      stat:'criticalReduction',amount:50,duration:4}])
  ],{incoming:{school:'physical',amount:100,canCrit:true,critChance:1,critMultiplier:2}});
  const health=rt.state.player.health;
  rt.cast('guard');
  rt.incoming();
  assert.equal(health-rt.state.player.health,150);
  assert.equal(rt.state.combatLog.at(-1).critical,50);
});

test('rate chart buckets and avoidance metrics agree with the full combat report',()=>{
  const rt=create([
    spell('hit',[{id:'damage',type:'damage',trigger:'onHit',school:'fire',baseAmount:100,scalingStat:'none',coefficient:0,canCrit:false}])
  ]);
  rt.cast('hit');
  rt.advance(2);
  rt.cast('hit');
  const report=rt.report();
  assert.equal(report.metrics.damage,200);
  assert.equal(report.series.reduce((sum,bucket)=>sum+bucket.damage,0),200);
  assert.equal(report.metrics.peakDps,100);
  assert.equal(report.metrics.dps,100);
});

test('free-cast auras are consumed only on execution and a finisher snapshots spent points through projectile contact',()=>{
  const aura={id:'clarity',type:'status',trigger:'onCast',name:'Clarity',target:'player',stat:'critChance',amount:0,duration:4};
  const damage={id:'hit',type:'damage',trigger:'onHit',school:'physical',baseAmount:10,scalingStat:'none',coefficient:0,canCrit:false};
  const rt=create([
    spell('clarity',[aura]),
    spell('free',[damage],{cast:1,resourceCosts:[{resourceId:'legacy:0',amount:100,unit:'points'}],
      workshop:{version:1,freeWithAura:'Clarity',consumeFreeAura:true}}),
    spell('finisher',[damage],{resourceCosts:[{resourceId:'legacy:0',amount:1,unit:'points'}],
      workshop:{version:1,finisherResource:'legacy:0',finisherScale:1}})
  ]);
  rt.cast('clarity');rt.cast('free');rt.cancel();
  assert.equal(rt.statuses.length,1);assert.equal(rt.state.player.resources['legacy:0'].current,100);
  rt.cast('free');rt.advance(1);
  assert.equal(rt.state.player.resources['legacy:0'].current,100);assert.equal(rt.statuses.length,0);
  assert.equal(rt.state.combatLog.filter(e=>e.type==='resourceSpent').length,0);
  let resolve;
  rt.cast('finisher',()=>({projectile:true,validate(){},launch(_,callback){resolve=callback;}}));
  assert.equal(rt.state.player.resources['legacy:0'].current,0);
  resolve('hit');
  assert.equal(rt.state.combatLog.filter(e=>e.type==='damage').at(-1).amount,1000);
  assert.equal(rt.state.combatLog.filter(e=>e.type==='resourceSpent').at(-1).amount,100);
});

test('out-of-combat resource recovery begins five combat seconds after the last action',()=>{
  const rt=create([spell('spend',[{id:'gain',type:'resource',trigger:'onCast',resourceId:'legacy:0',unit:'points',amount:0}],
    {resourceCosts:[{resourceId:'legacy:0',unit:'points',amount:50}]})],
    {resources:{'legacy:0':{regen:1,outOfCombatRegen:5}}});
  rt.cast('spend');rt.advance(5);assert.equal(rt.state.player.resources['legacy:0'].current,55);
  rt.advance(1);assert.equal(rt.state.player.resources['legacy:0'].current,60);
  rt.setPaused(true);rt.advance(10);assert.equal(rt.state.player.resources['legacy:0'].current,60);
});

test('school lockouts interrupt matching casts and leave other schools usable',()=>{
  const fire={id:'hit',type:'damage',trigger:'onHit',school:'fire',baseAmount:10,coefficient:0,scalingStat:'none',canCrit:false};
  const rt=create([spell('fire',[fire],{cast:2}),spell('frost',[{...fire,school:'frost'}]),
    spell('lock',[control('interrupt','player',{school:'fire'})])]);
  rt.cast('lock');assert.equal(rt.availability('fire').reason,'interrupt');
  assert.equal(rt.cast('frost').ok,true);
  rt.advance(4);assert.equal(rt.cast('fire').ok,true);
});

test('healing cannot break a damage-sensitive fear on the dummy',()=>{
  const rt=create([spell('fear',[control('fear','dummy',{breakOnDamage:true})]),
    spell('heal',[{id:'heal',type:'healing',trigger:'onCast',baseAmount:10,coefficient:0,scalingStat:'none',canCrit:false}])]);
  rt.cast('fear');rt.incoming();rt.cast('heal');
  assert.equal(rt.statuses.length,1);
});

test('incoming pushback and channel events retain monotonically increasing ledger identifiers',()=>{
  const doc=blank();doc.rpg.combatRules={version:'cataclysm-4.3.4',classId:'mage',targetLevel:60};
  doc.rpg.incoming={amount:100,school:'physical'};
  doc.abilities=[spell('cast',[{id:'heal',type:'healing',trigger:'onCast',baseAmount:10,scalingStat:'none',coefficient:0,canCrit:false}],{cast:2})];
  const rt=createCombatRuntime(compileCombatBuild(doc));rt.cast('cast');rt.advance(.5);rt.incoming();rt.advance(2);
  const ids=rt.state.combatLog.map(event=>event.id);
  assert.deepEqual(ids,[...ids].sort((a,b)=>a-b));
});

test('stance and form bonuses apply to stats and ability rules and are removed when switching back',()=>{
  const hit={id:'hit',type:'damage',trigger:'onHit',school:'physical',baseAmount:100,scalingStat:'none',coefficient:0,canCrit:false};
  const rt=create([spell('strike',[hit]),spell('battle',[{id:'state',type:'state',trigger:'onCast',key:'stance',value:'battle'}]),
    spell('defense',[{id:'state',type:'state',trigger:'onCast',key:'stance',value:'defensive'}])],
    {bonuses:[{id:'damage',owner:{kind:'ability',id:'battle'},state:{key:'stance',value:'battle'},spell:'strike',stat:'damage',amount:50},
      {id:'armor',owner:{kind:'ability',id:'defense'},state:{key:'stance',value:'defensive'},stat:'armor',amount:100}]});
  rt.cast('strike');rt.cast('battle');rt.cast('strike');rt.cast('defense');rt.cast('strike');
  assert.deepEqual(rt.state.combatLog.filter(event=>event.type==='damage').map(event=>event.amount),[100,150,100]);
  assert.equal(rt.sheet().armor,100);rt.cast('battle');assert.equal(rt.sheet().armor,0);
});

test('periodic haste is opt-in and uses a stable application interval and whole-tick breakpoint',()=>{
  const dot={id:'dot',type:'damage',trigger:'onHit',school:'fire',baseAmount:10,scalingStat:'none',coefficient:0,canCrit:false,duration:6,interval:2};
  const rt=create([spell('dot',[dot])],{attributes:{haste:50},hasteUses:['periodic']});
  rt.cast('dot');assert.ok(Math.abs(rt.statuses[0].effect.interval-4/3)<1e-8);
  assert.ok(Math.abs(rt.statuses[0].expires-20/3)<1e-8);
  rt.advance(7);assert.equal(rt.state.combatLog.filter(event=>event.type==='damage').length,5);
});
