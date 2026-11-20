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

export function openTrainingGrounds(dialog, document) {
  let settings = loadSettings();
  let build = compileCombatBuild(document, settings);
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
  }
  let frame = null;
  let world;
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
    cast(id) {
      syncClock();
      const result = runtime.cast(id, world?.delivery);
      view.update(runtime);
      return result;
    },
    cancel() {
      syncClock();
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
      build = compileCombatBuild(document, settings);
      auto.stop();
      runtime.cancelSpatial();
      runtime = createCombatRuntime(arenaBuild(), settings);
      world?.clearCombat(runtime.state);
      try {
        localStorage.setItem(storageKey, JSON.stringify(settings));
      } catch {
        // The settings still apply to the current session.
      }
      rebaseClock();
      view.reset(runtime);
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
    enter() { runtime.cancel(); },
    leave() { auto.stop(); runtime.cancelSpatial(); },
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
  rebaseClock();
  view.update(runtime);
  frame = requestAnimationFrame(tick);
}
