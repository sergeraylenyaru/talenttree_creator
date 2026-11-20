// Template provenance is descriptive metadata and is never resolved at runtime.
export function copyAbility(source, id = crypto.randomUUID()) {
  const copy = structuredClone(source);
  copy.id = id;
  copy.templateSource = {id:source.id, name:source.name};
  copy.talentId = '';
  copy.branchId = '';
  copy.branchOnly = false;
  copy.learningMode = 'base';
  if (copy.templateRules) remapRules(copy.templateRules,source.id,copy.id);
  return copy;
}

function rulesFor(document, source) {
  const result = {};
  for (const key of ['bonuses','procs']) {
    result[key] = structuredClone(source.templateRules?.[key] ?? (document.rpg?.[key] ?? []).filter(rule =>
      rule.spell === source.id || ['passive','ability'].includes(rule.owner.kind) && rule.owner.id === source.id));
  }
  return result;
}

function remapRules(rules, from, to) {
  for (const entries of Object.values(rules)) for (const rule of entries) {
    rule.id = crypto.randomUUID();
    if (rule.spell === from) rule.spell = to;
    if (['passive','ability'].includes(rule.owner.kind) && rule.owner.id === from) rule.owner.id = to;
  }
  return rules;
}

export function abilityTemplateSnapshot(document, source) {
  const template = copyAbility(source);
  template.templateRules = remapRules(rulesFor(document,source),source.id,template.id);
  for(const entries of Object.values(template.templateRules))for(const rule of entries){
    rule.owner={kind:'ability',id:template.id};
  }
  return template;
}

export function appendAbilityInstance(document, instance) {
  const next = structuredClone(document);
  const ability = structuredClone(instance);
  const source = document.abilities.find(entry => entry.id === ability.templateSource?.id);
  const rules = ability.templateRules ?? (source ? remapRules(rulesFor(document,source),source.id,ability.id) : {});
  delete ability.templateRules;
  next.abilities.push(ability);
  for (const [key, entries] of Object.entries(rules)) {
    if (!entries.length) continue;
    next.rpg ??= {version:1};
    next.rpg[key] ??= [];
    next.rpg[key].push(...structuredClone(entries));
  }
  return {document:next, ability};
}

export function copyAbilityIntoDocument(document, source, id) {
  const ability = copyAbility(source);
  if (id) ability.id = id;
  ability.templateRules = remapRules(rulesFor(document,source),source.id,ability.id);
  return appendAbilityInstance(document,ability);
}

export function validateTemplateSource(ability) {
  if (ability.templateSource === undefined) return;
  const source = ability.templateSource;
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      Object.keys(source).some(key => !['id','name'].includes(key)) ||
      ['id','name'].some(key => typeof source[key] !== 'string' || !source[key] || source[key].length > 200)) {
    throw Error('Проверь источник шаблона способности');
  }
}
