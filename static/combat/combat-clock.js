export function createCombatClock(now = 0) {
  let origin = now, offset = 0, rate = 1;
  return {
    time(now) { return offset + Math.max(0,now-origin)*rate/1000; },
    rebase(now, combatTime) { origin=now;offset=combatTime; },
    setRate(value, now, combatTime) {
      if(!Number.isFinite(value)||value<.1||value>4)throw new RangeError('Combat speed must be between 0.1 and 4');
      origin=now;offset=combatTime;rate=value;
    },
    get rate() { return rate; }
  };
}
