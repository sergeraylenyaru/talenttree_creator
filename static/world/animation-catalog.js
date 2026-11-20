const catalog=new Map();

export function localAnimationNames(role='hero') {
  if(!catalog.has(role))catalog.set(role,discover(role).catch(()=>[]));
  return catalog.get(role);
}

async function discover(role) {
  const manifest=await fetch('/local-world-assets/manifest.json');
  if(!manifest.ok)return [];
  const data=await manifest.json();
  const model=role==='target'?data.target?.model:data.model;
  const directory=role==='target'?'targets/':'character/';
  if(typeof model!=='string'||!model.startsWith(directory))return [];
  const path=model.split('/').map(encodeURIComponent).join('/');
  const response=await fetch('/local-world-assets/'+path+'?animations=1');
  if(!response.ok)return [];
  const {animations}=await response.json();
  return animations;
}
