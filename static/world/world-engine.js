import {loadArenaAssets} from './arena-loader.js';
import {applyWeaponTransform, attachWeapon, boundsOf, debugArena, safeArenaPositions} from './local-arena.js';
import {createSpatialCombat, facingTarget, spatialDefaults} from './combat/spatial-combat.js';
import {createCombatVisuals} from './combat/combat-visuals.js';
import {ArrowHelper, Box3, Group, MathUtils, PerspectiveCamera, Raycaster, Vector2, Vector3, WebGLRenderer} from 'three';
import {animateCharacter} from './animation-controller.js';
import {bindMovement, createCharacter, stepCharacter} from './character-controller.js';
import {disposeObjects} from './model-loader.js';
import {bindOrbit, orbitInput, placeCamera} from './third-person-camera.js';
import {qualities, world} from './world-config.js';
import {createArena, createPlaceholder} from './world-scene.js';

const activeWorlds = new WeakMap();
export const worldSnapshot = canvas => activeWorlds.get(canvas)?.snapshot();

export function createWorld(canvas, callbacks, config = world) {
  if (activeWorlds.has(canvas)) throw Error('World is already active');
  const renderer = new WebGLRenderer({canvas, antialias: false, alpha: false});
  const lifetime = new AbortController();
  const {signal} = lifetime;
  const {scene, dummy, dummyVisual, fallback, obstacles, selection, sightObstacles} = createArena(config);
  const camera = new PerspectiveCamera(55, 1, 0.06, 90);
  const avatar = new Group();
  scene.add(avatar);
  const visualPivot = new Group();
  avatar.add(visualPivot);
  let model = createPlaceholder();
  visualPivot.add(model.root);
  let animation = animateCharacter(model);
  let player = createCharacter(config);
  let strafeFacing;
  let orbit = {yaw: 0, pitch: 0.29, distance: config.camera.distance};
  let view = {...orbit};
  let distance = view.distance;
  let elapsed = 0;
  let lastTime = null;
  let queuedJump = false;
  let selected = false;
  let modelKind = 'placeholder';
  let width = 0;
  let height = 0;
  const target = {x: player.x, y: 1.38, z: player.z};
  const ray = new Raycaster();
  const dummyPoint = new Vector3();
  const readInput = bindMovement(canvas, document, window, signal);
  document.addEventListener('visibilitychange', () => { lastTime = null; queuedJump = false; }, {signal});
  window.addEventListener('blur', () => { queuedJump = false; }, {signal});

  let motionConfig = config;
  let manifest;
  let weapon;
  let dummyAnimation;
  let reaction;
  let reactionTime = 0;
  const diagnostics = {};
  let pose;
  let combatTime = 0;
  let facing;
  let alive = true;
  const visuals = createCombatVisuals(scene, dummy);
  const combatConfig = {...spatialDefaults, ...config.combat};
  const dummyTarget = {
    selected: () => selected,
    read: () => ({
      position: {x: dummy.position.x, y: dummy.position.y + combatConfig.aimHeight, z: dummy.position.z},
      radius: config.dummy.radius ?? 0.72, alive: (callbacks.targetAlive?.() ?? alive) && !signal.aborted
    })
  };
  const combat = createSpatialCombat({
    player: () => player,
    target: () => selected ? dummyTarget : null,
    obstacles: sightObstacles,
    face(position) { facing = facingTarget(player, position); player.facing = facing; },
    animate(name, until) { pose = {name, until}; },
    visuals,
    config: combatConfig
  });

  function setQuality(name) {
    const quality = qualities[name] || qualities.low;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    if (renderer.shadowMap.enabled !== quality.shadows) {
      renderer.shadowMap.enabled = quality.shadows;
      scene.traverse(object => {
        if (object.material) for (const material of [object.material].flat()) material.needsUpdate = true;
      });
    }
    width = height = 0;
  }

  function projectDummy() {
    const projected = dummyPoint.set(dummy.position.x, dummy.position.y + 2.45, dummy.position.z).project(camera);
    callbacks.marker({
      x: (projected.x + 1) * 50, y: (1 - projected.y) * 50,
      visible: Math.abs(projected.x) < 0.93 && Math.abs(projected.y) < 0.90 && Math.abs(projected.z) < 1
    });
  }

  function setSelection(value) {
    selected = value;
    selection.visible = value;
    callbacks.selection(value);
  }

  bindOrbit(canvas, delta => { orbit = orbitInput(orbit, delta, config.camera); }, (x, y) => {
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera);
    const hit = ray.intersectObjects(scene.children, true).find(({object}) => {
      for (let node = object; node; node = node.parent) if (!node.visible || node === selection) return false;
      return true;
    });
    let node = hit?.object;
    while (node && node !== dummy) node = node.parent;
    setSelection(node === dummy);
  }, signal);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    callbacks.unavailable();
  }, {signal});

  const controller = {
    setQuality,
    selectDummy() { setSelection(true); },
    delivery: combat.delivery,
    combatState(time, health) {
      alive = health > 0;
      combatTime = time;
      combat.update(time);
      dummy.scale.y = (callbacks.targetAlive?.() ?? alive) ? 1 : 0.72;
    },
    combatHit(critical) {
      const state = critical && dummyAnimation?.supports('criticalHit') ? 'criticalHit' : 'hit';
      if (!dummyAnimation?.supports(state)) {
        visuals.react();
        return;
      }
      reaction = state;
      dummyAnimation.update(reaction, 0, true);
      reactionTime = dummyAnimation.activeDuration;
    },
    weaponTransform(values) {
      if (!weapon) return false;
      applyWeaponTransform(weapon.mount, values);
      diagnostics.weapon.transform = {...diagnostics.weapon.transform, ...values};
      return true;
    },
    assetReport() { return {assets: diagnostics, manifest}; },
    clearPose() { pose = undefined; },
    clearCombat() {
      combat.clear();
      visuals.clear();
      pose = undefined;
      reaction = undefined;
      reactionTime = 0;
    },
    update(now) {
      if (signal.aborted || document.hidden) return;
      const dt = lastTime === null ? 0 : Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      const blend = 1 - Math.exp(-21 * dt);
      const yawDelta = Math.atan2(Math.sin(orbit.yaw - view.yaw), Math.cos(orbit.yaw - view.yaw));
      view.yaw += yawDelta * blend;
      view.pitch += (orbit.pitch - view.pitch) * blend;
      view.distance = orbit.distance;
      elapsed += dt;
      const input = readInput();
      queuedJump ||= input.jump;
      while (elapsed >= config.step) {
        player = stepCharacter(player, {...input, jump: queuedJump}, view.yaw, config.step, motionConfig, obstacles);
        queuedJump = false;
        elapsed -= config.step;
      }
      avatar.position.set(player.x, player.y, player.z);
      if (pose && combatTime >= pose.until) pose = undefined;
      const lateral = player.grounded && player.animation !== 'idle'
        ? input.forward < 0 ? (input.sprint ? 'runBack' : 'walkBack')
          : !input.forward && input.side ? (input.side < 0 ? 'strafeLeft' : 'strafeRight') : null
        : null;
      const directionalClip = lateral && animation.supports(lateral);
      if (directionalClip && !pose) {
        strafeFacing ??= avatar.rotation.y;
        const delta = view.yaw - strafeFacing;
        const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
        strafeFacing += Math.max(-12 * dt, Math.min(12 * dt, turn));
        player.facing = strafeFacing;
      } else strafeFacing = undefined;
      if (pose) player.facing = facing;
      avatar.rotation.y = player.facing;
      const clip = pose && animation.supports(pose.name);
      animation.update(clip ? pose.name : directionalClip ? lateral : player.animation, dt);
      // Root tilt is a rig-independent fallback for models without attack clips.
      const progress = pose ? Math.max(0, Math.min(1, (pose.until - combatTime) / 0.48)) : 0;
      visualPivot.rotation.x = pose && !clip ? -Math.sin(progress * Math.PI) * 0.25 : 0;
      visuals.update(dt);
      reactionTime -= dt;
      if (reactionTime <= 0) reaction = undefined;
      dummyAnimation?.update(reaction ?? 'idle', dt);
      target.x += (player.x - target.x) * blend;
      target.y += (player.y + 1.38 - target.y) * blend;
      target.z += (player.z - target.z) * blend;
      const nextWidth = canvas.clientWidth;
      const nextHeight = canvas.clientHeight;
      if (!nextWidth || !nextHeight) return;
      if (width !== nextWidth || height !== nextHeight) {
        width = nextWidth;
        height = nextHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      distance = placeCamera(camera, target, view, distance, dt, obstacles, motionConfig.ground?.y);
      renderer.render(scene, camera);
      projectDummy();
    },
    snapshot() {
      avatar.updateMatrixWorld(true);
      const visualMinY = new Box3().setFromObject(visualPivot, true).min.y;
      const direction = camera.getWorldDirection(new Vector3());
      return {attacks: combat.snapshot(), player: {...player}, orbit: {...orbit}, selected, model: modelKind,
        visualMinY, targetClip: dummyAnimation?.activeClip, assets: Object.keys(diagnostics), activeClip: animation.activeClip, cameraForward: {x: direction.x, z: direction.z},
        geometries: renderer.info.memory.geometries, draws: renderer.info.render.calls};
    },
    dispose() {
      if (signal.aborted) return;
      lifetime.abort();
      activeWorlds.delete(canvas);
      animation.dispose();
      dummyAnimation?.dispose();
      combat.clear();
      visuals.dispose();
      disposeObjects(scene);
      for (const light of scene.children) light.shadow?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
  activeWorlds.set(canvas, controller);

  function positionArena(spawn, ground, walls) {
    combat.clear();
    motionConfig = {...config, ground, spawn: spawn.player};
    player = createCharacter(motionConfig);
    dummy.position.set(spawn.dummy.x, spawn.dummy.y, spawn.dummy.z);
    avatar.position.set(player.x, player.y, player.z);
    Object.assign(target, {x: player.x, y: player.y + 1.38, z: player.z});
    sightObstacles.splice(0, sightObstacles.length, ...walls);
    obstacles.splice(0, obstacles.length, ...walls, spawn.collider);
  }

  loadArenaAssets(signal, {
    manifest(value) { manifest = value; },
    environment(asset, settings, info) {
      const visual = new Group();
      visual.add(asset.root);
      visual.scale.setScalar(settings.scale);
      visual.rotation.y = MathUtils.degToRad(settings.rotation);
      visual.position.set(settings.position.x, settings.position.y, settings.position.z);
      const bounds = boundsOf(visual);
      const ground = settings.ground;
      if (ground.minX < bounds.min.x || ground.maxX > bounds.max.x || ground.minZ < bounds.min.z ||
          ground.maxZ > bounds.max.z || ground.y < bounds.min.y - 0.05 || ground.y > bounds.max.y + 0.05) {
        throw Error('Configured floor is outside the transformed environment bounds');
      }
      const spawn = safeArenaPositions(ground, settings.walls, manifest.playerSpawn, manifest.target?.position, config.playerRadius);
      positionArena(spawn, ground, settings.walls);
      scene.add(visual);
      fallback.visible = false;
      diagnostics.environment = {...info, bounds: {min: bounds.min.toArray(), max: bounds.max.toArray()},
        groundStatus: 'explicit collision proxy', spawn};
      if (manifest.debug) {
        scene.add(debugArena(bounds, ground, settings.walls, spawn));
        const arrow = new ArrowHelper(new Vector3(0, 0, -1), new Vector3(0, 0.15, 0), 1.5, 0x00ffff);
        arrow.traverse(node => { node.raycast = () => {}; });
        avatar.add(arrow);
      }
    },
    hero(imported, settings, info) {
      animation.dispose();
      visualPivot.remove(model.visual ?? model.root);
      disposeObjects(model.root);
      model = imported;
      animation = animateCharacter(model);
      visualPivot.add(model.visual);
      modelKind = 'imported';
      diagnostics.hero = {...info, forward: 'controller -Z; visual yaw ' + settings.rotation + ' degrees'};
      callbacks.model(modelKind);
    },
    weapon(asset, settings, info) {
      weapon = attachWeapon(model, asset, settings);
      diagnostics.weapon = {...info, bone: weapon.bone};
    },
    target(asset, settings, info) {
      dummyVisual.visible = false;
      dummy.add(asset.visual);
      dummyAnimation = animateCharacter(asset);
      diagnostics.target = info;
    }
  }, (role, status, detail) => {
    callbacks.asset?.(role, status, detail);
    if (role === 'hero' && status === 'error') callbacks.model('error', detail);
  }).catch(error => {
    if (!signal.aborted) {
      callbacks.asset?.('manifest', 'error', error.message);
      callbacks.model('error', error.message);
    }
  });

  return controller;
}
