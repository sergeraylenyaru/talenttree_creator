import test from 'node:test';
import assert from 'node:assert/strict';
import {Bone, Group} from 'three';
import {validateManifest} from '../static/world/asset-manifest.js';
import {attachWeapon, applyWeaponTransform, safeArenaPositions} from '../static/world/local-arena.js';
import {localAssetURL} from '../static/world/model-loader.js';
import {createCharacter, stepCharacter} from '../static/world/character-controller.js';
import {world} from '../static/world/world-config.js';

const ground = {minX: -4, maxX: 4, minZ: -4, maxZ: 4, y: 2};
const configuration = {
  model: 'character/hero.glb',
  environment: {model: 'world/room.glb', ground},
  target: {model: 'targets/Training-dummy.glb'},
  weapons: {mainHand: {model: 'weapons/sword.glb'}}
};

test('old manifests remain supported and asset roles enforce independent allowlists', () => {
  assert.equal(validateManifest({model: configuration.model}).environment, undefined);
  const parsed = validateManifest(configuration);
  assert.equal(parsed.target.animations.criticalHit, 'CombatCritical (ID 10 variation 0)');
  assert.equal(parsed.weapons.mainHand.attachmentBone, 'bone_WeaponR');
  assert.throws(() => validateManifest({...configuration, target: {model: 'world/room.glb'}}), /targets/);
  assert.throws(() => validateManifest({...configuration, environment: {model: 'world/room.glb'}}), /ground/);
  assert.throws(() => validateManifest({...configuration, environment: {...configuration.environment,
    walls: [{...ground, maxY: 1}]}}), /height/);
});

test('dependency URL accepts four same-origin roots and rejects traversal or remote origins', () => {
  const origin = 'http://127.0.0.1:8000';
  for (const directory of ['world', 'weapons', 'targets', 'character']) {
    assert.equal(localAssetURL('/local-world-assets/' + directory + '/nested/Texture.png', origin),
      origin + '/local-world-assets/' + directory + '/nested/Texture.png');
  }
  for (const url of ['/local-world-assets/world/%2e%2e/weapons/a.png', '/local-world-assets/world/%5cfoo.png',
    '/local-world-assets/private/file.png', 'file:///tmp/test.png', 'https://example.com/x.png']) {
    assert.throws(() => localAssetURL(url, origin), /outside/);
  }
});

test('safe spawns avoid walls and target collision and land at the configured floor', () => {
  const walls = [{minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5, minY: 2, maxY: 5}];
  const spawn = safeArenaPositions(ground, walls, {x: 0, z: 0}, {x: 99, z: 99}, 0.34);
  assert.equal(spawn.player.y, 2);
  assert.equal(spawn.dummy.y, 2);
  assert.notDeepEqual(spawn.player, spawn.dummy);
  const config = {...world, spawn: spawn.player, ground};
  let player = createCharacter(config);
  player = stepCharacter(player, {side: 0, forward: 0, jump: true}, 0, 0.2, config, []);
  assert.ok(player.y > 2);
  player = stepCharacter(player, {side: 0, forward: 0}, 0, 2, config, []);
  assert.ok(player.grounded && player.y === 2);
});

test('weapon follows the preferred or fallback bone with local calibration', () => {
  const mainHand = validateManifest(configuration).weapons.mainHand;
  for (const name of ['bone_WeaponR', 'bone_HandR']) {
    const hero = {root: new Group()};
    const weapon = {root: new Group()};
    const bone = new Bone();
    bone.name = name;
    hero.root.add(bone);
    const attachment = attachWeapon(hero, weapon, mainHand);
    assert.equal(attachment.bone, name);
    assert.equal(attachment.mount.parent, bone);
    assert.equal(weapon.root.parent, attachment.mount);
    applyWeaponTransform(attachment.mount, {position: [1, 2, 3], rotation: [90, 0, 0], scale: 2});
    assert.deepEqual(attachment.mount.position.toArray(), [1, 2, 3]);
    assert.equal(attachment.mount.rotation.x, Math.PI / 2);
    assert.equal(attachment.mount.scale.x, 2);
  }
});
