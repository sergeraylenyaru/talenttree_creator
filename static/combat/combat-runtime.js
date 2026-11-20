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
  let eventId = 0;
  const pending = new Set();
  const emptyEffects = [];
  let statuses = emptyEffects;
  const charges = new Map();
  const report=createSessionReport();
  const procs=createProcEngine(build.profile?.procs??[],random);
  const cooldownEvents=[];
  let nextRegen=1, statusId=0, procDepth=0, sheetCache, sheetStatuses;
  const system={id:'',name:''};

  function sheet(){
    if(sheetStatuses!==statuses){
      sheetCache=deriveCharacterStats(build,statuses);
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
      statusName:status.effect.name??status.ability.name, target:status.target, stacks:status.stacks,expires:status.expires};
  }

  function removeStatuses(test,events){
    const previous=statuses;
    statuses=statuses.filter(status=>{
      if(!test(status))return true;
      status.removeVisual?.();
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
    for(const resource of current.resources)adjustResource(resource.id,(resource.regen??0)+current.resourceRegen-(resource.decay??0),system,events);
    if(events.length)log(events);
  }

  function absorb(result,events){
    let remaining=result.finalAmount;
    const shields=statuses.filter(status=>status.effect.type==='shield').sort((a,b)=>b.effect.priority-a.effect.priority||a.instance-b.instance);
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
    const effect=rule.ability.combatEffects.find(effect=>effect.id===rule.effect);
    if(isHostileEffect(effect)&&(!state.dummy.health||!['attackHit','projectileHit','autoHit','damage'].includes(trigger.type)))return false;
    const resource=rule.cost&&state.player.resources[rule.cost.resourceId];
    const cost=rule.cost&&{...rule.cost,amount:rule.cost.amount*(rule.cost.unit==='percent'?(resource?.max??0)/100:1)};
    const payment=cost&&spendResources(state.player,[cost]);
    if(payment?.failedCost)return false;
    procDepth=1;
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
    }finally{procDepth=0;}
  }

  function chargeState(ability) {
    const {charges: limit, recharge = 10} = ability.workshop ?? {};
    if (!limit) return {};
    const now = state.combatTime;
    const remaining = (charges.get(ability.id) ?? []).filter(at => at > now);
    return {limit, recharge, remaining};
  }

  function pay(ability, payment, costs, events, keepCast = false) {
    for (const cost of costs) if (cost.amount) events.push(entry('resourceSpent', ability, cost));
    const pool = chargeState(ability);
    if (pool.limit) {
      const rechargeAt=(pool.remaining.at(-1) ?? state.combatTime)+pool.recharge;
      charges.set(ability.id,[...pool.remaining,rechargeAt]);
      if(build.profile)cooldownEvents.push({time:rechargeAt,ability,charge:true});
    }
    const timing=sheet();
    const gcd = ability.workshop?.noGcd ? 0 : (ability.workshop?.gcdDuration ?? settings.globalCooldown)/timing.gcdSpeed;
    const cooldown=Math.max(0,ability.cooldown*(1+abilityBonuses(build.profile,ability.id,'cooldown'))/timing.cooldownSpeed);
    if(cooldown&&build.profile)cooldownEvents.push({time:state.combatTime+cooldown,ability});
    state = {
      ...state, player: payment.player, activeCast: keepCast ? state.activeCast : null,
      globalCooldownUntil: Math.max(state.globalCooldownUntil, state.combatTime + gcd),
      cooldowns: {...state.cooldowns, [ability.id]: state.combatTime + cooldown},
      statistics: {...state.statistics, casts: state.statistics.casts + 1}
    };
    return {gcd,cooldown};
  }

  function entry(type, ability, details = {}) {
    return {
      id: ++eventId, time: state.combatTime, type, ...(procDepth?{depth:procDepth}:{}),
      source:ability.id===''&&ability.name==='Training dummy'?'dummy':'player',target:type==='damage'?'dummy':'player',abilityId: ability.id, abilityName: ability.name, ...details
    };
  }

  function log(events) {
    state = {...state, combatLog: [...state.combatLog, ...events].slice(-300)};
    report.add(events);
    for(const event of events)procs.dispatch(event,state,statuses,event.weaponType?{type:event.weaponType}:sheet().weapon,
      proc=>abilityBonuses(build.profile,proc.spell,'procChance'),executeProc);
  }

  function availability(id) {
    const ability = abilities.get(id);
    if (!ability) return {reason: 'locked'};
    if (paused) return {reason: 'paused'};
    if (!state.player.health) return {reason:'playerDead'};
    if (state.activeCast) return {reason: 'casting'};
    const cooldown = Math.max(0, (Object.hasOwn(state.cooldowns, id) ? state.cooldowns[id] : 0) - state.combatTime);
    const gcd = ability.workshop?.noGcd ? 0 : Math.max(0, state.globalCooldownUntil - state.combatTime);
    const pool = chargeState(ability);
    if (pool.limit && pool.remaining.length >= pool.limit) return {reason: 'cooldown', remaining: pool.remaining[0] - state.combatTime};
    if (cooldown || gcd) return {reason: cooldown >= gcd ? 'cooldown' : 'gcd', remaining: Math.max(cooldown, gcd)};
    if (!ability.combatEffects.length && ability.presentation?.category!=='movement') return {reason:'noEffects'};
    if (!state.dummy.health && ability.combatEffects.some(isHostileEffect) && !['area','ground'].includes(ability.presentation?.targeting)) {
      return {reason: 'dummyDead'};
    }

    const costs = ability.resourceCosts.map(cost => {
      const max = cost.resourceId === 'health' ? state.player.maxHealth
        : Object.hasOwn(state.player.resources, cost.resourceId) ? state.player.resources[cost.resourceId].max : 0;
      return {...cost, amount: cost.unit === 'percent' && max ? max * (cost.amount / 100) : cost.amount};
    });
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
    const rank = ability.rankMultiplier ?? 1;
    const source = {
      ...values.source,
      healingPower:values.healingPower,
      damageMultiplier:values.source.damageMultiplier*rank*Math.max(0,1+abilityBonuses(build.profile,ability.id,'damage')),
      healingMultiplier:values.source.healingMultiplier*rank*Math.max(0,1+abilityBonuses(build.profile,ability.id,'healing'))
    };
    const targetModifier = key => Math.max(0, 1 + modifier(statuses, 'dummy', key));
    return effects.map(effect => {
      if (['resource','status','shield'].includes(effect.type) || effect.duration && !pulse) return {effect};
      const matches=effect.type==='damage'?values.damageModifiers.filter(({effect:bonus})=>
        (!bonus.school||bonus.school===effect.school)&&(!bonus.consumeOnHit||!pulse)):[];
      const damageModifier=Math.max(0,1+matches.reduce((sum,bonus)=>sum+bonus.effect.amount*bonus.stacks/100,0));
      const rules=values.combatRules;
      const physical=effect.school==='physical';
      const gap=rules?Math.max(0,rules.targetLevel-rules.level):0;
      const melee=physical&&!ranged;
      const chances=rules&&effect.type==='damage'&&!pulse?{
        miss:Math.max(0,(physical ? .05+gap*.01 : .04+gap*.043333333)-(physical?rules.hit:rules.spellHit)),
        dodge:melee?Math.max(0,.05+gap*.005-rules.expertise):0,
        parry:melee&&rules.position==='front'?Math.max(0,.05+gap*.03-rules.expertise):0,
        block:physical&&rules.position==='front'?.05:0,
        glancing:ability.isAuto&&melee?Math.min(.24,gap*.08):0
      }:undefined;
      const outcome=chances?rollAttackOutcome(chances,random()):'hit';
      const avoided=['miss','dodge','parry'].includes(outcome);
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
      const finalAmount = avoided?0:Math.round(result.finalAmount*stacked*(outcome==='block'?.7:outcome==='glancing'?.75:1));
      if (!Number.isSafeInteger(finalAmount)) throw new RangeError('Stacked result exceeds safe integer precision');
      return {...result, outcome, blocked:outcome==='block'?result.finalAmount*stacked-finalAmount:0, finalAmount, periodic:pulse, stacks:stacked, weaponType,
        consumed:matches.filter(bonus=>bonus.effect.consumeOnHit).map(bonus=>bonus.instance)};
    });
  }

  function applyResults(results, ability, events, startedAt, delivery, originStatus) {
    for (const result of results) {
      if (result.effect) {
        const effect = result.effect;
        if (effect.type === 'resource') {
          const resource = state.player.resources[effect.resourceId];
          const amount=effect.amount*(effect.unit==='percent'?(resource?.max??0)/100:1);
          const delta=effect.direction==='drain'?-amount:amount*Math.max(0,1+abilityBonuses(build.profile,ability.id,'resourceGain'));
          adjustResource(effect.resourceId,delta,ability,events);
          continue;
        }
        const hostile = isHostileEffect(effect);
        if (hostile && !state.dummy.health && !delivery?.ground) continue;
        const strength = sheet();
        const duration=Math.max(.25,Math.min(300,effect.duration*(1+abilityBonuses(build.profile,ability.id,'duration'))));
        const interval=effect.interval?Math.max(.25,Math.min(duration,effect.interval*Math.max(.05,1+abilityBonuses(build.profile,ability.id,'period')))):undefined;
        const timed={...effect,duration,...interval!==undefined?{interval}:{}};
        const before=statuses;
        const previous=effect.refresh==='independent'?undefined:statuses.find(status=>status.ability.id===ability.id&&status.effect.id===effect.id);
        statuses = addStatus(statuses, ability, timed, state.combatTime, delivery,{
          instance:previous?.instance??++statusId,snapshot:effect.snapshot?strength:undefined
        });
        const applied=statuses.at(-1);
        if(effect.type==='shield'){
          const capacity=Math.round(effect.amount+effect.coefficient*strength.source.spellPower)*applied.stacks;
          applied.remaining=capacity||(effect.fraction<1?null:0);
        }
        for(const old of before)if(old.instance!==applied.instance&&!statuses.includes(old)){
          events.push(entry('statusExpired',old.ability,statusData(old)));
        }
        syncVitals();
        events.push(entry('statusApplied',ability,{...statusData(applied),amount:duration}));
        delivery?.sound?.(hostile ? ability.workshop?.debuffSound : ability.workshop?.buffSound);
        continue;
      }
      const wasAlive = state.dummy.health > 0;
      const applied = applyCombatResult(state, ability, result, startedAt);
      state = applied.state;
      const {amount, effective, overhealing, overkill} = applied;
      if (result.type === 'damage' && amount <= 0) {
        if(result.outcome!=='hit')events.push(entry(result.outcome,ability,{target:'dummy',school:result.school,amount:0}));
        continue;
      }
      events.push(entry(result.type, ability, {
        outcome:result.outcome,blocked:result.blocked??0,amount, effective, overhealing, overkill, school: result.school, icon: ability.icon, effectId: result.effectId, isCritical: result.isCritical,
        original:result.baseAmount*result.stacks, bonus:(result.modifiedAmount-result.baseAmount)*result.stacks,
        raw:result.rawAmount*result.stacks, modified:result.modifiedAmount*result.stacks, critical:(result.criticalAmount-result.modifiedAmount)*result.stacks,
        mitigated:result.mitigation.preventedAmount*result.stacks, absorbed:0, periodic:result.periodic, auto:Boolean(ability.isAuto),
        ...(result.weaponType?{weaponType:result.weaponType}:{}),
        ...(originStatus?statusData(originStatus):{})
      }));
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
    const {ability, delivery, costs, startedAt} = cast;
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
      delivery?.sound?.(ability.workshop.tickSound);
      const nextTick = cast.nextTick + cast.tickInterval;
      state = {...state, activeCast: {...cast, paid: true, nextTick}};
    } catch (error) {
      cancelCast(true);
      events.push(entry('calculationFailed', ability, {message: error.message}));
    }
    if (events.length) log(events);
  }

  function cancelCast(force = false) {
    if (!state.activeCast) return false;
    const {ability, delivery} = state.activeCast;
    if (ability.workshop?.uninterruptible && !force) return false;
    delivery?.cancel?.();
    state = {...state, activeCast: null};
    log([entry('castCancelled', ability)]);
    return true;
  }

  return {
    get state() { return state; },
    get paused() { return paused; },
    get statuses() { return statuses; },
    sheet,
    movementScale() { return sheet().movementSpeed; },
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
    incoming() {
      const hit=build.profile?.incoming;
      if(!hit||paused||!state.player.health||!state.dummy.health)return false;
      const values=sheet();
      const ability={id:'',name:'Training dummy'};
      const rules=values.combatRules;
      const outcome=rules&&hit.school==='physical'?rollAttackOutcome({
        dodge:rules.dodge,parry:rules.parry,block:rules.block
      },random()):'hit';
      if(['dodge','parry'].includes(outcome)){
        log([entry(outcome,ability,{target:'player',amount:0,school:hit.school})]);
        return true;
      }
      const result=calculateCombatEffect({id:'dummy-hit',type:'damage',trigger:'onHit',school:hit.school,
        baseAmount:hit.amount,scalingStat:'none',coefficient:0,canCrit:false},
        {target:{armor:values.armor,resistances:values.resistance,damageTakenMultiplier:values.defense},
         ...(rules?{rules:{armorConstant:rules.armorConstant,resistanceConstant:rules.resistanceConstant}}:{})});
      const blocked=outcome==='block'?Math.round(result.finalAmount*.3):0;
      result.finalAmount-=blocked;
      const events=[];
      const {remaining,absorbed}=absorb(result,events);
      const amount=Math.min(state.player.health,remaining);
      state={...state,player:{...state.player,health:state.player.health-amount}};
      events.push(entry('incomingDamage',ability,{target:'player',school:hit.school,amount,original:hit.amount,
        bonus:result.modifiedAmount-hit.amount,critical:0,mitigated:result.mitigation.preventedAmount,
        outcome,blocked,absorbed,overkill:remaining-amount}));
      if(!state.player.health)cancelCast(true);
      log(events);
      return true;
    },
    chargeCount(id) {
      const pool = chargeState(abilities.get(id) ?? {});
      return pool.limit ? pool.limit - pool.remaining.length : undefined;
    },
    availability,
    autoEvent(ability, type, details) { log([entry(type, ability, details)]); },
    autoImpact(ability, delivery, startedAt) {
      if (paused || !state.dummy.health || !state.player.health) return;
      const events = [entry('autoHit', ability, {weaponType:ability.weaponType})];
      try {
        const results = calculate(ability.combatEffects, ability);
        applyResults(results, ability, events, startedAt);
        if (results.some(result => result.isCritical)) delivery.critical?.();
      } catch (error) {
        events.push(entry('calculationFailed', ability, {message: error.message}));
      }
      log(events);
    },
    cast(id, bindDelivery) {
      const status = availability(id);
      if (status.reason) {
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
      log([entry('castStarted', ability)]);
      delivery?.sound?.(ability.workshop?.activationSound);
      const timing=sheet();
      const channel = (ability.channelDuration ?? ability.presentation?.channelDuration ?? 0)/timing.channelSpeed;
      const tickInterval=ability.workshop?.tickInterval/timing.channelSpeed;
      if (!ability.cast && !channel) return finish(status);
      const castDuration=ability.cast/timing.castSpeed;
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
    },
    advance(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Invalid combat time delta');
      if (paused) return;
      const end = state.combatTime + deltaSeconds;
      if(nextRegen<=state.combatTime)nextRegen=Math.floor(state.combatTime)+1;
      for (;;) {
        const cast = state.activeCast;
        const stats=sheet();
        const regen=stats.healthRegen||stats.resourceRegen||stats.resources.some(resource=>resource.regen||resource.decay)?nextRegen:Infinity;
        const ready=cooldownEvents.reduce((time,entry)=>Math.min(time,entry.time),Infinity);
        const boundary = Math.min(regen,ready,nextStatusBoundary(statuses), cast?.end ?? Infinity,
          cast?.nextTick ?? Infinity, cast && !cast.channeling && cast.castEnd < cast.end ? cast.castEnd : Infinity);
        if (boundary > end) break;
        state = {...state, combatTime: boundary};
        if (nextStatusBoundary(statuses) <= boundary) tickStatuses();
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
        if (!cast) continue;
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
      pending.clear();
      const events=[];
      removeStatuses(status=>status.target==='zone',events);
      if(events.length)log(events);
      if (state.activeCast?.delivery) cancelCast(true);
    },
    setPaused(value) { paused = Boolean(value); },
    reset() {
      pending.clear();
      for (const status of statuses) status.removeVisual?.();
      statuses = emptyEffects;
      charges.clear();
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
