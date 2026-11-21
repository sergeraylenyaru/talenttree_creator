const maximumTimeline=5000;
const entry=()=>({damage:0,healing:0,effective:0,overhealing:0,hits:0,misses:0,crits:0,
  healingHits:0,healingCrits:0,dodges:0,parries:0,blocks:0,glancing:0,blocked:0,highest:0,casts:0,spent:0,gained:0,cooldowns:0,mitigated:0,absorbed:0});

export function createSessionReport(){
  let timeline=[], discarded=0, totals=entry(), abilities=new Map(), schools={}, effects=new Map(), procs=new Map();
  let direct=0,periodic=0,auto=0,critical=0,incoming=0,incomingMitigated=0,defensiveAbsorbed=0,peakDps=0,peakHps=0;
  let buckets=new Map(),discardedBuckets=0;
  function metric(row,event){
    switch(event.type){
      case 'damage':
        row.damage+=event.amount;row.hits++;row.blocked+=event.blocked??0;row.blocks+=Number(event.outcome==='block');row.glancing+=Number(event.outcome==='glancing');row.crits+=Number(Boolean(event.isCritical));
        row.highest=Math.max(row.highest,event.amount);row.mitigated+=event.mitigated??0;break;
      case 'healing':
        row.healing+=event.amount;row.effective+=event.effective;row.overhealing+=event.overhealing;
        row.healingHits++;row.healingCrits+=Number(Boolean(event.isCritical));break;
      case 'dodge': row.dodges++;row.misses++;break;
      case 'parry': row.parries++;row.misses++;break;
      case 'miss': row.misses++;break;
      case 'block': row.blocks++;row.blocked+=event.amount;break;
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
        if(event.type==='incomingDamage'){incoming+=event.amount;incomingMitigated+=event.mitigated??0;}
        if(event.type==='absorbed'&&event.target==='player')defensiveAbsorbed+=event.amount;
        if(['damage','healing'].includes(event.type)){
          const time=Math.floor(event.time),bucket=buckets.get(time)??{time,damage:0,healing:0};
          if(event.type==='damage')bucket.damage+=event.amount;else bucket.healing+=event.effective??0;
          buckets.set(time,bucket);peakDps=Math.max(peakDps,bucket.damage);peakHps=Math.max(peakHps,bucket.healing);
          if(buckets.size>3600){buckets.delete(buckets.keys().next().value);discardedBuckets++;}
        }
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
      const series=[];
      const start=Math.max(0,Math.floor(duration)-3599);
      for(let time=start;time<=Math.floor(duration);time++){
        const bucket=buckets.get(time)??{time,damage:0,healing:0};
        series.push({...bucket,dps:bucket.damage,hps:bucket.healing});
      }
      return {
        version:1, series, droppedSeriesBuckets:discardedBuckets, duration, seed, conditions:settings, build,
        metrics:{...totals,incomingMitigated,defensiveAbsorbed,dps:rate(totals.damage),hps:rate(totals.effective),incoming,direct,periodic,auto,critical,
          peakDps,peakHps,
          missPercentage:totals.hits+totals.misses?totals.misses/(totals.hits+totals.misses)*100:0,
          average:totals.hits?totals.damage/totals.hits:0,criticalChance:totals.hits?totals.crits/totals.hits:null,
          efficiency:totals.spent?totals.damage/totals.spent:null},
        schools:{...schools},
        abilities:[...abilities].map(([id,row])=>({id,...row,percentage:totals.damage?row.damage/totals.damage*100:0,
          dps:rate(row.damage),average:row.hits?row.damage/row.hits:0,averageHealing:row.healingHits?row.healing/row.healingHits:0})),
        effects:[...effects.values()].map(present),procs:[...procs.values()].map(row=>({...row,frequency:rate(row.count)})),
        droppedTimelineEvents:discarded,timeline:timeline.slice()
      };
    },
    reset(){timeline=[];discarded=0;totals=entry();abilities=new Map();schools={};effects=new Map();procs=new Map();direct=periodic=auto=critical=incoming=incomingMitigated=defensiveAbsorbed=peakDps=peakHps=0;buckets=new Map();discardedBuckets=0;}
  };
}

export function reportCsv(report){
  const headers=['id','time','type','source','target','outcome','blocked','abilityId','abilityName','school','amount','effective','overhealing','absorbed','mitigated','statusName','procName','resourceName','resourceId','original','raw','bonus','modified','critical','isCritical','capped','overkill','periodic','auto','effectId','statusKey','auraKind','stacks','expires','controlType','dispelType','drFactor','affectedAbilityId','reason'];
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
