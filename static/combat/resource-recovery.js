// A rune pair recovers one spent rune at a time. Each resource ID owns its queue.
export function createResourceRecovery(definitions) {
  const queues=new Map();
  return {
    consume(costs,now,speed=1) {
      for(const cost of costs){
        const rule=definitions[cost.resourceId];
        if(!rule?.rune||!cost.amount)continue;
        const queue=queues.get(cost.resourceId)??[];
        const duration=(rule.recharge??10)/speed;
        for(let index=0;index<cost.amount;index++)queue.push((queue.at(-1)??now)+duration);
        queues.set(cost.resourceId,queue);
      }
    },
    next() {return Math.min(Infinity,...[...queues.values()].map(queue=>queue[0]??Infinity));},
    tick(now,restore) {
      for(const [id,queue] of queues){
        while(queue.length&&queue[0]<=now){queue.shift();restore(id);}
      }
    },
    snapshot() {return Object.fromEntries([...queues].map(([id,queue])=>[id,[...queue]]));},
    reset() {queues.clear();}
  };
}
