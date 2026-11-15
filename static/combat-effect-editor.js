import {validateCombatEffects} from './engine.js';
const types=[['damage','Урон'],['healing','Лечение']];
const triggers=[['onCast','При применении'],['onHit','При попадании']];
const schools=[['physical','Физический'],['fire','Огонь'],['frost','Лёд'],['arcane','Тайная магия'],['nature','Природа'],['shadow','Тьма'],['holy','Свет']];
const stats=[['none','Без масштабирования'],['spellPower','Сила заклинаний'],['attackPower','Сила атаки']];
const options=(choices,value)=>choices.map(([id,label])=>`<option value="${id}" ${id===value?'selected':''}>${label}</option>`).join('');
export function combatEffectEditor(root,ability){
 let effects=structuredClone(ability.combatEffects||[]),touched=false;
 function capture(){
  for(const [i,row] of [...root.querySelectorAll('[data-combat-row]')].entries()){
   const e=effects[i];
   for(const key of ['type','trigger','scalingStat'])e[key]=row.querySelector(`[data-key="${key}"]`).value;
   for(const key of ['baseAmount','coefficient'])e[key]=row.querySelector(`[data-key="${key}"]`).valueAsNumber;
   e.canCrit=row.querySelector('[data-key="canCrit"]').checked;
   if(e.type==='damage')e.school=row.querySelector('[data-key="school"]')?.value||'physical';else delete e.school;
  }
 }
 function render(){
  root.innerHTML=`<section class="combat-effects"><h3>${'БОЕВЫЕ ЭФФЕКТЫ'}</h3><div class="combat-effect-list">${effects.map(e=>`<fieldset data-combat-row><legend>${(e.type==='damage'?'Урон':'Лечение')}</legend><div class="ability-selectors">${select('type','Тип эффекта',types,e.type)}${select('trigger','Срабатывание',triggers,e.trigger)}${e.type==='damage'?select('school','Школа урона',schools,e.school):''}${select('scalingStat','Характеристика масштабирования',stats,e.scalingStat)}${number('baseAmount','Базовая величина',e.baseAmount,1e9)}${number('coefficient','Коэффициент масштабирования',e.coefficient,1000)}</div><label><input type="checkbox" data-key="canCrit" ${e.canCrit?'checked':''}> ${(e.type==='damage'?'Может критически ударить':'Может критически исцелить')}</label><button type="button" data-remove>${'Удалить эффект'}</button></fieldset>`).join('')}</div><button type="button" data-add ${effects.length>=32?'disabled':''}>${'＋ Добавить эффект'}</button></section>`;
  root.querySelector('[data-add]').onclick=()=>{capture();touched=true;effects.push({id:crypto.randomUUID(),type:'damage',trigger:'onHit',school:'physical',baseAmount:0,scalingStat:'none',coefficient:0,canCrit:false});render();};
  root.querySelectorAll('[data-remove]').forEach((button,i)=>button.onclick=()=>{capture();touched=true;effects.splice(i,1);render();});
  root.querySelectorAll('[data-key="type"]').forEach(input=>input.onchange=()=>{capture();touched=true;render();});
 }
 function select(key,label,choices,value){return `<label>${label}<select data-key="${key}">${options(choices,value)}</select></label>`;}
 function number(key,label,value,max){return `<label>${label}<input data-key="${key}" type="number" min="0" max="${max}" step="any" required value="${value}"></label>`;}
 render();
 return ()=>{capture();if(!touched&&!Object.hasOwn(ability,'combatEffects'))return undefined;validateCombatEffects({combatEffects:effects});return structuredClone(effects);};
}
