import {addTranslations,t} from './i18n.js';
addTranslations([
 ['Параметры оружейного удара','Weapon strike parameters'],['Основное','Basics'],['Цель и применение','Target and casting'],['Дополнительно: изучение и условия','Advanced: learning and requirements'],
 ['Длительность канала и тики','Channel duration and ticks'],['Параметры снаряда','Projectile parameters'],['Резюме способности','Ability summary'],
 ['Скрытые параметры сохраняются. Изменяй дополнительные настройки, когда они нужны.','Hidden parameters are retained. Adjust advanced settings when needed.'],
 ['Сессия на паузе. После сохранения изменения действуют на следующие применения.','Session paused. Saved changes apply to subsequent uses.'],
 ['Заверши редактирование, чтобы продолжить прежнюю тренировку.','Finish editing to continue the retained training session.'],
 ['Пассивная способность','Passive ability'],['Стоимость','Cost'],['Без затрат ресурса','No resource cost'],['Базовая величина','Base amount'],['Доступность','Availability'],
 ['Требуется талант','Talent required'],['Доступна по умолчанию','Available by default'],['Мгновенно','Instant'],['сек.','sec.'],['м','m'],
 ['Основные эффекты','Main effects'],['Обновление аур и коэффициенты','Aura refresh and coefficients'],['Оружейный урон','Weapon damage'],
 ['Коэффициент умножается на урон экипированного оружия.','The coefficient multiplies equipped weapon damage.']
]);

