import {AxesHelper, Box3, Box3Helper, Color, Group, MathUtils, Vector3} from 'three';
import {box} from './collision-system.js';
import {renderedModelBounds} from './model-loader.js';

export function boundsOf(root) {
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) throw Error('Invalid asset bounds');
  return bounds;
}

export function assetDiagnostics(asset, configuration) {
  const materials = new Set(), textures = new Set(), joints = new Set();
  let meshes = 0;
  asset.root.traverse(node => {
    if (node.isMesh) meshes++;
    for (const material of [node.material].flat()) if (material) materials.add(material);
    for (const bone of node.skeleton?.bones ?? []) joints.add(bone);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  }
  const {min, max} = renderedModelBounds(asset.visual ?? asset.root);
  return {model: configuration.model, meshes, materials: materials.size, textures: textures.size,
    joints: joints.size, animations: asset.clips.map(clip => clip.name), bounds: {min: min.toArray(), max: max.toArray()},
    transform: configuration,
    ...(configuration.rigidAttachments?.length ? {rigidAttachments: configuration.rigidAttachments.map(({mesh, bone}) => ({mesh, bone}))} : {})};
}

export function safeArenaPositions(ground, walls, spawn, dummy, radius, height = 2.1) {
  const clear = (point, margin, obstacles) => point.x >= ground.minX + margin && point.x <= ground.maxX - margin &&
    point.z >= ground.minZ + margin && point.z <= ground.maxZ - margin && obstacles.every(wall =>
      wall.minY >= ground.y + height || wall.maxY <= ground.y || point.x <= wall.minX - margin || point.x >= wall.maxX + margin ||
      point.z <= wall.minZ - margin || point.z >= wall.maxZ + margin);
  function choose(requested, margin, obstacles) {
    const candidates = [requested];
    for (const z of [0.5, 0.75, 0.25, 0.9, 0.1]) for (const x of [0.5, 0.75, 0.25, 0.9, 0.1]) {
      candidates.push({x: ground.minX + x * (ground.maxX - ground.minX),
        z: ground.minZ + z * (ground.maxZ - ground.minZ)});
    }
    const point = candidates.find(candidate => candidate && clear(candidate, margin, obstacles));
    if (!point) throw Error('No safe spawn within the configured floor rectangle');
    return {...point, y: ground.y};
  }
  const target = choose(dummy, 0.73, walls);
  const collider = box(target.x, target.z, 1.45, 1.4, ground.y + 2.15);
  collider.minY = ground.y;
  return {dummy: target, player: choose(spawn, radius, [...walls, collider]), collider};
}

export function attachWeapon(hero, weapon, config) {
  const bone = [...new Set([config.attachmentBone, 'bone_HandR'])]
    .map(name => hero.root.getObjectByName(name)).find(Boolean);
  if (!bone) throw Error('Weapon attachment node was not found: ' + config.attachmentBone);
  // Unarmed locomotion opens the fingers. Sample the exported one-hand grip
  // without replacing the animated wrist, arm or any other joint.
  const fingers = /^(bone_(?:Thumb|IndexFinger|MiddleFinger|RingFinger|PinkyFinger)(?:Tip)?R)\.quaternion$/;
  const gripClip = hero.clips?.find(clip => clip.name === config.gripClip);
  const grip = gripClip?.tracks.flatMap(track => {
    const match = fingers.exec(track.name);
    const finger = match && hero.root.getObjectByName(match[1]);
    return finger ? [{finger, rotation: track.createInterpolant().evaluate(0)}] : [];
  }) ?? [];
  if (config.gripClip && !grip.length) throw Error('No right-hand finger rotations in ' + config.gripClip);
  const mount = new Group();
  mount.add(weapon.root);
  bone.add(mount);
  applyWeaponTransform(mount, config);
  return {mount, bone: bone.name, grip};
}

export function applyWeaponTransform(mount, {position, rotation, scale}) {
  mount.position.fromArray(position);
  mount.rotation.set(...rotation.map(MathUtils.degToRad));
  mount.scale.setScalar(scale);
}

export function debugArena(bounds, ground, walls, spawn) {
  const group = new Group();
  group.add(new Box3Helper(bounds, new Color('yellow')), new AxesHelper(3));
  const helper = (min, max, color) => group.add(new Box3Helper(
    new Box3(new Vector3(...min), new Vector3(...max)), new Color(color)));
  helper([ground.minX, ground.y, ground.minZ], [ground.maxX, ground.y + 0.02, ground.maxZ], 'lime');
  for (const wall of walls) helper([wall.minX, wall.minY, wall.minZ], [wall.maxX, wall.maxY, wall.maxZ], 'red');
  for (const [point, color] of [[spawn.player, 'cyan'], [spawn.dummy, 'orange']]) {
    helper([point.x - 0.2, ground.y, point.z - 0.2], [point.x + 0.2, ground.y + 0.8, point.z + 0.2], color);
  }
  group.traverse(node => { node.raycast = () => {}; });
  return group;
}
