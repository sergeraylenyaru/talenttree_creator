import {iconURL} from './icons.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validateClassIcon(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['background','layers','glow'].includes(k))||(value.background!==undefined&&(typeof value.background!=='string'||!/^#[0-9a-f]{6}$/i.test(value.background)))||!Array.isArray(value.layers)||value.layers.length<1||value.layers.length>2)throw Error('Проверь фон и один или два слоя иконки класса');
 if(value.glow!==undefined){const g=value.glow;if(!g||typeof g!=='object'||Object.keys(g).sort().join(',')!=='color,radius,strength'||typeof g.color!=='string'||!/^#[0-9a-f]{6}$/i.test(g.color)||!finite(g.radius,0,100)||!finite(g.strength,0,100))throw Error('Проверь цвет, радиус и яркость свечения');}
 for(const layer of value.layers){
  if(!layer||typeof layer!=='object'||Object.keys(layer).some(k=>!['icon','opacity','x','y','scale','rotation'].includes(k))||typeof layer.icon!=='string'||!layer.icon||!iconURL(layer.icon)||!finite(layer.opacity,0,1))throw Error('Проверь иконку слоя и непрозрачность');
  for(const [key,min,max] of [['x',-100,100],['y',-100,100],['scale',.75,1.5],['rotation',-180,180]])if(layer[key]!==undefined&&!finite(layer[key],min,max))throw Error('Проверь положение, масштаб 75–150% и угол слоя');
 }
 return value;
}
export function defaultClassIcon(icon='inv_misc_questionmark'){return {layers:[{icon,opacity:1}]};}
export function classEmblem(value,fallback='inv_misc_questionmark'){
 let model;try{model=validateClassIcon(value);}catch{model=defaultClassIcon(fallback||'inv_misc_questionmark');}
 return `<span class="class-emblem" aria-label="Эмблема класса">${model.layers.map(layer=>`<img src="${esc(iconURL(layer.icon))}" data-fit-icon alt="" draggable="false" loading="lazy" style="opacity:${layer.opacity};transform:rotate(${layer.rotation??0}deg) translate(${layer.x??0}%,${layer.y??0}%) scale(${layer.scale??1});transform-origin:50% 50%">`).join('')}</span>`;
}
