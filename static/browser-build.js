import {validBuild} from './engine.js';

export function withoutBuild(document) { return {...document,build:{}}; }
const key=id=>'talentforge-build:'+id;

// A publication is immutable; its visitor's allocation belongs only to this browser.
export function restoreBrowserBuild(document,id,storage=localStorage) {
 const result=withoutBuild(document);
 try {
  const build=JSON.parse(storage.getItem(key(id)));
  if(build&&typeof build==='object'&&!Array.isArray(build)&&validBuild(result,build))result.build={...build};
 } catch {}
 return result;
}

export function saveBrowserBuild(document,id,storage=localStorage) {
 storage.setItem(key(id),JSON.stringify(document.build));
}
