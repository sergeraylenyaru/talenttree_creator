// Each original rune pair owns its serial queue, even while its rune is converted.
export function createResourceRecovery(definitions) {
  const queues=new Map(),convertedReady=new Map();let rate=1;
  return {
    updateDefinitions(next){definitions=next;},
    consume(costs,now,speed=1) {
      this.retime(now,speed);
      for(const cost of costs){
        if(!definitions[cost.resourceId]?.rune||!cost.amount)continue;
        for(let index=0;index<cost.amount;index++){
          const ready=convertedReady.get(cost.resourceId)??[];
          const base=ready.shift()??cost.resourceId;
          const queue=queues.get(base)??[],duration=(definitions[base].recharge??10)/speed;
          queue.push({at:(queue.at(-1)?.at??now)+duration,base,restore:base});queues.set(base,queue);
        }
      }
    },
    retime(now,speed=1){
      if(!Number.isFinite(speed)||speed<=0||speed===rate)return;
      const ratio=rate/speed;
      for(const queue of queues.values())for(const rune of queue)rune.at=now+Math.max(0,rune.at-now)*ratio;
      rate=speed;
    },
    convert(from,to,count){
      if(!definitions[from]?.rune||!definitions[to]?.rune||from===to)return 0;
      let converted=0;
      for(const rune of queues.get(from)??[]){
        if(converted>=count)break;
        if(rune.restore!==from)continue;
        rune.restore=to;converted++;
      }
      return converted;
    },
    next() {return Math.min(Infinity,...[...queues.values()].map(queue=>queue[0]?.at??Infinity));},
    tick(now,restore) {
      for(const queue of queues.values()){
        while(queue.length&&queue[0].at<=now){
          const rune=queue.shift();
          if(restore(rune.restore)===false){if(rune.restore!==rune.base)restore(rune.base);continue;}
          if(rune.restore!==rune.base){const ready=convertedReady.get(rune.restore)??[];ready.push(rune.base);convertedReady.set(rune.restore,ready);}
        }
      }
    },
    snapshot() {return Object.fromEntries([...queues].map(([id,queue])=>[id,queue.map(rune=>rune.at)]));},
    details(){return {queues:Object.fromEntries([...queues].map(([id,queue])=>[id,queue.map(rune=>({...rune}))])),convertedReady:Object.fromEntries([...convertedReady].map(([id,entries])=>[id,[...entries]]))};},
    reset() {queues.clear();convertedReady.clear();rate=1;}
  };
}

export function substituteRuneCosts(costs,resources,definitions,substitute){
  if(!substitute||!definitions[substitute]?.rune)return costs;
  const reserved=costs.filter(cost=>cost.resourceId===substitute).reduce((sum,cost)=>sum+cost.amount,0);
  let remaining=Math.max(0,(resources[substitute]?.current??0)-reserved),substituted=0;
  const result=costs.map(cost=>{
    if(cost.resourceId===substitute||!definitions[cost.resourceId]?.rune)return cost;
    const missing=Math.min(remaining,Math.max(0,cost.amount-(resources[cost.resourceId]?.current??0)));
    remaining-=missing;substituted+=missing;return {...cost,amount:cost.amount-missing};
  });
  return substituted?[...result,{resourceId:substitute,amount:substituted,unit:'count',resourceName:resources[substitute]?.name}]:costs;
}
