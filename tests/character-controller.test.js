import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMovement, createCharacter, stepCharacter} from '../static/world/character-controller.js';
import {box, cameraFraction} from '../static/world/collision-system.js';
import {orbitInput, placeCamera} from '../static/world/third-person-camera.js';
import {world} from '../static/world/world-config.js';

const walk = {forward: 1, side: 0};
function simulate(input, seconds, {yaw = 0, dt = world.step, obstacles = []} = {}) {
  let player = createCharacter(world);
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    player = stepCharacter(player, {...input, jump: i === 0 && input.jump}, yaw, dt, world, obstacles);
  }
  return player;
}

test('movement is camera-relative and normalizes diagonal input', () => {
  const north = simulate(walk, 1);
  const west = simulate(walk, 1, {yaw: Math.PI / 2});
  assert.ok(north.z < world.spawn.z && Math.abs(north.x) < 1e-9);
  assert.ok(west.x < 0 && Math.abs(west.z - world.spawn.z) < 1e-9);
  const diagonal = simulate({...walk, side: 1}, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.vx, diagonal.vz) - world.movement.walk) < 1e-9);
});

test('acceleration stays consistent over time and sprint is faster', () => {
  const a = simulate(walk, 1, {dt: 1 / 60});
  const b = simulate(walk, 1, {dt: 1 / 144});
  assert.ok(Math.abs(a.z - b.z) < 0.03);
  const run = simulate({...walk, sprint: true}, 1);
  assert.ok(run.z < a.z - 2);
  assert.equal(run.animation, 'run');
});

test('jump rises, falls, lands and does not double jump', () => {
  const start = stepCharacter(createCharacter(world), {forward: 0, side: 0, jump: true}, 0, 0.1, world, []);
  assert.equal(start.animation, 'jump');
  assert.ok(start.y > 0);
  const attempted = stepCharacter(start, {forward: 0, side: 0, jump: true}, 0, 0.1, world, []);
  assert.ok(attempted.vy < start.vy);
  assert.equal(simulate({forward: 0, side: 0, jump: true}, 0.5).animation, 'fall');
  const landed = simulate({forward: 0, side: 0, jump: true}, 1);
  assert.equal(landed.y, 0);
  assert.equal(landed.vy, 0);
  assert.equal(landed.grounded, true);
});

test('the character stops at a dummy and the arena boundary', () => {
  const obstacle = box(0, 2, 1, 1, 2);
  const blocked = simulate(walk, 10, {obstacles: [obstacle]});
  assert.equal(blocked.z, 2.5 + world.playerRadius);
  const edge = simulate({...walk, sprint: true}, 10);
  assert.equal(edge.z, -(world.halfSize - world.playerRadius));
});

test('camera clamps pitch and zoom and clips before an obstacle', () => {
  const orbit = orbitInput({yaw: 0, pitch: 0, distance: 5}, {x: 20, y: 999, zoom: -9999}, world.camera);
  assert.equal(orbit.pitch, world.camera.maxPitch);
  assert.equal(orbit.distance, world.camera.minDistance);
  assert.ok(orbit.yaw < 0);
  const other = orbitInput(orbit, {y: -999, zoom: 9999}, world.camera);
  assert.equal(other.pitch, world.camera.minPitch);
  assert.equal(other.distance, world.camera.maxDistance);
  assert.equal(cameraFraction({x: 0, y: 1, z: 0}, {x: 0, y: 0, z: 5}, [box(0, 3, 2, 1, 2)], 0), 0.5);
});

test('movement clears on blur and disposal removes handlers when the canvas is reused', () => {
  class Canvas extends EventTarget { matches(selector) { return selector === 'canvas'; } }
  const canvas = new Canvas(), document = new EventTarget(), window = new EventTarget();
  const key = code => Object.assign(new Event('keydown', {cancelable: true}), {code});
  const first = new AbortController();
  const read = bindMovement(canvas, document, window, first.signal);
  canvas.dispatchEvent(key('KeyW'));
  assert.equal(read().forward, 1);
  window.dispatchEvent(new Event('blur'));
  assert.equal(read().forward, 0);
  first.abort();
  const second = new AbortController();
  const readAgain = bindMovement(canvas, document, window, second.signal);
  canvas.dispatchEvent(key('Space'));
  assert.equal(read().jump, false);
  assert.equal(readAgain().jump, true);
  assert.equal(readAgain().jump, false);
  second.abort();
});

test('jumping clears low obstacles but respects ceilings and lands on raised surfaces', () => {
  const step = box(0, 4, 2, 0.4, 0.55);
  const jumping = simulate({...walk, jump: true}, 1, {obstacles: [step]});
  assert.ok(jumping.z < step.minZ - world.playerRadius);
  const underRoof = {...box(0, 6, 2, 2, 4), minY: 2.4};
  const bumped = simulate({forward: 0, side: 0, jump: true}, 0.1, {dt: 0.1, obstacles: [underRoof]});
  assert.equal(bumped.y, underRoof.minY - world.playerHeight);
  assert.ok(bumped.vy <= 0);
  const airborne = {...createCharacter(world), y: 1, vy: -3, grounded: false};
  const platform = box(0, 6, 2, 2, 0.75);
  const landed = stepCharacter(airborne, {side: 0, forward: 0}, 0, 0.1, world, [platform]);
  assert.equal(landed.y, platform.maxY);
  assert.equal(landed.grounded, true);
});

test('separate wall volumes leave a doorway and the player slides along the jamb', () => {
  const walls = [box(-2, 4, 2, 0.4, 3), box(2, 4, 2, 0.4, 3)];
  assert.ok(simulate(walk, 1.2, {obstacles: walls}).z < 3.8);
  let player = {...createCharacter(world), x: -1.7};
  const blocked = 4.2 + world.playerRadius;
  for (let i = 0; i < 120; i++) player = stepCharacter(player, walk, 0, world.step, world, walls);
  assert.ok(Math.abs(player.z - blocked) < 1e-8);
  for (let i = 0; i < 160; i++) {
    player = stepCharacter(player, {...walk, side: 1}, 0, world.step, world, walls);
  }
  assert.ok(player.z < 3.8);
});

test('camera retracts at once and eases out after a wall clears', () => {
  const camera = {position: {set() {}}, lookAt() {}, updateMatrixWorld() {}};
  const target = {x: 0, y: 1, z: 0};
  const orbit = {yaw: 0, pitch: 0, distance: 5};
  const blocked = placeCamera(camera, target, orbit, {distance: 5, clearance: 5}, 1 / 60, [box(0, 3, 2, 1, 3)]);
  assert.equal(blocked.obstructed, true);
  assert.ok(blocked.clearance < 2.5);
  const clear = placeCamera(camera, target, orbit, blocked, 1 / 60, []);
  assert.equal(clear.obstructed, false);
  assert.ok(clear.clearance > blocked.clearance && clear.clearance < 5);
});

test('full forward speed survives a 360-degree turn and a change to diagonal input', () => {
  let player = simulate({...walk, sprint: true}, 0.5);
  for (let step = 1; step <= 120; step++) {
    player = stepCharacter(player, {...walk, sprint: true, side: Number(step > 40)}, step * Math.PI / 60,
      world.step, world, []);
    assert.ok(Math.abs(Math.hypot(player.vx, player.vz) - world.movement.run) < 1e-9);
  }
  const back = simulate({forward: -1, side: 0, sprint: true}, 1);
  assert.equal(back.animation, 'walk');
  assert.equal(back.facing, 0);
  assert.ok(Math.abs(back.vz - world.movement.walk) < 1e-9);
});
