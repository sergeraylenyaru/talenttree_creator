import {animationClips, presentationRange} from '../../combat/presentation.js';
import {cameraFraction} from '../collision-system.js';

export const spatialDefaults = {
  meleeRange: 2, windup: 0.3, projectileSpeed: 10, projectileRadius: 0.12, projectileScale: 0.14,
  launchHeight: 1.25, aimHeight: 1.1
};

const length = vector => Math.hypot(vector.x, vector.y, vector.z);
const difference = (a, b) => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
const offset = (a, b, scale) => ({x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale});
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

export function attackProfile(ability, config = spatialDefaults) {
  const damage = ability.combatEffects.filter(effect => effect.type === 'damage');
  const p = ability.presentation;
  if (!p) {
    if (!damage.length) return ability.combatEffects.some(effect => effect.type === 'healing') ? {kind: 'utility', school: 'healing'} : null;
    const range = ability.range || config.meleeRange;
    const kind = !ability.range ? 'melee' : damage.some(effect => effect.trigger === 'onHit') ? 'projectile' : 'instant';
    return {kind, range, school: (damage.find(effect => effect.school !== 'physical') || damage[0]).school};
  }
  if (!damage.length) return {...p, kind: 'utility', range: presentationRange(ability.range, p, config.meleeRange),
    school: ability.combatEffects.some(effect => effect.type === 'healing') ? 'healing' : p.category};
  const melee = p.delivery ? p.delivery === 'melee' : !ability.range && (!p.projectile || p.projectile === 'none') && p.targeting !== 'area';
  const projectile = p.projectile ?? (damage.some(effect => effect.trigger === 'onHit') ? 'straight' : 'none');
  const kind = melee ? 'melee' : projectile === 'none' || p.targeting === 'area' ? 'instant' : 'projectile';
  return {...p, kind, projectile, range: melee ? Math.min(config.meleeRange, ability.range || config.meleeRange) : presentationRange(ability.range, p, 30),
    school: (damage.find(effect => effect.school !== 'physical') || damage[0]).school};
}

export const facingTarget = (player, target) => Math.atan2(player.x - target.x, player.z - target.z);
export function distanceToTarget(origin, target) {
  if (!target.bounds) return Math.max(0, length(difference(origin, target.position)) - target.radius);
  const {min, max} = target.bounds;
  const gap = (value, axis) => Math.max(0, min[axis] - value, value - max[axis]);
  return Math.hypot(gap(origin.x, 0), gap(origin.y, 1), gap(origin.z, 2));
}

export function validateAttack(origin, target, profile, obstacles, occlusion) {
  if (!target) return 'invalidTarget';
  if (!target.alive) return 'dummyDead';
  if (distanceToTarget(origin, target) > profile.range) return 'outOfRange';
  if (Math.min(cameraFraction(origin, difference(target.position, origin), obstacles, 0),
      occlusion?.(origin, difference(target.position, origin), 0) ?? 1) < 1) return 'obstructed';
}

export function sphereImpact(origin, delta, target, padding = 0) {
  const relative = difference(origin, target.position);
  const c = dot(relative, relative) - (target.radius + padding) ** 2;
  if (c <= 0) return 0;
  const a = dot(delta, delta);
  const b = dot(relative, delta);
  const determinant = b * b - a * c;
  if (!a || b >= 0 || determinant < 0) return Infinity;
  const fraction = (-b - Math.sqrt(determinant)) / a;
  return fraction <= 1 ? fraction : Infinity;
}

export function sweptTargetImpact(origin, delta, target, padding) {
  if (!target.bounds) return sphereImpact(origin, delta, target, padding);
  const fraction = cameraFraction(origin, delta, [{
    minX: target.bounds.min[0], maxX: target.bounds.max[0],
    minY: target.bounds.min[1], maxY: target.bounds.max[1],
    minZ: target.bounds.min[2], maxZ: target.bounds.max[2]
  }], padding);
  if (fraction < 1) return fraction;
  return ['x', 'y', 'z'].every((axis, i) => {
    const end = origin[axis] + delta[axis];
    return end >= target.bounds.min[i] - padding && end <= target.bounds.max[i] + padding;
  }) ? 1 : Infinity;
}


