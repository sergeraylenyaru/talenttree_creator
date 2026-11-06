import fs from 'node:fs';
import {iconURL} from '../static/icons.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClassIcon,classEmblem} from '../static/class-emblem.js';
import {blank,normalize} from '../static/engine.js';
test('class emblem survives normalization and blends exactly two safe layers',()=>{
 const doc=blank();doc.classIcon={background:'#123456',layers:[{icon:'inv_sword_04',opacity:.4},{icon:'inv_shield_04',opacity:.7}]};
 assert.deepEqual(normalize(structuredClone(doc)).classIcon,doc.classIcon);
 const html=classEmblem(doc.classIcon);assert.equal((html.match(/<img /g)||[]).length,2);assert.ok(html.includes('opacity:0.4'));assert.ok(!html.includes('background-color:'));
});
test('emblem rejects invalid styles, URLs and opacity; old documents have a safe fallback',()=>{
 for(const value of [null,{background:'url(evil)',layers:[]},{background:'#ffffff',layers:[{icon:'javascript:evil()',opacity:1}]},{background:'#ffffff',layers:[{icon:'inv_sword_04',opacity:Infinity}]},{background:'#ffffff',layers:[{icon:'inv_sword_04',opacity:true}]},{background:'#ffffff',layers:[{icon:'inv_sword_04',opacity:-1}]}])assert.throws(()=>validateClassIcon(value));
 assert.ok(classEmblem(null,'inv_sword_04').includes('inv_sword_04.jpg'));
 assert.ok(normalize(blank()));
});

test('weapon catalog has unique valid weapon names compatible with every icon picker',()=>{
 const entries=JSON.parse(fs.readFileSync(new URL('../static/weapon-icons.json',import.meta.url)));
 assert.equal(entries.length,194);assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
 for(const entry of entries){assert.ok(/^inv_/.test(entry.id));assert.ok(iconURL(entry.id).startsWith('https://wow.zamimg.com/'));assert.ok(entry.label.includes('оружие'));}
});

test('transformed layers rotate about the circle center and old emblems remain valid',()=>{
 const model={background:'#123456',glow:{color:'#ffaa00',radius:100,strength:80},layers:[{icon:'inv_sword_04',opacity:.4,x:20,y:-10,rotation:90,scale:1.25}]};
 assert.equal(validateClassIcon(model),model);const html=classEmblem(model);
 assert.ok(html.includes('rotate(90deg) translate(20%,-10%) scale(1.25)'));
 assert.ok(!html.includes('emblem-glow'));
 for(const [key,value] of [['scale',1.51],['x',101],['rotation',181]]){const bad=structuredClone(model);bad.layers[0][key]=value;assert.throws(()=>validateClassIcon(bad));}
 const bad=structuredClone(model);bad.glow.radius=-1;assert.throws(()=>validateClassIcon(bad));
});

test('legacy glow is ignored and 150 percent scale works without a background',()=>{
 const model={glow:{color:'#ffcc88',radius:80,strength:70},layers:[{icon:'inv_sword_04',opacity:.5,scale:1.5}]};
 assert.equal(validateClassIcon(model),model);const html=classEmblem(model);assert.ok(html.includes('scale(1.5)'));assert.ok(!html.includes('emblem-glow'));assert.ok(!html.includes('background-color'));
});
