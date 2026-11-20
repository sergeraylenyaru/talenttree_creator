import {effectPresets} from '../../combat/effect-presets.js';
import {ConeGeometry, Mesh, MeshBasicMaterial, OctahedronGeometry, RingGeometry, SphereGeometry, Vector3} from 'three';

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
  const shard = new OctahedronGeometry(1);
  const slash = new RingGeometry(.30,.36,24,1,0,Math.PI*.68);
  const shapes = {orb:sphere, ring, shard, slash, burst:shard, arrow};
  const up = new Vector3(0, 1, 0);
  const direction = new Vector3();
  const materials = new Map();
  const impactMaterials = new Map();
  const free = [];
  const bursts = [];
  const zones = new Set();
  let reaction = 0;
  let audio;

  function createMesh(position, profile, radius, geometry, impact = false) {
    const tint=profile.color??effectPresets[profile.effectPreset]?.color??palette[profile.impact]??palette[profile.school]??palette.physical;
    const opacity=Math.min(1,(profile.opacity??(impact ? .72 : 1))*(profile.effectIntensity??1));
    const cache = impact ? impactMaterials : materials;
    const key=`${tint}/${opacity}`;
    if(!cache.has(key))cache.set(key,new MeshBasicMaterial({color:tint,opacity,transparent:opacity<1,depthWrite:opacity===1}));
    const mesh = free.pop() || new Mesh();
    mesh.geometry = geometry;
    mesh.material = cache.get(key);
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.set(geometry === ring ? -Math.PI / 2 : 0, geometry===slash ? Math.PI/4 : 0, 0);
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
      const preset=effectPresets[profile.effectPreset];
      const geometry=shapes[preset?.shape]??((profile.attackAnimation??profile.animation)==='bow'?arrow:sphere);
      const mesh=createMesh(position,profile,radius*(preset?.scale??1),geometry);
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
      const preset=effectPresets[profile.effectPreset];
      const area=profile.area||profile.critical;
      const fallback=area||['healing','defense'].includes(profile.impact??profile.school)?ring:sphere;
      const geometry=shapes[preset?.shape]??fallback;
      const speed=profile.effectSpeed??1;
      const intensity=profile.effectIntensity??1;
      const size=(profile.area&&profile.radius?profile.radius/.31:profile.area?2.5:profile.critical?1.1:.65)*
        (profile.effectScale??1)*(preset?.scale??1);
      const count=preset?.shape==='burst'?Math.ceil(3*intensity):1;
      const lifetime=profile.effectDuration??preset?.lifetime??(profile.critical ? .38 : .25);
      for(let index=0;index<count;index++){
        if(bursts.length===24)remove(bursts.shift().mesh);
        const angle=index/count*Math.PI*2;
        const mesh=createMesh(position,profile,geometry===ring||geometry===slash?size:size*.28,geometry,true);
        const drift=count>1?new Vector3(Math.cos(angle),.5,Math.sin(angle)).multiplyScalar(speed):null;
        bursts.push({mesh,age:0,size:mesh.scale.x,lifetime,drift,growth:(preset?.growth??(geometry===ring?2:.7))*speed});
      }
    },
    zone(position, profile) {
      if (profile.impact === 'none') return;
      const preset=effectPresets[profile.effectPreset];
      const size=(profile.radius??5)/.31*(profile.effectScale??1)*(preset?.scale??1);
      const mesh=createMesh({...position,y:position.y+.025},profile,size,ring,true);
      zones.add(mesh);
      return () => { if (zones.delete(mesh)) remove(mesh); };
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
    sound(id, profile = {}) {
      if (audio?.state !== 'running' || profile.volume === 0 || !Object.hasOwn(tones, id)) return;
      const [start, end, wave] = tones[id];
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const time = audio.currentTime;
      oscillator.type = wave;
      const pitch = 1 + (Math.random() * 2 - 1) * (profile.variation ?? 0);
      oscillator.frequency.setValueAtTime(start * pitch, time);
      oscillator.frequency.exponentialRampToValueAtTime(end * pitch, time + 0.14);
      gain.gain.setValueAtTime(.115 * (profile.volume ?? .65), time);
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
        burst.mesh.scale.setScalar(burst.size+burst.age*burst.growth);
        if(burst.drift)burst.mesh.position.addScaledVector(burst.drift,dt);
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
      for (const zone of zones) remove(zone);
      zones.clear();
      reaction = 0;
      dummy.rotation.x = 0;
    },
    dispose() {
      this.clear();
      sphere.dispose();
      ring.dispose();
      arrow.dispose();
      shard.dispose();
      slash.dispose();
      for (const material of materials.values()) material.dispose();
      for (const material of impactMaterials.values()) material.dispose();
      if (audio && audio.state !== 'closed') audio.close().catch(() => {});
      free.length = 0;
    }
  };
}
