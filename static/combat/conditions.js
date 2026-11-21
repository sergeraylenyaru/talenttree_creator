// Shared predicates for authored ability modifiers and the existing proc engine.
export function conditionMatches(condition,event={},state,statuses=[],weapon,context={}){
  if(!condition)return true;
  const {type,value,resource}=condition;
  const aura=target=>statuses.filter(status=>status.target===target&&[status.effect.id,status.effect.name,status.ability.id].includes(value));
  switch(type){
    case 'all':return condition.conditions.every(child=>conditionMatches(child,event,state,statuses,weapon,context));
    case 'any':return condition.conditions.some(child=>conditionMatches(child,event,state,statuses,weapon,context));
    case 'not':return !conditionMatches(condition.condition,event,state,statuses,weapon,context);
    case 'playerBelow':return state.player.health/state.player.maxHealth*100<value;
    case 'dummyBelow':return state.dummy.health/state.dummy.maxHealth*100<value;
    case 'critical':return event.isCritical===true;
    case 'playerStatus':return aura('player').length>0;
    case 'dummyStatus':return aura('dummy').length>0;
    case 'auraStacks':return aura(condition.target).some(status=>status.stacks>=condition.stacks);
    case 'resourceAbove':return (state.player.resources[resource]?.current??-1)>value;
    case 'resourceBelow':return (state.player.resources[resource]?.current??Infinity)<value;
    case 'school':return event.school===value;
    case 'weapon':return weapon?.type===value;
    case 'state':return state.classStates?.[condition.key]===value;
    case 'talentRank':return (context.talents?.[value]??0)>=(condition.rank??1);
    case 'previousEvent':return (state.combatLog??[]).some(previous=>previous.id<(event.id??Infinity)&&previous.type===value&&
      previous.time<=state.combatTime&&previous.time>=state.combatTime-condition.window&&(!condition.abilityId||previous.abilityId===condition.abilityId));
    default:return false;
  }
}

export function visitConditions(condition,visit){
  if(!condition)return;
  visit(condition);
  for(const child of condition.conditions??[])visitConditions(child,visit);
  if(condition.condition)visitConditions(condition.condition,visit);
}
