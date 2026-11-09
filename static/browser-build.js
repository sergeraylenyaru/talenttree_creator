import {validBuild} from './engine.js';

export function withoutBuild(document) { const {primaryBranchId,...rest}=document;return {...rest,build:{}}; }
const key=id=>'talentforge-build:'+id;

// A publication is immutable; its visitor's allocation belongs only to this browser.
export function restoreBrowserBuild(document,id,storage=localStorage) {
 const result=withoutBuild(document);
 try {
  const saved=JSON.parse(storage.getItem(key(id)));
  const build=saved?.build&&typeof saved.build==='object'?saved.build:saved;
  if(saved?.primaryBranchId&&result.branches.some(b=>b.id===saved.primaryBranchId))result.primaryBranchId=saved.primaryBranchId;
  if(build&&typeof build==='object'&&!Array.isArray(build)&&validBuild(result,build))result.build={...build};
 } catch {}
 return result;
}

export function saveBrowserBuild(document,id,storage=localStorage) {
 storage.setItem(key(id),JSON.stringify(document.specialization||document.primaryBranchId||document.abilities?.some(a=>a.branchOnly)?{build:document.build,primaryBranchId:document.primaryBranchId||''}:document.build));
}
