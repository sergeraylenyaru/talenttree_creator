import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {validateWorkshop} from '../static/combat/workshop-rules.js';
import {createSpatialCombat} from '../static/world/combat/spatial-combat.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/training-grounds.json',import.meta.url)));
const effect = (extra={}) => ({id:'pulse',type:'damage',trigger:'onHit',school:'fire',baseAmount:50,
  coefficient:0,scalingStat:'none',canCrit:false,...extra});
const ability = (id,combatEffects,extra={}) => ({id,name:id,icon:'forge-ember',description:'',
  combatEffects,resourceCosts:[],cast:0,range:20,cooldown:0,workshop:{version:1},learningMode:'base',...extra});
const make = (abilities, options={}) => createCombatRuntime({health:60,maxHealth:100,
  stats:{critChance:0,attackPower:100}, resources:[{id:'mana',name:'Mana',current:40,max:100}], activeAbilities:abilities},
  {globalCooldown:0, ...options});

test('workshop periodic effects retain independent schedules, stack and expire',()=>{
  const burn=ability('Burn',[effect({duration:4,interval:1,stacks:2})]);
  const hot=ability('Mend',[effect({type:'healing',school:undefined,duration:4,interval:2,baseAmount:12})]);
  delete hot.combatEffects[0].school;
  const runtime=make([burn,hot]);
  assert.ok(runtime.cast(burn.id).ok);
  assert.ok(runtime.cast(hot.id).ok);
  assert.equal(runtime.state.statistics.totalDamage,0);
  runtime.advance(1);
  assert.equal(runtime.state.statistics.totalDamage,50);
  runtime.cast(burn.id);
  assert.equal(runtime.statuses.find(status=>status.target==='dummy').stacks,2);
  runtime.advance(4);
  assert.equal(runtime.state.statistics.totalDamage,450);
  assert.equal(runtime.state.player.health,84);
  assert.equal(runtime.statuses.length,0);
});

test('status modifiers, gained resources and stacking feed the existing damage engine',()=>{
  const buff=ability('Power',[{id:'buff',type:'status',trigger:'onCast',target:'player',name:'Power',
    stat:'attackPower',amount:20,duration:3,stacks:2},{id:'gain',type:'resource',trigger:'onCast',resourceId:'mana',unit:'percent',amount:15}]);
  const expose=ability('Expose',[{id:'expose',type:'status',trigger:'onHit',target:'dummy',name:'Expose',
    stat:'damageTaken',amount:50,duration:2}]);
  const strike=ability('Strike',[effect({school:'physical',baseAmount:0,attackCoefficient:1})]);
  const runtime=make([buff,expose,strike]);
  runtime.cast(buff.id);
  runtime.cast(buff.id);
  runtime.cast(expose.id);
  runtime.cast(strike.id);
  assert.equal(runtime.state.statistics.totalDamage,210);
  assert.equal(runtime.state.player.resources.mana.current,70);
  runtime.advance(3);
  runtime.cast(strike.id);
  assert.equal(runtime.state.statistics.totalDamage,310);
});

test('tick channels consume a cost and charge once, GCD participates, and movement cancels',()=>{
  const channel=ability('Channel',[effect()],{
    presentation:{projectile:'none',delivery:'ranged',channelDuration:3},
    workshop:{version:1,tickInterval:1,charges:1,recharge:8,interruptMovement:true},
    resourceCosts:[{resourceId:'mana',resourceName:'Mana',unit:'points',amount:5}]
  });
  validateWorkshop(channel);
  const quick=ability('Quick',[effect()],{workshop:{version:1,noGcd:true}});
  const runtime=make([channel,quick],{globalCooldown:3});
  assert.ok(runtime.cast(channel.id).ok);
  runtime.advance(1);
  assert.equal(runtime.state.player.resources.mana.current,35);
  assert.equal(runtime.chargeCount(channel.id),0);
  assert.equal(runtime.state.globalCooldownUntil,4);
  runtime.advance(1);
  assert.equal(runtime.state.statistics.totalDamage,100);
  runtime.moved();
  assert.equal(runtime.state.activeCast,null);
  assert.ok(runtime.cast(quick.id).ok);
  assert.equal(runtime.state.globalCooldownUntil,4);
  runtime.advance(7);
  assert.equal(runtime.chargeCount(channel.id),1);
  assert.equal(runtime.state.statistics.totalDamage,150);
});

