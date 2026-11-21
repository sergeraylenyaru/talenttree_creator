import {heldTrainingSession,registerTrainingSession,forgetTrainingSession} from './session-registry.js';
export {disposeTrainingSession,rekeyTrainingSession,trainingSessionSnapshot} from './session-registry.js';
import {createPauseLeases,sessionCompatibility} from '../combat/session-updates.js';
import {addTranslations,t} from '../i18n.js';
import {createCombatClock} from '../combat/combat-clock.js';
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

addTranslations([
 ['Тренировка сохранена на паузе','Training session retained on pause'],['Начать новую сессию','Start a new session'],['Продолжить прежнюю сессию','Continue previous session'],['Остаться в дереве','Stay in the tree'],
 ['Смена класса или профиля требует новой сессии. Текущая сессия сохранена на паузе.','Changing the class or profile requires a new session. The current session remains paused.'],
 ['Касты, выпущенные снаряды и ауры сохраняют прежние настройки. Изменения действуют на следующие применения.','Casts, launched projectiles and auras retain their settings. Changes apply to subsequent uses.']
]);

export function openTrainingGrounds(dialog,document,options={}){
 const held=heldTrainingSession(dialog);
 if(held){
  const check=held.preview||options.preview?{ok:false,reason:'Предпросмотр — отдельная сессия.'}:held.key!==(options.sessionKey??options.layoutId??'local')?{ok:false,reason:'Открыт другой класс.'}:held.check(document);
  if(check.ok){held.resume(document);return held;}
  // This dialog is not an ability editor: it only protects the retained session.
  const prompt=window.document.createElement('dialog');prompt.className='tg-session-choice';
  const message=window.document.createElement('p');message.textContent=t('Смена класса или профиля требует новой сессии. Текущая сессия сохранена на паузе.');
  const reason=window.document.createElement('p');reason.textContent=check.reason;
  prompt.append(message,reason);
  for(const [name,run] of [
   ['Продолжить прежнюю сессию',()=>held.resume()],
   ['Начать новую сессию',()=>{held.dispose();openTrainingGrounds(dialog,document,options);}],
   ['Остаться в дереве',()=>{}]
  ]){const button=window.document.createElement('button');button.type='button';button.textContent=t(name);button.onclick=()=>{prompt.close();run();};prompt.append(button);}
  prompt.addEventListener('close',()=>prompt.remove(),{once:true});window.document.body.append(prompt);prompt.showModal();return held;
 }
 const session=createTrainingSession(dialog,document,options);registerTrainingSession(dialog,session);return session;
}

