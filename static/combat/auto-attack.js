export const trainingWeapon = {swingSeconds: 2, windupSeconds: 0.3, damage: 55};

export function createAutoAttack(weapon = trainingWeapon) {
  let {swingSeconds} = weapon;
  const {windupSeconds} = weapon;
  let status = {active: false};
  let due;
  let winding,suspended,remainingOnPause,hasSwung=false;

  function stop() {
    status = {active: false};
    due = undefined;
    winding = false;hasSwung=false;suspended=false;remainingOnPause=undefined;
  }

  function retime(now,interval){
    if(!Number.isFinite(interval)||interval<=0||interval===swingSeconds)return;
    const ratio=interval/swingSeconds;
    if(suspended&&remainingOnPause!==undefined)remainingOnPause*=ratio;
    else if(due!==undefined&&due>now)due=now+(due-now)*ratio;
    swingSeconds=interval;
  }

  return {
    inspect(){return {status:{...status},due,winding,suspended,remainingOnPause,hasSwung,swingSeconds};},
    get status() { return status; },
    stop,
    start(report,now) {
      if (status.active) return;
      status = {active: true, remaining: swingSeconds, progress: 0};
      if(Number.isFinite(now))due=now;
      report('autoStarted');
    },
    suspend(now,value,reset=false){
      if(value&&!suspended){remainingOnPause=reset?swingSeconds:Math.max(0,(due??now)-now);suspended=true;winding=false;}
      else if(!value&&suspended){due=now+(remainingOnPause??0);suspended=false;remainingOnPause=undefined;}
    },
    nextAt(now,interval=swingSeconds){
      retime(now,interval);
      if(!status.active||suspended||status.reason)return Infinity;
      return due===undefined?now:Math.max(now,winding?due:due-windupSeconds);
    },
    update(now, delivery, report, impact, interval = swingSeconds) {
      retime(now,interval);
      if (!status.active||suspended) return;
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
        if (first||status.reason) due = now;
        if (!winding && now >= due - windupSeconds) {
          delivery.autoPose(now, windupSeconds);
          winding = true;
        }
        while(now+1e-9>=due&&status.active){
          if(delivery.validate())break;
          if(delivery.autoContact())impact(delivery,hasSwung?due-swingSeconds:due,due);
          hasSwung=true;
          due+=swingSeconds;winding=false;
        }
      }
      const remaining = due === undefined ? swingSeconds : Math.max(0, due - now);
      status = {active: true, reason, remaining, progress: reason ? 0 : 1 - remaining / swingSeconds};
    }
  };
}
