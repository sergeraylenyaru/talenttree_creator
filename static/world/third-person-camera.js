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

export function placeCamera(camera, target, orbit, previous, dt, obstacles, floor = 0, collision) {
  const {distance = orbit.distance, clearance = orbit.distance} = previous;
  const forward = horizontalCameraForward(orbit.yaw);
  const zoom = distance + (orbit.distance - distance) * (1 - Math.exp(-12 * dt));
  const horizontalDistance = Math.cos(orbit.pitch) * zoom;
  const offset = {
    x: -forward.x * horizontalDistance,
    y: Math.sin(orbit.pitch) * zoom,
    z: -forward.z * horizontalDistance
  };
  const fraction = Math.min(cameraFraction(target, offset, obstacles), collision?.fraction(target, offset) ?? 1,
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

export function bindOrbit(canvas, update, select, signal, enabled=()=>true) {
  const surface = canvas.parentElement;
  const isArena = event => event.target === canvas || event.target.closest?.('.tg-world-target');
  const options = {signal};
  let pointer;
  const inside = ({clientX, clientY}) => {
    const bounds = canvas.getBoundingClientRect();
    return clientX >= bounds.left && clientX < bounds.right && clientY >= bounds.top && clientY < bounds.bottom;
  };

  function release() {
    if (!pointer) return;
    const {id} = pointer;
    pointer = undefined;
    surface.classList.remove('tg-orbit-held');
    if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
  }

  surface.addEventListener('pointerdown', event => {
    if (!enabled() || pointer || !isArena(event) || ![0, 2].includes(event.button)) return;
    canvas.focus({preventScroll: true});
    pointer = {id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY,
      marker: event.target !== canvas, dragged: false, touch: event.pointerType === 'touch'};
    if (event.button === 2) {
      event.preventDefault();
      surface.classList.add('tg-orbit-held');
    }
    if (event.button === 2 || pointer.touch) surface.setPointerCapture(event.pointerId);
  }, options);
  surface.addEventListener('pointermove', event => {
    if(!enabled()){release();return;}
    if (pointer?.id !== event.pointerId) return;
    if (!inside(event)) {
      release();
      return;
    }
    const x = event.clientX - pointer.x;
    const y = event.clientY - pointer.y;
    if (!pointer.dragged && Math.hypot(x, y) <= 4) return;
    pointer.dragged = true;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointer.button === 2 || pointer.touch) update({x, y});
  }, options);
  window.addEventListener('pointerup', event => {
    if(!enabled()){release();return;}
    if (pointer?.id !== event.pointerId || pointer.button !== event.button) return;
    const {dragged, button, marker, touch} = pointer;
    release();
    if (!dragged && inside(event) && (button === 2 || touch || isArena(event))) {
      select(event.clientX, event.clientY, button === 2, marker);
    }
  }, options);
  for (const name of ['lostpointercapture', 'pointercancel', 'pointerleave']) surface.addEventListener(name, release, options);
  window.addEventListener('blur', release, options);
  document.addEventListener('visibilitychange', release, options);
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || pointer?.button !== 2) return;
    release();
    event.preventDefault();
    event.stopPropagation();
  }, {...options, capture: true});
  signal.addEventListener('abort', release, {once: true});
  surface.addEventListener('contextmenu', event => {
    if (isArena(event) || event.target === surface || pointer) event.preventDefault();
  }, options);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if(!enabled())return;
    update({zoom: event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY});
  }, {signal, passive: false});
  return {clear:release};
}
