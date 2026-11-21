import {seededRandom} from './session-report.js';
// Authored item tuning, not Blizzard's random-affix pool. Persist the result once.
export function rollItemStats(item,seed,spread=.2) {
  if(!Number.isInteger(seed)||seed<0||seed>4294967295||!Number.isFinite(spread)||spread<0||spread>1)throw Error('Invalid item roll');
  const next=structuredClone(item),base=structuredClone(item.roll?.baseStats??item.stats??{});
  if(!Object.keys(base).length)throw Error('Enter item stat bonuses before rolling');
  const random=seededRandom(seed);
  next.stats=Object.fromEntries(Object.entries(base).map(([key,value])=>{
    let result=value*(1-spread+random()*2*spread);
    result=key==='critChance'?Math.max(-1,Math.min(1,result)):Math.round(Math.max(-1e8,Math.min(1e8,result))*100)/100;
    return [key,result];
  }));
  next.roll={seed,spread,baseStats:base};
  return next;
}
