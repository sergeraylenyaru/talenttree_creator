import {stateMatches} from './rpg-profile.js';
export function conditionMatches(condition, event, state, statuses, weapon) {
  if (!condition) return true;
  const {type,value,resource}=condition;
  switch(type){
    case 'playerBelow': return state.player.health/state.player.maxHealth*100<value;
    case 'dummyBelow': return state.dummy.health/state.dummy.maxHealth*100<value;
    case 'critical': return event.isCritical===true;
    case 'playerStatus':
    case 'dummyStatus':
      return statuses.some(status=>status.target===(type==='playerStatus'?'player':'dummy') &&
        [status.effect.id,status.effect.name,status.ability.id].includes(value));
    case 'resourceAbove': return (state.player.resources[resource]?.current??-1)>value;
    case 'school': return event.school===value;
    case 'weapon': return weapon?.type===value;
    default: return false;
  }
}

export function createProcEngine(rules,random){
  const counters=new Map(), readyAt=new Map(), seen=new Set(),used=new Map();
  const ordered=[...rules].sort((a,b)=>(b.priority??0)-(a.priority??0));
  return {
    dispatch(event,state,statuses,weapon,modifyChance,execute){
      // Payload events remain in the ledger but never start another proc generation.
      if((event.depth??0)>=4||seen.has(event.id)||event.resolvedHit===false)return;
      seen.add(event.id);
      if(seen.size>1024)seen.delete(seen.values().next().value);
      const tags=[event.type];
      if(event.type==='damage'||event.type==='healing'){
        if(event.isCritical)tags.push('critical',event.type==='damage'?'criticalDamage':'criticalHeal');
        if(event.periodic)tags.push(event.type==='damage'?'periodicDamage':'periodicHealing');
      }
      for(const rule of ordered){
        if(rule.consecutive&&['damage','healing'].includes(event.type)&&!event.isCritical&&
          (!rule.sourceAbilityId||rule.sourceAbilityId===event.abilityId))counters.set(rule.id,0);
        if(!stateMatches(rule,state.classStates)||event.depth&&!rule.chain||event.procPath?.includes(rule.id)||
          (used.get(rule.id)??0)>=(rule.charges??Infinity)||
          rule.sourceAbilityId&&rule.sourceAbilityId!==event.abilityId||
          rule.school&&rule.school!==event.school||
          rule.attackType==='auto'&&!event.auto||rule.attackType==='periodic'&&!event.periodic||
          rule.attackType==='direct'&&(event.auto||event.periodic))continue;
        if(!tags.includes(rule.event)||!conditionMatches(rule.condition,event,state,statuses,weapon))continue;
        const count=(counters.get(rule.id)??0)+1;
        counters.set(rule.id,count);
        const now=state.combatTime;
        if(count%(rule.every??1)||now<(readyAt.get(rule.id)??0))continue;
        const chance=Math.max(0,Math.min(1,rule.chance+modifyChance(rule)));
        if(!chance||random()>=chance)continue;
        if(execute(rule,event)){readyAt.set(rule.id,now+rule.cooldown);used.set(rule.id,(used.get(rule.id)??0)+1);}
      }
    },
    reset(){counters.clear();readyAt.clear();seen.clear();used.clear();}
  };
}
