import {addTranslations, t} from '../i18n.js';
import {iconURL} from '../icons.js';
import {presentationRange} from '../combat/presentation.js';

addTranslations([
  ['Уровень', 'Level'], ['Базовая атака', 'Basic attack'], ['Назначить ячейки', 'Assign slots'],
  ['Выбери манекен мышью, подойди ближе и нажми клавишу способности.', 'Select the dummy, move into range and press the ability key.'],
  ['Учебный набор', 'Practice loadout'], ['Пустая ячейка', 'Empty slot'], ['Время применения', 'Cast time'],
  ['Бег WASD · ходьба Shift · прыжок Space', 'WASD run · Shift walk · Space jump'],
  ['Учебная искра', 'Practice spark'], ['Учебный луч', 'Practice beam']
]);

const demo = (id,name,icon,range,cast,presentation) => ({
  id,name,icon,range,cast,channelDuration:presentation.channelDuration??0,presentation,
  cooldown:2,resourceCosts:[],combatEffects:[{id:'training-hit',type:'damage',trigger:'onHit',
    school:range?'fire':'physical',baseAmount:55,coefficient:0,scalingStat:'none',canCrit:true}]
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
    cost||t('Бесплатно'),t('Время применения')+' '+(ability.cast+ability.channelDuration)+' s',
    t('Перезарядка')+' '+ability.cooldown+' s',
    t('Дальность')+' '+presentationRange(ability.range,ability.presentation)+' m'].filter(Boolean).join('\n');
}

export function mountWorldHUD(frame, build, practice, cast) {
  const root=document.createElement('div');
  root.className='tg-play-hud';
  root.innerHTML=`<div class="tg-unit tg-unit-player"><div class="tg-portrait"><img alt="" hidden><b aria-label="Уровень">1</b></div>
    <div class="tg-unit-details"><strong data-user-content></strong><div class="tg-unit-bar"><i></i><span></span></div>
    <div class="tg-unit-bar tg-unit-resource"><i></i><span></span></div></div></div>
    <div class="tg-unit tg-unit-target" hidden><div class="tg-portrait"><img alt="" hidden><b aria-label="Уровень">1</b></div>
    <div class="tg-unit-details"><strong>Манекен</strong><div class="tg-unit-bar"><i></i><span></span></div><small></small></div></div>`;
  frame.append(root);
  const player=root.querySelector('.tg-unit-player');
  const target=root.querySelector('.tg-unit-target');
  player.querySelector('strong').textContent=build.name;
  const authored=[...build.activeAbilities];
  const sample=!authored.some(ability=>ability.combatEffects.length);
  const list=sample?[...practice,...authored]:[...authored,...practice.slice(0,1)];
  const byId=new Map(list.map(ability=>[ability.id,ability]));
  const storageKey='talentforge-action-slots-v1:'+JSON.stringify([build.name,list.map(ability=>ability.id)]);
  let slots=list.slice(0,9).map(ability=>ability.id);
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if(Array.isArray(saved)) slots=saved.slice(0,9).map(id=>byId.has(id)?id:null);
  } catch { /* A session can still use its default assignments. */ }

  const controls=document.createElement('section');
  controls.className='tg-world-actions';
  controls.innerHTML=`<div class="tg-game-feedback" role="status"></div><div class="tg-hotbar"></div>
    <details><summary>Назначить ячейки</summary><div class="tg-slot-settings"></div></details>
    <small>${sample?t('Учебный набор')+' · ':''}${t('Выбери манекен мышью, подойди ближе и нажми клавишу способности.')} · ${t('Бег WASD · ходьба Shift · прыжок Space')}</small>`;
  const bar=controls.querySelector('.tg-hotbar');
  const settings=controls.querySelector('.tg-slot-settings');
  const buttons=[];
  function renderSlot(index) {
    const button=buttons[index];
    const ability=byId.get(slots[index]);
    button.dataset.worldAbility=ability?.id??'';
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
    button.title=ability?describe(ability):t('Пустая ячейка');
    button.setAttribute('aria-label',ability?.name??t('Пустая ячейка'));
  }
  for(let i=0;i<9;i++){
    const button=document.createElement('button');
    button.type='button';
    button.dataset.worldSlot=String(i+1);
    button.innerHTML=`<i aria-hidden="true"></i><img alt="" hidden><kbd>${i+1}</kbd><span></span>`;
    button.onclick=()=>{if(slots[i])cast(slots[i]);};
    bar.append(button);
    buttons.push(button);
    renderSlot(i);
    const select=document.createElement('select');
    select.setAttribute('aria-label',t('Назначить ячейки')+' '+(i+1));
    select.append(new Option(t('Пустая ячейка'),''),...list.map(ability=>new Option(ability.name,ability.id)));
    select.value=slots[i]??'';
    select.onchange=()=>{
      slots[i]=select.value||null;
      renderSlot(i);
      try { localStorage.setItem(storageKey,JSON.stringify(slots)); } catch { /* Optional persistence. */ }
    };
    settings.append(select);
  }
  const strike=document.createElement('button');
  strike.type='button';
  strike.className='tg-basic-strike';
  strike.textContent=t('Базовая атака');
  strike.onclick=()=>cast(practice[0].id);
  strike.title=describe(practice[0]);
  bar.append(strike);

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
  return {
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
    update(runtime,feedback) {
      const {state}=runtime;
      fill(bars[0],state.player.health,state.player.maxHealth);
      const resource=build.resources[0] && state.player.resources[build.resources[0].id];
      bars[1].hidden=!resource;
      if(resource) fill(bars[1],resource.current,resource.max);
      fill(bars[2],state.dummy.health,state.dummy.maxHealth);
      const stateLabel=state.dummy.health?'':t('Манекен повержен');
      if(targetStatus.textContent!==stateLabel) targetStatus.textContent=stateLabel;
      buttons.forEach((button,i)=>{
        const status=slots[i]?runtime.availability(slots[i]):{};
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
