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
  let runtime = createCombatRuntime(arenaBuild(), settings);
  let auto = createAutoAttack();
  let basic = practice[0];
  let swingDelivery;
  const report = (type, details) => runtime.autoEvent(basic, type, details);
  function startAuto() {
    if (auto.status.active || !runtime.state.dummy.health) return;
    const weapon = world?.weaponCombat();
    auto = createAutoAttack({...trainingWeapon, swingSeconds: weapon?.swingSeconds ?? trainingWeapon.swingSeconds});
    basic = {...practice[0], combatEffects: practice[0].combatEffects.map(effect => ({
      ...effect, baseAmount: weapon?.damage ?? trainingWeapon.damage
    }))};
    swingDelivery = world?.delivery(basic);
    auto.start(report);
    syncClock();
    view.update(runtime);
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
    const target = combatStart + (performance.now() - realStart) / 1000;
    runtime.advance(Math.max(0, target - runtime.state.combatTime));
    world?.combatState(runtime.state);
    if (auto.status.active) {
      auto.update(runtime.state.combatTime, swingDelivery, report,
        (delivery, startedAt) => runtime.autoImpact(basic, delivery, startedAt));
      if (!runtime.state.dummy.health) auto.stop();
    }
    world?.updateHUD();
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
      auto.stop();
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
      auto.stop();
      runtime.cancelSpatial();
      runtime = createCombatRuntime(arenaBuild(), settings);
      world?.clearCombat(runtime.state);
      try {
        if (!preview) localStorage.setItem(storageKey, JSON.stringify(settings));
      } catch {
        // The settings still apply to the current session.
      }
      rebaseClock();
      view.reset(runtime);
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
    movementScale: () => runtime.movementScale(),
    move: () => runtime.moved(),
    enter() { runtime.cancel(); },
    leave() { picking = false; auto.stop(); runtime.cancelSpatial(); },
    deselect() { auto.stop(); world?.updateHUD(); },
    startAuto,
    autoStatus: () => auto.status,
    toggleAuto() {
      if (auto.status.active) auto.stop();
      else {
        world.selectDummy();
        startAuto();
      }
    },
    resetTarget() {
      auto.stop();
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
        auto.stop();
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
