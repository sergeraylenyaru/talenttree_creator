export function box(x, z, width, depth, height) {
  return {minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2,
    maxZ: z + depth / 2, minY: 0, maxY: height};
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function moveOnGround(player, dx, dz, obstacles, config) {
  const {playerRadius: radius, playerHeight = 2.1, halfSize} = config;
  const limit = halfSize - radius;
  const position = {x: player.x, z: player.z};
  for (const [axis, other, min, max, otherMin, otherMax, delta] of [
    ['x', 'z', 'minX', 'maxX', 'minZ', 'maxZ', dx],
    ['z', 'x', 'minZ', 'maxZ', 'minX', 'maxX', dz]
  ]) {
    const start = position[axis];
    const region = config.ground;
    let end = region ? clamp(start + delta, region[min] + radius, region[max] - radius)
      : clamp(start + delta, -limit, limit);
    for (const obstacle of obstacles) {
      if (player.y >= obstacle.maxY || player.y + playerHeight <= obstacle.minY) continue;
      if (position[other] <= obstacle[otherMin] - radius || position[other] >= obstacle[otherMax] + radius) continue;
      const lower = obstacle[min] - radius;
      const upper = obstacle[max] + radius;
      if (delta > 0 && start <= lower && end > lower) end = lower;
      if (delta < 0 && start >= upper && end < upper) end = upper;
    }
    position[axis] = end;
  }
  return position;
}

export function moveVertically(position, start, end, obstacles, config) {
  const {playerRadius: radius, playerHeight = 2.1} = config;
  const descending = end <= start;
  const floor = config.ground?.y ?? 0;
  let y = Math.max(floor, end);
  let grounded = descending && end <= floor;
  for (const box of obstacles) {
    if (position.x <= box.minX - radius || position.x >= box.maxX + radius ||
        position.z <= box.minZ - radius || position.z >= box.maxZ + radius) continue;
    const ceiling = box.minY - playerHeight;
    if (descending && start >= box.maxY && y <= box.maxY) {
      y = box.maxY;
      grounded = true;
    } else if (!descending && start <= ceiling && y > ceiling) {
      y = ceiling;
    }
  }
  return {y, grounded, blocked: y !== end};
}

export function cameraFraction(origin, offset, obstacles, padding = 0.18) {
  let fraction = 1;
  for (const obstacle of obstacles) {
    let near = 0;
    let far = fraction;
    for (const [axis, min, max] of [['x', 'minX', 'maxX'], ['y', 'minY', 'maxY'], ['z', 'minZ', 'maxZ']]) {
      const low = obstacle[min] - padding - origin[axis];
      const high = obstacle[max] + padding - origin[axis];
      const delta = offset[axis];
      if (Math.abs(delta) < 1e-8) {
        if (low > 0 || high < 0) far = -1;
        continue;
      }
      const a = low / delta;
      const b = high / delta;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
    }
    if (near <= far) fraction = near;
  }
  return fraction;
}
