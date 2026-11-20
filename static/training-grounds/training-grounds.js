import {weaponTiming} from '../combat/character-stats.js';
import {openCombatReview} from './combat-review.js';
import {createAutoAttack, trainingWeapon} from '../combat/auto-attack.js';
import {practiceAbilities} from './world-hud.js';
import {mountTrainingWorld} from './world-integration.js';
import {compileCombatBuild, normalizeCombatSettings} from '../combat/build-compiler.js';
import {createCombatRuntime} from '../combat/combat-runtime.js';
import {renderTrainingGrounds} from './training-grounds-ui.js';

const storageKey = 'talentforge-training-grounds-v1';

function loadSettings() {
  try {
    return normalizeCombatSettings(JSON.parse(localStorage.getItem(storageKey)));
  } catch {
    return normalizeCombatSettings();
  }
}

export function openTrainingGrounds(dialog, document, {preview, layoutId} = {}) {
  let settings = loadSettings();
  function compile() {
    const build = compileCombatBuild(document, settings);
    if (layoutId) build.layoutId = layoutId;
    if (preview) {
      build.resources = build.resources.map(resource=>({...resource,current:resource.max}));
      if (build.activeAbilities.some(ability=>ability.combatEffects.some(effect=>effect.type==='healing'))) {
        build.health = Math.ceil(build.maxHealth / 2);
      }
    }
    return build;
  }
  let build = compile();
  const practice = practiceAbilities(build.activeAbilities, build.resources);
  const arenaBuild = () => ({...build, activeAbilities: [...build.activeAbilities, ...practice]});
  const newRuntime=()=>createCombatRuntime(arenaBuild(),{...settings,seed:build.profile?.seed});
  let runtime = newRuntime();
  let auto=createAutoAttack(), offhand, basic=practice[0], swingDelivery, generation=0;
  const report=(type,details)=>runtime.autoEvent(basic,type,details);

  function stopAuto(){
    auto.stop();offhand?.clock.stop();
    generation++;
  }

  function autoAbility(weapon,off=false){
    const ranged=weapon.ranged&&!off;
    return {...practice[0],...(off?{id:practice[0].id+'_off',name:practice[0].name+' · Off hand'}:{}),isAuto:true,weaponType:weapon.type,
      ...(ranged?{range:24,presentation:{delivery:'ranged',projectile:'straight',attackAnimation:'bow',impact:'melee'}}:{}),
      combatEffects:practice[0].combatEffects.map(effect=>({...effect,baseAmount:weapon.minDamage,
        ...(weapon.maxDamage>weapon.minDamage?{minAmount:weapon.minDamage,maxAmount:weapon.maxDamage}:{}),
        ...(off?{multiplier:.5}:{})}))};
  }

  function startAuto(){
    if(auto.status.active||!runtime.state.dummy.health||!runtime.state.player.health)return;
    const local=world?.weaponCombat();
    const fallback={swingSeconds:local?.swingSeconds??trainingWeapon.swingSeconds,damage:local?.damage??trainingWeapon.damage};
    const values=runtime.sheet();
    const weapon=weaponTiming(values,fallback);
    auto=createAutoAttack({...trainingWeapon,swingSeconds:weapon.swingSeconds});
    basic=autoAbility(weapon);
    swingDelivery=world?.delivery(basic);
    const extra=build.profile?.equipment?.offHand;
    offhand=extra?.speed&&!weapon.ranged?(()=>{
      const ability=autoAbility(extra,true);
      return {ability,delivery:world?.delivery(ability),
        clock:createAutoAttack({...trainingWeapon,swingSeconds:extra.speed/values.swingSpeed}),speed:extra.speed};
    })():undefined;
    auto.start(report);
    offhand?.clock.start((type,details)=>runtime.autoEvent(offhand.ability,type,details));
    syncClock();
    view.update(runtime);
  }

  function swing(ability,delivery,startedAt){
    if(!delivery.projectile){runtime.autoImpact(ability,delivery,startedAt);return;}
    const token=generation;
    runtime.autoEvent(ability,'projectileLaunched');
    delivery.launch(runtime.state.combatTime,(outcome,reason)=>{
      if(token!==generation)return;
      runtime.autoEvent(ability,outcome==='hit'?'projectileHit':'projectileMissed',{reason});
      if(outcome==='hit')runtime.autoImpact(ability,delivery,startedAt);
    });
  }
  let frame = null;
  let world;
  let picking = false;
  let realStart = performance.now();
  let combatStart = 0;

  function rebaseClock() {
    realStart = performance.now();
    combatStart = runtime.state.combatTime;
  }

  function syncClock() {
    if (runtime.paused) return;
    const end=preview?Infinity:build.profile?.testDuration??Infinity;
    const target = Math.min(end,combatStart + (performance.now() - realStart) / 1000);
    runtime.advance(Math.max(0, target - runtime.state.combatTime));
    world?.combatState(runtime.state);
    if (auto.status.active) {
      const time=runtime.state.combatTime,values=runtime.sheet();
      const speed=weaponTiming(values,{swingSeconds:world?.weaponCombat()?.swingSeconds??trainingWeapon.swingSeconds,damage:0}).swingSeconds;
      auto.update(time,swingDelivery,report,(delivery,start)=>swing(basic,delivery,start),speed);
      if(offhand)offhand.clock.update(time,offhand.delivery,(type,details)=>runtime.autoEvent(offhand.ability,type,details),
        (delivery,start)=>swing(offhand.ability,delivery,start),offhand.speed/values.swingSpeed);
      if(!runtime.state.dummy.health||!runtime.state.player.health)stopAuto();
    }
    if(target>=end){stopAuto();runtime.setPaused(true);}
    world?.updateHUD();
  }

  function incoming(){
    syncClock();
    if(runtime.incoming()){
      world?.playerHit();
      view.update(runtime);
    }
  }

  const view = renderTrainingGrounds(dialog, build, settings, {
    cast(id, point) {
      const ability = build.activeAbilities.find(item => item.id === id);
      if (ability?.presentation?.targeting === 'ground' && !point) {
        if (preview && world?.targetGround()) point = world.targetGround();
        else if (world?.pickGround(position => {
          picking = false;
          world.pickGround(null);
          view.castAbility(id, position);
        })) {
          picking = true;
          return {ok: true};
        }
      }
      if (picking) { world.pickGround(null); picking = false; }
      syncClock();
      const result = runtime.cast(id, a => world?.delivery(a, point));
      view.update(runtime);
      return result;
    },
    cancel() {
      syncClock();
      if (picking) { world.pickGround(null); picking = false; }
      runtime.cancel();
      view.update(runtime);
    },
    pause() {
      syncClock();
      runtime.setPaused(!runtime.paused);
      rebaseClock();
      view.update(runtime);
    },
    reset() {
      if (picking) { world.pickGround(null); picking = false; }
      stopAuto();
      runtime.reset();
      world?.clearCombat(runtime.state);
      rebaseClock();
      view.reset(runtime);
    },
    clear() {
      runtime.clearLog();
      view.update(runtime);
    },
    settings(input) {
      settings = normalizeCombatSettings(input);
      build = compile();
      stopAuto();
      runtime.cancelSpatial();
      runtime = newRuntime();
      world?.clearCombat(runtime.state);
      try {
        if (!preview) localStorage.setItem(storageKey, JSON.stringify(settings));
      } catch {
        // The settings still apply to the current session.
      }
      rebaseClock();
      view.reset(runtime);
    },
    review() {
      if (!preview) openCombatReview({runtime:()=>runtime, portrait:()=>world?.heroPortrait(),
        weaponBone:()=>world?.weaponBone(), key:layoutId??document.name,
        incoming:build.profile?.incoming, onIncoming:incoming,
        pause:()=>dialog.querySelector('#tg-pause').click(),reset:()=>dialog.querySelector('#tg-reset').click()});
    },
    combatText(event) {
      return world?.combatText(event);
    },
    damage(critical, reaction) { world?.hit(critical, reaction); }
  });

  function tick(now) {
    if (!dialog.open) return;
    syncClock();
    view.update(runtime);
    world?.update(now);
    frame = requestAnimationFrame(tick);
  }

  dialog.addEventListener('close', () => {
    cancelAnimationFrame(frame);
    world?.dispose();
    dialog.replaceChildren();
    dialog.onkeydown = null;
  }, {once: true});
  dialog.showModal();
  world = mountTrainingWorld(dialog, {
    preview,
    review:()=>view.review(),
    incoming:build.profile?.incoming&&!preview?incoming:undefined,
    movementScale: () => runtime.movementScale(),
    move: () => runtime.moved(),
    enter() { runtime.cancel(); },
    leave() { picking = false; stopAuto(); runtime.cancelSpatial(); },
    deselect() { stopAuto(); world?.updateHUD(); },
    startAuto,
    autoStatus: () => auto.status,
    toggleAuto() {
      if (auto.status.active) stopAuto();
      else {
        world.selectDummy();
        startAuto();
      }
    },
    resetTarget() {
      stopAuto();
      runtime.resetTarget();
      world.clearCombat(runtime.state);
      view.update(runtime);
    },
    state: () => runtime.state,
    runtime: () => runtime, build, practice, cast: view.castAbility
  });
  if (preview) {
    dialog.classList.add('tg-spell-preview');
    const tools = window.document.createElement('div');
    tools.className = 'tg-preview-tools';
    const badge = window.document.createElement('strong');
    badge.textContent = 'Визуальный предпросмотр · отдельная сессия';
    tools.append(badge);
    for (const [label, action] of [
      ['Запустить предпросмотр', () => {
        dialog.querySelector('#tg-reset').click();
        world.selectDummy();
        const ability = build.activeAbilities.find(item=>item.id===preview);
        if (ability) world.stagePreview(ability);
        view.castAbility(preview);
      }],
      ['Остановить предпросмотр', () => {
        stopAuto();
        runtime.cancel(true);
        runtime.cancelSpatial();
        runtime.setPaused(true);
        world.clearCombat(runtime.state);
        view.update(runtime);
      }],
      ['Сбросить предпросмотр', () => dialog.querySelector('#tg-reset').click()]
    ]) {
      const button = window.document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = action;
      tools.append(button);
    }
    dialog.append(tools);
    dialog.addEventListener('close', () => dialog.classList.remove('tg-spell-preview'), {once: true});
  }
  dialog.addEventListener('keydown', event => {
    if (picking && event.key === 'Escape') {
      event.preventDefault();
      world.pickGround(null);
      picking = false;
    }
  }, {signal: (() => {
    const controller = new AbortController();
    dialog.addEventListener('close', () => controller.abort(), {once: true});
    return controller.signal;
  })()});
  rebaseClock();
  view.update(runtime);
  frame = requestAnimationFrame(tick);
}
