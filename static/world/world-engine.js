import {animationClips,isLocalClip} from '../combat/presentation.js';
import {capturePortrait} from './portrait.js';
import {createExplorationTerrain, createWorldCollision} from './exploration-world.js';
import {loadArenaAssets} from './arena-loader.js';
import {applyWeaponTransform, attachWeapon, boundsOf, debugArena, safeArenaPositions} from './local-arena.js';
import {createSpatialCombat, facingTarget, spatialDefaults} from './combat/spatial-combat.js';
import {createCombatVisuals} from './combat/combat-visuals.js';
import {ArrowHelper, Box3, Group, Matrix3, MathUtils, PerspectiveCamera, Raycaster, Vector2, Vector3, WebGLRenderer} from 'three';
import {animateCharacter} from './animation-controller.js';
import {cameraFraction} from './collision-system.js';
import {bindMovement, createCharacter, stepCharacter} from './character-controller.js';
import {disposeObjects, renderedModelBounds} from './model-loader.js';
import {bindOrbit, orbitInput, placeCamera} from './third-person-camera.js';
import {qualities, world} from './world-config.js';
import {createArena, createPlaceholder} from './world-scene.js';

const activeWorlds = new WeakMap();
export const worldLocation = canvas => activeWorlds.get(canvas)?.location();
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
  let groundPick;
  let groundMeshes = [fallback];
  const normalMatrix = new Matrix3();
  const normal = new Vector3();
  let modelKind = 'placeholder';
  let width = 0;
  let height = 0;
  const target = {x: player.x, y: 1.38, z: player.z};
  const ray = new Raycaster();
  const dummyPoint = new Vector3();
  const interactionBounds = new Box3();
  const interactionPoint = new Vector3();
  const aimPoint = new Vector3();
  const targetText = {};
  const playerText = {};
  const markerSight = new Vector3();
  const targetUnit = {id: "training-dummy", name: "Манекен", level: 1};
  const playerPoint = new Vector3();
  const readInput = bindMovement(canvas, document, window, signal);
  document.addEventListener('visibilitychange', () => { lastTime = null; queuedJump = false; }, {signal});
  window.addEventListener('blur', () => { queuedJump = false; }, {signal});

  let motionConfig = {...config};
  let manifest;
  let weapon;
  let dummyAnimation;
  let targetModelClips=[];
  let reaction;
  let reactionClip;
  let lastAnimationFallback;
  let reactionTime = 0;
  const diagnostics = {};
  let pose;
  let combatTime = 0;
  let facing;
  let autoReady = false;
  let alive = true;
  const visuals = createCombatVisuals(scene, dummy);
  visuals.weapon = profile => {
    if (weapon) visuals.impact(weapon.mount.getWorldPosition(mountPoint), profile);
  };
  const combatConfig = {...spatialDefaults, ...config.combat};
  function targetBounds() {
    const bounds = diagnostics.target?.bounds;
    if (!bounds) return undefined;
    const {x, y, z} = dummy.position;
    const [minX, minY, minZ] = bounds.min;
    const [maxX, maxY, maxZ] = bounds.max;
    return {
      min: [x + minX, y + minY * dummy.scale.y, z + minZ],
      max: [x + maxX, y + maxY * dummy.scale.y, z + maxZ]
    };
  }

  const dummyTarget = {
    selected: () => selected,
    read() {
      const bounds = targetBounds();
      const {x, y, z} = dummy.position;
      if (bounds) {
        interactionBounds.min.fromArray(bounds.min);
        interactionBounds.max.fromArray(bounds.max);
        interactionBounds.getCenter(aimPoint);
      } else aimPoint.set(x, y + combatConfig.aimHeight, z);
      return {
        position: {x: aimPoint.x, y: aimPoint.y, z: aimPoint.z}, bounds,
        radius: config.dummy.radius ?? 0.72, alive: (callbacks.targetAlive?.() ?? alive) && !signal.aborted
      };
    }
  };
  function reportAnimationFallback(requested,replacement){
    lastAnimationFallback={requested,replacement};
    callbacks.animationFallback?.(requested,replacement);
  }

  const combat = createSpatialCombat({
    player: () => player,
    animationAvailable: name => model.clips.some(clip=>clip.name===name),
    animationFallback: reportAnimationFallback,
    projectileOrigin(anchor) {
      const node=anchor==='weapon'&&weapon?.mount||model.root?.getObjectByName('bone_HandR');
      if(!node)return;
      const {x,y,z}=node.getWorldPosition(mountPoint);
      return {x,y,z};
    },
    target: () => selected ? dummyTarget : null,
    areaTarget: () => dummyTarget,
    move() { queuedJump = true; },
    obstacles: sightObstacles,
    occlusion: (origin, offset, padding) => motionConfig.collision?.fraction(origin, offset, padding) ?? 1,
    face(position) {
      facing = position ? facingTarget(player, position) : undefined;
      if (facing !== undefined) player.facing = facing;
    },
    autoAnimate(position, until, duration) {
      if (pose) return;
      facing = facingTarget(player, position);
      pose = {name: 'meleeAttack', until, minimum: duration, elapsed: 0, pending: true, duration, auto: true};
    },
    stopAnimation() { controller.clearPose(); },
    animate(name, until, override, loop = false, duration, profile) {
      const minimum = name === 'meleeAttack' ? combatConfig.windup + 0.18 : 0.18;
      pose = {name, until, minimum, elapsed: 0, pending: true, override, loop, duration, profile};
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

  function project(point, result, checkSight = false) {
    markerSight.copy(point).sub(camera.position);
    const visible = !checkSight ||
      Math.min(cameraFraction(camera.position, markerSight, sightObstacles, 0),
        motionConfig.collision?.fraction(camera.position, markerSight, 0) ?? 1) >= 1;
    point.project(camera);
    result.x = (point.x + 1) * 50;
    result.y = (1 - point.y) * 50;
    result.visible = visible && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1;
  }

  function projectDummy(now) {
    const {x, y, z} = dummy.position;
    const bounds = diagnostics.target?.bounds;
    // The imported silhouette includes a weapon extending well above the head.
    const head = bounds ? MathUtils.lerp(bounds.min[1], bounds.max[1], 0.76) : 2.1;
    project(dummyPoint.set(x, y + head * dummy.scale.y + 0.30, z), targetText, true);
    callbacks.marker(targetText);
    if (!callbacks.combatProjection) return;
    project(playerPoint.set(player.x, player.y + 2.2, player.z), playerText);
    callbacks.combatProjection(targetText, playerText, now);
  }

  function setSelection(value) {
    selected = value;
    selection.visible = value;
    callbacks.selection(value, value ? targetUnit : null);
  }

  bindOrbit(canvas, delta => { orbit = orbitInput(orbit, delta, config.camera); }, (x, y, right, marker) => {
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera);
    if (groundPick && !right) {
      const hit = ray.intersectObjects(groundMeshes, true)[0];
      if (hit?.face && normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).y > .52) {
        const pick = groundPick;
        controller.pickGround(null);
        pick({x: hit.point.x, y: hit.point.y, z: hit.point.z});
      }
      return;
    }
    const bounds = targetBounds();
    if (bounds) {
      interactionBounds.min.fromArray(bounds.min);
      interactionBounds.max.fromArray(bounds.max);
    } else {
      const {x, y, z} = dummy.position;
      interactionBounds.min.set(x - 0.55, y, z - 0.55);
      interactionBounds.max.set(x + 0.55, y + 2.1, z + 0.55);
    }
    interactionBounds.expandByScalar(0.16);
    const contact = ray.ray.intersectBox(interactionBounds, interactionPoint);
    let found = marker;
    if (contact && !found) {
      markerSight.copy(contact).sub(camera.position);
      found = Math.min(cameraFraction(camera.position, markerSight, sightObstacles, 0),
        motionConfig.collision?.fraction(camera.position, markerSight, 0) ?? 1) >= 1;
    }
    if (!right || found) setSelection(found);
    if (right && found) callbacks.autoAttack?.();
  }, signal);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    callbacks.unavailable();
  }, {signal});

  const controller = {
    setQuality,
    pickGround(callback) {
      groundPick = callback;
      canvas.classList.toggle('tg-aim-ground', Boolean(callback));
    },
    stagePreview(ability) {
      const dx = dummy.position.x - player.x, dz = dummy.position.z - player.z;
      const distance = Math.hypot(dx,dz);
      const close = ability.presentation?.delivery === 'melee' || (!ability.range && !ability.presentation?.projectile) ||
        ability.presentation?.targeting === 'area';
      player.facing = facingTarget(player,dummy.position);
      if (!close || distance <= 1.7) return;
      const move = (distance - 1.7) / distance;
      const x = player.x + dx * move, z = player.z + dz * move;
      const floor = motionConfig.collision?.floorAt(x,z,player.y + .3,1) ?? motionConfig.ground?.y ?? 0;
      Object.assign(player,{x,y:floor,z,vx:0,vy:0,vz:0});
      target.set(x,floor + 1.38,z);
    },
    targetGround() {
      return {x: dummy.position.x, y: dummy.position.y, z: dummy.position.z};
    },
    selectDummy() { setSelection(true); },
    delivery: combat.delivery,
    weaponCombat() { return manifest?.weapons?.mainHand; },
    autoStance(value) {
      autoReady = value;
      if (!value && pose?.auto) controller.clearPose();
    },
    combatState(time, health) {
      alive = health > 0;
      combatTime = time;
      combat.update(time);
      dummy.scale.y = (callbacks.targetAlive?.() ?? alive) ? 1 : 0.72;
    },
    playerHit() {
      if(pose)return;
      pose={name:'hitReaction',until:combatTime+.35,minimum:.35,elapsed:0,pending:true,
        override:'CombatWound (ID 9 variation 0)'};
    },
    combatHit(critical,reactionStyle,clip) {
      if (reactionStyle==='none'||clip==='none')return;
      const state = (reactionStyle === 'heavy' || (critical && reactionStyle !== 'normal')) && dummyAnimation?.supports('criticalHit') ? 'criticalHit' : 'hit';
      if (!dummyAnimation?.supports(state)) {
        visuals.react();
        return;
      }
      const requested=isLocalClip(clip)?clip.slice(5):animationClips[clip];
      reactionClip=requested&&targetModelClips.includes(requested)?requested:undefined;
      if(requested&&!reactionClip)reportAnimationFallback(requested,'default');
      reaction=state;
      dummyAnimation.update(reaction,0,true,undefined,reactionClip);
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
        ground: motionConfig.collision?.floorAt(player.x, player.z, player.y + .1, 25) ?? motionConfig.ground?.y ?? 0,
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
      const movement = callbacks.movementScale?.() ?? 1;
      motionConfig.movement = movement === 1 ? config.movement : {...config.movement, walk: config.movement.walk * movement, run: config.movement.run * movement};
      queuedJump ||= input.jump;
      if (input.forward || input.side || queuedJump) callbacks.move?.();
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
        ? input.forward < 0 ? 'walkBack'
          : !input.forward && input.side ? (input.side < 0 ? 'strafeLeft' : 'strafeRight') : null
        : null;
      const directionalClip = lateral && animation.supports(lateral);
      const ready = autoReady && !pose && player.animation === 'idle' && animation.supports('ready', 'Ready1H (ID 26 variation 0)');
      if (ready) {
        const desired = facingTarget(player, dummy.position);
        const delta = desired - player.facing;
        const turn = Math.atan2(Math.sin(delta), Math.cos(delta));
        player.facing += Math.max(-12 * dt, Math.min(12 * dt, turn));
      }
      if (pose && facing !== undefined) player.facing = facing;
      avatar.rotation.y = player.facing;
      const clip = pose && animation.supports(pose.name, pose.override);
      const swingDuration = pose?.duration;
      const locomotion = directionalClip || ['walk', 'run'].includes(player.animation);
      const stride = directionalClip ? config.movement.walk : config.movement[player.animation];
      const pace = !pose && locomotion ? Math.max(.55, Math.min(1.7, Math.hypot(player.vx, player.vz)/stride)) : undefined;
      animation.update(clip ? pose.name : ready ? 'ready' : directionalClip ? lateral : player.animation, dt,
        Boolean(clip && pose.pending), swingDuration, ready ? 'Ready1H (ID 26 variation 0)' : pose?.override, pose?.loop, pace, pose?.profile?.playback, pose?.profile?.blend);
      if (weapon) for (const {finger, rotation} of weapon.grip) finger.quaternion.fromArray(rotation);
      if (pose) pose.pending = false;
      // Root tilt is a rig-independent fallback for models without attack clips.
      const remaining = pose ? Math.max(pose.until - combatTime, pose.minimum - pose.elapsed) : 0;
      const progress = Math.max(0, Math.min(1, remaining / 0.48));
      visualPivot.rotation.x = pose && !clip ? -Math.sin(progress * Math.PI) * 0.25 : 0;
      visuals.update(dt);
      if (reaction && (reactionTime -= dt) <= 0) reaction = undefined;
      dummyAnimation?.update(reaction??'idle',dt,false,undefined,reaction?reactionClip:undefined);
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
      focus.addScaledVector(lag, Math.min(
        cameraFraction(focus, lag, sightObstacles, 0.18),
        motionConfig.collision?.fraction(focus, lag) ?? 1
      ));
      cameraState = placeCamera(camera, focus, view, cameraState, dt, obstacles, motionConfig.collision ? player.y : motionConfig.ground?.y, motionConfig.collision);
      // In a tight obstruction the camera can be inside the avatar.
      visualPivot.visible = cameraState.clearance >= (config.camera.hideAvatarDistance ?? world.camera.hideAvatarDistance);
      renderer.render(scene, camera);
      projectDummy(now);
    },
    location() { return {...player, clip: animation.activeClip}; },
    snapshot() {
      avatar.updateMatrixWorld(true);
      const visualMinY = renderedModelBounds(model.visual ?? model.root).min.y;
      const direction = camera.getWorldDirection(new Vector3());
      return {attacks: combat.snapshot(), player: {...player}, orbit: {...orbit}, selected, model: modelKind,
        visualMinY, lastAnimationFallback, targetClip: dummyAnimation?.activeClip, assets: Object.keys(diagnostics), activeClip: animation.activeClip, cameraForward: {x: direction.x, z: direction.z},
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
      positionArena(spawn, ground, settings.exploration ? [] : settings.walls);
      groundMeshes = [visual];
      if (settings.exploration) {
        const terrain = createExplorationTerrain(bounds);
        scene.add(terrain.root);
        groundMeshes.push(terrain.ground);
        motionConfig.collision = createWorldCollision(visual, terrain, config, obstacles);
      }
      scene.add(visual);
      fallback.visible = false;
      diagnostics.environment = {...info, bounds: {min: bounds.min.toArray(), max: bounds.max.toArray()},
        groundStatus: settings.exploration ? 'multi-level triangle collision' : 'explicit collision proxy', spawn};
      debugGeometry = debugArena(bounds, ground, settings.exploration ? [spawn.collider] : [...settings.walls, spawn.collider], spawn);
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
      if (callbacks.portrait) callbacks.portrait('hero',capturePortrait(renderer,model.visual,info.bounds,true));
    },
    weapon(asset, settings, info) {
      weapon = attachWeapon(model, asset, settings);
      diagnostics.weapon = {...info, bone: weapon.bone};
    },
    target(asset, settings, info) {
      dummyVisual.visible = false;
      dummy.add(asset.visual);
      dummyAnimation = animateCharacter(asset);
      targetModelClips=asset.clips.map(clip=>clip.name);
      diagnostics.target = info;
      if (callbacks.portrait) callbacks.portrait('target',capturePortrait(renderer,asset.visual,info.bounds,false));
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
