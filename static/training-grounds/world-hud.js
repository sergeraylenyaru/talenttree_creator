import {mountAbilityContextMenu} from './ability-context-menu.js';
import {auraPolarity} from '../combat/advanced-effects.js';
import {addTranslations, t} from '../i18n.js';
import {trainingWeapon} from '../combat/auto-attack.js';
import {iconURL} from '../icons.js';
import {presentationRange} from '../combat/presentation.js';

addTranslations([
  ['Уровень', 'Level'], ['Базовая атака', 'Basic attack'], ['Назначить ячейки', 'Assign slots'],
  ['Выбери манекен мышью, подойди ближе и нажми клавишу способности.', 'Select the dummy, move into range and press the ability key.'],
  ['Учебный набор', 'Practice loadout'], ['Пустая ячейка', 'Empty slot'], ['Время применения', 'Cast time'],
  ['WASD · Shift — ходьба · Пробел — прыжок · ПКМ — камера и автоатака',
    'WASD · Shift to walk · Space to jump · Right mouse for orbit and autoattack'],
  ['Автоатака', 'Autoattack'], ['Остановить автоатаку', 'Stop autoattack'],
  ['Вне досягаемости', 'Out of melee range'], ['Цель за преградой', 'Target obstructed'],
  ['Учебная искра', 'Practice spark'], ['Учебный луч', 'Practice beam']
]);

const demo = (id,name,icon,range,cast,presentation) => ({
  id,name,icon,range,cast,channelDuration:presentation.channelDuration??0,presentation,
  cooldown:2,resourceCosts:[],combatEffects:[{id:'training-hit',type:'damage',trigger:'onHit',
    school:range?'fire':'physical',baseAmount:trainingWeapon.damage,coefficient:0,scalingStat:'none',canCrit:true}]
});

export function practiceAbilities(abilities, resources) {
  const used = new Set(abilities.map(a=>a.id));
  const id = key => {
    let candidate='__training_'+key;
    while(used.has(candidate)) candidate+='_';
    used.add(candidate);
    return candidate;
  };
  const loadout = [
    demo(id('strike'),t('Базовая атака'),'inv_sword_04',0,0,{delivery:'melee',attackAnimation:'sword',impact:'melee'}),
    demo(id('spark'),t('Учебная искра'),'spell_fire_flamebolt',24,1.25,{delivery:'ranged',projectile:'straight',impact:'fire'}),
    demo(id('beam'),t('Учебный луч'),'spell_fire_fireball',24,0,{delivery:'ranged',projectile:'homing',impact:'fire',channelDuration:2})
  ];
  if (resources[0]) loadout[1].resourceCosts = [{
    resourceId: resources[0].id, resourceName: resources[0].name, amount: 5, unit:'percent'
  }];
  return loadout;
}

function describe(ability) {
  const cost=ability.resourceCosts.map(c=>c.amount+(c.unit==='percent'?'%':'')+' '+c.resourceName).join(', ');
  return [ability.name,ability.description,
    !ability.combatEffects.length&&ability.presentation?.category!=='movement'&&t('Нет исполняемых боевых эффектов'),
    cost||t('Бесплатно'),t('Время применения')+' '+(ability.cast+ability.channelDuration)+' s',
    t('Перезарядка')+' '+ability.cooldown+' s',
    t('Дальность')+' '+presentationRange(ability.range,ability.presentation)+' m'].filter(Boolean).join('\n');
}

