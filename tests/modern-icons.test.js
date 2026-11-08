import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {iconURL} from '../static/icons.js';
import {retailIconNames} from '../static/retail-icon-aliases.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../static/'+p,import.meta.url)));
test('full named icon snapshot includes modern assets and safe exceptional filenames',()=>{
 const list=read('retail-icons.json'),source=read('retail-icons-source.json');assert.equal(list.length,33765);assert.equal(source.entries,list.length);assert.equal(new Set(list.map(i=>i.id)).size,list.length);assert.equal(Object.keys(retailIconNames).length,440);
 assert.ok(list.some(i=>i.id==='inv_stegodonprimalmount_blue'));
 for(const item of list){assert.ok(Number.isInteger(item.fileDataId));const url=new URL(iconURL(item.id));assert.equal(url.origin,'https://wow.zamimg.com');assert.ok(url.pathname.startsWith('/images/wow/icons/large/'));}
 assert.equal(iconURL('retail:unknown'),'');assert.equal(iconURL('constructor'),'https://wow.zamimg.com/images/wow/icons/large/constructor.jpg');
 assert.equal(iconURL('retail:132134'),'https://wow.zamimg.com/images/wow/icons/large/ability_druid_mangle.tga.jpg');
});
test('each Cata tree has linked specialization grants and readable descriptions',()=>{
 const entries=read('presets/index.json').filter(x=>x.version==='4.3.4');assert.equal(entries.length,10);let abilities=0;
 for(const entry of entries){const d=read('presets/'+entry.id+'.json');assert.equal(d.specialization.requiredPoints,31);assert.equal(d.budget,41);
  for(const branch of d.branches)assert.ok(d.abilities.some(a=>a.branchId===branch.id&&a.learningMode==='specialization'));
  for(const a of d.abilities){abilities++;assert.ok(a.sourceSpellId>0);assert.ok(iconURL(a.icon));assert.ok(a.description.length>10);assert.equal(a.description.includes('$'),false);}
 }
 assert.equal(abilities,120);
});
