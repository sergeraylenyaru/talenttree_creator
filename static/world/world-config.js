export const world = {
  halfSize: 12,
  spawn: {x: 0, z: 6},
  dummy: {x: 0, z: -3},
  playerRadius: 0.34,
  playerHeight: 2.1,
  movement: {walk: 3, run: 6, acceleration: 21, braking: 26, gravity: 18, jumpSpeed: 7},
  camera: {minPitch: -0.12, maxPitch: 1.18, minDistance: 2.3, maxDistance: 9, distance: 5, hideAvatarDistance: 0.72},
  step: 1 / 120
};

export const qualities = {
  low: {pixelRatio: 1, shadows: false},
  high: {pixelRatio: 1.75, shadows: true}
};