test('workshop build honors an explicit talent rank and keeps old abilities',()=>{
  const doc=fixture();
  const legacy=doc.abilities[0];
  const ranked=ability('ranked',[effect()],{learningMode:'talent',talentId:'fire-talent',workshop:{version:1,talentRank:2}});
  doc.abilities.push(ranked);
  legacy.workshop={version:1,rank:2};
  doc.branches[0].talents[0].maxRank=2;
  doc.branches[0].talents[0].descriptions.push('Second rank');
  doc.build={'fire-talent':1};
  const first=compileCombatBuild(doc).activeAbilities.map(a=>a.id);
  assert.ok(first.includes(legacy.id));
  assert.ok(!first.includes(ranked.id));
  doc.build['fire-talent']=2;
  assert.ok(compileCombatBuild(doc).activeAbilities.some(a=>a.id===ranked.id));
  ranked.workshop.disabled=true;
  assert.ok(!compileCombatBuild(doc).activeAbilities.some(a=>a.id===ranked.id));
});

test('ground targeting requires a real point, tests obstacle and delivers only within radius',()=>{
  const spell=ability('Ground',[effect()],{presentation:{targeting:'ground',projectile:'none',delivery:'ranged'},
    workshop:{version:1,radius:2}});
  const runtime=make([spell]);
  const dummy={position:{x:0,y:1,z:-5},radius:.5,alive:true};
  let blocked=false;
  const world=createSpatialCombat({player:()=>({x:0,y:0,z:0,facing:0}),areaTarget:()=>({read:()=>dummy}),
    obstacles:[],occlusion:()=>blocked?0.5:1,animate(){},face(){},visuals:{impact(){}}});
  assert.equal(runtime.cast(spell.id).reason,'groundTarget');
  blocked=true;
  assert.equal(runtime.cast(spell.id,a=>world.delivery(a,{x:0,y:0,z:-5})).reason,'obstructed');
  blocked=false;
  assert.ok(runtime.cast(spell.id,a=>world.delivery(a,{x:6,y:0,z:-5})).ok);
  assert.equal(runtime.state.statistics.totalDamage,0);
  assert.ok(runtime.cast(spell.id,a=>world.delivery(a,{x:0,y:0,z:-5})).ok);
  assert.equal(runtime.state.statistics.totalDamage,50);
});

test('a ground zone placed on empty floor hits only on eligible ticks and cleans up',()=>{
  const zone=ability('Zone',[effect({duration:3,interval:1})],{presentation:{targeting:'ground',projectile:'none',delivery:'ranged'},
    workshop:{version:1,radius:1.5}});
  const runtime=make([zone]);
  const dummy={position:{x:5,y:1,z:-5},radius:.5,alive:true};
  let active=0;
  const world=createSpatialCombat({player:()=>({x:0,y:0,z:0,facing:0}),areaTarget:()=>({read:()=>dummy}),
    obstacles:[],animate(){},face(){},visuals:{impact(){},zone(){active++;return ()=>active--;}}});
  assert.ok(runtime.cast(zone.id,a=>world.delivery(a,{x:0,y:0,z:-5})).ok);
  assert.equal(active,1);
  runtime.advance(1);
  assert.equal(runtime.state.statistics.totalDamage,0);
  dummy.position.x=0;
  runtime.advance(2);
  assert.equal(runtime.state.statistics.totalDamage,100);
  assert.equal(runtime.statuses.length,0);
  assert.equal(active,0);
});

test('player-centered cones honor real facing instead of turning to the dummy',()=>{
  const cone=ability('Cone',[effect()],{presentation:{targeting:'area',projectile:'none',delivery:'ranged'},
    workshop:{version:1,radius:6,areaShape:'cone'}});
  const runtime=make([cone]);
  const player={x:0,y:0,z:0,facing:Math.PI};
  const dummy={position:{x:0,y:1,z:-5},radius:.5,alive:true};
  const world=createSpatialCombat({player:()=>player,areaTarget:()=>({read:()=>dummy}),
    obstacles:[],animate(){},face(){player.facing=0;},visuals:{impact(){}}});
  runtime.cast(cone.id,world.delivery);
  assert.equal(player.facing,Math.PI);
  assert.equal(runtime.state.statistics.totalDamage,0);
  player.facing=0;
  runtime.cast(cone.id,world.delivery);
  assert.equal(runtime.state.statistics.totalDamage,50);
});
