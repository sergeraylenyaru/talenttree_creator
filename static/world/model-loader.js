import {Box3, Group, LoadingManager, MathUtils, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {assetDirectories, assetRoot, validateManifest} from './asset-manifest.js';

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
  const rawPath = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  if (rawPath.split('/').some(part => part === '..') || rawPath.includes('\\')) {
    throw Error('A model dependency points outside the local character directory or other allowed asset roots');
  }
  const url = new URL(value, origin);
  const parts = decodeURIComponent(url.pathname).slice(assetRoot.length).split('/');
  if (url.origin !== origin || !url.pathname.startsWith(assetRoot) || !assetDirectories.includes(parts[0]) ||
      parts.length < 2 || parts.some(part => !part || part === '..' || part === '.' || /[\\:\x00-\x1f]/.test(part))) {
    throw Error('A model dependency points outside the local character directory or other allowed asset roots');
  }
  return url.href;
}

export function renderedModelBounds(root) {
  const bounds = new Box3();
  const vertex = new Vector3();
  root.updateMatrixWorld(true);
  root.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    const {index, attributes, drawRange} = mesh.geometry;
    const end = Math.min(index?.count ?? attributes.position.count, drawRange.start + drawRange.count);
    for (let i = drawRange.start; i < end; i++) {
      const vertexIndex = index ? index.getX(i) : i;
      bounds.expandByPoint(mesh.getVertexPosition(vertexIndex, vertex).applyMatrix4(mesh.matrixWorld));
    }
  });
  return bounds;
}

export function orientAndGroundModel(root, {scale, rotation, heightOffset}) {
  const orientation = new Group();
  orientation.scale.setScalar(scale);
  orientation.rotation.y = MathUtils.degToRad(rotation);
  orientation.add(root);
  // Refresh bone transforms and the attached skin's inverse bind transform before sampling vertices.
  orientation.updateMatrixWorld(true);
  const bounds = renderedModelBounds(orientation);
  if (bounds.isEmpty() || !bounds.min.toArray().every(Number.isFinite) || !bounds.max.toArray().every(Number.isFinite)) {
    throw Error('Cannot align character to ground: model bounds are empty or non-finite');
  }
  orientation.position.y = heightOffset - bounds.min.y;
  orientation.updateMatrixWorld(true);
  return orientation;
}

export async function loadLocalManifest(signal) {
  const response = await fetch(assetRoot + 'manifest.json', {signal});
  if (response.status === 404) return null;
  if (!response.ok) throw Error('Could not read the local asset manifest');
  return validateManifest(await response.json());
}

async function readModel(response, signal, progress) {
  const length = Number(response.headers.get('Content-Length'));
  if (!response.body || !length || !progress) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks = [];
  let read = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
      read += value.length;
      progress(Math.min(100, Math.floor(read / length * 100)));
    }
    const bytes = new Uint8Array(read);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes.buffer;
  } finally {
    reader.releaseLock();
  }
}

export async function loadLocalModel(manifest, signal, progress) {
  const modelURL = assetRoot + manifest.model.split('/').map(encodeURIComponent).join('/');
  const modelResponse = await fetch(modelURL, {signal});
  if (!modelResponse.ok) throw Error('Could not open ' + manifest.model);
  const bytes = await readModel(modelResponse, signal, progress);
  signal.throwIfAborted();

  progress?.('parsing');
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (signal.aborted && !url.startsWith('blob:')) signal.throwIfAborted();
    return localAssetURL(url, location.origin);
  });
  const directory = new URL(modelURL.slice(0, modelURL.lastIndexOf('/') + 1), location.origin).href;
  const abort = () => manager.abort();
  signal.addEventListener('abort', abort, {once: true});
  let gltf;
  try {
    gltf = await new GLTFLoader(manager).parseAsync(bytes, directory);
  } finally {
    signal.removeEventListener('abort', abort);
  }
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
  return {root: gltf.scene, clips: gltf.animations, mapping: manifest.animations};
}

export function mountRigidAttachments(root, attachments = []) {
  if (!attachments.length) return;
  const namedMeshes = new Map();
  root.traverse(node => {
    if (node.isMesh && !node.isSkinnedMesh && !node.children.length) {
      namedMeshes.set(node.userData.name ?? node.name, node);
    }
  });
  const mounts = attachments.map(({mesh, bone, position}) => {
    const object = namedMeshes.get(mesh);
    const joint = root.getObjectByName(bone);
    if (!object || !joint?.isBone) throw Error('Invalid rigid attachment: ' + mesh + ' → ' + bone);
    return {object, joint, position};
  });
  for (const {object, joint, position} of mounts) {
    joint.add(object);
    object.position.fromArray(position);
  }
}

export function groundLocalModel(asset, manifest) {
  try {
    mountRigidAttachments(asset.root, manifest.rigidAttachments);
    return {...asset, visual: orientAndGroundModel(asset.root, manifest)};
  } catch (error) {
    disposeObjects(asset.root);
    throw error;
  }
}
