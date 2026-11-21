import {addTranslations,t} from '../i18n.js';
addTranslations([['Настроить интерфейс','Edit interface'],['Сбросить расположение','Reset layout'],
  ['Герой','Hero'],['Цель','Target'],['Панель способностей','Action bars'],['Применение','Casting'],['Аналитика','Meter'],['Журнал','Log']]);

// Only explicit edit handles capture input. The regular HUD retains camera controls.
export function mountHudLayout(frame,toolbar,panels,key,preview=false) {
  const storageKey='talentforge-hud-layout-v1:'+JSON.stringify(key);
  let positions={},editing=false;
  try{if(!preview)positions=JSON.parse(localStorage.getItem(storageKey))??{};}catch{/* Optional browser storage. */}
  const toggle=document.createElement('button');toggle.type='button';toggle.className='tg-layout-toggle';
  toggle.textContent=t('Настроить интерфейс');toggle.setAttribute('aria-pressed','false');
  const reset=document.createElement('button');reset.type='button';reset.textContent=t('Сбросить расположение');reset.hidden=true;
  toolbar.append(toggle,reset);
  const handles=[],applied=new WeakMap();
  const save=()=>{try{if(!preview)localStorage.setItem(storageKey,JSON.stringify(positions));}catch{/* Keep the session layout. */}};
  function apply(node,id) {
    const point=positions[id];
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return;
    const bounds=frame.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    const stamp=[point.x,point.y,bounds.width,bounds.height,node.hidden].join(':');
    if(applied.get(node)===stamp)return;
    const box=node.getBoundingClientRect();
    applied.set(node,stamp);
    const x=Math.max(0,Math.min(Math.max(0,100-box.width/bounds.width*100),point.x));
    const y=Math.max(0,Math.min(Math.max(0,100-box.height/bounds.height*100),point.y));
    node.style.position='absolute';node.style.left=x+'%';node.style.top=y+'%';
    node.style.bottom='auto';node.style.right='auto';node.style.transform='none';node.style.margin='0';
  }
  for(const [id,node,title] of panels){
    if(!node)continue;
    const original=node.getAttribute('style');
    const handle=document.createElement('button');handle.type='button';handle.className='tg-layout-handle';
    handle.textContent=t(title);handle.hidden=true;handle.setAttribute('aria-label',t('Настроить интерфейс')+' · '+t(title));
    node.prepend(handle);handles.push({node,id,handle,original});
    let drag;
    handle.onpointerdown=event=>{
      if(!editing||event.button!==0)return;
      event.preventDefault();event.stopPropagation();
      const box=node.getBoundingClientRect(),bounds=frame.getBoundingClientRect();
      drag={x:event.clientX-box.left,y:event.clientY-box.top,bounds};handle.setPointerCapture(event.pointerId);
    };
    handle.onpointermove=event=>{
      if(!drag)return;
      event.preventDefault();event.stopPropagation();
      positions[id]={x:(event.clientX-drag.x-drag.bounds.left)/drag.bounds.width*100,
        y:(event.clientY-drag.y-drag.bounds.top)/drag.bounds.height*100};apply(node,id);
    };
    const finish=event=>{if(drag){event.stopPropagation();drag=undefined;save();}};
    handle.onpointerup=finish;handle.onpointercancel=finish;
    handle.onclick=event=>event.stopPropagation();
  }
  toggle.onclick=()=>{
    editing=!editing;toggle.setAttribute('aria-pressed',String(editing));reset.hidden=!editing;
    for(const {handle,node} of handles){handle.hidden=!editing;applied.delete(node);}
  };
  reset.onclick=()=>{
    positions={};save();
    for(const {node,original} of handles){applied.delete(node);if(original===null)node.removeAttribute('style');else node.setAttribute('style',original);}
  };
  return {
    apply(){for(const {node,id} of handles)apply(node,id);},
    suspend(){
      editing=false;toggle.setAttribute('aria-pressed','false');reset.hidden=true;
      for(const {node,handle,original} of handles){
        handle.hidden=true;applied.delete(node);
        if(original===null)node.removeAttribute('style');else node.setAttribute('style',original);
      }
    }
  };
}
