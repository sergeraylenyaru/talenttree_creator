// Compatibility is deliberately narrower than document validity. No reset is implicit.
const signature=value=>JSON.stringify(value??null);
export function sessionCompatibility(before,after){
 const profile=build=>build.profile??{};
 if(signature(profile(before).combatRules?.version)!==signature(profile(after).combatRules?.version)||
    profile(before).combatRules?.classId!==profile(after).combatRules?.classId)return {ok:false,reason:'Изменён профиль боевых правил или базовый класс.'};
 if(profile(before).seed!==profile(after).seed)return {ok:false,reason:'Изменён seed боевой сессии.'};
 const resources=build=>(build.baseResources??build.resources).map(resource=>({id:resource.id,unit:resource.unit,
  rune:Boolean(profile(build).resources?.[resource.id]?.rune),kind:profile(build).resources?.[resource.id]?.kind??null})).sort((a,b)=>a.id.localeCompare(b.id));
 if(signature(resources(before))!==signature(resources(after)))return {ok:false,reason:'Изменены состав, единицы или тип ресурсов.'};
 if(signature(profile(before).incoming)!==signature(profile(after).incoming)||profile(before).trainingMode!==profile(after).trainingMode)return {ok:false,reason:'Изменён входящий сценарий тренировки.'};
 return {ok:true};
}

export function createPauseLeases({getPaused,setPaused,sync,onChange=()=>{}}){
 const leases=new Set();let previous;
 return {
  get active(){return leases.size>0;},
  acquire(){
   const token={};
   if(!leases.size){sync();previous=getPaused();setPaused(true);}
   leases.add(token);onChange(true);
   let released=false;
   return ()=>{if(released)return;released=true;leases.delete(token);if(!leases.size){setPaused(previous);onChange(false);}};
  }
 };
}
