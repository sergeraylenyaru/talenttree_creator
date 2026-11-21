// Explicit author-defined progression; no invented official class/level tables.
export function progressionValues(profile) {
  const rules=profile?.progression;
  if(!rules)return {attributes:{},health:0,resources:{}};
  const levels=Math.max(0,(profile.level??1)-rules.baseLevel);
  return {attributes:Object.fromEntries(Object.entries(rules.attributesPerLevel??{}).map(([key,value])=>[key,value*levels])),
    health:(rules.healthPerLevel??0)*levels,
    resources:Object.fromEntries(Object.entries(rules.resourcePerLevel??{}).map(([key,value])=>[key,value*levels]))};
}
