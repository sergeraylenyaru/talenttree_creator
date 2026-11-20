import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Bone, Box3, BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  PerspectiveCamera, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3
} from 'three';
import {createCharacter, stepCharacter} from '../static/world/character-controller.js';
import {orientAndGroundModel, disposeObjects} from '../static/world/model-loader.js';
import {placeCamera} from '../static/world/third-person-camera.js';
import {createPlaceholder} from '../static/world/world-scene.js';
import {world} from '../static/world/world-config.js';

const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-6, `${value} ≈ ${expected}`);
const minY = root => new Box3().setFromObject(root, true).min.y;
const options = {scale: 1, rotation: 0, heightOffset: 0};
const input = [{forward: 1, side: 0}, {forward: 0, side: -1},
  {forward: -1, side: 0}, {forward: 0, side: 1}];
const cardinal = [
  [[0, -1], [-1, 0], [0, 1], [1, 0]],
  [[-1, 0], [0, 1], [1, 0], [0, -1]],
  [[0, 1], [1, 0], [0, -1], [-1, 0]],
  [[1, 0], [0, -1], [-1, 0], [0, 1]]
];

for (const [index, directions] of cardinal.entries()) {
  test(`WASD and facing agree with the rendered camera at yaw ${index * 90}°`, () => {
    const yaw = index * Math.PI / 2;
    const camera = new PerspectiveCamera();
    placeCamera(camera, {x: 0, y: 1, z: 0}, {yaw, pitch: 0.31, distance: 5}, 5, 1, []);
    const cameraForward = camera.getWorldDirection(new Vector3());
    const flattened = new Vector3(cameraForward.x, 0, cameraForward.z).normalize();
    near(flattened.x, directions[0][0]);
    near(flattened.z, directions[0][1]);
    for (const [key, [x, z]] of directions.entries()) {
      let player = createCharacter(world);
      for (let i = 0; i < 100; i++) player = stepCharacter(player, input[key], yaw, world.step, world, []);
      near(player.vx, x * world.movement.walk);
      near(player.vz, z * world.movement.walk);
      near(-Math.sin(player.facing), flattened.x);
      near(-Math.cos(player.facing), flattened.z);
    }
  });
}

for (const [label, pivot] of [['feet', 1], ['center', 0], ['shoulders', -0.7]]) {
  test(`automatic grounding works when the model origin is at its ${label}`, () => {
    const mesh = new Mesh(new BoxGeometry(1, 2, 0.4), new MeshBasicMaterial());
    mesh.position.y = pivot;
    const visual = orientAndGroundModel(mesh, options);
    near(minY(visual), 0);
    near(mesh.position.y, pivot);
    disposeObjects(visual);
  });
}

test('nested negative bounds account for scale, rotation and offset under the movement root', () => {
  const root = new Group(), child = new Group(), movement = new Group();
  const mesh = new Mesh(new BoxGeometry(0.5, 2, 0.25), new MeshBasicMaterial());
  root.position.y = -0.3;
  child.position.set(1, -1.2, 0);
  child.add(mesh);
  root.add(child);
  const visual = orientAndGroundModel(root, {scale: 2, rotation: 90, heightOffset: 0.25});
  movement.add(visual);
  movement.updateMatrixWorld(true);
  const point = child.getWorldPosition(new Vector3());
  near(point.x, 0);
  near(point.z, -2);
  near(minY(movement), 0.25);
  near(movement.position.y, 0);
  near(movement.rotation.y, 0);
  const player = createCharacter(world);
  const walk = stepCharacter(player, input[0], 0, world.step, world, []);
  near(walk.x, player.x);
  assert.ok(walk.z < player.z);
  disposeObjects(movement);
});

test('grounding samples the skinned pose and leaves rig transforms intact', () => {
  const geometry = new BoxGeometry(1, 2, 0.4);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = Float32Array.from({length: count * 4}, (_, i) => Number(i % 4 === 0));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const skin = new SkinnedMesh(geometry, new MeshBasicMaterial());
  const bone = new Bone();
  skin.add(bone);
  skin.updateMatrixWorld(true);
  skin.bind(new Skeleton([bone]));
  bone.position.y = -1.5;
  const visual = orientAndGroundModel(skin, {...options, scale: 2, rotation: 90});
  near(minY(visual), 0);
  near(visual.position.y, 5);
  near(bone.position.y, -1.5);
  assert.equal(skin.skeleton.bones[0], bone);
  disposeObjects(visual);
});

test('placeholder still stands above the floor and empty or invalid bounds yield a useful error', () => {
  const {root} = createPlaceholder();
  root.updateMatrixWorld(true);
  assert.ok(minY(root) >= 0 && minY(root) < 0.03);
  disposeObjects(root);
  assert.throws(() => orientAndGroundModel(new Group(), options), /model bounds are empty or non-finite/);
});
