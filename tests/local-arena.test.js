import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Mesh, QuaternionKeyframeTrack} from 'three';
import {validateManifest} from '../static/world/asset-manifest.js';
import {attachWeapon, applyWeaponTransform, safeArenaPositions} from '../static/world/local-arena.js';
import {localAssetURL, mountRigidAttachments, renderedModelBounds} from '../static/world/model-loader.js';
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

test('optional sword grip samples only the right fingers from the exported clip', () => {
  const root = new Group();
  const hand = new Bone();
  hand.name = 'bone_HandR';
  const finger = new Bone();
  finger.name = 'bone_IndexFingerR';
  root.add(hand);
  hand.add(finger);
  const values = [0.5, 0.5, 0.5, 0.5];
  const clips = [new AnimationClip('swing', 1, [
    new QuaternionKeyframeTrack('bone_HandR.quaternion', [0], [0, 0, 0, 1]),
    new QuaternionKeyframeTrack('bone_IndexFingerR.quaternion', [0], values)
  ])];
  const settings = validateManifest({...configuration, weapons: {mainHand: {
    ...configuration.weapons.mainHand, attachmentBone: 'bone_HandR', gripClip: 'swing'
  }}}).weapons.mainHand;
  const attachment = attachWeapon({root, clips}, {root: new Group()}, settings);
  assert.equal(attachment.grip.length, 1);
  assert.equal(attachment.grip[0].finger, finger);
  assert.deepEqual([...attachment.grip[0].rotation], values);
  assert.throws(() => attachWeapon({root, clips}, {root: new Group()}, {...settings, gripClip: 'missing'}), /finger rotations/);
});


test('rigid armor uses the original glTF mesh name and moves with its configured joint', () => {
  const root = new Group();
  const shoulder = new Bone();
  shoulder.name = 'bone_ShoulderL';
  shoulder.position.y = 1.6;
  const plate = new Mesh();
  plate.name = 'Shoulder_(L)_Armor';
  plate.userData.name = 'Shoulder (L) Armor';
  root.add(shoulder, plate);
  const {rigidAttachments} = validateManifest({...configuration, rigidAttachments: [
    {mesh: plate.userData.name, bone: shoulder.name, position: [0, 0.1, -0.2]}
  ]});
  mountRigidAttachments(root, rigidAttachments);
  assert.equal(plate.parent, shoulder);
  assert.deepEqual(plate.position.toArray(), [0, 0.1, -0.2]);
  assert.throws(() => mountRigidAttachments(root, [{...rigidAttachments[0], bone: 'missing'}]), /Invalid rigid attachment/);
});

test('grounding ignores unreferenced vertices in shared export buffers', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -10, 0], 3));
  geometry.setIndex([0, 1, 2]);
  const mesh = new Mesh(geometry);
  assert.equal(renderedModelBounds(mesh).min.y, 0);
  geometry.dispose();
  mesh.material.dispose();
});
