import {targetSide} from '../../combat/attack-rules.js';
import {animationClips, isLocalClip, presentationRange} from '../../combat/presentation.js';
import {isHostileEffect} from '../../combat/workshop-rules.js';
import {cameraFraction} from '../collision-system.js';

export const spatialDefaults = {
  meleeRange: 2, windup: 0.3, projectileSpeed: 10, projectileRadius: 0.12, projectileScale: 0.14,
  launchHeight: 1.25, aimHeight: 1.1
};

const length = vector => Math.hypot(vector.x, vector.y, vector.z);
const difference = (a, b) => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
const offset = (a, b, scale) => ({x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale});
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const crossbowClip = 'clip:AttackCrossbow (ID 840 variation 0)';
const daggerClip = 'clip:Attack1HPierce (ID 85 variation 0)';

export function attackProfile(ability, config = spatialDefaults) {
  const damage = ability.combatEffects.filter(effect => effect.type === 'damage');
  const hostile = ability.combatEffects.some(isHostileEffect);
  const p = ability.presentation ?? (ability.workshop ? {targeting:hostile?'dummy':'self'} : null);
  if (!p) {
    if (!damage.length) {
      if (hostile) return {kind:'instant',range:ability.range||config.meleeRange,targeting:'dummy'};
      if (ability.combatEffects.length) return {kind:'utility',school:ability.combatEffects.some(effect=>effect.type==='healing')?'healing':'defense'};
      return null;
    }
    const range = ability.range || config.meleeRange;
    const kind = !ability.range ? 'melee' : damage.some(effect => effect.trigger === 'onHit') ? 'projectile' : 'instant';
    return {kind, range, school: (damage.find(effect => effect.school !== 'physical') || damage[0]).school};
  }
  const workshop = ability.workshop;
  const zone = ['area','targetArea','ground'].includes(p.targeting);
  const projectile = p.projectile ?? (damage.some(effect => effect.trigger === 'onHit') ? 'straight' : 'none');
  const utility = p.targeting==='self'||(!hostile&&!zone&&p.targeting!=='dummy'&&!(workshop&&projectile!=='none'));
  const melee = !zone && (p.delivery ? p.delivery === 'melee' : !ability.range && (!p.projectile || p.projectile === 'none'));
  const kind = utility ? 'utility' : zone || workshop?.tickInterval ? 'instant' : melee ? 'melee' : projectile === 'none' ? 'instant' : 'projectile';
  return {...p, ...workshop, kind, projectile, range: melee ? Math.min(config.meleeRange, ability.range || config.meleeRange)
    : presentationRange(ability.range, p, 30), school: damage.find(effect => effect.school !== 'physical')?.school ?? damage[0]?.school ??
      (ability.combatEffects.some(effect => effect.type === 'healing') ? 'healing' : p.category)};

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
  const distance = distanceToTarget(origin, target);
  if (distance > profile.range) return 'outOfRange';
  if (distance < (profile.minRange ?? 0)) return 'tooNear';
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


export function createSpatialCombat({displace,animationAvailable, animationFallback, projectileOrigin, autoAnimate, player, target,
  areaTarget, obstacles, occlusion, animate, face, visuals, move, stopAnimation, config = spatialDefaults}) {
  const flights = new Set();
  let phase;
  const origin = () => {
    const position = player();
    return {...position, y: position.y + config.launchHeight};
  };

  function impactPosition(profile, position, victim) {
    if (profile.impactAnchor==='caster')return origin();
    if (profile.impactAnchor==='target'&&victim)return victim.position;
    if (profile.impactAnchor==='ground')return {...position,y:victim?.bounds?.min[1]??player().y};
    return position;
  }

  function finish(attack, outcome, position, reason) {
    if (!flights.delete(attack)) return;
    if (attack.visual) visuals.remove(attack.visual);
    if (position) {
      const contact=outcome==='hit'?impactPosition(attack.profile,position,attack.locked.read()):position;
      attack.impactPosition = contact;
      visuals.impact(contact, outcome === 'miss' ? {...attack.profile, effectPreset:undefined, impact: 'melee'} : attack.profile);
    }
    if (outcome === 'hit') visuals.sound?.(attack.profile.impactSound, attack.profile);
    attack.resolve(outcome, reason);
  }

  function trace(attack, delta, victim) {
    const padding=attack.profile.collisionRadius??config.projectileRadius;
    const hit=sweptTargetImpact(attack.position,delta,victim,padding);
    const wall=Math.min(cameraFraction(attack.position,delta,obstacles,padding),
      occlusion?.(attack.position,delta,0)??1);
    if(hit<=wall&&hit<=1)finish(attack,'hit',offset(attack.position,delta,hit));
    else if(wall<1)finish(attack,'miss',offset(attack.position,delta,wall),'obstructed');
    else{
      attack.position=offset(attack.position,delta,1);
      visuals.move(attack.visual,attack.position);
    }
  }

  return {
    delivery(ability, groundPoint) {
      const profile = attackProfile(ability, config);
      if (profile && ['staff','wand'].includes(ability.weaponType)) {
        for (const field of ['attackAnimation','animation','castingAnimation','startAnimation','finishAnimation']) {
          const clip=profile[field];
          if (clip!=='bow' && clip!=='clip:'+animationClips.bow && clip!==crossbowClip) continue;
          animationFallback?.(clip==='bow'?animationClips.bow:clip.slice(5),animationClips.cast);
          profile[field]='cast';
        }
      }
      if (!profile) return null;
      if (profile.sound || Object.keys(ability.workshop ?? {}).some(key => key.endsWith('Sound'))) visuals.prepareSound?.();
      const utility = profile.kind === 'utility';
      const forwardShot = profile.projectile === 'straight' && profile.flightDirection === 'forward';
      const self = utility && profile.targeting !== 'dummy';
      const area = profile.targeting === 'area';
      const ground = profile.targeting === 'ground';
      const zone = area || ground || profile.targeting === 'targetArea';
      const locked = area || ground ? areaTarget?.() : self ? null : target();
      const turnToTarget = !area && !ground && !forwardShot;
      const inFront = point => Math.cos(player().facing - facingTarget(player(), point)) >= .5;
      function validate() {
        if (self&&ability.combatEffects.some(isHostileEffect)) return 'invalidTarget';
        if (self) return;
        if (ground) {
          if (!groundPoint) return 'groundTarget';
          // Aim above the clicked floor to avoid treating the floor as a wall.
          const point = {...groundPoint, y: groundPoint.y + .15};
          const rejection = validateAttack(origin(), {position: point, alive: true, radius: 0}, profile, obstacles, occlusion);
          return rejection || (profile.facing && !inFront(point) ? 'facing' : undefined);
        }
        if (area && ability.workshop) return;
        const victim = area || locked?.selected() ? locked?.read() : null;
        const rejection = validateAttack(origin(), victim, profile, obstacles, occlusion);
        if (rejection) return rejection;
        if (profile.facing && !inFront(victim.position)) return 'facing';
      }
      function zoneImpact(victim) {
        const center = ground ? groundPoint : area ? player() : victim.position;
        visuals.impact(impactPosition(profile,center,victim),{...profile,area:true});
        if (!victim?.alive) return false;
        const from = area ? origin() : {...center, y: center.y + (ground ? .2 : 0)};
        if (area && profile.areaShape === 'cone' &&
            Math.cos(player().facing - facingTarget(player(), victim.position)) < Math.cos(Math.PI / 4)) return false;
        return !validateAttack(from, victim, {range: profile.radius ?? profile.range}, obstacles, occlusion);
      }
      const windup = config.windup + 0.18;
      const pose = (state, now, duration, key) => {
        if (key === 'none') { stopAnimation?.(); return; }
        const requested = isLocalClip(key) ? key.slice(5) : animationClips[key] ?? key;
        const substitute = {meleeAttack:animationClips.sword,rangedAttack:animationClips.bow,
          spellCast:animationClips.cast,channel:animationClips.channel}[state];
        const missing=requested&&animationAvailable&&!animationAvailable(requested);
        const clip=missing?(animationAvailable(substitute)?substitute:undefined):requested;
        if(missing)animationFallback?.(requested,clip??'default');
        animate(state, now + duration, clip, state === 'channel' || profile.loopAnimation,
          state === 'meleeAttack' ? duration : undefined, profile);
      };
      let launch;
      return {
        combatContext(){const victim=locked?.read();return victim?{position:targetSide(player(),victim),distance:distanceToTarget(origin(),victim),geometry:true}:{};},
        displace:(target,amount)=>displace?.(target,amount),
        utility, validate, ground, projectile: profile.kind === 'projectile',
        placeZone() { return visuals.zone?.(groundPoint,profile); },
        sound(id) { visuals.sound?.(id, profile); },
        pulse() {
          const victim = locked?.read();
          if (zone) return zoneImpact(victim);
          visuals.impact(victim?.position ?? origin(), profile);
          return true;
        },
        autoPose(now, duration) {
          if (profile.kind !== 'projectile') autoAnimate?.(locked.read().position, now + duration, duration);
        },
        autoContact() {
          if (validate()) return false;
          if (profile.kind === 'projectile') return true;
          launch = {impactPosition: locked.read().position};
          visuals.impact(launch.impactPosition, profile);
          return true;
        },
        cancel() {phase=undefined;stopAnimation?.();},
        prepare(duration, now) {
          if (locked && turnToTarget && locked.read()) face(locked.read().position);
          else if (self) face(null);
          if (profile.casterEffect) visuals.impact(origin(), {...profile, effectPreset:undefined, impact:profile.casterEffect});
          phase=undefined;
          const cast=profile.castingAnimation??profile.animation;
          if(profile.startAnimation&&profile.startAnimation!=='none'&&duration>.35){
            pose('spellCast',now,.18,profile.startAnimation);
            phase={at:now+.18,play:()=>pose('spellCast',now+.18,duration-.18,cast)};
          }else pose('spellCast',now,duration,cast);
        },
        channel(duration, now) {
          phase=undefined;
          if (locked && turnToTarget && locked.read()) face(locked.read().position);
          else if (self) face(null);
          const castingAnimation = profile.castingAnimation;
          pose('channel', now, duration, !castingAnimation || castingAnimation === 'cast' ? 'channel' : castingAnimation);
        },
        critical() {
          visuals.sound?.(profile.criticalSound,profile);
          if (launch?.impactPosition) visuals.impact(launch.impactPosition, {...profile, critical: true});
        },
        launch(now, resolve) {
          const victim = locked?.read();
          if (victim && turnToTarget) face(victim.position);
          else if (self) face(null);
          const {kind} = profile;
          const state = kind==='melee'?'meleeAttack':profile.school==='physical'&&!['staff','wand'].includes(ability.weaponType)?'rangedAttack':'spellCast';
          const release=kind==='melee'?windup:.4;
          let action=profile.attackAnimation??profile.animation??profile.castingAnimation;
          if (kind==='melee' && (!action||action==='sword')) {
            action={sword2:'twoHand',staff:'twoHand',dagger:daggerClip}[ability.weaponType]??action;
          }
          if (state==='rangedAttack' && (!action||action==='bow') && ability.weaponType==='crossbow') action=crossbowClip;
          pose(state,now,release,action);
          phase=profile.finishAnimation?{at:now+release,play:()=>pose(state,now+release,.3,profile.finishAnimation)}:undefined;
          visuals.sound?.(profile.launchSound ?? profile.sound, profile);
          if (profile.casterEffect && !ability.cast) visuals.impact(origin(), {...profile,effectPreset:undefined,impact:profile.casterEffect});
          if (profile.weaponEffect) visuals.weapon?.({...profile,effectPreset:undefined,impact:profile.weaponEffect});
          if (utility) {
            if (profile.category === 'movement') move?.();
            launch={impactPosition:impactPosition(profile,origin())};
            visuals.impact(launch.impactPosition,profile);
            return;
          }
          const attack = {profile, locked, resolve, start: now, last: now, position: origin()};
          launch = attack;
          if (kind === 'instant') {
            attack.impactPosition = victim&&impactPosition(profile,victim.position,victim);
            const hit = zone ? zoneImpact(victim) : Boolean(victim?.alive);
            if (!zone && hit) visuals.impact(attack.impactPosition, profile);
            if (hit) visuals.sound?.(profile.impactSound, profile);
            resolve(hit ? 'hit' : 'miss', hit ? undefined : 'outOfRange');
            return;
          }
          if (kind === 'projectile') {
            if(profile.projectileOrigin&&profile.projectileOrigin!=='caster'){
              attack.position=projectileOrigin?.(profile.projectileOrigin)??attack.position;
            }
            const heading = difference(victim.position, attack.position);
            if (forwardShot) {
              const horizontal = Math.hypot(heading.x,heading.z);
              heading.x = -Math.sin(player().facing) * horizontal;
              heading.z = -Math.cos(player().facing) * horizontal;
            }
            const magnitude = length(heading);
            attack.direction = magnitude ? offset({x: 0, y: 0, z: 0}, heading, 1 / magnitude) : {x: 0, y: 0, z: 0};
            attack.remaining = magnitude + Math.max(0, profile.range - distanceToTarget(attack.position, victim)) +
              (profile.collisionRadius ?? config.projectileRadius);
            if(profile.trajectory==='arc'&&profile.projectile==='straight'&&magnitude>0){
              attack.arc={start:attack.position,distance:magnitude,height:profile.arcHeight??1.2,travelled:0};
              attack.remaining=Math.min(attack.remaining,magnitude+1);
            }
            const projectileVisual={...profile,effectPreset:profile.projectilePreset,
              impact:profile.projectileEffect??profile.impact};
            attack.visual = visuals.spawn(attack.position,projectileVisual,profile.projectileSize??config.projectileScale,attack.direction);
          }
          flights.add(attack);
        }
      };
    },
    nextEvent(){
      return Math.min(phase?.at??Infinity,...[...flights].map(attack=>attack.profile.kind==='melee'?attack.start+config.windup:
        Math.min(attack.last+1/120,attack.start+(attack.profile.projectileLifetime??Infinity))));
    },
    update(now) {
      if(phase&&now>=phase.at){const cue=phase;phase=undefined;cue.play();}
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

        const dt = Math.min(now, attack.start + (profile.projectileLifetime ?? Infinity)) - attack.last;
        const travel = Math.min(attack.remaining, dt * (profile.projectileSpeed ?? config.projectileSpeed));
        if (travel <= 0) {
          if (now >= attack.start + (profile.projectileLifetime ?? Infinity)) finish(attack, 'miss');
          continue;
        }
        if (profile.projectile === 'homing') {
          const heading = difference(victim.position, attack.position);
          if (length(heading)) {
            const desired = offset({x: 0, y: 0, z: 0}, heading, 1 / length(heading));
            const angle = Math.acos(Math.max(-1, Math.min(1, dot(attack.direction, desired))));
            const mix = angle ? Math.min(1, dt * (profile.homingStrength ?? Infinity) / angle) : 1;
            attack.direction = offset(attack.direction, difference(desired, attack.direction), mix);
            const magnitude = length(attack.direction);
            attack.direction = magnitude ? offset({x: 0, y: 0, z: 0}, attack.direction, 1 / magnitude) : desired;
          }
        }
        if(attack.arc){
          const arc=attack.arc;
          let left=travel;
          while(left>1e-8&&flights.has(attack)){
            const segment=Math.min(left,.5);
            arc.travelled+=segment;
            const progress=Math.min(1,arc.travelled/arc.distance);
            const next=offset(arc.start,attack.direction,arc.travelled);
            next.y+=4*arc.height*progress*(1-progress);
            trace(attack,difference(next,attack.position),victim);
            left-=segment;
          }
        }else trace(attack,offset({x:0,y:0,z:0},attack.direction,travel),victim);
        if(!flights.has(attack))continue;
        attack.last=now;
        attack.remaining-=travel;
        if(attack.remaining<=0||now>=attack.start+(profile.projectileLifetime??Infinity))finish(attack,'miss');
      }
    },
    clear() {
      phase=undefined;
      for (const attack of flights) finish(attack, 'miss');
    },
    snapshot() {
      return [...flights].map(({profile, position}) => ({kind: profile.kind, position: {...position}}));
    }
  };
}