function createTrainingSession(dialog, document, options = {}) {
  const {preview,layoutId}=options;
  let disposed=false,retaining=false,treeRelease,api;
  const sessionId=crypto.randomUUID(),lifecycle=new AbortController();
  let fingerprint=JSON.stringify(document);
  let settings = loadSettings();
  function compile(source=document) {
    const build = compileCombatBuild(source, settings);
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
  const arenaBuild = (current=build) => ({...current, activeAbilities: [...current.activeAbilities, ...practice]});
  const newRuntime=()=>{
    const current=createCombatRuntime(arenaBuild(),{...settings,seed:build.profile?.seed});
    current.attachTimeline('spatial',{next:()=>world?.nextCombatEvent()??Infinity,tick:()=>world?.advanceCombat(current.state),cancel:()=>world?.clearCombat(current.state)});
    const policy=()=>current.state.activeCast?.ability.workshop?.swingPolicy??(build.profile?.combatRules?.version==='cataclysm-4.3.4'?'pause':'continue');
    const interval=()=>weaponTiming(current.sheet(),{swingSeconds:world?.weaponCombat()?.swingSeconds??trainingWeapon.swingSeconds,damage:0}).swingSeconds;
    current.attachTimeline('main-hand',{
      next:now=>{auto.suspend(now,Boolean(current.state.activeCast)&&policy()!=='continue',policy()==='reset');return auto.nextAt(now,interval());},
      tick:now=>auto.update(now,swingDelivery,report,(delivery,start)=>swing(basic,delivery,start),interval()),cancel:()=>auto.stop()
    });
    current.attachTimeline('off-hand',{
      next:now=>{if(!offhand)return Infinity;offhand.clock.suspend(now,Boolean(current.state.activeCast)&&policy()!=='continue',policy()==='reset');return offhand.clock.nextAt(now,offhand.speed/current.sheet().swingSpeed);},
      tick:now=>offhand?.clock.update(now,offhand.delivery,(type,details)=>current.autoEvent(offhand.ability,type,details),
        (delivery,start)=>swing(offhand.ability,delivery,start),offhand.speed/current.sheet().swingSpeed),cancel:()=>offhand?.clock.stop()
    });
    return current;
  };
  let runtime = newRuntime();
  let auto=createAutoAttack(), offhand, basic=practice[0], swingDelivery, generation=0;
  const report=(type,details)=>runtime.autoEvent(basic,type,details);

  const leases=createPauseLeases({getPaused:()=>runtime.paused,setPaused:value=>runtime.setPaused(value),sync:()=>syncClock(),
    onChange:()=>{rebaseClock();world?.setSuspended(runtime.paused);if(leases.active)stopLoop();else startLoop();}});
  function stopLoop(){if(frame!==null)cancelAnimationFrame(frame);frame=null;}
  function startLoop(){if(!disposed&&!leases.active&&dialog.open&&frame===null)frame=requestAnimationFrame(tick);}
  function suspend(){
    if(preview){dialog.close();return;}
    world?.closeMenu();if(!treeRelease)treeRelease=leases.acquire();
    retaining=true;dialog.close();
  }
  function reconcile(source){
    const nextFingerprint=JSON.stringify(source);if(nextFingerprint===fingerprint)return {ok:true,changed:false};
    const next=compile(source);const result=runtime.updateBuild(arenaBuild(next));if(!result.ok)return result;
    document=structuredClone(source);fingerprint=nextFingerprint;build=next;
    view.reconcile(build);world?.reconcile(build);
    if(auto.status.active){
      const values=runtime.sheet(),weapon=weaponTiming(values,{swingSeconds:world?.weaponCombat()?.swingSeconds??trainingWeapon.swingSeconds,damage:world?.weaponCombat()?.damage??trainingWeapon.damage});
      basic=autoAbility(weapon);swingDelivery=world?.delivery(basic);
      const extra=build.profile?.equipment?.offHand;
      if(extra?.speed&&!weapon.ranged){
        const ability=autoAbility(extra,true);
        if(offhand){offhand.ability=ability;offhand.delivery=world?.delivery(ability);offhand.speed=extra.speed;}
        else{const clock=createAutoAttack({...trainingWeapon,swingSeconds:extra.speed/values.swingSpeed});offhand={clock,ability,delivery:world?.delivery(ability),speed:extra.speed};clock.start((type,details)=>runtime.autoEvent(ability,type,details),runtime.state.combatTime+extra.speed/values.swingSpeed);}
      }else{offhand?.clock.stop();offhand=undefined;}
    }
    view.update(runtime);world?.combatState(runtime.state);world?.updateHUD();return {ok:true,changed:true};
  }

  function stopAuto(){
    auto.stop();offhand?.clock.stop();
    generation++;
  }

  function autoAbility(weapon,off=false){
    const ranged=weapon.ranged&&!off;
    return {...practice[0],weaponHand:off?'offHand':ranged?'ranged':'mainHand',autoWeapon:weapon,...(off?{id:practice[0].id+'_off',name:practice[0].name+' · Off hand'}:{}),isAuto:true,weaponType:weapon.type,
      ...(ranged?{range:24,presentation:{delivery:'ranged',projectile:'straight',attackAnimation:'bow',impact:'melee'}}:{}),
      combatEffects:practice[0].combatEffects.map(effect=>build.profile?.combatRules?.version==='cataclysm-4.3.4'?{...effect,baseAmount:0,weaponCoefficient:1,...(off?{multiplier:.5}:{})}:({...effect,baseAmount:weapon.minDamage,
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
    auto.start(report,runtime.state.combatTime);
    offhand?.clock.start((type,details)=>runtime.autoEvent(offhand.ability,type,details),runtime.state.combatTime);
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
  const clock=createCombatClock(performance.now());

  function rebaseClock() {
    clock.rebase(performance.now(),runtime.state.combatTime);
  }

  function syncClock() {
    if (runtime.paused) return;
    const end=preview?Infinity:build.profile?.testDuration??Infinity;
    const target = Math.min(end,clock.time(performance.now()));
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
    returnToTree:suspend,
    cast(id, point) {
      if(leases.active)return {ok:false,reason:"paused"};
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
      const result=runtime.cast(id,a=>{
        const weapons=runtime.sheet().weapons;
        const equipped=a.presentation?.delivery==='ranged'?weapons.ranged??weapons.melee:weapons.melee;
        return world?.delivery({...a,weaponType:a.weaponType??equipped?.type},point);
      });
      view.update(runtime);
      return result;
    },
    cancel() {
      syncClock();
      if (picking) { world.pickGround(null); picking = false; }
      runtime.cancel();
      view.update(runtime);
    },
    speed(value) {
      syncClock();
      clock.setRate(value,performance.now(),runtime.state.combatTime);
    },
    pause() {
      if(leases.active)return;
      syncClock();
      runtime.setPaused(!runtime.paused);
      world?.setSuspended(runtime.paused);
      rebaseClock();
      view.update(runtime);
    },
    reset() {
      if(leases.active)return;
      if (picking) { world.pickGround(null); picking = false; }
      stopAuto();
      runtime.reset();
      world?.setSuspended(false);
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
    damage(critical,reaction,clip) { world?.hit(critical,reaction,clip); }
  });

  function tick(now) {
    frame=null;
    if (!dialog.open||disposed||leases.active) return;
    syncClock();
    view.update(runtime);
    world?.setSuspended(runtime.paused);
    world?.update(now);
    frame = requestAnimationFrame(tick);
  }

  function dispose(){
    if(disposed)return;disposed=true;lifecycle.abort();stopLoop();world?.dispose();
    if(dialog.open)dialog.close();dialog.replaceChildren();dialog.onkeydown=null;dialog.classList.remove('tg-spell-preview');forgetTrainingSession(dialog,api);
  }
  dialog.addEventListener('close',()=>{if(retaining){retaining=false;return;}dispose();},{signal:lifecycle.signal});
  dialog.addEventListener('cancel',event=>{if(!preview){event.preventDefault();suspend();}},{signal:lifecycle.signal});
  dialog.querySelector('#tg-return').title=t('Касты, выпущенные снаряды и ауры сохраняют прежние настройки. Изменения действуют на следующие применения.');
  dialog.showModal();
  world = mountTrainingWorld(dialog, {
    preview,
    editing:!preview&&options.editAbility?{
      resolve:id=>!options.getDocument?.()?.abilities?.some(ability=>ability.id===id)?{allowed:false,message:'Базовая автоатака настраивается в экипировке.'}:!options.canEdit?.()||options.getSessionKey?.()!==api?.key?{allowed:false,message:'Редактирование этого класса недоступно.'}:{allowed:true},
      pause:()=>leases.acquire(),
      edit(id,done){options.editAbility(id,()=>{try{const result=reconcile(options.getDocument());if(!result.ok)dialog.querySelector('#tg-feedback').textContent=result.reason;}finally{done();view.update(runtime);world?.updateHUD();}});}
    }:undefined,
    review:()=>view.review(),
    incoming:build.profile?.incoming?incoming:undefined,incomingCastTime:build.profile?.incoming?.castTime,
    movementScale: () => runtime.movementScale(),
    move: () => runtime.moved(),
    enter() { runtime.cancel(); },
    leave() { picking = false; stopAuto(); runtime.cancelSpatial(); },
    deselect() { stopAuto(); world?.updateHUD(); },
    startAuto,
    autoStatus: () => auto.status,
    toggleAuto() {
      if(leases.active)return;
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
  }, {signal:lifecycle.signal});
  rebaseClock();
  view.update(runtime);
  startLoop();
  api={key:options.sessionKey??layoutId??'local',preview,dispose,
    check:source=>sessionCompatibility(arenaBuild(),arenaBuild(compile(source))),
    resume(source){
      if(source){const result=reconcile(source);if(!result.ok)return result;}
      if(!dialog.open)dialog.showModal();
      if(treeRelease){const release=treeRelease;treeRelease=undefined;release();}
      rebaseClock();world?.setSuspended(runtime.paused);view.update(runtime);world?.updateHUD();startLoop();return {ok:true};
    },
    inspect:()=>({sessionId,key:api.key,held:Boolean(treeRelease),leases:leases.active,runtime:runtime.inspectSession(),auto:auto.inspect(),offhand:offhand?.clock.inspect()})
  };
  return api;
}
