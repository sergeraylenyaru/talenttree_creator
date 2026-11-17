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
  let runtime = createCombatRuntime(build, settings);
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
      if (runtime.state.activeCast?.delivery) world?.clearPose();
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
      runtime.cancelSpatial();
      runtime = createCombatRuntime(build, settings);
      world?.clearCombat(runtime.state);
      try {
        localStorage.setItem(storageKey, JSON.stringify(settings));
      } catch {
        // The settings still apply to the current session.
      }
      rebaseClock();
      view.reset(runtime);
    },
    damage(critical) { world?.hit(critical); }
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
    leave() { runtime.cancelSpatial(); },
    resetTarget() {
      runtime.resetTarget();
      world.clearCombat(runtime.state);
      view.update(runtime);
    },
    state: () => runtime.state
  });
  rebaseClock();
  view.update(runtime);
  frame = requestAnimationFrame(tick);
}
