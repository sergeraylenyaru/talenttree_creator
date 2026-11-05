import {iconURL} from './icons.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateClassIcon(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='background,layers'||!/^#[0-9a-f]{6}$/i.test(value.background)||!Array.isArray(value.layers)||value.layers.length<1||value.layers.length>2)throw Error('Проверь фон и один или два слоя иконки класса');
 for(const layer of value.layers)if(!layer||typeof layer!=='object'||Object.keys(layer).sort().join(',')!=='icon,opacity'||typeof layer.icon!=='string'||!layer.icon||!iconURL(layer.icon)||typeof layer.opacity!=='number'||!Number.isFinite(layer.opacity)||layer.opacity<0||layer.opacity>1)throw Error('Проверь иконку слоя и прозрачность от 0 до 100%');
 return value;
}
export function defaultClassIcon(icon='inv_misc_questionmark'){return {background:'#161b25',layers:[{icon,opacity:1}]};}
export function classEmblem(value,fallback='inv_misc_questionmark'){
 let model;try{model=validateClassIcon(value);}catch{model=defaultClassIcon(fallback||'inv_misc_questionmark');}
 return `<span class="class-emblem" style="background-color:${model.background}" aria-label="Эмблема класса">${model.layers.map(layer=>`<img src="${esc(iconURL(layer.icon))}" alt="" draggable="false" loading="lazy" style="opacity:${layer.opacity}">`).join('')}</span>`;
}