export function createSpatialCombat({autoAnimate, player, target, areaTarget, obstacles, occlusion, animate, face, visuals, move, stopAnimation, config = spatialDefaults}) {
  const flights = new Set();
  const origin = () => {
    const position = player();
    return {...position, y: position.y + config.launchHeight};
  };

  function finish(attack, outcome, position, reason) {
    if (!flights.delete(attack)) return;
    if (attack.visual) visuals.remove(attack.visual);
    if (position) {
      attack.impactPosition = position;
      visuals.impact(position, outcome === 'miss' ? {...attack.profile, impact: 'melee'} : attack.profile);
    }
    attack.resolve(outcome, reason);
  }

  return {
    delivery(ability) {
      const profile = attackProfile(ability, config);
      if (!profile) return null;
      if (profile.sound) visuals.prepareSound?.();
      const utility = profile.kind === 'utility';
      const self = utility && profile.targeting !== 'dummy' && profile.targeting !== 'area';
      const area = profile.targeting === 'area';
      // A selected cast owns its original target; area casts use the only arena opponent.
      const locked = area ? areaTarget?.() : self ? null : target();
      const validate = () => !utility && profile.targeting === 'self' ? 'invalidTarget' : self ? undefined
        : validateAttack(origin(), area || locked?.selected() ? locked?.read() : null, profile, obstacles, occlusion);
      const windup = config.windup + 0.18;
      const pose = (state, now, duration, key) => animate(state, now + duration,
        animationClips[key], state === 'channel', state === 'meleeAttack' ? duration : undefined);
      let launch;
      return {
        utility, validate, projectile: profile.kind === 'projectile',
        autoPose(now, duration) {
          autoAnimate?.(locked.read().position, now + duration, duration);
        },
        autoContact() {
          if (validate()) return false;
          launch = {impactPosition: locked.read().position};
          visuals.impact(launch.impactPosition, profile);
          return true;
        },
        cancel: stopAnimation,
        prepare(duration, now) {
          if (locked) face(locked.read().position);
          else if (self) face(null);
          pose('spellCast', now, duration, profile.castingAnimation ?? profile.animation);
        },
        channel(duration, now) {
          if (locked) face(locked.read().position);
          else if (self) face(null);
          pose('channel', now, duration, 'channel');
        },
        critical() {
          if (launch?.impactPosition) visuals.impact(launch.impactPosition, {...profile, critical: true});
        },
        launch(now, resolve) {
          const victim = locked?.read();
          if (victim) face(victim.position);
          else if (self) face(null);
          const {kind} = profile;
          const state = kind === 'melee' ? 'meleeAttack' : profile.school === 'physical' ? 'rangedAttack' : 'spellCast';
          pose(state, now, kind === 'melee' ? windup : 0.4, profile.attackAnimation ?? profile.animation ?? profile.castingAnimation);
          visuals.sound?.(profile.sound);
          if (utility) {
            if (profile.category === 'movement') move?.();
            visuals.impact(origin(), profile);
            return;
          }
          const attack = {profile, locked, resolve, start: now, last: now, position: origin()};
          launch = attack;
          if (kind === 'instant') {
            if (area) visuals.impact({...player()}, {...profile, area: true});
            attack.impactPosition = victim.position;
            visuals.impact(victim.position, profile);
            resolve('hit');
            return;
          }
          if (kind === 'projectile') {
            const heading = difference(victim.position, attack.position);
            const magnitude = length(heading);
            attack.direction = magnitude ? offset({x: 0, y: 0, z: 0}, heading, 1 / magnitude) : {x: 0, y: 0, z: 0};
            attack.remaining = magnitude + Math.max(0, profile.range - distanceToTarget(attack.position, victim)) +
              config.projectileRadius;
            attack.visual = visuals.spawn(attack.position, profile, config.projectileScale, attack.direction);
          }
          flights.add(attack);
        }
      };
    },
    update(now) {
      for (const attack of flights) {
        const {profile, locked} = attack;
        const victim = locked.read();
        if (!victim?.alive) {
          finish(attack, 'miss', undefined, 'dummyDead');
          continue;
        }
        if (profile.kind === 'melee') {
          if (now < attack.start + config.windup) continue;
          const reason = validateAttack(origin(), victim, profile, obstacles, occlusion);
          finish(attack, reason ? 'miss' : 'hit', reason ? undefined : victim.position, reason);
          continue;
        }

        const travel = Math.min(attack.remaining, (now - attack.last) * (profile.projectileSpeed ?? config.projectileSpeed));
        if (travel <= 0) continue;
        if (profile.projectile === 'homing') {
          const heading = difference(victim.position, attack.position);
          if (length(heading)) attack.direction = offset({x: 0, y: 0, z: 0}, heading, 1 / length(heading));
        }
        const delta = offset({x: 0, y: 0, z: 0}, attack.direction, travel);
        const hit = sweptTargetImpact(attack.position, delta, victim, config.projectileRadius);
        const wall = Math.min(cameraFraction(attack.position, delta, obstacles, config.projectileRadius),
          occlusion?.(attack.position, delta, 0) ?? 1);
        if (hit <= wall && hit <= 1) {
          finish(attack, 'hit', offset(attack.position, delta, hit));
        } else if (wall < 1) {
          finish(attack, 'miss', offset(attack.position, delta, wall), 'obstructed');
        } else {
          attack.position = offset(attack.position, delta, 1);
          attack.last = now;
          attack.remaining -= travel;
          visuals.move(attack.visual, attack.position);
          if (attack.remaining <= 0) finish(attack, 'miss');
        }
      }
    },
    clear() {
      for (const attack of flights) finish(attack, 'miss');
    },
    snapshot() {
      return [...flights].map(({profile, position}) => ({kind: profile.kind, position: {...position}}));
    }
  };
}
