import {partialPresetSpells,unsupportedPresetSpells} from './preset-spells.js';

export function abilityReadiness(document, ability) {
  if (!ability) return {state:'broken',message:'Способность таланта не найдена'};
  if (ability.learningMode==='talent'&&!document.branches.some(branch=>branch.talents.some(talent=>
    talent.id===ability.talentId||talent.grantedAbilityId===ability.id))) {
    return {state:'broken',message:'Укажи талант, который открывает способность.'};
  }
  const effects=ability.combatEffects??[];
  if (ability.workshop?.disabled || ability.workshop?.hidden) return {state:'disabled',message:'Отключена для боя'};
  const partial=Object.hasOwn(partialPresetSpells,ability.id)&&partialPresetSpells[ability.id];
  if (ability.kind==='passive') {
    const rules=[...(document.rpg?.bonuses??[]),...(document.rpg?.procs??[])];
    const owned=rules.some(rule=>rule.owner.kind==='passive'&&rule.owner.id===ability.id);
    const aura=effects.some(effect=>effect.type==='status'&&effect.target==='player'&&!effect.consumeOnHit);
    if (owned||aura) return partial?{state:'partial',message:partial}:{state:'ready',message:'Пассивный эффект настроен'};
    if (effects.length) return {state:'partial',message:'Для этих пассивных эффектов нужен триггер в настройках персонажа.'};
  } else if (effects.length||ability.presentation?.category==='movement') {
    return partial?{state:'partial',message:partial}:{state:'ready',message:'Боевой эффект настроен'};
  }
  if (Object.hasOwn(unsupportedPresetSpells,ability.id)) return {state:'unsupported',message:unsupportedPresetSpells[ability.id]};
  return {state:'noEffects',message:'Нет исполняемых боевых эффектов'};
}
