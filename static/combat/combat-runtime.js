import {auraPolarity} from './advanced-effects.js';
import {createResourceRecovery} from './resource-recovery.js';
import {abilityBonuses, deriveCharacterStats} from './character-stats.js';
import {createProcEngine} from './proc-engine.js';
import {createSessionReport,seededRandom} from './session-report.js';
import {addStatus, modifier, nextStatusBoundary} from './active-effects.js';
import {isHostileEffect} from './workshop-rules.js';
import {normalizeCombatSettings} from './build-compiler.js';
import {calculateCombatEffect, rollCritical, rollAttackOutcome} from './calculation-engine.js';
import {applyCombatResult, createCombatState, spendResources} from './combat-state.js';

export function createCombatRuntime(build, options = {}) {
  const seed=Number.isInteger(options.seed)?options.seed>>>0:null;
  let generator=seed===null?Math.random:seededRandom(seed);
  const random=options.random??(()=>generator());
  const settings = normalizeCombatSettings(options);
  const abilities = new Map(build.activeAbilities.map(ability => [ability.id, ability]));
  let state = createCombatState(build, settings);
  let paused = false;
  let queued,lastCombatAt=-Infinity;
  const scenario=['survival','hps'].includes(build.profile?.trainingMode)&&build.profile?.incoming;
  const incomingInterval=scenario?(build.profile.incoming.interval??2):Infinity;
  let nextIncoming=incomingInterval;
  let procPath=[],procBudget=64;
  let eventId = 0;
  const pending = new Set();
  const emptyEffects = [];
  let statuses = emptyEffects;
  const charges = new Map();
  const diminishing=new Map();
  const report=createSessionReport();
  const procs=createProcEngine(build.profile?.procs??[],random);
  const cooldownEvents=[];
  const runeRecovery=createResourceRecovery(build.profile?.resources??{});
  let nextRegen=1, statusId=0, procDepth=0, sheetCache, sheetStatuses;
  const system={id:'',name:''};

  function sheet(){
    if(sheetStatuses!==statuses){
      sheetCache=deriveCharacterStats(build,statuses,state.classStates);
      sheetStatuses=statuses;
    }
    return sheetCache;
  }

  function syncVitals(){
    const {maxHealth,resources}=sheet();
    const player=state.player;
    if(maxHealth===player.maxHealth&&resources.every(resource=>resource.max===player.resources[resource.id]?.max))return;
    state={...state,player:{...player,maxHealth,health:Math.min(player.health,maxHealth),
      resources:Object.fromEntries(resources.map(resource=>[resource.id,{...resource,current:Math.min(resource.max,player.resources[resource.id]?.current??0)}]))}};
  }

  function adjustResource(id,delta,ability,events,lostType='resourceLost'){
    const resource=Object.hasOwn(state.player.resources,id)&&state.player.resources[id];
    if(!resource)return;
    const current=Math.round(Math.max(0,Math.min(resource.max,resource.current+delta))*1e6)/1e6;
    const actual=current-resource.current;
    if(!actual)return;
    state={...state,player:{...state.player,resources:{...state.player.resources,[id]:{...resource,current}}}};
    events.push(entry(actual>0?'resourceGained':lostType,ability,{resourceId:id,amount:Math.abs(actual),resourceName:resource.name}));
  }

  function statusData(status){
    return {statusKey:JSON.stringify([status.ability.id,status.effect.id]),statusInstance:status.instance,
      statusName:status.effect.name??status.ability.name,auraKind:auraPolarity(status.effect), target:status.target, stacks:status.stacks,expires:status.expires,
      controlType:status.effect.controlType,dispelType:status.effect.dispelType,drFactor:status.drFactor};
  }

  function removeStatuses(test,events){
    const previous=statuses;
    statuses=statuses.filter(status=>{
      if(!test(status))return true;
      status.removeVisual?.();
      if(status.effect.drGroup){
        const key=status.target+':'+status.effect.drGroup;
        const dr=diminishing.get(key);
        if(dr)diminishing.set(key,{...dr,resetAt:state.combatTime+18});
      }
      events.push(entry('statusExpired',status.ability,statusData(status)));
      return false;
    });
    if(statuses.length!==previous.length)syncVitals();
  }

  function tickResources(){
    const current=sheet();
    const events=[];
    const health=Math.min(state.player.maxHealth,state.player.health+current.healthRegen);
    if(health>state.player.health&&state.player.health>0){
      events.push(entry('healthRegen',system,{amount:health-state.player.health,target:'player'}));
      state={...state,player:{...state.player,health}};
    }
    for(const resource of current.resources.filter(resource=>!resource.rune)){
      const regen=state.combatTime-lastCombatAt>5?(resource.outOfCombatRegen??resource.regen??0):(resource.regen??0);
      adjustResource(resource.id,regen+current.resourceRegen-(resource.decay??0),system,events);
    }
    if(events.length)log(events);
  }

  function absorb(result,events,target='player'){
    let remaining=result.finalAmount;
    const shields=statuses.filter(status=>status.target===target&&status.effect.type==='shield'&&(!status.effect.school||status.effect.school===result.school)).sort((a,b)=>b.effect.priority-a.effect.priority||a.instance-b.instance);
    for(const shield of shields){
      const amount=Math.min(remaining,shield.remaining??remaining,Math.round(remaining*shield.effect.fraction));
      if(!amount)continue;
      if(shield.remaining!==null)shield.remaining-=amount;
      remaining-=amount;
      events.push(entry('absorbed',shield.ability,{...statusData(shield),amount,remaining:shield.remaining,school:result.school}));
    }
    removeStatuses(status=>status.effect.type==='shield'&&status.remaining===0,events);
    return {remaining, absorbed:result.finalAmount-remaining};
  }

  function executeProc(rule, trigger){
    if(procBudget<=0)return false;
    const effect=rule.ability.combatEffects.find(effect=>effect.id===rule.effect);
    if(isHostileEffect(effect)&&(!state.dummy.health||!['attackHit','projectileHit','autoHit','damage'].includes(trigger.type)))return false;
    const resource=rule.cost&&state.player.resources[rule.cost.resourceId];
    const cost=rule.cost&&{...rule.cost,amount:rule.cost.amount*(rule.cost.unit==='percent'?(resource?.max??0)/100:1)};
    const payment=cost&&spendResources(state.player,[cost]);
    if(payment?.failedCost)return false;
    const previousDepth=procDepth,previousPath=procPath;
    procBudget--;
    procDepth=(trigger.depth??0)+1;
    procPath=[...(trigger.procPath??[]),rule.id];
    const entries=[];
    try{
      const results=calculate([effect],rule.ability);
      if(payment){
        state={...state,player:payment.player};
        entries.push(entry('resourceSpent',rule.ability,{...cost,resourceName:resource.name}));
      }
      entries.push(entry('procTriggered',rule.ability,{procId:rule.id,procName:rule.name,triggerId:trigger.id}));
      applyResults(results,rule.ability,entries);
      log(entries);
      return true;
    }catch(error){
      log([entry('calculationFailed',rule.ability,{message:error.message})]);
      return false;
    }finally{procDepth=previousDepth;procPath=previousPath;}
  }

  function chargeState(ability) {
    const {charges: limit, recharge = 10} = ability.workshop ?? {};
    if (!limit) return {};
    const now = state.combatTime;
    const remaining = (charges.get(ability.id) ?? []).filter(at => at > now);
    return {limit, recharge, remaining};
  }

  function gcdDuration(ability) {
    if(ability.workshop?.noGcd)return 0;
    const base=ability.workshop?.gcdDuration??settings.globalCooldown;
    const scaled=base/sheet().gcdSpeed;
    return build.profile?.combatRules?.version==='cataclysm-4.3.4'?Math.max(Math.min(base,1),scaled):scaled;
  }

  function freeAura(ability) {
    const key=ability.workshop?.freeWithAura;
    return key&&statuses.find(status=>status.target==='player'&&[status.effect.id,status.effect.name,status.ability.id].includes(key));
  }

  function costsFor(ability) {
    const free=Boolean(freeAura(ability));
    return ability.resourceCosts.map(cost=>{
      const resource=state.player.resources[cost.resourceId];
      const max=cost.resourceId==='health'?state.player.maxHealth:resource?.max??0;
      const base=cost.unit==='percent'&&max?max*cost.amount/100:cost.amount;
      const amount=cost.resourceId===ability.workshop?.finisherResource?Math.max(base,resource?.current??0):base;
      return {...cost,amount:free?0:amount*Math.max(0,1+abilityBonuses(build.profile,ability.id,'cost',state.classStates))};
    });
  }

  function withResourceScale(ability,costs) {
    const id=ability.workshop?.finisherResource;
    return id?{...ability,castResourceAmount:costs.find(cost=>cost.resourceId===id)?.amount??0}:ability;
  }

  function pay(ability, payment, costs, events, keepCast = false) {
    const aura=freeAura(ability);
    if(aura&&ability.workshop.consumeFreeAura)removeStatuses(status=>status===aura,events);
    for (const cost of costs) if (cost.amount) events.push(entry('resourceSpent', ability, cost));
    runeRecovery.consume(costs,state.combatTime,build.profile?.hasteUses?.includes('rune')?Math.max(.1,1+sheet().haste):1);
    const pool = chargeState(ability);
    if (pool.limit) {
      const rechargeAt=(pool.remaining.at(-1) ?? state.combatTime)+pool.recharge;
      charges.set(ability.id,[...pool.remaining,rechargeAt]);
      if(build.profile)cooldownEvents.push({time:rechargeAt,ability,charge:true});
    }
    const timing=sheet();
    const gcd = gcdDuration(ability);
    const startGcd=build.profile?.combatRules?.version==='cataclysm-4.3.4'&&ability.cast>0;
    const cooldown=Math.max(0,ability.cooldown*(1+abilityBonuses(build.profile,ability.id,'cooldown',state.classStates))/timing.cooldownSpeed);
    if(cooldown&&build.profile)cooldownEvents.push({time:state.combatTime+cooldown,ability});
    state = {
      ...state, player: payment.player, activeCast: keepCast ? state.activeCast : null,
      globalCooldownUntil: Math.max(state.globalCooldownUntil, state.combatTime + (startGcd?0:gcd)),
      cooldowns: {...state.cooldowns, [ability.id]: state.combatTime + cooldown},
      statistics: {...state.statistics, casts: state.statistics.casts + 1}
    };
    return {gcd,cooldown};
  }

  function entry(type, ability, details = {}) {
    return {
      id: ++eventId, time: state.combatTime, type, ...(procDepth?{depth:procDepth,procPath:[...procPath]}:{}),
      ...(ability.combatEffects?.find(effect=>effect.school)?{school:ability.combatEffects.find(effect=>effect.school).school}:{}),
      source:ability.id===''&&ability.name==='Training dummy'?'dummy':'player',target:['damage','projectileHit','projectileMissed','attackHit','attackMissed','attackLaunched','projectileLaunched','autoHit','miss','dodge','parry','targetDefeated'].includes(type)||['castStarted','castCompleted'].includes(type)&&ability.combatEffects?.some(isHostileEffect)?'dummy':'player',abilityId: ability.id, abilityName: ability.name, ...details
    };
  }

  function log(events) {
    if(!procDepth)procBudget=64;
    state = {...state, combatLog: [...state.combatLog, ...events].slice(-300)};
    report.add(events);
    if(events.some(event=>['castStarted','autoHit','damage','incomingDamage'].includes(event.type)))lastCombatAt=state.combatTime;
    for(const event of events)procs.dispatch(event,state,statuses,event.weaponType?{type:event.weaponType}:sheet().weapon,
      proc=>abilityBonuses(build.profile,proc.spell,'procChance',state.classStates),executeProc);
  }

  function availability(id) {
    const ability = abilities.get(id);
    if (!ability) return {reason: 'locked'};
    if (paused) return {reason: 'paused'};
    if (!state.player.health) return {reason:'playerDead'};
    const rules=ability.workshop??{};
    if(rules.requiredLevel>(build.profile?.level??1))return {reason:'levelRequired'};
    if(rules.requiredClass&&rules.requiredClass!==build.profile?.combatRules?.classId)return {reason:'classRequired'};
    if(rules.requiredStateKey&&state.classStates?.[rules.requiredStateKey]!==rules.requiredStateValue)return {reason:'stateRequired'};
    if (state.activeCast) return {reason:'casting',remaining:state.activeCast.end-state.combatTime};
    const controls=statuses.filter(status=>status.target==='player'&&status.effect.type==='control');
    const magical=ability.combatEffects.some(effect=>effect.type==='damage'&&effect.school!=='physical')||
      ['spell','healing'].includes(ability.presentation?.category)||ability.cast>0;
    const blocked=controls.find(status=>['stun','fear'].includes(status.effect.controlType)||
      status.effect.controlType==='silence'&&magical||
      status.effect.controlType==='interrupt'&&magical&&(!status.effect.school||ability.combatEffects.some(effect=>effect.school===status.effect.school))||
      status.effect.controlType==='disarm'&&ability.presentation?.delivery==='melee');
    if(blocked)return {reason:blocked.effect.controlType};
    const cooldown = Math.max(0, (Object.hasOwn(state.cooldowns, id) ? state.cooldowns[id] : 0) - state.combatTime);
    const gcd = ability.workshop?.noGcd ? 0 : Math.max(0, state.globalCooldownUntil - state.combatTime);
    const pool = chargeState(ability);
    if (pool.limit && pool.remaining.length >= pool.limit) return {reason: 'cooldown', remaining: pool.remaining[0] - state.combatTime};
    if (cooldown || gcd) return {reason: cooldown >= gcd ? 'cooldown' : 'gcd', remaining: Math.max(cooldown, gcd)};
    if (!ability.combatEffects.length && ability.presentation?.category!=='movement') return {reason:'noEffects'};
    if (!state.dummy.health && ability.combatEffects.some(isHostileEffect) && !['area','ground'].includes(ability.presentation?.targeting)) {
      return {reason: 'dummyDead'};
    }

    const costs = costsFor(ability);
    if(costs.some(cost=>build.profile?.resources?.[cost.resourceId]?.rune&&!Number.isInteger(cost.amount)))return {reason:'invalidRuneCost'};
    const payment = spendResources(state.player, costs);
    if (payment.failedCost) return {reason: 'insufficient', ...payment};
    return {ability, costs};
  }

  function finish({ability, costs, delivery, startedAt}) {
    const rejection = delivery?.validate();
    if (rejection) {
      state = {...state, activeCast: null};
      delivery?.cancel?.();
      log([entry('castRejected', ability, {reason: rejection})]);
      return {ok: false, reason: rejection};
    }
    costs=costsFor(ability);
    ability=withResourceScale(ability,costs);
    const payment = spendResources(state.player, costs);
    if (payment.failedCost) {
      state = {...state, activeCast: null};
      delivery?.cancel?.();
      log([entry('insufficient', ability, payment.failedCost)]);
      return {ok: false, reason: 'insufficient', failedCost: payment.failedCost};
    }
    const ordered = ['onCast', 'onHit'].flatMap(trigger =>
      ability.combatEffects.filter(effect => effect.trigger === trigger));
    const spatialDamage = delivery && !delivery.utility;
    const followsImpact = effect => isHostileEffect(effect) || effect.trigger === 'onHit' && Boolean(ability.workshop);
    const zoneEffects = delivery?.ground ? ordered.filter(effect => effect.type === 'damage' && effect.interval) : [];
    const delayed = spatialDamage ? ordered.filter(effect=>followsImpact(effect) && !zoneEffects.includes(effect)) : [];
    let results;
    try {
      results = calculate(spatialDamage ? ordered.filter(effect => !followsImpact(effect)) : ordered, ability);
    } catch (error) {
      state = {...state, activeCast: null};
      delivery?.cancel?.();
      log([entry('calculationFailed', ability, {message: error.message})]);
      return {ok: false, reason: 'calculationFailed'};
    }

    const events = [entry('castCompleted', ability)];
    const {gcd,cooldown} = pay(ability, payment, costs, events);
    applyResults([...results,...calculate(zoneEffects, ability)], ability, events, startedAt, delivery);
    if (cooldown || gcd) events.push(entry('cooldownStarted', ability, {amount: cooldown, globalCooldown: gcd}));
    if (spatialDamage) events.push(entry(delivery.projectile ? 'projectileLaunched' : 'attackLaunched', ability));
    log(events);
    if(delivery?.utility){
      delivery.launch(state.combatTime);
      if(results.some(result=>result.isCritical))delivery.critical?.();
    }
    if (spatialDamage) {
      const token = {};
      pending.add(token);
      delivery.launch(state.combatTime, (outcome, reason) => {
        if (!pending.delete(token)) return;
        const impact = outcome === 'hit' && state.dummy.health > 0;
        const type = delivery.projectile
          ? (impact ? 'projectileHit' : 'projectileMissed')
          : (impact ? 'attackHit' : 'attackMissed');
        const entries = [entry(type, ability, {reason})];
        if (impact) {
          try {
            const results = calculate(delayed, ability);
            applyResults(results, ability, entries, startedAt, delivery);
            if (results.some(result => result.isCritical)) delivery.critical?.();
          } catch (error) {
            entries.push(entry('calculationFailed', ability, {message: error.message}));
          }
        }
        if(impact)entries[0].resolvedHit=!entries.some(event=>['miss','dodge','parry','immune','calculationFailed'].includes(event.type))||entries.some(event=>event.type==='damage'&&event.amount>0);
        log(entries);
      });
    }
    return {ok: true};
  }

  function calculate(effects, ability, stacked = 1, pulse = false, snapshot) {
    const stat = key => modifier(statuses, 'player', key);
    const values = snapshot??sheet();
    const ranged=ability.presentation?.delivery==='ranged';
    const weapon=ranged?values.weapons.ranged:values.weapons.melee;
    const weaponType=ability.weaponType??weapon?.type;
    const rules=ability.workshop??{};
    const levelScale=Math.max(0,(build.profile?.level??1)-(rules.baseLevel??1))*(rules.levelScale??0)/100;
    const rank = (ability.rankMultiplier??1)*(1+levelScale)*Math.max(0,1+Math.max(0,(ability.castResourceAmount??1)-1)*(rules.finisherScale??1));
    const source = {
      ...values.source,
      healingPower:values.healingPower,
      damageMultiplier:values.source.damageMultiplier*rank*Math.max(0,1+abilityBonuses(build.profile,ability.id,'damage',state.classStates)),
      healingMultiplier:values.source.healingMultiplier*rank*Math.max(0,1+abilityBonuses(build.profile,ability.id,'healing',state.classStates))
    };
    const targetModifier = key => Math.max(0, 1 + modifier(statuses, 'dummy', key));
    return effects.map(effect => {
      if (['resource','status','shield','control','dispel','cooldown','state'].includes(effect.type) || effect.duration && !pulse) return {effect};
      const matches=effect.type==='damage'?values.damageModifiers.filter(({effect:bonus})=>
        (!bonus.school||bonus.school===effect.school)&&(!bonus.consumeOnHit||!pulse)):[];
      const damageModifier=Math.max(0,1+matches.reduce((sum,bonus)=>sum+bonus.effect.amount*bonus.stacks/100,0));
      const immune=effect.type==='damage'&&statuses.some(status=>status.target==='dummy'&&status.effect.controlType==='immunity'&&(!status.effect.school||status.effect.school===effect.school));
      const rules=values.combatRules;
      const physical=effect.school==='physical';
      const gap=rules?Math.max(0,rules.targetLevel-rules.level):0;
      const melee=physical&&!ranged;
      const chances=rules&&effect.type==='damage'&&!pulse&&!ability.isReflection?{
        miss:Math.max(0,(physical ? .05+gap*.01 : .04+gap*.043333333)-(physical?rules.hit:rules.spellHit)),
        dodge:melee?Math.max(0,.05+gap*.005-rules.expertise):0,
        parry:melee&&rules.position==='front'?Math.max(0,.05+gap*.03-rules.expertise):0,
        block:physical&&rules.position==='front'?.05:0,
        glancing:ability.isAuto&&melee?Math.min(.24,gap*.08):0
      }:undefined;
      const outcome=immune?'immune':chances?rollAttackOutcome(chances,random()):'hit';
      const avoided=['miss','dodge','parry','immune'].includes(outcome);
      const result = calculateCombatEffect(effect, {
        source:{...source,damageMultiplier:source.damageMultiplier*damageModifier,
          flatDamage:effect.school==='physical'?(ranged?values.rangedPower:values.meleePower):values.spellDamage,
          weaponDamage:weapon?(weapon.minDamage+weapon.maxDamage)/2:0
        },
        target: effect.type === 'damage' ? {
          armor: state.dummy.armor * targetModifier('armor')*(1-(rules?.armorPenetration??0)),
          resistances:Object.fromEntries(Object.entries(state.dummy.resistances).map(([school,value])=>[school,Math.max(0,value-(rules?.spellPenetration??0))])),
          damageTakenMultiplier: state.dummy.damageTakenMultiplier * targetModifier('damageTaken') * targetModifier(effect.school==='physical'?'physicalTaken':'magicalTaken')
        } : {healingTakenMultiplier: settings.healingTakenMultiplier * Math.max(0, 1 + stat('healingTaken'))},
        ...(rules?{rules:{armorConstant:rules.armorConstant,resistanceConstant:rules.resistanceConstant}}:{}),
        outcome: {isCritical: !avoided&&!['glancing','block'].includes(outcome)&&effect.canCrit && rollCritical(source.critChance, random()),
          ...(effect.minAmount !== undefined || effect.maxAmount !== undefined ? {amountRoll:random()} : {})}
      });
      const finalAmount = avoided?0:Math.min(effect.cap===undefined?Infinity:Math.floor(effect.cap),Math.round(result.finalAmount*stacked*(outcome==='block'?.7:outcome==='glancing'?.75:1)));
      if (!Number.isSafeInteger(finalAmount)) throw new RangeError('Stacked result exceeds safe integer precision');
      return {...result, outcome, blocked:outcome==='block'?result.finalAmount*stacked-finalAmount:0, finalAmount, periodic:pulse, stacks:stacked, weaponType,
        consumed:matches.filter(bonus=>bonus.effect.consumeOnHit).map(bonus=>bonus.instance)};
    });
  }

  function applyResults(results, ability, events, startedAt, delivery, originStatus) {
    for (const result of results) {
      if (result.effect) {
        const effect = result.effect;
        if(effect.type==='control'&&effect.controlType==='knockback'){
          delivery?.displace?.(effect.target,effect.amount??3);
          events.push(entry('knockback',ability,{target:effect.target,amount:effect.amount??3}));
          continue;
        }
        if(effect.type==='state'){
          state={...state,classStates:{...state.classStates,[effect.key]:effect.value}};
          sheetStatuses=undefined;
          syncVitals();
          events.push(entry('classStateChanged',ability,{stateKey:effect.key,stateValue:effect.value}));
          continue;
        }
        if(effect.type==='dispel'){
          let count=0;
          removeStatuses(status=>status.target===effect.target&&status.effect.dispelType===effect.dispelType&&
            status.effect.removable!==false&&count++<effect.count,events);
          events.push(entry('dispelled',ability,{target:effect.target,amount:Math.min(count,effect.count),dispelType:effect.dispelType}));
          continue;
        }
        if(effect.type==='cooldown'){
          const id=effect.abilityId==='self'?ability.id:effect.abilityId;
          state={...state,cooldowns:{...state.cooldowns,[id]:effect.reset?state.combatTime:
            Math.max(state.combatTime,(state.cooldowns[id]??0)-effect.seconds)}};
          const pool=charges.get(id)??[];
          charges.set(id,effect.reset?[]:pool.slice(effect.charges??0).map(at=>Math.max(state.combatTime,at-effect.seconds)));
          for(let index=cooldownEvents.length-1;index>=0;index--)if(cooldownEvents[index].ability.id===id)cooldownEvents.splice(index,1);
          if(state.cooldowns[id]>state.combatTime)cooldownEvents.push({time:state.cooldowns[id],ability:abilities.get(id)??ability});
          for(const at of charges.get(id))if(at>state.combatTime)cooldownEvents.push({time:at,ability:abilities.get(id)??ability,charge:true});
          events.push(entry('cooldownChanged',ability,{affectedAbilityId:id,amount:effect.seconds,reset:effect.reset}));
          continue;
        }
        if (effect.type === 'resource') {
          const resource = state.player.resources[effect.resourceId];
          const amount=effect.amount*(effect.unit==='percent'?(resource?.max??0)/100:1);
          const delta=effect.direction==='drain'?-amount:amount*Math.max(0,1+abilityBonuses(build.profile,ability.id,'resourceGain',state.classStates));
          adjustResource(effect.resourceId,delta,ability,events);
          continue;
        }
        const hostile = isHostileEffect(effect);
        if (hostile && !state.dummy.health && !delivery?.ground) continue;
        const strength = sheet();
        let duration=Math.max(.25,Math.min(300,effect.duration*(1+abilityBonuses(build.profile,ability.id,'duration',state.classStates))));
        let drFactor=1;
        if(effect.type==='control'&&effect.drGroup){
          const key=(effect.target??'dummy')+':'+effect.drGroup;
          const previous=diminishing.get(key);
          const stage=previous&&previous.resetAt>state.combatTime?previous.stage:0;
          drFactor=[1,.5,.25,0][Math.min(3,stage)];
          duration*=drFactor;
          diminishing.set(key,{stage:Math.min(3,stage+1),resetAt:state.combatTime+duration+18});
          if(!duration){events.push(entry('controlImmune',ability,{target:effect.target,drGroup:effect.drGroup}));continue;}
        }
        const periodicHaste=build.profile?.hasteUses?.includes('periodic')?Math.max(.1,1+strength.haste):1;
        const interval=effect.interval?Math.max(.25,Math.min(duration,effect.interval*Math.max(.05,1+abilityBonuses(build.profile,ability.id,'period',state.classStates))/periodicHaste)):undefined;
        if(interval&&periodicHaste!==1)duration=Math.min(300,Math.max(1,Math.floor(duration/interval+.5))*interval);
        const maxStacks=Math.max(1,Math.min(10,(effect.stacks??1)+Math.round(abilityBonuses(build.profile,ability.id,'maxStacks',state.classStates)*100)));
        const timed={...effect,duration,...(maxStacks>1?{stacks:maxStacks}:{}),...interval!==undefined?{interval}:{}};
        const before=statuses;
        const previous=effect.refresh==='independent'?undefined:statuses.find(status=>status.ability.id===ability.id&&status.effect.id===effect.id);
        statuses = addStatus(statuses, ability, timed, state.combatTime, delivery,{
          instance:previous?.instance??++statusId,drFactor,snapshot:effect.snapshot?strength:undefined
        });
        const applied=statuses.at(-1);
        if(effect.type==='shield'){
          const capacity=Math.round(effect.amount+effect.coefficient*strength.source.spellPower)*applied.stacks;
          applied.remaining=capacity||(effect.fraction<1?null:0);
        }
        for(const old of before)if(old.instance!==applied.instance&&!statuses.includes(old)){
          events.push(entry('statusExpired',old.ability,statusData(old)));
        }
        if(effect.type==='control'&&effect.target==='player'&&['stun','fear','silence','interrupt'].includes(effect.controlType)&&
          (effect.controlType!=='interrupt'||!effect.school||state.activeCast?.ability.combatEffects.some(entry=>entry.school===effect.school)))cancelCast(true,events);
        syncVitals();
        if(applied.stacks>(previous?.stacks??0)&&previous)events.push(entry('statusStacked',ability,statusData(applied)));
        events.push(entry('statusApplied',ability,{...statusData(applied),amount:duration}));
        delivery?.sound?.(hostile ? ability.workshop?.debuffSound : ability.workshop?.buffSound);
        continue;
      }
      const wasAlive = state.dummy.health > 0;
      let absorbedAmount=0;
      if(result.type==='damage'){
        const protectedResult=absorb(result,events,'dummy');
        absorbedAmount=protectedResult.absorbed;
        result.finalAmount=protectedResult.remaining;
      }
      const applied = applyCombatResult(state, ability, result, startedAt);
      state = applied.state;
      const {amount, effective, overhealing, overkill} = applied;
      if (result.type === 'damage' && amount <= 0) {
        if(result.outcome!=='hit')events.push(entry(result.outcome,ability,{target:'dummy',school:result.school,amount:0}));
        continue;
      }
      events.push(entry(result.type, ability, {
        damageKind:result.damageKind,capped:result.capped??0,outcome:result.outcome,blocked:result.blocked??0,amount, effective, overhealing, overkill, school: result.school, icon: ability.icon, effectId: result.effectId, isCritical: result.isCritical,
        original:result.baseAmount*result.stacks, bonus:(result.modifiedAmount-result.baseAmount)*result.stacks,
        raw:result.rawAmount*result.stacks, modified:result.modifiedAmount*result.stacks, critical:(result.criticalAmount-result.modifiedAmount)*result.stacks,
        mitigated:result.mitigation.preventedAmount*result.stacks, absorbed:absorbedAmount, periodic:result.periodic, auto:Boolean(ability.isAuto),
        ...(result.weaponType?{weaponType:result.weaponType}:{}),
        ...(originStatus?statusData(originStatus):{})
      }));
      if(result.type==='damage'&&amount>0)removeStatuses(status=>status.target==='dummy'&&status.effect.breakOnDamage,events);
      if (wasAlive && !state.dummy.health) events.push(entry('targetDefeated', ability));
      if(result.consumed.length)removeStatuses(status=>result.consumed.includes(status.instance),events);
      if (effective) delivery?.sound?.(ability.workshop?.healSound);
      if (!state.dummy.health) removeStatuses(status=>status.target==='dummy',events);
      if(result.type==='damage'&&!result.periodic&&!procDepth){
        for(const resource of sheet().resources){
          adjustResource(resource.id,(resource.onHit??0)+(result.isCritical?resource.onCrit??0:0),ability,events);
        }
      }
      if (overhealing) events.push(entry('overhealing', ability, {amount: overhealing, isCritical: result.isCritical}));
    }
  }

  function tickStatuses() {
    const now = state.combatTime;
    const events = [];
    for (const status of statuses) {
      if (status.nextTick > now || status.nextTick > status.expires ||
          status.target === 'dummy' && !state.dummy.health) continue;
      status.nextTick += status.effect.interval;
      try {
        if (status.target === 'zone' && status.delivery?.pulse?.() === false) continue;
        applyResults(calculate([status.effect], status.ability, status.stacks, true,status.snapshot), status.ability, events, undefined, status.delivery,status);
      } catch (error) {
        events.push(entry('calculationFailed', status.ability, {message: error.message}));
      }
    }
    removeStatuses(status=>status.expires<=now,events);
    if (events.length) log(events);
  }

  function channelTick(cast) {
    let {ability, costs}=cast;
    const {delivery,startedAt}=cast;
    if(!cast.paid){costs=costsFor(ability);ability=withResourceScale(ability,costs);}
    const rejection = delivery?.validate();
    const payment = !cast.paid && spendResources(state.player, costs);
    if (rejection || payment?.failedCost) {
      cancelCast(true);
      log([entry('castRejected', ability, {reason: rejection ?? 'insufficient'})]);
      return;
    }
    const events = [];
    try {
      const hit = delivery?.pulse?.() !== false;
      const results = calculate(hit ? ability.combatEffects : ability.combatEffects.filter(effect => !isHostileEffect(effect)), ability);
      if (!cast.paid) {
        const {gcd,cooldown} = pay(ability, payment, costs, events, true);
        if (cooldown || gcd) events.push(entry('cooldownStarted', ability, {amount: cooldown, globalCooldown: gcd}));
      }
      applyResults(results, ability, events, startedAt, delivery);
      if(results.some(result=>result.isCritical))delivery?.critical?.();
      events.push(entry('channelTick',ability));
      delivery?.sound?.(ability.workshop.tickSound);
      const nextTick = cast.nextTick + cast.tickInterval;
      state = {...state, activeCast: {...cast, ability, costs, paid: true, nextTick}};
    } catch (error) {
      cancelCast(true,events);
      events.push(entry('calculationFailed', ability, {message: error.message}));
    }
    if (events.length) log(events);
  }

  function cancelCast(force = false, events) {
    if (!state.activeCast) {
      if(!queued)return false;
      if(events)events.push(entry('castCancelled',abilities.get(queued.id)));else log([entry('castCancelled',abilities.get(queued.id))]);
      queued=undefined;
      state={...state,queuedAbilityId:undefined};
      return true;
    }
    const {ability, delivery} = state.activeCast;
    if (ability.workshop?.uninterruptible && !force) return false;
    delivery?.cancel?.();
    queued=undefined;
    state = {...state, activeCast: null,queuedAbilityId:undefined};
    if(events)events.push(entry('castCancelled',ability));else log([entry('castCancelled', ability)]);
    return true;
  }

  function incomingStrike() {
      const hit=build.profile?.incoming;
      if(!hit||paused||!state.player.health||!state.dummy.health)return false;
      const values=sheet();
      const ability={id:'',name:'Training dummy'};
      if(statuses.some(status=>status.target==='player'&&status.effect.controlType==='immunity'&&(!status.effect.school||status.effect.school===hit.school))){
        log([entry('immune',ability,{target:'player',amount:0,school:hit.school})]);
        return true;
      }
      const rules=values.combatRules;
      const outcome=rules&&hit.school==='physical'?rollAttackOutcome({
        dodge:rules.dodge,parry:rules.parry,block:rules.block
      },random()):'hit';
      if(['dodge','parry'].includes(outcome)){
        log([entry(outcome,ability,{target:'player',amount:0,school:hit.school})]);
        return true;
      }
      const result=calculateCombatEffect({id:'dummy-hit',type:'damage',trigger:'onHit',school:hit.school,
        baseAmount:hit.amount,scalingStat:'none',coefficient:0,canCrit:Boolean(hit.canCrit)},
        {source:{critMultiplier:1+((hit.critMultiplier??2)-1)*Math.max(0,1-modifier(statuses,'player','criticalReduction'))},
         outcome:{isCritical:Boolean(hit.canCrit)&&random()<(hit.critChance??0)},
         target:{armor:values.armor,resistances:values.resistance,damageTakenMultiplier:values.defense},
         ...(rules?{rules:{armorConstant:rules.armorConstant,resistanceConstant:rules.resistanceConstant}}:{})});
      const blocked=outcome==='block'?Math.round(result.finalAmount*.3):0;
      result.finalAmount-=blocked;
      const events=[];
      if(outcome==='block')events.push(entry('block',ability,{target:'player',amount:blocked}));
      const {remaining,absorbed}=absorb(result,events);
      const amount=Math.min(state.player.health,remaining);
      state={...state,player:{...state.player,health:state.player.health-amount}};
      events.push(entry('incomingDamage',ability,{target:'player',school:hit.school,amount,original:hit.amount,
        bonus:result.modifiedAmount-hit.amount,isCritical:result.isCritical,critical:result.criticalAmount-result.modifiedAmount,mitigated:result.mitigation.preventedAmount,
        outcome,blocked,absorbed,overkill:remaining-amount}));
      const casting=state.activeCast;
      if(rules&&amount>0&&casting&&!casting.ability.workshop?.uninterruptible&&(casting.pushbacks??0)<2){
        const delay=casting.channeling?-Math.min((casting.end-casting.start)*.25,casting.end-state.combatTime):.5;
        state={...state,activeCast:{...casting,pushbacks:(casting.pushbacks??0)+1,
          castEnd:casting.castEnd+(casting.channeling?0:delay),end:casting.end+delay}};
        if(queued)queued.at=state.activeCast.end;
        events.push(entry('castPushback',casting.ability,{amount:delay}));
      }
      const reflect=modifier(statuses,'player','reflectDamage');
      if(reflect>0&&amount>0&&state.dummy.health){
        const reflection={id:'reflection',type:'damage',trigger:'onHit',school:hit.school,
          baseAmount:Math.round(amount*reflect),scalingStat:'none',coefficient:0,canCrit:false};
        const source=statuses.find(status=>status.effect.stat==='reflectDamage')?.ability??ability;
        applyResults(calculate([reflection],{...source,isReflection:true}),source,events);
        events.push(entry('reflected',source,{target:'dummy',amount:reflection.baseAmount,school:hit.school}));
      }
      if(amount>0)removeStatuses(status=>status.target==='player'&&status.effect.breakOnDamage,events);
      if(!state.player.health)cancelCast(true,events);
      log(events);
      return true;
    }

  function releaseQueued(now) {
    if(!queued||queued.at>now)return;
    const request=queued;
    queued=undefined;
    state={...state,queuedAbilityId:undefined};
    const result=castAbility(request.id,request.bindDelivery,false);
    if(!result.ok)log([entry('castRejected',abilities.get(request.id),{reason:result.reason})]);
  }

  function castAbility(id, bindDelivery, allowQueue = true) {
      const status = availability(id);
      if (status.reason) {
        if(allowQueue&&build.profile?.combatRules?.version==='cataclysm-4.3.4'&&
            ['casting','gcd','cooldown'].includes(status.reason)&&status.remaining>0&&status.remaining<=.4){
          queued={id,bindDelivery,at:state.combatTime+status.remaining};
          state={...state,queuedAbilityId:id};
          log([entry('castQueued',abilities.get(id),{readyAt:queued.at})]);
          return {ok:true,queued:true};
        }
        if (status.reason === 'insufficient') log([entry('insufficient', abilities.get(id), status.failedCost)]);
        return {ok: false, reason: status.reason, failedCost: status.failedCost};
      }
      const {ability} = status;
      const delivery = bindDelivery?.(ability);
      const rejection = ability.presentation?.targeting === 'ground' && !delivery ? 'groundTarget' : delivery?.validate();
      if (rejection) {
        log([entry('castRejected', ability, {reason: rejection})]);
        return {ok: false, reason: rejection};
      }
      status.delivery = delivery;
      status.startedAt = state.combatTime;
      if(build.profile?.combatRules?.version==='cataclysm-4.3.4'&&ability.cast&&!ability.workshop?.noGcd){
        const gcd=gcdDuration(ability);
        state={...state,globalCooldownUntil:Math.max(state.globalCooldownUntil,state.combatTime+gcd)};
      }
      log([entry('castStarted', ability)]);
      delivery?.sound?.(ability.workshop?.activationSound);
      const timing=sheet();
      const channel = (ability.channelDuration ?? ability.presentation?.channelDuration ?? 0)/timing.channelSpeed;
      const tickInterval=ability.workshop?.tickInterval/timing.channelSpeed;
      if (!ability.cast && !channel) return finish(status);
      const castDuration=ability.cast/timing.castSpeed*Math.max(0,1+abilityBonuses(build.profile,ability.id,'castTime',state.classStates));
      if(!castDuration&&!channel)return finish(status);
      const castEnd = state.combatTime + castDuration;
      state = {...state, activeCast: {...status, start: state.combatTime, castEnd,
        end: castEnd + channel, channeling: !ability.cast,
        tickInterval,nextTick: tickInterval ? castEnd + tickInterval : Infinity}};
      if (ability.cast) {
        delivery?.sound?.(ability.workshop?.castSound);
        delivery?.prepare?.(castDuration, state.combatTime);
      }
      else delivery?.channel?.(channel, state.combatTime);
      return {ok: true};
    }

  return {
    get state() { return state; },
    get paused() { return paused; },
    get statuses() { return statuses; },
    sheet,
    movementScale() {
      const controls=statuses.filter(status=>status.target==='player'&&status.effect.type==='control');
      if(controls.some(status=>['root','stun','fear'].includes(status.effect.controlType)))return 0;
      return sheet().movementSpeed*controls.reduce((factor,status)=>status.effect.controlType==='slow'?factor*(1-(status.effect.amount??50)/100):factor,1);
    },
    controlState() {return {active:statuses.filter(status=>status.effect.type==='control').map(status=>statusData(status)),
      diminishing:[...diminishing].filter(([,value])=>value.resetAt>state.combatTime)};},
    report() {
      const stats=sheet();
      const {source,primary,...extra}=stats;
      const flatStats={...primary,...source,...Object.fromEntries(Object.entries(extra).filter(([,v])=>typeof v==='number')),
        ...Object.fromEntries(Object.entries(stats.resistance).map(([school,value])=>[school+'Resistance',value])),
        ...Object.fromEntries(stats.resources.map(resource=>['max '+resource.name,resource.max]))};
      return report.snapshot(state.combatTime,{name:build.name,talents:build.talentBuild??{},specialization:build.primaryBranch,stats:flatStats,
        equipment:build.profile?.equipment??{}}, {dummy:settings.dummy,globalCooldown:settings.globalCooldown,
        healingTakenMultiplier:settings.healingTakenMultiplier,incoming:build.profile?.incoming},seed);
    },
    incoming:incomingStrike,
    runeState() {return runeRecovery.snapshot();},
    chargeCount(id) {
      const pool = chargeState(abilities.get(id) ?? {});
      return pool.limit ? pool.limit - pool.remaining.length : undefined;
    },
    availability,
    autoEvent(ability, type, details) { log([entry(type, ability, details)]); },
    autoImpact(ability, delivery, startedAt) {
      if (paused || !state.dummy.health || !state.player.health) return;
      const events = [entry('autoHit', ability, {weaponType:ability.weaponType,auto:true})];
      try {
        const results = calculate(ability.combatEffects, ability);
        applyResults(results, ability, events, startedAt);
        if (results.some(result => result.isCritical)) delivery.critical?.();
        events[0].resolvedHit=results.some(result=>result.type==='damage'&&result.finalAmount>0);
      } catch (error) {
        events.push(entry('calculationFailed', ability, {message: error.message}));
      }
      log(events);
    },
    cast:castAbility,
    advance(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Invalid combat time delta');
      if (paused) return;
      const end = state.combatTime + deltaSeconds;
      if(nextRegen<=state.combatTime)nextRegen=Math.floor(state.combatTime)+1;
      for (;;) {
        let cast = state.activeCast;
        const stats=sheet();
        const regen=stats.healthRegen||stats.resourceRegen||stats.resources.some(resource=>resource.regen||resource.outOfCombatRegen||resource.decay)?nextRegen:Infinity;
        const ready=cooldownEvents.reduce((time,entry)=>Math.min(time,entry.time),Infinity);
        const boundary = Math.min(nextIncoming,runeRecovery.next(),regen,ready,queued?.at??Infinity,nextStatusBoundary(statuses), cast?.end ?? Infinity,
          cast?.nextTick ?? Infinity, cast && !cast.channeling && cast.castEnd < cast.end ? cast.castEnd : Infinity);
        if (boundary > end) break;
        state = {...state, combatTime: boundary};
        if (nextStatusBoundary(statuses) <= boundary) tickStatuses();
        if(nextIncoming<=boundary){
          nextIncoming+=incomingInterval;
          incomingStrike();
        }
        cast=state.activeCast;
        if(runeRecovery.next()<=boundary){
          const events=[];
          runeRecovery.tick(boundary,id=>adjustResource(id,1,system,events));
          if(events.length)log(events);
        }
        if (regen<=boundary) {nextRegen=boundary+1;tickResources();}
        if(ready<=boundary){
          const events=[];
          for(let index=cooldownEvents.length-1;index>=0;index--){
            const item=cooldownEvents[index];
            if(item.time>boundary)continue;
            cooldownEvents.splice(index,1);
            events.push(entry('cooldownCompleted',item.ability,{charge:item.charge??false}));
          }
          if(events.length)log(events);
        }
        if(nextRegen<=state.combatTime)nextRegen=Math.floor(state.combatTime)+1;
        if (!cast) {
          releaseQueued(boundary);
          continue;
        }
        if (!cast.channeling && cast.castEnd < cast.end && boundary === cast.castEnd) {
          state = {...state, activeCast: {...cast, channeling: true}};
          if (end < cast.end) cast.delivery?.channel?.(cast.end - boundary, boundary);
          continue;
        }
        if (cast.ability.workshop?.tickInterval) {
          if (boundary >= cast.nextTick) channelTick(cast);
          if (boundary >= cast.end && state.activeCast) {
            state = {...state, activeCast: null};
            log([entry('castCompleted', cast.ability)]);
          }
        } else if (boundary >= cast.end) finish(cast);
        releaseQueued(boundary);
      }
      if (end !== state.combatTime) state = {...state, combatTime: end};
    },
    cancel: cancelCast,
    moved() {
      if (state.activeCast?.ability.workshop?.interruptMovement) cancelCast(true);
    },
    resetTarget() {
      this.cancelSpatial();
      const events=[];
      removeStatuses(status=>status.target==='dummy',events);
      if(events.length)log(events);
      state = {...state, dummy: {...state.dummy, health: state.dummy.maxHealth}};
      log([entry('targetRestored', {id: '', name: ''})]);
    },
    cancelSpatial() {
      queued=undefined;
      state={...state,queuedAbilityId:undefined};
      pending.clear();
      const events=[];
      removeStatuses(status=>status.target==='zone',events);
      if(events.length)log(events);
      if (state.activeCast?.delivery) cancelCast(true);
    },
    setPaused(value) { paused = Boolean(value); },
    reset() {
      queued=undefined;
      nextIncoming=incomingInterval;
      pending.clear();
      for (const status of statuses) status.removeVisual?.();
      statuses = emptyEffects;
      charges.clear();
      diminishing.clear();
      runeRecovery.reset();lastCombatAt=-Infinity;
      cooldownEvents.length=0;
      nextRegen=1;statusId=0;
      report.reset();procs.reset();
      if(seed!==null)generator=seededRandom(seed);
      state = createCombatState(build, settings);
      paused = false;
    },
    clearLog() { state = {...state, combatLog: []}; }
  };
}
