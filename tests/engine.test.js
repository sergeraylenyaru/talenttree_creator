import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {blank,changeRank,validBuild,normalize} from '../static/engine.js';

function fixture(){const doc=blank();doc.rowCost=2;doc.budget=4;doc.branches[0].talents=[{id:'a',name:'Основа',icon:'spell_fire_fireball02',row:0,col:0,maxRank:2,descriptions:['1','2'],requires:''},{id:'b',name:'Продолжение',icon:'spell_fire_fireball02',row:1,col:0,maxRank:2,descriptions:['3','4'],requires:'a'}];return doc;}
test('new classes start with two branches and five rows',()=>{const d=blank();assert.equal(d.branches.length,2);assert.ok(d.branches.every(b=>b.rows===5));});
test('row and prerequisite requirements, rank cap and point budget',()=>{const d=fixture();assert.equal(changeRank(d,'b',1),false);assert.equal(changeRank(d,'a',1),true);assert.equal(changeRank(d,'b',1),false);assert.equal(changeRank(d,'a',1),true);assert.equal(changeRank(d,'a',1),false);assert.equal(changeRank(d,'b',1),true);assert.equal(changeRank(d,'b',1),true);assert.equal(changeRank(d,'b',1),false);assert.equal(changeRank(d,'a',-1),false);assert.equal(changeRank(d,'b',-1),true);assert.equal(changeRank(d,'b',-1),true);assert.equal(changeRank(d,'a',-1),true);});
test('points in a later row cannot unlock an earlier row',()=>{const d=fixture();d.branches[0].talents[1].requires='';assert.equal(validBuild(d,{b:2}),false);});
test('removal cannot strand talents in later rows even without an arrow',()=>{const d=fixture();d.branches[0].talents[1].requires='';d.build={a:2,b:1};assert.equal(changeRank(d,'a',-1),false);});
test('unknown, negative and fractional ranks rejected',()=>{const d=fixture();for(const build of [{unknown:1},{a:-1},{a:.5}])assert.equal(validBuild(d,build),false);});
test('same-row dependencies supported; cycles rejected',()=>{const d=fixture();d.rowCost=0;d.branches[0].talents[1].row=0;d.branches[0].talents[1].col=1;assert.doesNotThrow(()=>normalize(d));d.branches[0].talents[0].requires='b';assert.throws(()=>normalize(d),/циклов/);});
test('duplicate cells and identifiers rejected',()=>{const d=fixture();d.branches[0].talents[1].row=0;assert.throws(()=>normalize(d));});
test('all ten 3.3.5a presets satisfy schema, ranks and dependencies',()=>{const index=JSON.parse(fs.readFileSync(new URL('../static/presets/index.json',import.meta.url)));assert.equal(index.length,10);let count=0;for(const c of index){const d=normalize(JSON.parse(fs.readFileSync(new URL(`../static/presets/${c.id}.json`,import.meta.url))));assert.equal(d.branches.length,3);assert.ok(d.branches.every(b=>b.rows===11));assert.equal(d.budget,71);for(const b of d.branches)for(const t of b.talents){count++;assert.ok(t.descriptions.every(s=>s.length>0));assert.ok(t.icon.startsWith('wotlk:'));}assert.equal(d.branches.flatMap(b=>b.talents).length,c.talents);}assert.equal(count,829);});

test('dependency routes turn through empty cells and reserve their cells',async()=>{
 const {route,reserved}=await import('../static/engine.js');const b={rows:4,talents:[{id:'p',row:0,col:2},{id:'block',row:1,col:2},{id:'c',row:3,col:3,requires:'p'}]};
 const path=route(b,b.talents[0],b.talents[2]);assert.ok(path);assert.ok(path.some(([r,c])=>c===3&&r<3));assert.ok(!path.some(([r,c])=>r===1&&c===2));for(let i=1;i<path.length;i++)assert.equal(Math.abs(path[i][0]-path[i-1][0])+Math.abs(path[i][1]-path[i-1][1]),1);
 const [r,c]=path[1];assert.equal(reserved(b,r,c),true);
 b.talents.push(...[0,1,2,3].filter(c=>c!==2).map(c=>({id:'wall'+c,row:1,col:c})));assert.equal(route(b,b.talents[0],b.talents[2]),null);
});
