import {moveOnGround, moveVertically} from './collision-system.js';
import {horizontalCameraForward} from './third-person-camera.js';

const approach = (value, target, step) => value + Math.max(-step, Math.min(step, target - value));

export function createCharacter(config) {
  return {...config.spawn, y: config.ground?.y ?? 0, vx: 0, vy: 0, vz: 0, facing: 0, grounded: true, animation: 'idle'};
}

export function stepCharacter(player, input, yaw, dt, config, obstacles) {
  const {walk, run, acceleration, braking, jumpSpeed, gravity} = config.movement;
  const mag = Math.hypot(input.side, input.forward);
  const speed = (input.sprint ? run : walk) / Math.max(1, mag);
  const forward = horizontalCameraForward(yaw);
  // Camera right is forward × world up (+Y).
  const targetX = (input.forward * forward.x - input.side * forward.z) * speed;
  const targetZ = (input.forward * forward.z + input.side * forward.x) * speed;
  const changeX = targetX - player.vx;
  const changeZ = targetZ - player.vz;
  const rate = (mag ? acceleration : braking) * dt;
  const ratio = Math.min(1, rate / (Math.hypot(changeX, changeZ) || 1));
  const vx = player.vx + changeX * ratio;
  const vz = player.vz + changeZ * ratio;
  const horizontal = moveOnGround(player, vx * dt, vz * dt, obstacles, config);
  const dx = horizontal.x - player.x;
  const dz = horizontal.z - player.z;
  const moving = Math.hypot(dx, dz) / dt;
  const desired = moving >= 0.08 ? Math.atan2(-dx, -dz) : player.facing;
  const angle = Math.atan2(Math.sin(desired - player.facing), Math.cos(desired - player.facing));
  const initialVy = input.jump && player.grounded ? jumpSpeed : player.vy;
  const nextY = player.y + initialVy * dt - gravity * dt * dt / 2;
  const {y, grounded, blocked} = moveVertically(horizontal, player.y, nextY, obstacles, config);
  const vy = grounded || blocked ? 0 : initialVy - gravity * dt;
  return {
    ...horizontal, y, vx: dx / dt, vy, vz: dz / dt, grounded,
    facing: approach(0, angle, 12 * dt) + player.facing,
    animation: !grounded ? (vy > 0 ? 'jump' : 'fall') : moving < 0.08 ? 'idle' : moving > walk + 0.2 ? 'run' : 'walk'
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
  return () => {
    const input = {
      side: Number(pressed.has('KeyD')) - Number(pressed.has('KeyA')),
      forward: Number(pressed.has('KeyW')) - Number(pressed.has('KeyS')),
      sprint: pressed.has('ShiftLeft') || pressed.has('ShiftRight'), jump
    };
    jump = false;
    return input;
  };
}