// Reorganize the existing controls; all entry points still share editAbility and its readers.
export function simplifyAbilityEditor(root,readDraft,{training=false}={}){
 const $=selector=>root.querySelector(selector);
 const section=(name,details=false)=>{
  const node=document.createElement(details?'details':'section');node.className='ability-editor-section';
  const heading=document.createElement(details?'summary':'h3');heading.textContent=t(name);node.append(heading);return node;
 };
 const layout=$('.ability-editor-layout'),left=layout.children[0],right=layout.children[1];
 const basic=section('Основное'),casting=section('Цель и применение'),advanced=section('Дополнительно: изучение и условия',true);
 const pair=(id,destination)=>{const input=$('#'+id);if(!input)return;const label=$(`label[for="${id}"]`);if(label)destination.append(label);destination.append(input);};
 const identity=$('.ability-identity small');if(identity)advanced.append(identity);
 $('#abilityDescription').rows=3;pair('abilityDescription',basic);
 const selectors=$('.ability-selectors');casting.append(selectors.children[0]);advanced.append(selectors.children[0]);selectors.remove();
 advanced.append($('.ability-branch-only'),$('.ability-channeled'));
 casting.append($('#abilityCastControl'));
 for(const key of ['category','targeting','delivery'])casting.append($(`[data-presentation=${key}]`).parentElement);
 const weapons=section('Параметры оружейного удара');
 for(const key of ['attackType','weaponHand','normalizedWeapon'])weapons.append($(`[data-workshop=${key}]`).parentElement);
 const channel=section('Длительность канала и тики');
 for(const selector of ['[data-presentation=channelDuration]','[data-workshop=tickInterval]','[data-workshop=channelPayment]'])channel.append($(selector).parentElement);
 const projectiles=section('Параметры снаряда');
 for(const key of ['projectile','projectileSpeed','trajectory','arcHeight','projectileOrigin','projectilePreset'])projectiles.append($(`[data-presentation=${key}]`).parentElement);
 // Advanced projectile tuning remains in its original foldout.
 const options=$('#workshopOptions');
 advanced.append($('label[for=abilityRequirements]'),$('#abilityRequirements'),$('label[for=abilityLearning]'),$('#abilityLearning'),$('#talentLinkField'));
 const templates=$('.workshop-template-details'),previews=$('.workshop-preview-actions'),presentation=$('#spellPresentationDetails');
 const costs=$('#abilityApplication'),passive=$('#passiveApplication'),help=$('#abilityTimingHelp'),effects=$('#combatEffectEditor');
 left.replaceChildren(basic,casting,weapons,channel,projectiles,options,templates,advanced,previews);
 right.replaceChildren(costs,passive,effects,presentation,help);
 const summary=document.createElement('output');summary.className='ability-live-summary';summary.setAttribute('aria-label',t('Резюме способности'));summary.setAttribute('aria-live','polite');root.prepend(summary);
 const hint=document.createElement('p');hint.className='muted compact-field-help';hint.textContent=t('Скрытые параметры сохраняются. Изменяй дополнительные настройки, когда они нужны.');advanced.prepend(hint);advanced.prepend(advanced.querySelector('summary'));
 if(training){
  const notice=document.createElement('p');notice.className='ability-session-notice';notice.textContent=t('Сессия на паузе. После сохранения изменения действуют на следующие применения.');root.prepend(notice);
  $('#previewSpell').hidden=true;$('#saveTestSpell').textContent=t('Сохранить');
 }
 const passiveValue=()=>$('#abilityKind').value==='passive';
 function refresh(){
  if(!layout.isConnected||!root.contains(layout))return;
  const passive=passiveValue(),castMode=$('#abilityCastMode').value;
  const weaponRelevant=$('[data-presentation=category]').value==='attack'||$('[data-presentation=delivery]').value==='melee'||['melee','ranged'].includes($('[data-workshop=attackType]').value)||[...root.querySelectorAll('[data-key=weaponCoefficient]')].some(input=>input.value!=='');
  weapons.hidden=passive||!weaponRelevant;
  for(const group of root.querySelectorAll('.ability-weapon-settings'))group.hidden=!weaponRelevant;
  channel.hidden=passive||!['sustain','channel'].includes(castMode);
  $('[data-workshop=tickInterval]').parentElement.hidden=castMode!=='channel';
  projectiles.hidden=passive||$('[data-presentation=delivery]').value==='melee'||['self','area','targetArea','ground'].includes($('[data-presentation=targeting]').value);
  $('#cast').parentElement.hidden=castMode!=='cast'&& !$('#abilityChanneled').checked;
  for(const key of ['targeting','delivery'])$(`[data-presentation=${key}]`).parentElement.hidden=passive;
  try{
   const a=readDraft(),numbers=(a.combatEffects??[]).map(e=>`${t(({damage:'Урон',healing:'Лечение',shield:'Щит поглощения',control:'Контроль',status:'Эффект состояния',resource:'Восстановление ресурса',dispel:'Снятие эффекта',cooldown:'Изменение перезарядки',state:'Смена состояния',rune:'Преобразование рун'})[e.type]??e.type)}: ${e.baseAmount??e.amount??e.duration??'—'}${e.duration?' / '+e.duration+' '+t('сек.'):''}`);
   const costs=a.resourceCosts.map(c=>`${c.amount} ${c.unit==='percent'?'% ':''}${c.resourceName??c.resourceId}`).join(', ');
   const timing=a.kind==='passive'?t('Пассивная способность'):`${t('Стоимость')}: ${costs||t('Без затрат ресурса')} · ${a.cast?a.cast+' '+t('сек.'):t('Мгновенно')} · ${t('Перезарядка')}: ${a.cooldown} ${t('сек.')} · ${a.range} ${t('м')}`;
   summary.textContent=`${a.name} · ${numbers.length?numbers.join(' / ')+' · ':''}${timing} · ${t(a.learningMode==='talent'?'Требуется талант':'Доступна по умолчанию')}`;
  }catch{summary.textContent=t('Резюме способности')+' — '+($('#abilityName').value||t('Введи название'));}
 }
 const controller=new AbortController(),dialog=root.closest('dialog');
 const cleanup=()=>{if(layout.isConnected&&dialog.open)return;controller.abort();dialog.removeEventListener('close',cleanup);};dialog.addEventListener('close',cleanup);
 for(const name of ['input','change','click'])root.addEventListener(name,refresh,{signal:controller.signal});
 refresh();
}

export function simplifyEffectRow(row){
 const field=key=>row.querySelector(`[data-key="${key}"]`)?.parentElement;
 const grid=row.querySelector('.ability-selectors');
 const advanced=row.querySelector('.workshop-effect-advanced')??document.createElement('details');
 if(!advanced.parentElement){advanced.className='workshop-effect-advanced';const heading=document.createElement('summary');heading.textContent=t('Обновление аур и коэффициенты');advanced.append(heading);grid.append(advanced);}
 const panel=advanced.querySelector('.ability-selectors')??document.createElement('div');panel.className='ability-selectors';if(!panel.parentElement)advanced.append(panel);
 for(const key of ['scalingStat','coefficient','damageKind','trigger','stacks','refresh','tickPolicy','drGroup','category','dispelType','removable','breakOnDamage','consumeOnHit','snapshot','priority','fraction','icon','description']){
  const label=field(key);if(label)panel.append(label);
 }
 const weapon=field('weaponCoefficient');
 if(weapon){
  const group=document.createElement('details');group.className='workshop-effect-advanced ability-weapon-settings';
  const title=document.createElement('summary');title.textContent=t('Оружейный урон');const note=document.createElement('small');note.textContent=t('Коэффициент умножается на урон экипированного оружия.');
  group.append(title,weapon,note);grid.append(group);if(Number(weapon.querySelector('input').value))group.open=true;
 }
}
