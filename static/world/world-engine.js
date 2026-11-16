import {Group, PerspectiveCamera, Raycaster, Vector2, Vector3, WebGLRenderer} from 'three';
import {animateCharacter} from './animation-controller.js';
import {bindMovement, createCharacter, stepCharacter} from './character-controller.js';
import {disposeObjects, loadLocalCharacter} from './model-loader.js';
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
  const {scene, dummy, obstacles, selection} = createArena(config);
  const camera = new PerspectiveCamera(55, 1, 0.06, 90);
  const avatar = new Group();
  scene.add(avatar);
  let model = createPlaceholder();
  avatar.add(model.root);
  let animation = animateCharacter(model);
  let player = createCharacter(config);
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
    const projected = dummyPoint.set(dummy.position.x, 2.45, dummy.position.z).project(camera);
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
    const hit = ray.intersectObjects(scene.children, true).find(({object}) => object.visible);
    setSelection(Boolean(hit && hit.object.parent === dummy));
  }, signal);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    callbacks.unavailable();
  }, {signal});

  const controller = {
    setQuality,
    selectDummy() { setSelection(true); },
    update(now) {
      if (signal.aborted || document.hidden) return;
      const dt = lastTime === null ? 0 : Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      elapsed += dt;
      const input = readInput();
      queuedJump ||= input.jump;
      while (elapsed >= config.step) {
        player = stepCharacter(player, {...input, jump: queuedJump}, view.yaw, config.step, config, obstacles);
        queuedJump = false;
        elapsed -= config.step;
      }
      avatar.position.set(player.x, player.y, player.z);
      avatar.rotation.y = player.facing;
      animation.update(player.animation, dt);
      const blend = 1 - Math.exp(-21 * dt);
      const yawDelta = Math.atan2(Math.sin(orbit.yaw - view.yaw), Math.cos(orbit.yaw - view.yaw));
      view.yaw += yawDelta * blend;
      view.pitch += (orbit.pitch - view.pitch) * blend;
      view.distance = orbit.distance;
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
      distance = placeCamera(camera, target, view, distance, dt, obstacles);
      renderer.render(scene, camera);
      projectDummy();
    },
    snapshot() {
      return {player: {...player}, orbit: {...orbit}, selected, model: modelKind,
        geometries: renderer.info.memory.geometries, draws: renderer.info.render.calls};
    },
    dispose() {
      if (signal.aborted) return;
      lifetime.abort();
      activeWorlds.delete(canvas);
      animation.dispose();
      disposeObjects(scene);
      for (const light of scene.children) light.shadow?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
  activeWorlds.set(canvas, controller);

  loadLocalCharacter(signal).then(imported => {
    if (!imported) return;
    if (signal.aborted) {
      disposeObjects(imported.root);
      return;
    }
    animation.dispose();
    avatar.remove(model.root);
    disposeObjects(model.root);
    model = imported;
    animation = animateCharacter(model);
    avatar.add(model.root);
    modelKind = 'imported';
    callbacks.model(modelKind);
  }).catch(error => {
    if (!signal.aborted) callbacks.model('error', error.message);
  });

  return controller;
}
