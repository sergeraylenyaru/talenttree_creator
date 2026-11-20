export const trainingWeapon = {swingSeconds: 2, windupSeconds: 0.3, damage: 55};

export function createAutoAttack(weapon = trainingWeapon) {
  const {swingSeconds, windupSeconds} = weapon;
  let status = {active: false};
  let due;
  let winding;

  function stop() {
    status = {active: false};
    due = undefined;
    winding = false;
  }

  return {
    get status() { return status; },
    stop,
    start(report) {
      if (status.active) return;
      status = {active: true, remaining: swingSeconds, progress: 0};
      report('autoStarted');
    },
    update(now, delivery, report, impact) {
      if (!status.active) return;
      const reason = delivery ? delivery.validate() : 'invalidTarget';
      if (reason === 'invalidTarget' || reason === 'dummyDead') {
        stop();
        return;
      }
      if (reason) {
        if (winding) report('attackMissed', {reason});
        if (status.reason !== reason) report('autoWaiting', {reason});
        winding = false;
      } else {
        const first = due === undefined;
        if (first) due = now;
        if (!winding && now >= due - windupSeconds) {
          delivery.autoPose(now, windupSeconds);
          winding = true;
        }
        if (now >= due) {
          if (delivery.autoContact()) impact(delivery, first ? now : due - swingSeconds);
          due = now + swingSeconds;
          winding = false;
        }
      }
      const remaining = due === undefined ? swingSeconds : Math.max(0, due - now);
      status = {active: true, reason, remaining, progress: reason ? 0 : 1 - remaining / swingSeconds};
    }
  };
}
