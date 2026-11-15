// Optional declarative combat schema; limits must match server.py.
export function validateCombatEffects(ability) {
 if(!Object.hasOwn(ability,'combatEffects'))return;
 const effects=ability.combatEffects,ids=new Set();
 const invalid=()=>{throw Error('Проверь боевые эффекты');};
 if(!Array.isArray(effects)||effects.length>32)invalid();
 for(const e of effects){
  if(!e||typeof e!=='object'||Array.isArray(e))invalid();
  if(typeof e.id!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(e.id)||ids.has(e.id))invalid();
  ids.add(e.id);
  if(!['damage','healing'].includes(e.type)||!['onCast','onHit'].includes(e.trigger)||!['none','spellPower','attackPower'].includes(e.scalingStat))invalid();
  if(e.type==='damage'&&!['physical','fire','frost','arcane','nature','shadow','holy'].includes(e.school))invalid();
  if(e.type==='healing'&&Object.hasOwn(e,'school'))invalid();
  if(!Number.isFinite(e.baseAmount)||e.baseAmount<0||e.baseAmount>1e9||!Number.isFinite(e.coefficient)||e.coefficient<0||e.coefficient>1000||typeof e.canCrit!=='boolean')invalid();
  if(Object.keys(e).some(k=>!['id','type','trigger','school','baseAmount','scalingStat','coefficient','canCrit'].includes(k)))invalid();
 }
}
