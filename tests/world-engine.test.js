import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest, defaultClips} from '../static/world/asset-manifest.js';
import {animateCharacter, resolveClip} from '../static/world/animation-controller.js';
import {disposeObjects, localAssetURL} from '../static/world/model-loader.js';
import {createArena, createPlaceholder} from '../static/world/world-scene.js';
import {qualities, world} from '../static/world/world-config.js';

test('configuration provides a clear spawn, dummy collider and low graphics preset', () => {
  const {scene, dummy, obstacles} = createArena(world);
  assert.equal(dummy.position.z, world.dummy.z);
  assert.ok(!obstacles.some(box => world.spawn.x > box.minX && world.spawn.x < box.maxX &&
    world.spawn.z > box.minZ && world.spawn.z < box.maxZ));
  assert.ok(obstacles.some(box => world.dummy.x > box.minX && world.dummy.x < box.maxX &&
    world.dummy.z > box.minZ && world.dummy.z < box.maxZ));
  assert.equal(qualities.low.shadows, false);
  disposeObjects(scene);
});

test('local asset manifest validates model paths, transform and animation mappings', () => {
  for (const model of ['../hero.glb', '/character/hero.glb', 'character/../hero.glb',
    'character/%2e%2e/hero.glb', 'https://x/hero.gltf', 'character/model.obj', 'character\\hero.glb']) {
    assert.throws(() => validateManifest({model}), /under character/);
  }
  assert.throws(() => validateManifest({model: 'character/x.glb', scale: 0}), /transform/);
  assert.throws(() => validateManifest({model: 'character/x.glb', animations: {run: 1}}), /names/);
  const manifest = validateManifest({model: 'character/Портрет 2/Hero.glTF', scale: 0.01,
    rotation: 180, heightOffset: -0.1, animations: {run: 'Sprint', attacks: ['Slash']}});
  assert.deepEqual(manifest, {
    model: 'character/Портрет 2/Hero.glTF', scale: 0.01, rotation: 180, heightOffset: -0.1,
    animations: {...defaultClips, run: 'Sprint', attacks: ['Slash']}
  });
});

test('external or unrelated same-origin glTF dependencies are rejected', () => {
  const origin = 'http://localhost:8000';
  assert.equal(localAssetURL('/local-world-assets/character/texture.png', origin), origin + '/local-world-assets/character/texture.png');
  for (const uri of ['https://example.com/texture.png', '/api/me', '/local-world-assets/character/%2e%2e/manifest.json']) {
    assert.throws(() => localAssetURL(uri, origin), /outside/);
  }
});

test('missing animations fall back safely and a model without clips can be disposed', () => {
  const model = createPlaceholder();
  const idle = model.clips[0];
  assert.equal(resolveClip([idle], defaultClips, 'run'), idle);
  assert.equal(resolveClip([idle], defaultClips, 'fall'), idle);
  assert.equal(resolveClip([], defaultClips, 'jump'), null);
  const still = animateCharacter({...model, clips: []});
  still.update('run', 1 / 60);
  still.dispose();
  const moving = animateCharacter(model);
  moving.update('walk', 0.2);
  assert.notEqual(model.root.children.find(child => child.isGroup).rotation.x, 0);
  moving.dispose();
  const geometries = new Set();
  model.root.traverse(child => { if (child.geometry) geometries.add(child.geometry); });
  let disposed = 0;
  for (const geometry of geometries) geometry.addEventListener('dispose', () => disposed++);
  disposeObjects(model.root);
  assert.equal(disposed, geometries.size);
});
