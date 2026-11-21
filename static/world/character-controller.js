import {moveOnGround, moveVertically} from './collision-system.js';
import {horizontalCameraForward} from './third-person-camera.js';

const approach = (value, target, step) => value + Math.max(-step, Math.min(step, target - value));

export function createCharacter(config) {
  return {...config.spawn, y: config.ground?.y ?? 0, vx: 0, vy: 0, vz: 0, facing: 0, grounded: true, animation: 'idle'};
}

export function stepCharacter(player, input, yaw, dt, config, obstacles) {
  const {walk, run, acceleration, braking, jumpSpeed, gravity} = config.movement;
  const mag = Math.hypot(input.side, input.forward);
  const running = input.sprint && input.forward >= 0;
  const previousSpeed = Math.hypot(player.vx, player.vz);
  const limit = running ? run : walk;
  const speed = approach(mag ? player.motionSpeed ?? previousSpeed : previousSpeed, mag ? limit * Math.min(1, mag) : 0, (mag ? acceleration : braking) * dt);
  const forward = horizontalCameraForward(yaw);
  const vx = mag ? (input.forward * forward.x - input.side * forward.z) * speed / mag
    : player.vx * speed / (previousSpeed || 1);
  const vz = mag ? (input.forward * forward.z + input.side * forward.x) * speed / mag
    : player.vz * speed / (previousSpeed || 1);
  const initialVy = input.jump && player.grounded ? jumpSpeed : player.vy;
  const nextY = player.y + initialVy * dt - gravity * dt * dt / 2;
  const surface = config.collision?.move(player, vx * dt, vz * dt, nextY, initialVy > 0);
  const horizontal = surface ?? moveOnGround(player, vx * dt, vz * dt, obstacles, config);
  const dx = horizontal.x - player.x;
  const dz = horizontal.z - player.z;
  // Depenetration can move the capsule farther than the input requested.
  // It must not turn into velocity on the next simulation step.
  const actualX = surface ? Math.sign(vx) * Math.max(0, Math.min(Math.abs(vx), Math.sign(vx) * dx / dt)) : dx / dt;
  const actualZ = surface ? Math.sign(vz) * Math.max(0, Math.min(Math.abs(vz), Math.sign(vz) * dz / dt)) : dz / dt;
  const moving = Math.hypot(actualX, actualZ);
  const desired = moving < 0.08 ? player.facing : input.forward <= 0 && mag ? yaw : Math.atan2(-actualX, -actualZ);
  const angle = Math.atan2(Math.sin(desired - player.facing), Math.cos(desired - player.facing));
  const {y, grounded, blocked} = surface ?? moveVertically(horizontal, player.y, nextY, obstacles, config);
  const vy = grounded || blocked ? 0 : initialVy - gravity * dt;
  return {
    x: horizontal.x, z: horizontal.z, y, vx: actualX, vy, vz: actualZ, grounded,
    facing: approach(0, angle, 12 * dt) + player.facing, motionSpeed: speed,
    animation: !grounded ? (vy > 0 ? 'jump' : 'fall') : moving < 0.08 ? 'idle' : running ? 'run' : 'walk'
  };
}

const keys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space']);

export function bindMovement(scope, document, window, signal) {
  const pressed = new Set();
  let jump = false;
  function clear() {
    pressed.clear();
    jump = false;
  }
  scope.addEventListener('keydown', event => {
    if (!event.target.matches('canvas') || !keys.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    pressed.add(event.code);
    if (event.code === 'Space' && !event.repeat) jump = true;
  }, {signal});
  window.addEventListener('keyup', event => pressed.delete(event.code), {signal});
  window.addEventListener('blur', clear, {signal});
  document.addEventListener('visibilitychange', clear, {signal});
  scope.addEventListener('focusout', clear, {signal});
  const read = () => {
    const input = {
      side: Number(pressed.has('KeyD')) - Number(pressed.has('KeyA')),
      forward: Number(pressed.has('KeyW')) - Number(pressed.has('KeyS')),
      sprint: !(pressed.has('ShiftLeft') || pressed.has('ShiftRight')), jump
    };
    jump = false;
    return input;
  };
  read.clear=clear;
  return read;
}
