import {Box3, Group, LoadingManager, MathUtils} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {assetRoot, validateManifest} from './asset-manifest.js';

export function disposeObjects(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    if (object.material) for (const material of [object.material].flat()) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  const images = new Set();
  for (const texture of textures) {
    if (typeof texture.image?.close === 'function') images.add(texture.image);
    texture.dispose();
  }
  for (const image of images) image.close();
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}

export function localAssetURL(value, origin) {
  if (/^(data|blob):/.test(value)) return value;
  const url = new URL(value, origin);
  if (url.origin !== origin || !url.pathname.startsWith(assetRoot + 'character/')) {
    throw Error('A model dependency points outside the local character directory');
  }
  return url.href;
}

export function orientAndGroundModel(root, {scale, rotation, heightOffset}) {
  const orientation = new Group();
  orientation.scale.setScalar(scale);
  orientation.rotation.y = MathUtils.degToRad(rotation);
  orientation.add(root);
  // Refresh bone transforms and the attached skin's inverse bind transform before sampling vertices.
  orientation.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(orientation, true);
  if (bounds.isEmpty() || !bounds.min.toArray().every(Number.isFinite) || !bounds.max.toArray().every(Number.isFinite)) {
    throw Error('Cannot align character to ground: model bounds are empty or non-finite');
  }
  orientation.position.y = heightOffset - bounds.min.y;
  orientation.updateMatrixWorld(true);
  return orientation;
}

export async function loadLocalCharacter(signal) {
  const response = await fetch(assetRoot + 'manifest.json', {signal});
  if (response.status === 404) return null;
  if (!response.ok) throw Error('Could not read the local asset manifest');
  const manifest = validateManifest(await response.json());
  const modelURL = assetRoot + manifest.model.split('/').map(encodeURIComponent).join('/');
  const modelResponse = await fetch(modelURL, {signal});
  if (!modelResponse.ok) throw Error('Could not open ' + manifest.model);
  const bytes = await modelResponse.arrayBuffer();
  signal.throwIfAborted();

  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (signal.aborted && !url.startsWith('blob:')) signal.throwIfAborted();
    return localAssetURL(url, location.origin);
  });
  const directory = new URL(modelURL.slice(0, modelURL.lastIndexOf('/') + 1), location.origin).href;
  const gltf = await new GLTFLoader(manager).parseAsync(bytes, directory);
  if (signal.aborted) {
    disposeObjects(gltf.scene);
    signal.throwIfAborted();
  }
  let hasMesh = false;
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    hasMesh = true;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  if (!hasMesh) {
    disposeObjects(gltf.scene);
    throw Error('The glTF scene contains no mesh');
  }
  try {
    const visual = orientAndGroundModel(gltf.scene, manifest);
    // Bind animation tracks to the original glTF scene, beneath the correction.
    return {root: gltf.scene, visual, clips: gltf.animations, mapping: manifest.animations};
  } catch (error) {
    disposeObjects(gltf.scene);
    throw error;
  }
}
