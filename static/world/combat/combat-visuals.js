import {Mesh, MeshBasicMaterial, SphereGeometry} from 'three';

const palette = {fire: 0xff6b22, arcane: 0xca80ff};
const color = profile => palette[profile.school] ?? 0xffdf90;

export function createCombatVisuals(scene, dummy) {
  const geometry = new SphereGeometry(1, 10, 8);
  const materials = new Map();
  const free = [];
  const bursts = [];
  let reaction = 0;

  function spawn(position, profile, radius) {
    const tint = color(profile);
    if (!materials.has(tint)) materials.set(tint, new MeshBasicMaterial({color: tint}));
    const mesh = free.pop() || new Mesh(geometry, materials.get(tint));
    mesh.material = materials.get(tint);
    mesh.position.set(position.x, position.y, position.z);
    mesh.scale.setScalar(radius);
    scene.add(mesh);
    return mesh;
  }

  function remove(mesh) {
    mesh.removeFromParent();
    free.push(mesh);
  }

  return {
    spawn, remove,
    move(mesh, position) { mesh.position.set(position.x, position.y, position.z); },
    impact(position, profile) {
      if (bursts.length === 16) remove(bursts.shift().mesh);
      bursts.push({mesh: spawn(position, profile, 0.14), age: 0});
    },
    react() { reaction = 0.22; },
    update(dt) {
      for (let i = bursts.length - 1; i >= 0; i--) {
        const burst = bursts[i];
        burst.age += dt;
        burst.mesh.scale.setScalar(0.14 + burst.age * 1.7);
        if (burst.age >= 0.18) {
          remove(burst.mesh);
          bursts.splice(i, 1);
        }
      }
      reaction = Math.max(0, reaction - dt);
      dummy.rotation.x = -Math.sin(reaction / 0.22 * Math.PI) * 0.19;
    },
    clear() {
      for (const burst of bursts) remove(burst.mesh);
      bursts.length = 0;
      reaction = 0;
      dummy.rotation.x = 0;
    },
    dispose() {
      this.clear();
      geometry.dispose();
      for (const material of materials.values()) material.dispose();
      free.length = 0;
    }
  };
}
