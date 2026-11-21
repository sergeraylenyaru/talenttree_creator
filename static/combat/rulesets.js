// The existing Talent Forge rules remain the default for saved documents.
export const rulesets = ['talentforge-v1','cataclysm-4.3.4'];
export const combatClasses = ['warrior','paladin','hunter','rogue','priest','shaman','mage','warlock','druid','deathknight'];
export const ratingStats = ['hitRating','spellHitRating','expertiseRating','critRating','hasteRating','masteryRating',
  'dodgeRating','parryRating','blockRating','spellPenetration','armorPenetration','hitChance','spellHitChance',
  'expertise','dodgeChance','parryChance','blockChance'];
const at85 = {hitRating:120.109,spellHitRating:102.446,expertiseRating:30.0272,critRating:179.28,
  hasteRating:128.057,masteryRating:179.28,dodgeRating:176.719,parryRating:176.719,blockRating:88.359};
const primaryPower = {
  warrior:['strength',2],paladin:['strength',2],hunter:['agility',2],rogue:['agility',2],
  priest:['intellect',1],shaman:['agility',2],mage:['intellect',1],warlock:['intellect',1],
  druid:['agility',2],deathknight:['strength',2]
};

export function validateCombatRules(profile) {
  const rules = profile.combatRules;
  if (rules === undefined) return;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules) ||
      Object.keys(rules).some(key=>!['version','classId','targetLevel','ratingScale','position'].includes(key)) ||
      !rulesets.includes(rules.version) || !combatClasses.includes(rules.classId) ||
      rules.targetLevel!==undefined && (!Number.isInteger(rules.targetLevel)||rules.targetLevel<1||rules.targetLevel>1000) ||
      rules.ratingScale!==undefined && (!Number.isFinite(rules.ratingScale)||rules.ratingScale<=0||rules.ratingScale>1000) ||
      rules.position!==undefined && !['front','behind'].includes(rules.position)) throw Error('Проверь профиль боевых правил');
}

export function combatRuleValues(profile, stats, states = {}) {
  const rules = profile?.combatRules;
  if (rules?.version !== 'cataclysm-4.3.4') return undefined;
  const level = profile.level ?? 85;
  // Only level 85 conversion constants are transcribed. Other levels use an explicitly
  // configurable simulation scale, avoiding invented official progression tables.
  const scale = rules.ratingScale ?? 1;
  const percent = key => Math.max(0,stats[key]??0) / at85[key] / scale;
  const [primary,factor] = rules.classId==='druid'&&states.form==='bear'?['strength',2]:primaryPower[rules.classId];
  return {
    classId:rules.classId,level,targetLevel:rules.targetLevel??level+3,position:rules.position??'front',
    approximateRatings:level!==85 && rules.ratingScale===undefined,
    attackPower:['warrior','paladin','hunter','rogue','shaman','druid','deathknight'].includes(rules.classId)?(stats[primary]??0)*factor:0,
    spellPower:Math.max(0,(stats.intellect??0)-10),
    health:Math.max(0,(stats.stamina??0)-20)*10+Math.min(20,stats.stamina??0),
    mana:Math.max(0,(stats.intellect??0)-20)*15+Math.min(20,stats.intellect??0),
    hit:Math.min(1,(percent('hitRating')+(stats.hitChance??0))/100),
    spellHit:Math.min(1,(percent('spellHitRating')+(stats.spellHitChance??0))/100),
    expertise:Math.max(0,percent('expertiseRating')+(stats.expertise??0))*.0025,
    crit:percent('critRating')/100,haste:percent('hasteRating')/100,mastery:percent('masteryRating'),
    dodge:Math.min(1,(percent('dodgeRating')+(stats.dodgeChance??0))/100),
    parry:Math.min(1,(percent('parryRating')+(stats.parryChance??0))/100),
    block:Math.min(1,(percent('blockRating')+(stats.blockChance??0))/100),
    spellPenetration:stats.spellPenetration??0,armorPenetration:Math.min(1,(stats.armorPenetration??0)/100),
    armorConstant:Math.max(400,level>=81?2167.5*level-158167.5:400+85*level),
    resistanceConstant:Math.max(5,level*5)
  };
}
