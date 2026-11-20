import {readFileSync} from 'node:fs';
import {abilityReadiness} from '../static/combat/ability-readiness.js';
import {normalize} from '../static/engine.js';
import {attackProfile} from '../static/world/combat/spatial-combat.js';

const read = file => JSON.parse(readFileSync(new URL('../static/presets/'+file+'.json',import.meta.url),'utf8'));
const csv = row => row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',');
const rows = [[
  'preset','version','ability_id','ability_name','ability_type','source_spell_id','learning_mode','branch_id','talent_links',
  'cast_seconds','cooldown_seconds','channel_seconds','range','resource_cost','before','after','target','delivery','effects',
  'configured_animation','notes'
]];
for(const preset of read('index')){
  const before=read(preset.id);
  const after=normalize(structuredClone(before),{allowLegacy:true});
  for(const ability of after.abilities){
    const raw=before.abilities.find(a=>a.id===ability.id);
    const readiness=abilityReadiness(after,ability);
    const state=abilityReadiness(before,raw).state;
    const talents=after.branches.flatMap(b=>b.talents).filter(t=>t.grantedAbilityId===ability.id||t.id===ability.talentId);
    const spatial=ability.kind==='active'&&ability.combatEffects?.length?attackProfile(ability):undefined;
    rows.push([preset.id,preset.version,ability.id,ability.name,ability.kind,ability.sourceSpellId,ability.learningMode,
      ability.branchId,talents.map(t=>t.id).join(' '),ability.cast,ability.cooldown,ability.presentation?.channelDuration,
      ability.range,(ability.resourceCosts??[]).map(cost=>[cost.resourceId,cost.amount,cost.unit].join(':')).join(' '),state,
      readiness.state,spatial?.targeting,spatial?.kind,(ability.combatEffects??[]).map(e=>e.type+(e.school?' '+e.school:'')).join('; '),
      spatial?.castingAnimation??spatial?.attackAnimation??spatial?.animation,readiness.message]);
  }
}
process.stdout.write(rows.map(csv).join('\r\n')+'\r\n');
