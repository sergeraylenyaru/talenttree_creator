import {BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, Group, InstancedMesh,
  Matrix4, Mesh, MeshStandardMaterial, Ray, Triangle, Vector3} from 'three';
import {Octree} from 'three/addons/math/Octree.js';
import {moveOnGround} from './collision-system.js';
import {Capsule} from 'three/addons/math/Capsule.js';

const stepHeight = 0.56;
const down = new Vector3(0, -1, 0);

export function createExplorationTerrain(bounds) {
  const root = new Group();
  root.name = 'Exploration terrain';
  const ox = (bounds.min.x + bounds.max.x) / 2;
  const oz = (bounds.min.z + bounds.max.z) / 2;
  const half = 76;
  const cellar = {minX: -38, maxX: -16, minZ: -23, maxZ: -4};
  const height = (x, z) => {
    const distance = Math.max(bounds.min.x - x, x - bounds.max.x, bounds.min.z - z, z - bounds.max.z);
    return -1.30 + Math.min(1, Math.max(0, (distance - 7) / 21)) *
      (0.65 * Math.sin(x * 0.12) + 0.47 * Math.cos(z * 0.18));
  };
  const positions = [], colors = [], indices = [];
  const xs = [...new Set([...Array.from({length: 77}, (_, i) => ox - half + i * 2), cellar.minX, cellar.maxX])].sort((a,b) => a-b);
  const zs = [...new Set([...Array.from({length: 77}, (_, i) => oz - half + i * 2), cellar.minZ, cellar.maxZ])].sort((a,b) => a-b);
  for (const z of zs) for (const x of xs) {
    positions.push(x, height(x,z), z);
    const road = Math.abs(x - (-11 + 3 * Math.sin(z * 0.07))) < 3 || z > -6 && z < 9 && x > -15 && x < 14;
    const tint = new Color(road ? 0x937b56 : 0x627345).multiplyScalar(0.93 + 0.07 * Math.cos(x * 3 + z));
    colors.push(tint.r,tint.g,tint.b);
  }
  for (let j=0;j<zs.length-1;j++) for (let i=0;i<xs.length-1;i++) {
    if (xs[i]>=cellar.minX && xs[i+1]<=cellar.maxX && zs[j]>=cellar.minZ && zs[j+1]<=cellar.maxZ) continue;
    const a=j*xs.length+i, b=a+1, c=a+xs.length, d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions),3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors),3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new Mesh(geometry,new MeshStandardMaterial({vertexColors:true,roughness:1}));
  ground.receiveShadow = true;
  root.add(ground);

  const trees = new InstancedMesh(new ConeGeometry(1.7,5,7),new MeshStandardMaterial({color:0x3d5939}),72);
  const rocks = new InstancedMesh(new BoxGeometry(1.2,0.8,1.1),new MeshStandardMaterial({color:0x777365}),72);
  const matrix = new Matrix4();
  for(let i=0;i<72;i++){
    const angle=i*2.399963, radius=38+(i%11)*2.5;
    const x=ox+Math.cos(angle)*radius, z=oz+Math.sin(angle)*radius;
    const y=height(x,z);
    trees.setMatrixAt(i,matrix.makeTranslation(x,y+2.5,z));
    rocks.setMatrixAt(i,matrix.makeRotationY(angle).setPosition(x+2,y+0.25,z+1.8));
  }
  root.add(trees,rocks);
  const railMaterial=new MeshStandardMaterial({color:0x5c5040});
  for (const [x,z,width,depth] of [[ox,oz-half,half*2,.35],[ox,oz+half,half*2,.35],
    [ox-half,oz,.35,half*2],[ox+half,oz,.35,half*2]]) {
    const rail=new Mesh(new BoxGeometry(width,.8,depth),railMaterial);
    rail.position.set(x,-.65,z);
    root.add(rail);
  }
  return {root,ground, boundary:{minX:ox-half,maxX:ox+half,minZ:oz-half,maxZ:oz+half}};
}

