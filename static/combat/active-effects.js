export function addStatus(statuses, ability, effect, now, delivery, details = {}) {
  const target = delivery?.ground && effect.type === 'damage' ? 'zone' : effect.target ?? (effect.type === 'damage' ? 'dummy' : 'player');
  const previous = effect.refresh === 'independent' ? undefined : statuses.find(status => status.ability.id === ability.id && status.effect.id === effect.id);
  const replace = effect.refresh === 'replace';
  previous?.removeVisual?.();
  const matching = statuses.filter(status=>status.ability.id===ability.id&&status.effect.id===effect.id);
  const overflow = effect.refresh==='independent' && matching.length >= (effect.stacks??1) ? matching[0] : undefined;
  overflow?.removeVisual?.();
  const stacks=replace||effect.refresh==='refreshOnly'?1:Math.min(effect.stacks??1,(previous?.stacks??0)+1);
  const status = {
    ability, effect, target, delivery, ...details,
    removeVisual: target === 'zone' ? delivery.placeZone?.() : undefined, stacks,
    expires: previous && effect.refresh === 'keep' ? previous.expires : previous && effect.refresh==='extend'
      ? Math.min(now+300,previous.expires+effect.duration) : now + effect.duration,
    nextTick: effect.interval ? (!replace && previous ? previous.nextTick : now + effect.interval) : Infinity
  };
  return [...statuses.filter(entry => entry !== previous && entry !== overflow), status];
}

export function modifier(statuses, target, stat) {
  return statuses.reduce((sum, status) => status.target === target && status.effect.stat === stat
    ? sum + status.effect.amount * status.stacks / 100 : sum, 0);
}

export function nextStatusBoundary(statuses) {
  return statuses.reduce((next, status) => Math.min(next, status.expires, status.nextTick), Infinity);
}
