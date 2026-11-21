export const controlTypes = ['stun','root','slow','fear','silence','disarm','interrupt','knockback','immunity'];
export const dispelTypes = ['magic','curse','poison','disease'];
export const advancedTypes = ['control','dispel','cooldown','state','rune'];

export function validateAdvancedEffect(effect) {
  const common=['id','type','trigger'];
  const bounded=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const fail=()=>{throw Error('Проверь боевые эффекты');};
  let fields;
  if(effect.type==='rune'){
    fields=['fromResource','toResource','count'];
    if(['fromResource','toResource'].some(key=>typeof effect[key]!=='string'||!effect[key]||effect[key].length>100)||effect.fromResource===effect.toResource||!Number.isInteger(effect.count)||!bounded(effect.count,1,6))fail();
  }else if(effect.type==='state'){
    fields=['key','value'];
    if(!['form','stance','aspect','seal','mode'].includes(effect.key)||
      typeof effect.value!=='string'||!effect.value||effect.value.length>60)fail();
  }else if(effect.type==='control'){
    fields=['name','target','controlType','duration','drGroup','dispelType','removable','breakOnDamage','amount','school'];
    if(!controlTypes.includes(effect.controlType)||!['player','dummy'].includes(effect.target)||
       typeof effect.name!=='string'||!effect.name.trim()||effect.name.length>100||
       !bounded(effect.duration,.25,300)||
       effect.drGroup!==undefined&&(typeof effect.drGroup!=='string'||!/^[A-Za-z0-9_-]{1,60}$/.test(effect.drGroup))||
       effect.amount!==undefined&&!bounded(effect.amount,0,100)||
       effect.school!==undefined&&!['physical','fire','frost','arcane','nature','shadow','holy'].includes(effect.school))fail();
  }else if(effect.type==='dispel'){
    fields=['target','dispelType','count'];
    if(!['player','dummy'].includes(effect.target)||!dispelTypes.includes(effect.dispelType)||
       !Number.isInteger(effect.count)||!bounded(effect.count,1,32))fail();
  }else if(effect.type==='cooldown'){
    fields=['abilityId','seconds','reset','charges','includeGroup'];
    if(effect.includeGroup!==undefined&&typeof effect.includeGroup!=='boolean')fail();
    if(typeof effect.abilityId!=='string'||!effect.abilityId||effect.abilityId.length>200||
       !bounded(effect.seconds,0,3600)||typeof effect.reset!=='boolean'||
       effect.charges!==undefined&&(!Number.isInteger(effect.charges)||!bounded(effect.charges,0,10)))fail();
  }else fail();
  if(Object.keys(effect).some(key=>!common.includes(key)&&!fields.includes(key)))fail();
  validateAuraMetadata(effect);
}

export function validateAuraMetadata(effect) {
  if(effect.dispelType!==undefined&&!dispelTypes.includes(effect.dispelType)||
     effect.removable!==undefined&&typeof effect.removable!=='boolean'||
     effect.breakOnDamage!==undefined&&typeof effect.breakOnDamage!=='boolean')throw Error('Проверь боевые эффекты');
}

export function auraPolarity(effect) {
  const vulnerability=['damageTaken','physicalTaken','magicalTaken'].includes(effect.stat);
  return effect.type==='damage'||effect.type==='control'&&effect.controlType!=='immunity'||
    effect.type==='status'&&(vulnerability?effect.amount>0:effect.amount<0)?'debuff':'buff';
}
