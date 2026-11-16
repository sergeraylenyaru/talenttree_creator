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
  if (!damage.length) return null;
  const range = ability.range || config.meleeRange;
  const kind = !ability.range ? 'melee' : damage.some(effect => effect.trigger === 'onHit') ? 'projectile' : 'instant';
  return {kind, range, school: (damage.find(effect => effect.school !== 'physical') || damage[0]).school};
}

export const facingTarget = (player, target) => Math.atan2(player.x - target.x, player.z - target.z);
export const distanceToTarget = (origin, target) => Math.max(0, length(difference(origin, target.position)) - target.radius);

export function validateAttack(origin, target, profile, obstacles) {
  if (!target) return 'invalidTarget';
  if (!target.alive) return 'dummyDead';
  if (distanceToTarget(origin, target) > profile.range) return 'outOfRange';
  if (cameraFraction(origin, difference(target.position, origin), obstacles, 0) < 1) return 'obstructed';
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

export function createSpatialCombat({player, target, obstacles, animate, face, visuals, config = spatialDefaults}) {
  const flights = new Set();
  const origin = () => {
    const position = player();
    return {...position, y: position.y + config.launchHeight};
  };

  function finish(attack, outcome, position) {
    if (!flights.delete(attack)) return;
    if (attack.visual) visuals.remove(attack.visual);
    attack.resolve(outcome);
    if (position) visuals.impact(position, attack.profile);
  }

  return {
    delivery(ability) {
      const profile = attackProfile(ability, config);
      if (!profile) return null;
      // A cast owns its original selection; deselecting must not redirect it.
      const locked = target();
      const validate = () => validateAttack(origin(), locked?.selected() ? locked.read() : null, profile, obstacles);
      return {
        validate,
        prepare(duration, now) {
          face(locked.read().position);
          animate('spellCast', now + duration);
        },
        launch(now, resolve) {
          const victim = locked.read();
          face(victim.position);
          const {kind} = profile;
          animate(kind === 'melee' ? 'meleeAttack' : profile.school === 'physical' ? 'rangedAttack' : 'spellCast',
            now + (kind === 'melee' ? config.windup + 0.18 : 0.4));
          if (kind === 'instant') {
            resolve('hit');
            visuals.impact(victim.position, profile);
            return;
          }
          const attack = {profile, locked, resolve, start: now, last: now, position: origin()};
          if (kind === 'projectile') {
            const heading = difference(victim.position, attack.position);
            const magnitude = length(heading);
            attack.direction = magnitude ? offset({x: 0, y: 0, z: 0}, heading, 1 / magnitude) : {x: 0, y: 0, z: 0};
            attack.remaining = profile.range + victim.radius + config.projectileRadius;
            attack.visual = visuals.spawn(attack.position, profile, config.projectileScale);
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
          finish(attack, 'miss');
          continue;
        }
        if (profile.kind === 'melee') {
          if (now < attack.start + config.windup) continue;
          const hit = !validateAttack(origin(), victim, profile, obstacles);
          finish(attack, hit ? 'hit' : 'miss', hit ? victim.position : undefined);
          continue;
        }

        const travel = Math.min(attack.remaining, (now - attack.last) * config.projectileSpeed);
        if (travel <= 0) continue;
        const delta = offset({x: 0, y: 0, z: 0}, attack.direction, travel);
        const hit = sphereImpact(attack.position, delta, victim, config.projectileRadius);
        const wall = cameraFraction(attack.position, delta, obstacles, config.projectileRadius);
        if (hit <= wall && hit <= 1) {
          finish(attack, 'hit', offset(attack.position, delta, hit));
        } else if (wall < 1) {
          finish(attack, 'miss', offset(attack.position, delta, wall));
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
