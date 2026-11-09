import {iconURL} from './icons.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function iconWindow(count,width,height,scrollTop,pitch=56){
 const columns=Math.max(1,Math.floor((width+8)/pitch)),rows=Math.ceil(count/columns);
 const firstRow=Math.min(Math.max(0,rows-1),Math.max(0,Math.floor(scrollTop/pitch)-2));
 const endRow=Math.min(rows,firstRow+Math.ceil(height/pitch)+5);
 return {columns,start:firstRow*columns,end:Math.min(count,endRow*columns),top:firstRow*pitch,height:rows*pitch};
}
export function createIconBrowser(root,selected,onPick){
 let items=[],frame=0,lastRange='',destroyed=false;
 const canvas=document.createElement('div');canvas.className='icon-browser-canvas';
 const window=document.createElement('div');window.className='icon-browser-window';canvas.append(window);root.replaceChildren(canvas);root.setAttribute('role','list');
 function render(force=false){
  if(destroyed||!root.clientWidth)return;
  const range=iconWindow(items.length,root.clientWidth,root.clientHeight,root.scrollTop),key=[range.start,range.end,range.columns].join(':');
  canvas.style.height=range.height+'px';root.dataset.total=String(items.length);
  if(!force&&key===lastRange)return;lastRange=key;
  window.style.top=range.top+'px';window.style.gridTemplateColumns=`repeat(${range.columns},minmax(0,1fr))`;
  window.innerHTML=items.slice(range.start,range.end).map((item,i)=>`<button type="button" role="listitem" class="icon-choice ${item.id===selected()?'active':''}" data-icon="${esc(item.id)}" data-icon-index="${range.start+i}" title="${esc(item.label+(item.tags?' · '+item.tags:''))}" aria-label="${esc(item.label)}" ${item.id.startsWith('custom:')?'data-user-content':''}><span aria-hidden="true">✦</span><img data-fit-icon src="${esc(iconURL(item.id))||'missing-icon'}" alt="" loading="lazy" draggable="false"></button>`).join('');
 }
 const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>render());};
 const resize=new ResizeObserver(()=>render(true));resize.observe(root);root.addEventListener('scroll',schedule);
 const click=e=>{const button=e.target.closest('[data-icon]');if(button)onPick(button.dataset.icon);};root.addEventListener('click',click);
 const keydown=e=>{
  const button=e.target.closest('[data-icon-index]');if(!button)return;
  const columns=iconWindow(items.length,root.clientWidth,root.clientHeight,root.scrollTop).columns,index=Number(button.dataset.iconIndex);
  const delta={ArrowRight:1,ArrowLeft:-1,ArrowDown:columns,ArrowUp:-columns,PageDown:columns*Math.max(1,Math.floor(root.clientHeight/56)),PageUp:-columns*Math.max(1,Math.floor(root.clientHeight/56))}[e.key];
  if(delta===undefined&&!['Home','End'].includes(e.key))return;e.preventDefault();
  const next=Math.max(0,Math.min(items.length-1,e.key==='Home'?0:e.key==='End'?items.length-1:index+delta));
  const top=Math.floor(next/columns)*56;if(top<root.scrollTop||top+48>root.scrollTop+root.clientHeight)root.scrollTop=top;
  render(true);root.querySelector(`[data-icon-index="${next}"]`)?.focus({preventScroll:true});
 };root.addEventListener('keydown',keydown);
 return {setItems(next){items=next;root.dataset.total=String(items.length);render(true);},refresh(){render(true);},destroy(){destroyed=true;cancelAnimationFrame(frame);resize.disconnect();root.removeEventListener('scroll',schedule);root.removeEventListener('click',click);root.removeEventListener('keydown',keydown);}};
}
