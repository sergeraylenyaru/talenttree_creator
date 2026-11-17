import {
  AmbientLight, AnimationClip, BoxGeometry, CircleGeometry, Color, CylinderGeometry,
  DirectionalLight, Fog, Group, Mesh, MeshStandardMaterial, NumberKeyframeTrack,
  PlaneGeometry, RingGeometry, Scene, SphereGeometry
} from 'three';
import {defaultClips} from './asset-manifest.js';
import {box} from './collision-system.js';

function material(color, settings) {
  return new MeshStandardMaterial({color, roughness: 0.9, ...settings});
}

function mesh(parent, geometry, surface, x, y, z) {
  const object = new Mesh(geometry, surface);
  object.position.set(x, y, z);
  object.castShadow = object.receiveShadow = true;
  parent.add(object);
  return object;
}

export function createArena(config) {
  const scene = new Scene();
  scene.background = new Color(0x9daeb2);
  scene.fog = new Fog(0x9daeb2, 20, 49);
  scene.add(new AmbientLight(0xffecd3, 1.45));
  const sun = new DirectionalLight(0xffe1a6, 2.1);
  sun.position.set(-7, 15, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {left: -14, right: 14, top: 14, bottom: -14, near: 0.5, far: 37});
  sun.shadow.normalBias = 0.035;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  const turf = material(0x52653c), sand = material(0x9d8355), stone = material(0x655f54);
  const wood = material(0x593422), straw = material(0xad7839), iron = material(0x39444b);
  const ground = mesh(scene, new PlaneGeometry(100, 100), turf, 0, 0, 0);
  ground.rotation.x = -Math.PI / 2;
  ground.castShadow = false;
  const yard = mesh(scene, new CircleGeometry(10.8, 58), sand, 0, 0.006, 0);
  yard.rotation.x = -Math.PI / 2;
  yard.castShadow = false;
  const ring = mesh(scene, new RingGeometry(7.65, 7.75, 48), stone, 0, 0.012, -1);
  ring.rotation.x = -Math.PI / 2;
  ring.castShadow = false;

  const obstacles = [];
  const edge = config.halfSize + 0.15;
  for (const [x, z, width, depth] of [[0, -edge, edge * 2, 0.6], [0, edge, edge * 2, 0.6],
    [-edge, 0, 0.6, edge * 2], [edge, 0, 0.6, edge * 2]]) {
    mesh(scene, new BoxGeometry(width, 1.15, depth), stone, x, 0.575, z);
    obstacles.push(box(x, z, width, depth, 1.15));
  }
  const banner = material(0x772f35);
  for (const x of [-9, 9]) {
    for (const z of [-8, 2]) {
      mesh(scene, new BoxGeometry(0.86, 2.7, 0.86), stone, x, 1.35, z);
      mesh(scene, new BoxGeometry(1.03, 0.25, 1.03), iron, x, 2.69, z);
      mesh(scene, new BoxGeometry(0.56, 1.08, 0.04), banner, x, 1.83, z + 0.45);
      obstacles.push(box(x, z, 1.03, 1.03, 2.82));
    }
  }
  const hills = material(0x4a5845);
  const hillGeometry = new CylinderGeometry(0, 4, 10, 5);
  for (let i = 0; i < 18; i++) {
    const angle = i * Math.PI / 9;
    const ridge = mesh(scene, hillGeometry, hills, Math.cos(angle) * 28, 0, Math.sin(angle) * 28);
    ridge.scale.setScalar(1 + (i % 4) * 0.28);
  }

  const fallback = new Group();
  for (const child of [...scene.children]) if (!child.isLight) fallback.add(child);
  scene.add(fallback);
  const dummy = new Group();
  dummy.position.set(config.dummy.x, 0, config.dummy.z);
  const dummyVisual = new Group();
  dummy.add(dummyVisual);
  mesh(dummyVisual, new CylinderGeometry(0.65, 0.78, 0.2, 12), iron, 0, 0.1, 0);
  mesh(dummyVisual, new CylinderGeometry(0.12, 0.18, 1.55, 8), wood, 0, 0.78, 0);
  mesh(dummyVisual, new BoxGeometry(1.4, 0.15, 0.23), wood, 0, 1.22, 0);
  mesh(dummyVisual, new CylinderGeometry(0.38, 0.29, 0.68, 10), straw, 0, 1.3, 0);
  mesh(dummyVisual, new SphereGeometry(0.24, 12, 8), straw, 0, 1.88, 0);
  const target = mesh(dummyVisual, new CylinderGeometry(0.28, 0.28, 0.075, 20), banner, 0, 1.33, 0.36);
  target.rotation.x = Math.PI / 2;
  const selection = mesh(dummy, new RingGeometry(0.83, 0.94, 36), material(0xffd175, {emissive: 0x9c5814}), 0, 0.024, 0);
  selection.rotation.x = -Math.PI / 2;
  selection.castShadow = false;
  selection.visible = false;
  scene.add(dummy);
  const sightObstacles = obstacles.slice();
  obstacles.push(box(config.dummy.x, config.dummy.z, 1.45, 1.4, 2.15));
  return {scene, dummy, dummyVisual, fallback, selection, obstacles, sightObstacles};
}

export function createPlaceholder() {
  const root = new Group();
  const armor = material(0x627784), cloth = material(0x30455b), gold = material(0xb48e49), skin = material(0xc79168);
  mesh(root, new BoxGeometry(0.58, 0.61, 0.33), armor, 0, 1.3, 0);
  mesh(root, new BoxGeometry(0.55, 0.13, 0.37), gold, 0, 1.04, 0);
  mesh(root, new SphereGeometry(0.23, 12, 10), skin, 0, 1.83, -0.025);
  mesh(root, new BoxGeometry(0.44, 0.14, 0.39), cloth, 0, 1.95, 0);
  const joints = [];
  for (const side of [-1, 1]) {
    const arm = new Group(), leg = new Group();
    arm.position.set(side * 0.41, 1.56, 0);
    leg.position.set(side * 0.16, 1.04, 0);
    mesh(arm, new BoxGeometry(0.24, 0.22, 0.27), gold, 0, -0.06, 0);
    mesh(arm, new BoxGeometry(0.17, 0.48, 0.19), armor, 0, -0.30, 0);
    mesh(arm, new BoxGeometry(0.16, 0.16, 0.18), skin, 0, -0.6, 0);
    mesh(leg, new BoxGeometry(0.23, 0.85, 0.25), cloth, 0, -0.46, 0);
    mesh(leg, new BoxGeometry(0.25, 0.17, 0.36), armor, 0, -0.94, -0.054);
    root.add(arm, leg);
    joints.push([arm, side], [leg, -side]);
  }
  const clips = [
    ['Idle', 1.35, 0.06], ['Walk', 0.75, 0.48], ['Run', 0.49, 0.9],
    ['Jump', 0.32, 0.51], ['Fall', 0.35, 0.25]
  ].map(([name, duration, swing]) => new AnimationClip(name, duration, joints.map(([joint, sign], index) => {
    const airborne = name === 'Jump' || name === 'Fall';
    const peak = airborne ? swing * (index % 2 ? -1 : 1) : sign * swing;
    return new NumberKeyframeTrack(joint.uuid + '.rotation[x]', [0, duration / 4, 3 * duration / 4, duration],
      airborne ? [0, peak, peak, peak] : [0, peak, -peak, 0]);
  })));
  return {root, clips, mapping: defaultClips};
}
