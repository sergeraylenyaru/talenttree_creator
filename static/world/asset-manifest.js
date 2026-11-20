export const assetRoot = '/local-world-assets/';
export const assetDirectories = ['character', 'targets', 'weapons', 'world'];
export const defaultClips = {idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', fall: 'Fall'};

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected an asset manifest object');
  const {model, scale = 1, rotation = 0, heightOffset = 0, animations = {}} = value;
  validateAssetPath(model, 'character');
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100 || !Number.isFinite(rotation) ||
      !Number.isFinite(heightOffset) || Math.abs(heightOffset) > 20) throw Error('Invalid model transform');
  if (!animations || typeof animations !== 'object' || Array.isArray(animations)) throw Error('Invalid animation mapping');
  const mapping = {...defaultClips};
  for (const state of Object.keys(mapping)) {
    if (!Object.hasOwn(animations, state)) continue;
    if (typeof animations[state] !== 'string' || animations[state].length > 200) throw Error('Animation names must be strings');
    mapping[state] = animations[state];
  }
  for (const state of ['meleeAttack', 'rangedAttack', 'spellCast', 'hitReaction', 'walkBack', 'runBack', 'strafeLeft', 'strafeRight']) {
    if (!Object.hasOwn(animations, state)) continue;
    if (typeof animations[state] !== 'string' || animations[state].length > 200) throw Error('Animation names must be strings');
    mapping[state] = animations[state];
  }
  const attacks = animations.attacks ?? [];
  if (!Array.isArray(attacks) || attacks.length > 32 || attacks.some(name => typeof name !== 'string' || name.length > 200)) {
    throw Error('Attack animations must be a list of names');
  }
  if (!Object.hasOwn(mapping, 'meleeAttack') && attacks.length) mapping.meleeAttack = attacks[0];
  const result = {model, scale, rotation, heightOffset, animations: {...mapping, attacks: [...attacks]}};
  if (value.rigidAttachments !== undefined) {
    const entries = value.rigidAttachments;
    if (!Array.isArray(entries) || entries.length > 32) throw Error('Invalid rigid attachments');
    result.rigidAttachments = entries.map(entry => {
      const {mesh, bone, position} = object(entry);
      return {mesh: name(mesh), bone: name(bone), position: triple(position)};
    });
    if (new Set(result.rigidAttachments.map(entry => entry.mesh)).size !== entries.length) {
      throw Error('A rigid mesh can only have one attachment');
    }
  }
  if (value.environment !== undefined) {
    const asset = transform(value.environment, 'world');
    const {ground, walls = [], exploration = false} = value.environment;
    if (typeof exploration !== 'boolean') throw Error('Invalid exploration flag');
    if (!ground || !Array.isArray(walls) || walls.length > 64) throw Error('Environment requires a ground rectangle and a wall list');
    const horizontal = rectangle(ground);
    const y = number(ground.y, 'floor height');
    result.environment = {...asset, exploration, ground: {...horizontal, y}, walls: walls.map(wall => {
      const bounds = rectangle(wall);
      const minY = number(wall.minY ?? y, 'wall minimum');
      const maxY = number(wall.maxY, 'wall maximum');
      if (minY >= maxY) throw Error('Wall height must be positive');
      return {...bounds, minY, maxY};
    })};
  }
  if (value.target !== undefined) {
    const animations = object(value.target.animations ?? {});
    const defaults = {idle: 'Stand (ID 0 variation 0)', hit: 'CombatWound (ID 9 variation 0)',
      criticalHit: 'CombatCritical (ID 10 variation 0)'};
    result.target = {...transform(value.target, 'targets'),
      animations: Object.fromEntries(Object.entries(defaults).map(([id, clip]) => [id, name(animations[id] ?? clip)]))};
  }
  if (value.weapons !== undefined) {
    const weapon = object(value.weapons).mainHand;
    if (weapon !== undefined) {
      object(weapon);
      validateAssetPath(weapon.model, 'weapons');
      if (weapon.enabled !== undefined && typeof weapon.enabled !== 'boolean') throw Error('Invalid weapon enabled flag');
      const grip = weapon.gripClip === undefined ? {} : {gripClip: name(weapon.gripClip)};
      result.weapons = {mainHand: {model: weapon.model, enabled: weapon.enabled ?? true,
        attachmentBone: name(weapon.attachmentBone ?? 'bone_WeaponR'), scale: scaleValue(weapon.scale),
        position: triple(weapon.position), rotation: triple(weapon.rotation), ...grip}};
    }
  }
  if (value.playerSpawn !== undefined) result.playerSpawn = point(value.playerSpawn);
  if (value.debug !== undefined) {
    if (typeof value.debug !== 'boolean') throw Error('Invalid debug flag');
    result.debug = value.debug;
  }
  return result;
}

export function validateAssetPath(path, directory) {
  if (typeof path !== 'string' || path.length > 300 || path.split('/')[0] !== directory ||
      !/^[\p{L}\d_ .()-]+(?:\/[\p{L}\d_ .()-]+)*\.(?:gltf|glb)$/iu.test(path) ||
      path.split('/').some(part => part === '.' || part === '..')) {
    throw Error('Model must be a .glb or .gltf under ' + directory + '/');
  }
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected asset configuration object');
  return value;
}

function number(value, label, max = 10000) {
  if (!Number.isFinite(value) || Math.abs(value) > max) throw Error('Invalid ' + label);
  return value;
}

function name(value) {
  if (typeof value !== 'string' || !value.length || value.length > 200) throw Error('Invalid clip or bone name');
  return value;
}

function scaleValue(value = 1) {
  if (number(value, 'scale', 100) <= 0) throw Error('Scale must be positive');
  return value;
}

function point(value) {
  object(value);
  return Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, number(value[axis] ?? 0, axis)]));
}

function triple(value = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length !== 3) throw Error('Expected three transform values');
  return value.map(entry => number(entry, 'transform'));
}

function transform(value, directory) {
  object(value);
  validateAssetPath(value.model, directory);
  return {model: value.model, scale: scaleValue(value.scale), rotation: number(value.rotation ?? 0, 'rotation'),
    position: point(value.position ?? {})};
}

function rectangle(value) {
  object(value);
  const bounds = Object.fromEntries(['minX', 'maxX', 'minZ', 'maxZ'].map(key => [key, number(value[key], key)]));
  if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) throw Error('Invalid collision rectangle');
  return bounds;
}
