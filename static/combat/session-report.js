const maximumTimeline=5000;
const entry=()=>({damage:0,healing:0,effective:0,overhealing:0,hits:0,misses:0,crits:0,
  healingHits:0,healingCrits:0,highest:0,casts:0,spent:0,gained:0,cooldowns:0,mitigated:0,absorbed:0});

export function createSessionReport(){
  let timeline=[], discarded=0, totals=entry(), abilities=new Map(), schools={}, effects=new Map(), procs=new Map();
  let direct=0,periodic=0,auto=0,critical=0, incoming=0;
  function metric(row,event){
    switch(event.type){
      case 'damage':
        row.damage+=event.amount;row.hits++;row.crits+=Number(Boolean(event.isCritical));
        row.highest=Math.max(row.highest,event.amount);row.mitigated+=event.mitigated??0;break;
      case 'healing':
        row.healing+=event.amount;row.effective+=event.effective;row.overhealing+=event.overhealing;
        row.healingHits++;row.healingCrits+=Number(Boolean(event.isCritical));break;
      case 'projectileMissed':
      case 'attackMissed': row.misses++;break;
      case 'castCompleted': row.casts++;break;
      case 'resourceSpent': row.spent+=event.amount;break;
      case 'resourceGained': row.gained+=event.amount;break;
      case 'cooldownStarted': row.cooldowns++;break;
      case 'absorbed': row.absorbed+=event.amount;break;
    }
  }
  function effectMetric(event){
    if(!event.statusKey)return;
    const row=effects.get(event.statusKey)??{id:event.statusKey,name:event.statusName,applications:0,instances:0,individualTime:0,
      uptime:0,stacks:0,damage:0,healing:0,active:new Map()};
    const token=event.statusInstance??event.statusKey;
    if(event.type==='statusApplied'){
      row.applications++;row.stacks=Math.max(row.stacks,event.stacks??1);
      if(!row.active.size)row.since=event.time;
      const active=row.active.get(token);
      if(!active)row.instances++;
      row.active.set(token,{since:active?.since??event.time,expires:event.expires});
    } else if(event.type==='statusExpired'){
      const instance=row.active.get(token);
      if(instance)row.individualTime+=Math.max(0,event.time-instance.since);
      row.active.delete(token);
      if(!row.active.size&&row.since!==undefined){row.uptime+=Math.max(0,event.time-row.since);delete row.since;}
    } else if(event.type==='damage')row.damage+=event.amount;
    else if(event.type==='healing')row.healing+=event.effective;
    effects.set(event.statusKey,row);
  }
  return {
    add(events){
      for(const event of events){
        timeline.push(event);
        const id=event.abilityId;
        const row=abilities.get(id)??{name:event.abilityName,...entry()};
        metric(row,event);metric(totals,event);
        if(id)abilities.set(id,row);
        if(event.type==='damage'){
          schools[event.school]=(schools[event.school]??0)+event.amount;
          if(event.periodic)periodic+=event.amount; else direct+=event.amount;
          if(event.auto)auto+=event.amount;
          if(event.isCritical)critical+=event.amount;
        }
        if(event.type==='incomingDamage')incoming+=event.amount;
        if(event.type==='procTriggered'){
          const row=procs.get(event.procId)??{id:event.procId,name:event.procName,count:0};
          row.count++;procs.set(event.procId,row);
        }
        effectMetric(event);
      }
      if(timeline.length>maximumTimeline){const count=timeline.length-maximumTimeline;discarded+=count;timeline.splice(0,count);}
    },
    snapshot(duration,build,settings,seed){
      const rate=value=>duration>0?value/duration:0;
      const present=({active,since,individualTime,instances,...row})=>{
        let until=0;
        for(const instance of active.values()){
          const end=Math.min(duration,instance.expires);
          until=Math.max(until,end);
          individualTime+=Math.max(0,end-instance.since);
        }
        const uptime=row.uptime+(since===undefined?0:Math.max(0,until-since));
        return {...row,uptime,uptimePercent:duration?uptime/duration*100:0,averageDuration:instances?individualTime/instances:0};
      };
      return {
        version:1, duration, seed, conditions:settings, build,
        metrics:{...totals,dps:rate(totals.damage),hps:rate(totals.effective),incoming,direct,periodic,auto,critical,
          average:totals.hits?totals.damage/totals.hits:0,criticalChance:totals.hits?totals.crits/totals.hits:null,
          efficiency:totals.spent?totals.damage/totals.spent:null},
        schools:{...schools},
        abilities:[...abilities].map(([id,row])=>({id,...row,percentage:totals.damage?row.damage/totals.damage*100:0,
          dps:rate(row.damage),average:row.hits?row.damage/row.hits:0,averageHealing:row.healingHits?row.healing/row.healingHits:0})),
        effects:[...effects.values()].map(present),procs:[...procs.values()].map(row=>({...row,frequency:rate(row.count)})),
        droppedTimelineEvents:discarded,timeline:timeline.slice()
      };
    },
    reset(){timeline=[];discarded=0;totals=entry();abilities=new Map();schools={};effects=new Map();procs=new Map();direct=periodic=auto=critical=incoming=0;}
  };
}

export function reportCsv(report){
  const headers=['id','time','type','abilityId','abilityName','school','amount','effective','overhealing','absorbed','mitigated','statusName','procName','resourceName'];
  const escape=value=>{
    let cell=String(value??'');
    if(typeof value==='string'&&/^[\s]*[=+@-]/.test(cell))cell="'"+cell;
    return '"'+cell.replaceAll('"','""')+'"';
  };
  return [
    ['report_version','duration','class','seed','build','conditions'].join(','),
    [report.version,report.duration,report.build.name,report.seed,JSON.stringify(report.build),JSON.stringify(report.conditions)].map(escape).join(','),'',
    headers.join(','),...report.timeline.map(event=>headers.map(key=>escape(event[key])).join(','))
  ].join('\r\n');
}

export function compareReports(left,right){
  const comparable=left.duration===right.duration&&left.seed===right.seed&&
    JSON.stringify(left.conditions)===JSON.stringify(right.conditions);
  const stats=Object.keys({...left.build.stats,...right.build.stats}).map(key=>({
    key,left:left.build.stats[key],right:right.build.stats[key]
  })).filter(row=>typeof row.left==='number'||typeof row.right==='number').filter(row=>row.left!==row.right);
  const gear=Object.keys({...left.build.equipment,...right.build.equipment}).flatMap(slot=>{
    const a=left.build.equipment[slot],b=right.build.equipment[slot];
    return JSON.stringify(a)===JSON.stringify(b)?[]:[{slot,left:a?.name,right:b?.name}];
  });
  return {comparable,stats,gear};
}

export function seededRandom(seed){
  let value=seed>>>0;
  return ()=>{
    value=(Math.imul(value,1664525)+1013904223)>>>0;
    return value/4294967296;
  };
}