export function mountWorldHUD(frame, build, practice, cast, preview,editing) {
  const root=document.createElement('div');
  root.className='tg-play-hud';
  root.innerHTML=`<div class="tg-unit tg-unit-player"><div class="tg-portrait"><img alt="" hidden><b aria-label="Уровень">1</b></div>
    <div class="tg-unit-details"><strong data-user-content></strong><div class="tg-unit-bar"><i></i><span></span></div>
    <div class="tg-unit-bar tg-unit-resource"><i></i><span></span></div><div class="tg-buffs" aria-label="Player buffs"></div><div class="tg-debuffs" aria-label="Player debuffs"></div><small class="tg-absorb"></small></div></div>
    <div class="tg-unit tg-unit-target" hidden><div class="tg-portrait"><img alt="" hidden><b aria-label="Уровень">1</b></div>
    <div class="tg-unit-details"><strong>Манекен</strong><div class="tg-unit-bar"><i></i><span></span></div><small></small><div class="tg-buffs" aria-label="Target buffs"></div><div class="tg-debuffs" aria-label="Target debuffs"></div><small class="tg-absorb"></small></div></div>`;
  frame.append(root);
  const player=root.querySelector('.tg-unit-player');
  const target=root.querySelector('.tg-unit-target');
  const extraResources=document.createElement('div');
  extraResources.className='tg-secondary-resources';
  const resourceRows=new Map();
  for(const [index,resource] of build.resources.entries()){
    if(index===0&&!build.profile?.resources?.[resource.id]?.rune)continue;
    const row=document.createElement('small');
    row.dataset.resourceId=resource.id;
    extraResources.append(row);
    resourceRows.set(resource.id,{row,name:resource.name});
  }
  player.querySelector('.tg-unit-details').append(extraResources);

  player.querySelector('strong').textContent=build.name;
  player.querySelector('.tg-portrait b').textContent=build.profile?.level??1;
  const authored=[...build.activeAbilities];
  const ready=authored.filter(ability=>ability.combatEffects.length||ability.presentation?.category==='movement');
  const sample=!ready.length;
  const list=sample?[...practice,...authored]:[...authored,...practice.slice(0,1)];
  const byId=new Map(list.map(ability=>[ability.id,ability]));
  const storageKey='talentforge-action-slots-v2:'+JSON.stringify(build.layoutId ?? build.name);
  const legacyKey='talentforge-action-slots-v1:'+JSON.stringify([build.name,list.map(ability=>ability.id)]);
  const known = new Set([...(build.knownAbilityIds ?? []), ...list.map(ability=>ability.id)]);
  let slots=Array.from({length:18},(_,index)=>list[index]?.id??null);
  try {
    const exact = preview ? null : localStorage.getItem(storageKey) ?? localStorage.getItem(legacyKey);
    let saved = JSON.parse(exact);
    if (!preview && !saved) {
      let best = 0;
      for (const key of Object.keys(localStorage)) {
        const prefix = 'talentforge-action-slots-v1:';
        if (!key.startsWith(prefix)) continue;
        const [name,ids] = JSON.parse(key.slice(prefix.length));
        if (name !== build.name || !Array.isArray(ids)) continue;
        const score = ids.filter(id => known.has(id)).length;
        if (score <= best) continue;
        best = score;
        saved = JSON.parse(localStorage.getItem(key));
      }
    }
    const readyKey=storageKey+':unlocked';
    const previous=preview?[]:JSON.parse(localStorage.getItem(readyKey))??[];
    if(Array.isArray(saved)){
      saved.slice(0,18).forEach((id,index)=>{slots[index]=known.has(id)?id:null;});
      while(slots.length<18)slots.push(null);
      for(const ability of ready){
        if(slots.includes(ability.id)||previous.includes(ability.id))continue;
        const index=slots.findIndex(id=>id===null||practice.slice(1).some(example=>example.id===id));
        if(index>=0)slots[index]=ability.id;
      }
    }
    if(!preview){
      localStorage.setItem(readyKey,JSON.stringify([...new Set([...previous,...ready.map(ability=>ability.id)])]));
      if(Array.isArray(saved))localStorage.setItem(storageKey,JSON.stringify(slots));
    }
  } catch { /* A session can still use its default assignments. */ }

  const controls=document.createElement('section');
  controls.className='tg-world-actions';
  controls.innerHTML=`<div class="tg-game-feedback" role="status"></div><div class="tg-swing" hidden><progress max="1"></progress><span></span></div><div class="tg-hotbar"><div></div><div></div></div>
    <details><summary>Назначить ячейки</summary><div class="tg-slot-settings"><div class="tg-slot-palette"></div></div></details>
    <small>${sample?t('Учебный набор')+' · ':''}${t('Выбери манекен мышью, подойди ближе и нажми клавишу способности.')} · ${t('WASD · Shift — ходьба · Пробел — прыжок · ПКМ — камера и автоатака')}</small>`;
  const bar=controls.querySelector('.tg-hotbar');
  const settings=controls.querySelector('.tg-slot-settings');
  const buttons=[], selects=[];
  const dragType = 'application/x-talentforge-ability';
  function dragAbility(event, id) {
    if (id) event.dataTransfer.setData(dragType, id);
    else event.preventDefault();
  }
  function assign(index, id) {
    slots[index] = byId.has(id) ? id : null;
    selects[index].value = slots[index] ?? '';
    renderSlot(index);
    if (preview) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(slots));
      // Retain the bridge for existing saved loadouts and clients.
      localStorage.setItem(legacyKey, JSON.stringify(slots));
    } catch { /* Optional persistence. */ }
  }
  const palette=settings.querySelector('.tg-slot-palette');
  for (const ability of list) {
    const button=document.createElement('button');
    button.type='button';
    button.draggable=true;
    button.dataset.dragAbility=ability.id;
    button.textContent=ability.name;
    button.title=describe(ability);
    button.ondragstart=event=>dragAbility(event,ability.id);
    palette.append(button);
  }
  function renderSlot(index) {
    const button=buttons[index];
    const ability=byId.get(slots[index]);
    button.dataset.worldAbility=ability?.id??'';
    button.draggable=Boolean(ability);
    const img=button.querySelector('img');
    const symbol=button.querySelector('i');
    img.hidden=true;
    symbol.hidden=!ability;
    symbol.textContent=ability?.presentation?.delivery==='melee'?'⚔':ability?.channelDuration?'◈':'✦';
    if(ability) {
      img.onload=()=>{img.hidden=false;symbol.hidden=true;};
      img.onerror=()=>{img.hidden=true;symbol.hidden=false;};
      const url=iconURL(ability.icon||'inv_misc_questionmark');
      if(url) img.src=url;
      else img.removeAttribute('src');
    } else img.removeAttribute('src');
    button.title=ability?.id===practice[0].id?t('Автоатака'):ability?describe(ability):t('Пустая ячейка');
    button.setAttribute('aria-label',ability?.name??t('Пустая ячейка'));
  }
  for(let i=0;i<18;i++){
    const button=document.createElement('button');
    button.type='button';
    button.dataset.worldSlot=String(i+1);
    button.innerHTML=`<i aria-hidden="true"></i><img alt="" hidden><kbd>${i<9?i+1:'Shift+'+(i-8)}</kbd><em class="tg-slot-charge"></em><span></span>`;
    button.onclick=()=>{if(byId.has(slots[i]))cast(slots[i]);};
    button.ondragstart=event=>dragAbility(event,slots[i]);
    button.ondragover=event=>{if(event.dataTransfer.types.includes(dragType))event.preventDefault();};
    button.ondrop=event=>{
      event.preventDefault();
      const id=event.dataTransfer.getData(dragType);
      if(byId.has(id))assign(i,id);
    };
    bar.children[i<9?0:1].append(button);
    buttons.push(button);
    renderSlot(i);
    const select=document.createElement('select');
    select.setAttribute('aria-label',t('Назначить ячейки')+' '+(i+1));
    select.append(new Option(t('Пустая ячейка'),''),...list.map(ability=>new Option(ability.name,ability.id)));
    select.value=slots[i]??'';
    select.onchange=()=>assign(i,select.value);
    selects.push(select);
    settings.append(select);
  }
  const strike=document.createElement('button');
  strike.type='button';
  strike.className='tg-basic-strike';
  strike.textContent=t('Базовая атака');
  strike.onclick=()=>cast(practice[0].id);
  strike.title=t('Автоатака');
  strike.setAttribute('aria-pressed','false');
  controls.append(strike);
  const swing=controls.querySelector('.tg-swing');
  const swingLabel=swing.querySelector('span');

  const context=editing&&mountAbilityContextMenu(controls,{
    resolve:id=>!byId.has(id)?null:editing.resolve(id),pause:editing.pause,edit:editing.edit,
    feedback:message=>{controls.querySelector('.tg-game-feedback').textContent=message;}
  });
  function reconcile(next){
    context?.close();build=next;
    for(const resource of build.resources){const entry=resourceRows.get(resource.id);if(entry)entry.name=resource.name;}
    if(build.resources[0])bars[1].title=build.resources[0].name;
    const previous=new Set(byId.keys());
    const authored=build.activeAbilities;
    const ready=authored.filter(ability=>ability.combatEffects.length||ability.presentation?.category==='movement');
    const list=ready.length?[...authored,...practice.slice(0,1)]:[...practice,...authored];
    byId.clear();for(const ability of list)byId.set(ability.id,ability);
    const known=new Set([...(build.knownAbilityIds??[]),...list.map(ability=>ability.id)]);
    slots=slots.map(id=>known.has(id)?id:null);
    // New/unlocked abilities fill empty slots. Existing assignments never reorder.
    for(const ability of ready)if(!previous.has(ability.id)&&!slots.includes(ability.id)){const index=slots.indexOf(null);if(index>=0)slots[index]=ability.id;}
    palette.replaceChildren();
    for(const ability of list){const button=document.createElement('button');button.type='button';button.draggable=true;button.dataset.dragAbility=ability.id;button.textContent=ability.name;button.title=describe(ability);button.ondragstart=event=>dragAbility(event,ability.id);palette.append(button);}
    selects.forEach((select,index)=>{select.replaceChildren(new Option(t('Пустая ячейка'),''),...list.map(ability=>new Option(ability.name,ability.id)));select.value=byId.has(slots[index])?slots[index]:'';renderSlot(index);});
    player.querySelector('strong').textContent=build.name;player.querySelector('.tg-portrait b').textContent=build.profile?.level??1;
    if(!preview)try{localStorage.setItem(storageKey,JSON.stringify(slots));}catch{}
  }

  const bars=[player.querySelector('.tg-unit-bar'),player.querySelector('.tg-unit-resource'),target.querySelector('.tg-unit-bar')];
  function fill(element,value,max) {
    const width=Math.max(0,Math.min(100,100*value/max))+'%';
    if(element.firstElementChild.style.width!==width) element.firstElementChild.style.width=width;
    const label=Math.round(value)+' / '+Math.round(max);
    if(element.lastElementChild.textContent!==label) element.lastElementChild.textContent=label;
  }
  if (build.resources[0]) bars[1].title=build.resources[0].name;
  const targetStatus=target.querySelector('small');
  const feedbackLabel=controls.querySelector('.tg-game-feedback');
  let event;
  const activeStatuses = new Map();
  const rails={player:{buff:player.querySelector('.tg-buffs'),debuff:player.querySelector('.tg-debuffs')},
    dummy:{buff:target.querySelector('.tg-buffs'),debuff:target.querySelector('.tg-debuffs')}};
  function renderStatuses(runtime) {
    const present = new Set();
    for (const status of runtime.statuses) {
      const {ability,effect,expires,stacks,target} = status;
      const key=JSON.stringify([ability.id,effect.id,status.instance]);
      present.add(key);
      let badge=activeStatuses.get(key);
      if(!badge) {
        badge=document.createElement('span');
        badge.className='tg-status-effect';badge.dataset.target=target;
        badge.tabIndex=0;
        const icon=document.createElement('img');
        const iconSrc=iconURL(effect.icon??ability.icon);
        icon.alt='';
        if(iconSrc)icon.src=iconSrc;
        else icon.hidden=true;
        icon.onerror=()=>{icon.hidden=true;};
        badge.append(icon,document.createElement('small'));
        badge.dataset.aura=auraPolarity(effect);
        rails[target==='zone'?'dummy':target][badge.dataset.aura].append(badge);
        activeStatuses.set(key,badge);
      }
      const time=Math.max(0,Math.ceil(expires-runtime.state.combatTime));
      badge.classList.toggle('tg-aura-expiring',time<=3);
      const label=(stacks>1?stacks+'× ':'')+time+' s'+(status.remaining==null?'':(' · '+status.remaining));
      if(badge.lastChild.textContent!==label) {
        badge.lastChild.textContent=label;
        badge.title=(effect.name??ability.name)+' · '+label+(effect.description?' · '+effect.description:'')+
          (effect.dispelType?' · '+effect.dispelType:'')+(effect.controlType?' · '+effect.controlType:'')+
          (effect.drGroup?' · DR '+effect.drGroup:'')+(effect.removable===false?' · '+t('Нельзя снять'):'');
        badge.setAttribute('aria-label',badge.title);
      }
    }
    for(const [key,badge] of activeStatuses)if(!present.has(key)){
      badge.remove();
      activeStatuses.delete(key);
    }
  }
  return {reconcile,closeMenu:()=>context?.close(),dispose:()=>context?.dispose(),
    controls,
    select(value,unit) {
      target.hidden=!value;
      if(unit) {
        target.dataset.unit=unit.id;
        target.querySelector('strong').textContent=t(unit.name);
        target.querySelector('.tg-portrait b').textContent=unit.level;
      } else delete target.dataset.unit;
    },
    portrait(role,url) {
      const img=(role==='hero'?player:target).querySelector('img');
      img.src=url;
      img.hidden=false;
    },
    update(runtime,feedback,auto = {active:false}) {
      const recovery=runtime.runeState?.()??{};
      for(const [id,{row,name}] of resourceRows){
        const resource=runtime.state.player.resources[id];
        const pending=(recovery[id]??[]).map(at=>Math.max(0,at-runtime.state.combatTime).toFixed(1)+'s');
        const value=name+' · '+Math.round(resource?.current??0)+' / '+(resource?.max??0)+(pending.length?' · '+pending.join(' · '):'');
        if(row.textContent!==value)row.textContent=value;
      }
      strike.setAttribute('aria-pressed', String(auto.active));
      const strikeLabel=t(auto.active?'Остановить автоатаку':'Автоатака');
      if(strike.textContent!==strikeLabel) strike.textContent=strikeLabel;
      swing.hidden=!auto.active;
      swing.toggleAttribute('data-waiting', Boolean(auto.reason));
      if(auto.active) {
        swing.firstElementChild.value=auto.progress;
        const message=auto.reason ? t(auto.reason==='outOfRange'?'Вне досягаемости':'Цель за преградой')
          : auto.remaining.toFixed(1)+' s';
        const line=t('Манекен')+' · '+message;
        if(swingLabel.textContent!==line) swingLabel.textContent=line;
      }
      const {state}=runtime;
      renderStatuses(runtime);
      for(const [key,node] of [['player',player],['dummy',target]]) {
        const amount=runtime.statuses.filter(status=>status.target===key&&status.effect.type==='shield')
          .reduce((sum,status)=>sum+(status.remaining??0),0);
        const text=amount?t('Поглощение')+' · '+Math.round(amount):'';
        if(node.querySelector('.tg-absorb').textContent!==text)node.querySelector('.tg-absorb').textContent=text;
      }
      fill(bars[0],state.player.health,state.player.maxHealth);
      const form=state.classStates?.form;
      const primaryName=form==='cat'?'energy':form==='bear'?'rage':null;
      const primary=primaryName?build.resources.find(resource=>resource.id.toLowerCase().endsWith(primaryName))??build.resources[0]:build.resources[0];
      const resource=primary && state.player.resources[primary.id];
      if(primary)bars[1].title=primary.name;
      bars[1].hidden=!resource;
      if(resource) fill(bars[1],resource.current,resource.max);
      fill(bars[2],state.dummy.health,state.dummy.maxHealth);
      const classState=Object.entries(state.classStates??{}).map(([key,value])=>key+' · '+value).join(' | ');
      player.dataset.classState=classState;
      player.querySelector('strong').title=classState;
      const stateLabel=state.dummy.health?'':t('Манекен повержен');
      if(targetStatus.textContent!==stateLabel) targetStatus.textContent=stateLabel;
      buttons.forEach((button,i)=>{
        const basic=slots[i]===practice[0].id;
        button.classList.toggle('tg-auto-active',basic && auto.active);
        const charge = runtime.chargeCount(slots[i]);
        const badge = button.querySelector('.tg-slot-charge');
        const chargeLabel = charge === undefined ? '' : String(charge);
        if(badge.textContent!==chargeLabel)badge.textContent=chargeLabel;
        const status=byId.has(slots[i])&&!basic?runtime.availability(slots[i]):{};
        if(button.dataset.state!==(status.reason??'')) button.dataset.state=status.reason??'';
        const remaining=status.remaining?Math.ceil(status.remaining*10)/10+' s':'';
        if(button.lastElementChild.textContent!==remaining) button.lastElementChild.textContent=remaining;
      });
      const latest=state.combatLog.at(-1);
      const labels={castStarted:'Начало применения',castCancelled:'Применение отменено',attackHit:'Попадание',damage:'Попадание',healing:'Лечение игрока',attackMissed:'Промах'};
      if(latest && latest!==event) event=latest;
      const recent=event && state.combatTime-event.time<3;
      const label=feedback||(recent && event.isCritical?t('Крит'):recent && labels[event.type]?t(labels[event.type]):'');
      if(feedbackLabel.textContent!==label) feedbackLabel.textContent=label;
    }
  };
}
