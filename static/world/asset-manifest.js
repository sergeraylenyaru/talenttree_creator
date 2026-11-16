export const assetRoot = '/local-world-assets/';
export const defaultClips = {idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', fall: 'Fall'};

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected an asset manifest object');
  const {model, scale = 1, rotation = 0, heightOffset = 0, animations = {}} = value;
  if (typeof model !== 'string' || model.length > 300 ||
      !/^character\/(?:[\p{L}\d_ .()-]+\/)*[\p{L}\d_ .()-]+\.(?:gltf|glb)$/iu.test(model) ||
      model.split('/').some(part => part === '.' || part === '..')) throw Error('Model must be a .glb or .gltf under character/');
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100 || !Number.isFinite(rotation) ||
      !Number.isFinite(heightOffset) || Math.abs(heightOffset) > 20) throw Error('Invalid model transform');
  if (!animations || typeof animations !== 'object' || Array.isArray(animations)) throw Error('Invalid animation mapping');
  const mapping = {...defaultClips};
  for (const state of Object.keys(mapping)) {
    if (!Object.hasOwn(animations, state)) continue;
    if (typeof animations[state] !== 'string' || animations[state].length > 200) throw Error('Animation names must be strings');
    mapping[state] = animations[state];
  }
  for (const state of ['meleeAttack', 'rangedAttack', 'spellCast', 'hitReaction']) {
    if (!Object.hasOwn(animations, state)) continue;
    if (typeof animations[state] !== 'string' || animations[state].length > 200) throw Error('Animation names must be strings');
    mapping[state] = animations[state];
  }
  const attacks = animations.attacks ?? [];
  if (!Array.isArray(attacks) || attacks.length > 32 || attacks.some(name => typeof name !== 'string' || name.length > 200)) {
    throw Error('Attack animations must be a list of names');
  }
  if (!Object.hasOwn(mapping, 'meleeAttack') && attacks.length) mapping.meleeAttack = attacks[0];
  return {model, scale, rotation, heightOffset, animations: {...mapping, attacks: [...attacks]}};
}
