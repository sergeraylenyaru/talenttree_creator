import {loadArenaAssets} from './arena-loader.js';
import {applyWeaponTransform, attachWeapon, boundsOf, debugArena, safeArenaPositions} from './local-arena.js';
import {createSpatialCombat, facingTarget, spatialDefaults} from './combat/spatial-combat.js';
import {createCombatVisuals} from './combat/combat-visuals.js';
import {ArrowHelper, Group, MathUtils, PerspectiveCamera, Raycaster, Vector2, Vector3, WebGLRenderer} from 'three';
import {animateCharacter} from './animation-controller.js';
import {cameraFraction} from './collision-system.js';
import {bindMovement, createCharacter, stepCharacter} from './character-controller.js';
import {disposeObjects, renderedModelBounds} from './model-loader.js';
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
  let cameraState = {distance: view.distance, clearance: view.distance, obstructed: false};
  let debug = false;
  let debugGeometry;
  let debugArrow;
  const focus = new Vector3();
  const lag = new Vector3();
  const mountPoint = new Vector3();
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
  const playerPoint = new Vector3();
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
    read() {
      const position = dummy.position.toArray();
      const bounds = diagnostics.target?.bounds;
      return {
        position: {x: position[0], y: position[1] + combatConfig.aimHeight, z: position[2]},
        bounds: bounds && {
          min: bounds.min.map((value, i) => value + position[i]),
          max: bounds.max.map((value, i) => value + position[i])
        },
        radius: config.dummy.radius ?? 0.72, alive: (callbacks.targetAlive?.() ?? alive) && !signal.aborted
      };
    }
  };
  const combat = createSpatialCombat({
    player: () => player,
    target: () => selected ? dummyTarget : null,
    areaTarget: () => dummyTarget,
    move() { queuedJump = true; },
    obstacles: sightObstacles,
    face(position) {
      facing = position ? facingTarget(player, position) : undefined;
      if (facing !== undefined) player.facing = facing;
    },
    stopAnimation() { controller.clearPose(); },
    animate(name, until, override, loop = false, duration) {
      const minimum = name === 'meleeAttack' ? combatConfig.windup + 0.18 : 0.18;
      pose = {name, until, minimum, elapsed: 0, pending: true, override, loop, duration};
    },
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
    combatHit(critical, reactionStyle) {
      if (reactionStyle === 'none') return;
      const state = (reactionStyle === 'heavy' || (critical && reactionStyle !== 'normal')) && dummyAnimation?.supports('criticalHit') ? 'criticalHit' : 'hit';
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
    setDebug(enabled) {
      debug = enabled;
      if (debugGeometry) debugGeometry.visible = enabled;
      if (debugArrow) debugArrow.visible = enabled;
    },
    debugState() {
      return {
        position: [player.x, player.y, player.z],
        rotation: player.facing * 180 / Math.PI,
        animation: animation.activeClip ?? player.animation,
        weapon: weapon && {bone: weapon.bone, position: weapon.mount.position.toArray(),
          rotation: diagnostics.weapon.transform.rotation, scale: diagnostics.weapon.transform.scale},
        ground: motionConfig.ground?.y ?? 0,
        volumes: obstacles.length,
        obstructed: cameraState.obstructed,
        dummyDistance: Math.hypot(player.x - dummy.position.x, player.z - dummy.position.z)
      };
    },
    clearPose() { pose = undefined; facing = undefined; },
    clearCombat() {
      combat.clear();
      visuals.clear();
      pose = undefined;
      facing = undefined;
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
      // The combat clock can advance across a delayed render. Give its pose
      // enough rendered time to be seen without delaying the combat result.
      if (pose && !pose.pending) {
        pose.elapsed += dt;
        if (combatTime >= pose.until && pose.elapsed >= pose.minimum) controller.clearPose();
      }
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
      if (pose && facing !== undefined) player.facing = facing;
      avatar.rotation.y = player.facing;
      const clip = pose && animation.supports(pose.name, pose.override);
      const swingDuration = pose?.duration;
      animation.update(clip ? pose.name : directionalClip ? lateral : player.animation, dt,
        Boolean(clip && pose.pending), swingDuration, pose?.override, pose?.loop);
      if (weapon) for (const {finger, rotation} of weapon.grip) finger.quaternion.fromArray(rotation);
      if (pose) pose.pending = false;
      // Root tilt is a rig-independent fallback for models without attack clips.
      const remaining = pose ? Math.max(pose.until - combatTime, pose.minimum - pose.elapsed) : 0;
      const progress = Math.max(0, Math.min(1, remaining / 0.48));
      visualPivot.rotation.x = pose && !clip ? -Math.sin(progress * Math.PI) * 0.25 : 0;
      visuals.update(dt);
      if (reaction && (reactionTime -= dt) <= 0) reaction = undefined;
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
      // Limit follow lag to the player's side of any wall crossed by the focus.
      focus.set(player.x, player.y + 1.38, player.z);
      lag.set(target.x - focus.x, target.y - focus.y, target.z - focus.z);
      focus.addScaledVector(lag, cameraFraction(focus, lag, sightObstacles, 0.18));
      cameraState = placeCamera(camera, focus, view, cameraState, dt, obstacles, motionConfig.ground?.y);
      // In a tight obstruction the camera can be inside the avatar.
      visualPivot.visible = cameraState.clearance >= (config.camera.hideAvatarDistance ?? world.camera.hideAvatarDistance);
      renderer.render(scene, camera);
      projectDummy();
      if (callbacks.playerMarker) {
        const point = playerPoint.set(player.x, player.y + 2.2, player.z).project(camera);
        callbacks.playerMarker({
          x: Math.max(10, Math.min(90, (point.x + 1) * 50)),
          y: Math.max(15, Math.min(85, (1 - point.y) * 50))
        });
      }
    },
    snapshot() {
      avatar.updateMatrixWorld(true);
      const visualMinY = renderedModelBounds(model.visual ?? model.root).min.y;
      const direction = camera.getWorldDirection(new Vector3());
      return {attacks: combat.snapshot(), player: {...player}, orbit: {...orbit}, selected, model: modelKind,
        visualMinY, targetClip: dummyAnimation?.activeClip, assets: Object.keys(diagnostics), activeClip: animation.activeClip, cameraForward: {x: direction.x, z: direction.z},
        camera: {...cameraState, position: camera.position.toArray(), avatarVisible: visualPivot.visible},
        dummy: dummy.position.toArray(),
        weaponPosition: weapon?.mount.getWorldPosition(mountPoint).toArray(),
        weaponGripError: weapon && weapon.mount.parent.worldToLocal(mountPoint).distanceTo(weapon.mount.position),
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
    manifest(value) {
      manifest = value;
      callbacks.debugDefault?.(Boolean(value.debug));
    },
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
      const spawn = safeArenaPositions(ground, settings.walls, manifest.playerSpawn, manifest.target?.position, config.playerRadius, config.playerHeight);
      positionArena(spawn, ground, settings.walls);
      scene.add(visual);
      fallback.visible = false;
      diagnostics.environment = {...info, bounds: {min: bounds.min.toArray(), max: bounds.max.toArray()},
        groundStatus: 'explicit collision proxy', spawn};
      debugGeometry = debugArena(bounds, ground, [...settings.walls, spawn.collider], spawn);
      debugArrow = new ArrowHelper(new Vector3(0, 0, -1), new Vector3(0, 0.15, 0), 1.5, 0x00ffff);
      debugArrow.traverse(node => { node.raycast = () => {}; });
      scene.add(debugGeometry);
      avatar.add(debugArrow);
      controller.setDebug(debug);
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
