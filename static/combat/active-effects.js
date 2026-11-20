export function addStatus(statuses, ability, effect, now, delivery) {
  const target = delivery?.ground && effect.type === 'damage' ? 'zone' : effect.target ?? (effect.type === 'damage' ? 'dummy' : 'player');
  const previous = statuses.find(status => status.ability.id === ability.id && status.effect.id === effect.id);
  const replace = effect.refresh === 'replace';
  previous?.removeVisual?.();
  const status = {
    ability, effect, target, delivery,
    removeVisual: target === 'zone' ? delivery.placeZone?.() : undefined, stacks: replace ? 1 : Math.min(effect.stacks ?? 1, (previous?.stacks ?? 0) + 1),
    expires: previous && effect.refresh === 'keep' ? previous.expires : now + effect.duration,
    nextTick: effect.interval ? (!replace && previous ? previous.nextTick : now + effect.interval) : Infinity
  };
  return [...statuses.filter(entry => entry !== previous), status];
}

export function modifier(statuses, target, stat) {
  return statuses.reduce((sum, status) => status.target === target && status.effect.stat === stat
    ? sum + status.effect.amount * status.stacks / 100 : sum, 0);
}

export function nextStatusBoundary(statuses) {
  return statuses.reduce((next, status) => Math.min(next, status.expires, status.nextTick), Infinity);
}
