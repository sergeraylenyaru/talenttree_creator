import {cameraFraction} from './collision-system.js';

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

export function orbitInput(orbit, delta, config) {
  return {
    yaw: (orbit.yaw - (delta.x || 0) * 0.006) % (Math.PI * 2),
    pitch: clamp(orbit.pitch + (delta.y || 0) * 0.006, config.minPitch, config.maxPitch),
    distance: clamp(orbit.distance * Math.exp((delta.zoom || 0) * 0.001), config.minDistance, config.maxDistance)
  };
}

// The orbit yaw points back from the subject to the camera.
export function horizontalCameraForward(yaw) {
  return {x: -Math.sin(yaw), z: -Math.cos(yaw)};
}

export function placeCamera(camera, target, orbit, previous, dt, obstacles, floor = 0) {
  const {distance = orbit.distance, clearance = orbit.distance} = previous;
  const forward = horizontalCameraForward(orbit.yaw);
  const zoom = distance + (orbit.distance - distance) * (1 - Math.exp(-12 * dt));
  const horizontalDistance = Math.cos(orbit.pitch) * zoom;
  const offset = {
    x: -forward.x * horizontalDistance,
    y: Math.sin(orbit.pitch) * zoom,
    z: -forward.z * horizontalDistance
  };
  const fraction = Math.min(cameraFraction(target, offset, obstacles),
    offset.y < 0 ? (target.y - floor - 0.24) / -offset.y : 1);
  // Pull in immediately to avoid clipping, then ease back once the wall clears.
  const limit = zoom * Math.max(0, fraction);
  const actual = Math.min(limit, clearance + (limit - clearance) * (1 - Math.exp(-9 * dt)));
  const usable = Math.max(0.00001, actual / zoom);
  camera.position.set(target.x + offset.x * usable, target.y + offset.y * usable, target.z + offset.z * usable);
  camera.lookAt(target.x, target.y, target.z);
  camera.updateMatrixWorld();
  return {distance: zoom, clearance: actual, obstructed: fraction < 1};
}

export function bindOrbit(canvas, update, select, signal) {
  let pointer = null;
  canvas.addEventListener('pointerdown', event => {
    if (pointer || event.button !== 0) return;
    canvas.focus({preventScroll: true});
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0};
    canvas.setPointerCapture(event.pointerId);
  }, {signal});
  canvas.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    const x = event.clientX - pointer.x;
    const y = event.clientY - pointer.y;
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: pointer.moved + Math.hypot(x, y)};
    if (pointer.moved > 4) update({x, y});
  }, {signal});
  canvas.addEventListener('pointerup', event => {
    if (pointer?.id !== event.pointerId) return;
    if (pointer.moved <= 4) select(event.clientX, event.clientY);
    pointer = null;
  }, {signal});
  canvas.addEventListener('lostpointercapture', () => { pointer = null; }, {signal});
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    update({zoom: event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY});
  }, {signal, passive: false});
}
