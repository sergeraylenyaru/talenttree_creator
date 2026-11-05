import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreBrowserBuild,saveBrowserBuild,withoutBuild} from '../static/browser-build.js';

const document=()=>({budget:41,rowCost:5,branches:[{talents:[{id:'a',row:0,maxRank:5}]}],build:{a:5}});
function storage(){const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};}

test('author allocations never become a visitor default or exported build',()=>{
 const d=document(),s=storage();
 assert.deepEqual(restoreBrowserBuild(d,'share:one',s).build,{});
 assert.deepEqual(withoutBuild(d).build,{});
 assert.deepEqual(d.build,{a:5});
});
test('allocations restore per publication and browser, including an explicit reset',()=>{
 const d=document(),s=storage();d.build={a:2};saveBrowserBuild(d,'share:one',s);
 assert.deepEqual(restoreBrowserBuild(document(),'share:one',s).build,{a:2});
 assert.deepEqual(restoreBrowserBuild(document(),'share:two',s).build,{});
 assert.deepEqual(restoreBrowserBuild(document(),'share:one',storage()).build,{});
 d.build={};saveBrowserBuild(d,'share:one',s);
 assert.deepEqual(restoreBrowserBuild(document(),'share:one',s).build,{});
});
test('stale, corrupt or unavailable browser storage safely starts empty',()=>{
 const s=storage();
 for(const build of [{a:6},{missing:1},{a:-1},[]]){saveBrowserBuild({build},'project:one',s);assert.deepEqual(restoreBrowserBuild(document(),'project:one',s).build,{});}
 for(const value of ['{','null']){s.setItem('talentforge-build:project:one',value);assert.deepEqual(restoreBrowserBuild(document(),'project:one',s).build,{});}
 assert.deepEqual(restoreBrowserBuild(document(),'one',{getItem(){throw Error('unavailable');}}).build,{});
});
