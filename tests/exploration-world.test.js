import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,Mesh} from 'three';
import {createWorldCollision} from '../static/world/exploration-world.js';
import {world} from '../static/world/world-config.js';

const block=(x,y,z,w,h,d)=>{
  const mesh=new Mesh(new BoxGeometry(w,h,d));
  mesh.position.set(x,y,z);
  return mesh;
};
const terrain={
  ground:block(0,-.5,0,25,1,25),
  boundary:{minX:-12,maxX:12,minZ:-12,maxZ:12}
};

test('the exploration solver walks up discrete steps and descends using the same floor query',()=>{
  const building=new Group();
  building.add(block(0,.15,0,1,.3,4),block(1,.30,0,1,.6,4),block(2,.45,0,1,.9,4));
  const collision=createWorldCollision(building,terrain,world,[]);
  let player={x:-1.5,y:.006,z:0,grounded:true};
  for(let i=0;i<77;i++) player=collision.move(player,.05,0,player.y-.025,false);
  assert.ok(player.x>1.5&&player.grounded&&Math.abs(player.y-.906)<.04,player);
  for(let i=0;i<79;i++) player=collision.move(player,-.05,0,player.y-.025,false);
  assert.ok(player.x<-.8&&player.grounded&&Math.abs(player.y)<.04,player);
});

test('stacked floors are selected by height and walls obstruct horizontal sight',()=>{
  const building=new Group();
  building.add(block(0,3,0,3,.2,4),block(1.7,1,0,.2,2,4));
  const collision=createWorldCollision(building,terrain,world,[]);
  assert.ok(Math.abs(collision.floorAt(0,0,4,5)-3.1)<.001);
  assert.equal(collision.floorAt(0,0,1,2),0);
  assert.ok(collision.fraction({x:0,y:1,z:0},{x:3,y:0,z:0},0)<.6);
  assert.equal(collision.fraction({x:0,y:3.5,z:0},{x:3,y:0,z:0},0),1);
});
