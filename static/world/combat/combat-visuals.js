import {ConeGeometry, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, Vector3} from 'three';

const palette = {
  melee: 0xffdf90, physical: 0xffdf90, fire: 0xff6b22, frost: 0x82dcff,
  arcane: 0xca80ff, holy: 0xfff5ba, nature: 0x8de65a, shadow: 0xa567e1,
  healing: 0x63f6c1, defense: 0x8bb9ff
};
const tones = {strike: [145, 65, 'triangle'], spark: [520, 185, 'sine'], chime: [480, 780, 'sine']};

export function createCombatVisuals(scene, dummy) {
  const sphere = new SphereGeometry(1, 10, 8);
  const ring = new RingGeometry(0.2, 0.31, 24);
  const arrow = new ConeGeometry(0.23, 4, 6);
  const up = new Vector3(0, 1, 0);
  const direction = new Vector3();
  const materials = new Map();
  const impactMaterials = new Map();
  const free = [];
  const bursts = [];
  let reaction = 0;
  let audio;

  function createMesh(position, profile, radius, geometry, impact = false) {
    const tint = palette[profile.impact] ?? palette[profile.school] ?? palette.physical;
    const cache = impact ? impactMaterials : materials;
    if (!cache.has(tint)) cache.set(tint, new MeshBasicMaterial(impact
      ? {color: tint, transparent: true, opacity: 0.72, depthWrite: false} : {color: tint}));
    const mesh = free.pop() || new Mesh();
    mesh.geometry = geometry;
    mesh.material = cache.get(tint);
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.set(geometry === ring ? -Math.PI / 2 : 0, 0, 0);
    mesh.scale.setScalar(radius);
    scene.add(mesh);
    return mesh;
  }

  function remove(mesh) {
    mesh.removeFromParent();
    free.push(mesh);
  }

  return {
    spawn(position, profile, radius, heading) {
      const geometry = (profile.attackAnimation ?? profile.animation) === 'bow' ? arrow : sphere;
      const mesh = createMesh(position, profile, radius, geometry);
      if (geometry === arrow && heading) mesh.quaternion.setFromUnitVectors(up, heading);
      return mesh;
    },
    remove,
    move(mesh, position) {
      if (mesh.geometry === arrow) {
        direction.set(position.x, position.y, position.z).sub(mesh.position).normalize();
        if (direction.lengthSq()) mesh.quaternion.setFromUnitVectors(up, direction);
      }
      mesh.position.set(position.x, position.y, position.z);
    },
    impact(position, profile) {
      if (profile.impact === 'none') return;
      if (bursts.length === 24) remove(bursts.shift().mesh);
      const size = profile.area ? 2.5 : profile.critical ? 1.1 : 0.65;
      const geometry = profile.area || profile.critical || ['healing', 'defense'].includes(profile.impact ?? profile.school)
        ? ring : sphere;
      const mesh = createMesh(position, profile, geometry === ring ? size : size * 0.28, geometry, true);
      bursts.push({mesh, age: 0, size: mesh.scale.x, lifetime: profile.critical ? 0.38 : 0.25});
    },
    prepareSound() {
      if (!globalThis.AudioContext) return;
      try {
        audio ??= new AudioContext();
        if (audio.state === 'suspended') audio.resume().catch(() => {});
      } catch {
        // Presentation is optional when audio is unavailable.
      }
    },
    sound(id) {
      if (audio?.state !== 'running' || !Object.hasOwn(tones, id)) return;
      const [start, end, wave] = tones[id];
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const time = audio.currentTime;
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(start, time);
      oscillator.frequency.exponentialRampToValueAtTime(end, time + 0.14);
      gain.gain.setValueAtTime(0.075, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(time);
      oscillator.stop(time + 0.15);
    },
    react() { reaction = 0.22; },
    update(dt) {
      for (let i = bursts.length - 1; i >= 0; i--) {
        const burst = bursts[i];
        burst.age += dt;
        burst.mesh.scale.setScalar(burst.size + burst.age * (burst.mesh.geometry === ring ? 2 : 0.7));
        if (burst.age >= burst.lifetime) {
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
      sphere.dispose();
      ring.dispose();
      arrow.dispose();
      for (const material of materials.values()) material.dispose();
      for (const material of impactMaterials.values()) material.dispose();
      if (audio && audio.state !== 'closed') audio.close().catch(() => {});
      free.length = 0;
    }
  };
}