// The guildhouse exports individual treads with 0.48-unit risers. Use a
// continuous proxy on that flight while keeping the surrounding visual meshes.
function indexBuilding(building) {
  const tree = new Octree();
  const ramps = [];
  const stairMesh = /guildhouseb_interior13/;
  const normal = new Vector3();
  let measuredStair = false, measuredEntry = false;
  building.updateWorldMatrix(true,true);
  building.traverse(mesh => {
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.attributes.position;
    const indices = mesh.geometry.index;
    for (let i=0;i<(indices?.count??positions.count);i+=3) {
      const vertex = offset => new Vector3().fromBufferAttribute(positions,indices?indices.getX(i+offset):i+offset)
        .applyMatrix4(mesh.matrixWorld);
      const triangle = new Triangle(vertex(0),vertex(1),vertex(2));
      if (stairMesh.test(mesh.name)) {
        const points = [triangle.a,triangle.b,triangle.c];
        const width = Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
        const tread = width>2 && Math.abs(triangle.getNormal(normal).x)<.33 && points.every(p=>
          p.x>=-37.95 && p.x<=-31.99 && p.z>=-21.98 && p.z<=-8.68 && p.y>=-.11 && p.y<=7.26 &&
          Math.abs(p.y-(-.052+(p.z+21.9)*.583))<.95);
        if(tread) { measuredStair=true; continue; }
      }
      if (/guildhouseb_guildhouseb9/.test(mesh.name)) {
        const points = [triangle.a, triangle.b, triangle.c];
        if (points.every(p => p.x >= -11.85 && p.x <= -8.68 && p.z >= -8.60 && p.z <= -2.05 &&
            p.y >= -1.31 && p.y <= -.05) && points.some(p => p.y < -.07)) {
          measuredEntry = true;
          continue;
        }
      }
      tree.addTriangle(triangle);
    }
  });
  if (measuredStair) {
    const a=new Vector3(-36.45,-.052,-21.9), b=new Vector3(-32.65,-.052,-21.9);
    const c=new Vector3(-37.58,7.215,-9.42), d=new Vector3(-32.84,7.215,-9.42);
    ramps.push(new Triangle(a,c,b),new Triangle(b,c,d));
  }
  if (measuredEntry) {
    const a=new Vector3(-11.29,-.054,-8.15), b=new Vector3(-8.6,-1.29,-8.15);
    const c=new Vector3(-11.29,-.054,-3.55), d=new Vector3(-8.6,-1.29,-3.55);
    ramps.push(new Triangle(a,c,b),new Triangle(b,c,d));
  }
  tree.build();
  return {tree, ramps};
}

export function createWorldCollision(building, terrain, config, dynamicObstacles) {
  const {tree: octree,ramps} = indexBuilding(building);
  const terrainTree = new Octree().fromGraphNode(terrain.ground);
  const ray = new Ray(), normal = new Vector3(), hitPoint = new Vector3();
  const capsule = new Capsule(), displacement = new Vector3();
  const {playerRadius: radius, playerHeight: height} = config;

  function queryRay(origin, direction, max, walkable = false) {
    ray.origin.set(origin.x,origin.y,origin.z);
    ray.direction.copy(direction);
    const triangles = [...ramps];
    octree.getRayTriangles(ray, triangles);
    terrainTree.getRayTriangles(ray, triangles);
    let nearest = max;
    for (const triangle of triangles) {
      if (walkable && triangle.getNormal(normal).y < 0.52) continue;
      if (!ray.intersectTriangle(triangle.a,triangle.b,triangle.c,walkable,hitPoint)) continue;
      const distance = hitPoint.distanceTo(ray.origin);
      if (distance < nearest) nearest = distance;
    }
    return nearest;
  }

  function floorAt(x,z,top,drop) {
    const distance=queryRay({x,y:top,z},down,drop,true);
    return distance < drop ? top-distance : undefined;
  }

  function resolve(x,y,z) {
    capsule.set(displacement.set(x,y+radius,z),new Vector3(x,y+height-radius,z),radius);
    let ground=false, ceiling=false;
    for (const tree of [octree,terrainTree]) {
      const hit=tree.capsuleIntersect(capsule);
      if (!hit) continue;
      capsule.translate(displacement.copy(hit.normal).multiplyScalar(hit.depth));
      ground ||= hit.normal.y > 0.52;
      ceiling ||= hit.normal.y < -0.45;
    }
    return {x:capsule.start.x,y:capsule.start.y-radius,z:capsule.start.z,ground,ceiling};
  }

  return {
    floorAt,
    fraction(origin, offset, padding=0.18) {
      displacement.set(offset.x,offset.y,offset.z);
      const length=displacement.length();
      if(!length) return 1;
      const hit=queryRay(origin,displacement.divideScalar(length),length+padding);
      return Math.min(1,Math.max(0,(hit-padding)/length));
    },
    move(player, dx, dz, nextY, jumping) {
      const b=terrain.boundary;
      const {x,z}=moveOnGround(player,dx,dz,dynamicObstacles,{...config,ground:b});
      let y=nextY;
      if(player.grounded && !jumping) {
        const floor=floorAt(x,z,player.y+stepHeight,stepHeight*2+0.02);
        const travel=Math.hypot(dx,dz);
        const leading=travel > 1e-6 ? floorAt(x+dx/travel*radius,z+dz/travel*radius,player.y+stepHeight,stepHeight*2+0.02) : undefined;
        if(floor!==undefined) y=floor+0.007;
        if(leading!==undefined && leading>=player.y-0.035 && leading>y+0.015) y=Math.max(y,leading+0.007);
      }
      const p=resolve(x,y,z);
      const top = Math.max(p.y, player.y) + .05;
      const floor = !jumping && nextY <= player.y
        ? floorAt(p.x,p.z,top,top-Math.min(p.y,nextY)+.06) : undefined;
      const supported = floor!==undefined && (floor>=p.y-.06 || !player.grounded);
      const grounded = p.ground || supported;
      return {x:p.x,z:p.z,y:supported?floor+0.006:p.y,grounded,blocked:p.ceiling||grounded};
    }
  };
}
