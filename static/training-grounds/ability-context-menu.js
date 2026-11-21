import {t,addTranslations} from '../i18n.js';
addTranslations([['Редактировать','Edit'],['Базовая автоатака настраивается в экипировке.','Configure basic autoattack in Equipment.'],['Редактирование этого класса недоступно.','This class cannot be edited here.']]);

export function mountAbilityContextMenu(host,{resolve,pause,edit,feedback}){
 const controller=new AbortController(),options={signal:controller.signal};let menu,release;
 function close(){menu?.remove();menu=undefined;release?.();release=undefined;}
 host.addEventListener('pointerdown',event=>{if(event.button===2&&event.target.closest('[data-world-slot]')){event.preventDefault();event.stopPropagation();}},options);
 host.addEventListener('contextmenu',event=>{
  const slot=event.target.closest('[data-world-slot]');if(!slot)return;
  event.preventDefault();event.stopPropagation();close();
  const id=slot.dataset.worldAbility;if(!id)return;
  const result=resolve(id);if(!result?.allowed){if(result?.message)feedback?.(t(result.message));return;}
  release=pause();menu=document.createElement('div');menu.className='tg-ability-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',slot.getAttribute('aria-label'));
  const item=document.createElement('button');item.type='button';item.setAttribute('role','menuitem');item.textContent=t('Редактировать');
  item.onclick=()=>{const done=pause();close();try{edit(id,done);}catch(error){done();feedback?.(error.message);}};
  const surface=host.closest('.tg-world-frame')??host;
  menu.append(item);surface.append(menu);menu.oncontextmenu=event=>event.preventDefault();
  const bounds=slot.getBoundingClientRect(),parent=surface.getBoundingClientRect(),size=menu.getBoundingClientRect();
  menu.style.left=Math.max(0,Math.min(parent.width-size.width,bounds.left-parent.left))+'px';
  menu.style.top=Math.max(0,Math.min(parent.height-size.height,bounds.top-parent.top-size.height-4))+'px';
  item.focus({preventScroll:true});
 },options);
 document.addEventListener('pointerdown',event=>{if(menu&&!menu.contains(event.target))close();},{...options,capture:true});
 window.addEventListener('keydown',event=>{
  if(!menu)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}
  else if(/^[1-9]$/.test(event.key)||['KeyW','KeyA','KeyS','KeyD','Space'].includes(event.code)){event.preventDefault();event.stopImmediatePropagation();}
 },{...options,capture:true});
 return {close,dispose(){close();controller.abort();}};
}
