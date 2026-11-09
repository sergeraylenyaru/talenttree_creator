import test from 'node:test';
import assert from 'node:assert/strict';
import {iconWindow} from '../static/icon-browser.js';
import {blank,abilityUnlocked,normalize} from '../static/engine.js';
import {withoutBuild,restoreBrowserBuild,saveBrowserBuild} from '../static/browser-build.js';
test('continuous icon surface covers all 35k entries, including the end, with a bounded window',()=>{
 const first=iconWindow(35000,980,420,0),last=iconWindow(35000,980,420,1e8);assert.equal(first.start,0);assert.ok(first.end<400);assert.equal(last.end,35000);assert.ok(last.end-last.start<=400);assert.ok(first.height>90000);
 for(const width of [220,480,980]){const w=iconWindow(35000,width,420,5000);assert.ok(w.start<w.end&&w.end<=35000);assert.ok(w.start<=Math.floor(5000/56)*w.columns);assert.ok(w.end>Math.floor(5000/56)*w.columns);}
 assert.equal(iconWindow(0,980,420,0).end,0);
});
test('exclusive abilities in custom trees require the chosen primary and keep talent requirements independent',()=>{
 const d=blank(),a={id:'a',name:'A',description:'D',icon:'inv_misc_book_09',branchId:d.branches[0].id,branchOnly:true,learningMode:'base'};d.abilities=[a];d.primaryBranchEnabled=true;assert.equal(abilityUnlocked(d,a),false);d.primaryBranchId=d.branches[0].id;assert.equal(abilityUnlocked(d,a),true);d.primaryBranchId=d.branches[1].id;assert.equal(abilityUnlocked(d,a),false);
 a.branchOnly=false;assert.equal(abilityUnlocked(d,a),true);a.branchOnly=true;a.learningMode='talent';a.talentId='t';d.primaryBranchId=d.branches[0].id;assert.equal(abilityUnlocked(d,a),false);d.build.t=1;assert.equal(abilityUnlocked(d,a),true);
 const bad=structuredClone(d);bad.abilities[0].branchId='auto';assert.throws(()=>normalize(bad),/ветку/);
});
test('primary choice in custom classes also restores only in its own browser',()=>{
 const d=blank();d.primaryBranchEnabled=true;d.primaryBranchId=d.branches[0].id;const values=new Map(),s={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)};saveBrowserBuild(d,'project:one',s);assert.equal(restoreBrowserBuild(d,'project:one',s).primaryBranchId,d.primaryBranchId);assert.equal(restoreBrowserBuild(d,'project:two',s).primaryBranchId,undefined);assert.equal(withoutBuild(d).primaryBranchId,undefined);
});
