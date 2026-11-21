import {addTranslations, getLanguage, t} from './i18n.js';
import {effectPresets} from './combat/effect-presets.js';
import {localAnimationNames} from './world/animation-catalog.js';
import {animationFields, isLocalClip, presentationLimits, presentationOptions, presentationPresets} from './combat/presentation.js';

const fields = {
  category: ['Категория', 'Category'], delivery: ['Тип доставки', 'Delivery'],
  animation: ['Анимация действия', 'Action animation'], castingAnimation: ['Анимация подготовки', 'Casting animation'],
  attackAnimation: ['Анимация выпуска', 'Release animation'], startAnimation:['Анимация начала','Start animation'],
  finishAnimation:['Анимация завершения','Finish animation'], impactAnimation:['Анимация реакции манекена','Dummy impact animation'],
  projectile: ['Снаряд', 'Projectile'], projectileOrigin:['Точка выпуска','Launch anchor'],
  trajectory:['Траектория','Trajectory'], arcHeight:['Высота дуги','Arc height'],
  projectilePreset:['Пресет снаряда','Projectile preset'], effectPreset:['Пресет попадания','Impact preset'],
  impactAnchor:['Точка эффекта','Impact anchor'],
  projectileSpeed: ['Скорость снаряда', 'Projectile speed'], impact: ['Эффект попадания', 'Impact effect'],
  hitReaction: ['Реакция цели', 'Hit reaction'], sound: ['Звуковой эффект', 'Sound effect'],
  targeting: ['Выбор цели', 'Targeting'], channelDuration: ['Поддержание, сек.', 'Channel duration, sec.']
};
const labels = {
  attack: ['Атака', 'Attack'], spell: ['Заклинание', 'Spell'], healing: ['Лечение', 'Healing'],
  area: ['Область вокруг героя', 'Area around player'], defense: ['Защита', 'Defense'], movement: ['Движение', 'Movement'],
  melee: ['Ближний бой', 'Melee'], ranged: ['Дальний бой', 'Ranged'], sword: ['Одноручный меч', 'One-handed sword'],
  twoHand: ['Двуручное оружие', 'Two-handed weapon'], bow: ['Выстрел из лука', 'Bow shot'],
  cast: ['Направленное заклинание', 'Directed spell'], channel: ['Поддержание', 'Channeling'],
  guard: ['Блок', 'Block'], hurt: ['Получение удара', 'Taking a hit'], none: ['Нет', 'None'],
  straight: ['Прямой', 'Straight'], homing: ['Самонаводящийся', 'Homing'], fire: ['Огонь', 'Fire'],
  frost: ['Лёд', 'Frost'], arcane: ['Тайная магия', 'Arcane'], holy: ['Свет', 'Holy'],
  nature: ['Природа', 'Nature'], shadow: ['Тьма', 'Shadow'], normal: ['Обычная', 'Normal'],
  physical:['Физическая','Physical'], magical:['Магическая','Magical'], support:['Поддержка','Support'], utility:['Утилита','Utility'],
  targetArea:['Область вокруг цели','Area around target'], ground:['По точке на земле','Ground-targeted'],
  heavy: ['Сильная', 'Heavy'], strike: ['Удар', 'Strike'], spark: ['Искра', 'Spark'],
  caster:['Герой','Caster'],hand:['Правая рука','Right hand'],weapon:['Оружие','Weapon'],
  linear:['Прямая','Linear'],arc:['Дуга','Arc'],contact:['Контакт','Contact'],target:['Манекен','Dummy model'],
  chime: ['Перезвон', 'Chime'], dummy: ['Манекен', 'Training dummy'], self: ['На себя', 'Self']
};

addTranslations([
  ['Оформление в бою', 'Combat presentation'], ['Пресет оформления', 'Presentation preset'],
  ['Автоматически', 'Automatic'], ['Проверь оформление способности', 'Check ability presentation']]);

export function presentationEditor(container, ability) {
  const labelText = pair => pair[getLanguage() === 'ru' ? 0 : 1];
  container.dataset.userContent = '';
  const controls = new Map();
  const makeSelect = (options, placeholder) => {
    const select = document.createElement('select');
    select.append(new Option(t(placeholder), ''));
    for (const key of options) select.append(new Option(labelText(labels[key] ?? effectPresets[key]?.label ?? [key,key]), key));
    return select;
  };
  const append = (key, label, control) => {
    const wrapper = document.createElement('label');
    wrapper.append(labelText(label), control);
    control.dataset.presentation = key;
    container.append(wrapper);
  };
  const preset = makeSelect(Object.keys(presentationPresets), 'Автоматически');
  append('preset', ['Пресет оформления', 'Presentation preset'], preset);
  for (const [key, label] of Object.entries(fields)) {
    const control = presentationOptions[key] ? makeSelect(presentationOptions[key], 'Автоматически') : document.createElement('input');
    if (presentationLimits[key]) {
      control.type = 'number';
      [control.min, control.max] = presentationLimits[key];
      control.step = 'any';
    }
    const initial = ability.presentation?.[key] ?? '';
    if (isLocalClip(initial)) control.append(new Option(initial.slice(5),initial));
    control.value = initial;
    controls.set(key, control);
    append(key, label, control);
  }
  const modes = {
    instant:['Мгновенная доставка','ranged','none','dummy'],
    melee:['Ближний бой','melee','none','dummy'],
    straight:['Прямой снаряд','ranged','straight','dummy'],
    homing:['Самонаведение','ranged','homing','dummy'],
    area:['Область действия','ranged','none','area'],
    targetArea:['Область вокруг цели','ranged','none','targetArea'],
    ground:['По точке на земле','ranged','none','ground'],
    channel:['Поддерживаемое заклинание','ranged','none','dummy']
  };
  const mode = document.createElement('select');
  mode.append(new Option(t('Автоматически'),''),...Object.entries(modes).map(([key,[name]])=>new Option(t(name),key)));
  const modeLabel = document.createElement('label');
  modeLabel.append(t('Поэтапное применение'),mode);
  mode.dataset.workshopDelivery = '';
  container.prepend(modeLabel);
  function updateRelevance() {
    const target=controls.get('targeting').value;
    const delivery=controls.get('delivery').value;
    const area=['area','targetArea','ground'].includes(target);
    const projectile=controls.get('projectile');
    projectile.parentElement.hidden=area||target==='self'||delivery==='melee';
    const flight=!projectile.parentElement.hidden&&['straight','homing'].includes(projectile.value);
    for(const key of ['projectileSpeed','projectileOrigin','projectilePreset'])controls.get(key).parentElement.hidden=!flight;
    controls.get('trajectory').parentElement.hidden=!flight||projectile.value!=='straight';
    controls.get('arcHeight').parentElement.hidden=!flight||projectile.value!=='straight'||controls.get('trajectory').value!=='arc';
    controls.get('impactAnimation').parentElement.hidden=target==='self';
    controls.get('hitReaction').parentElement.hidden=target==='self';
  }
  mode.onchange = () => {
    const selected = modes[mode.value];
    if (!selected) return;
    const [,delivery,projectile,targeting] = selected;
    for (const [key,value] of Object.entries({delivery,projectile,targeting})) controls.get(key).value=value;
    if (mode.value === 'channel' && !Number(controls.get('channelDuration').value)) {
      controls.get('channelDuration').value = '3';
      controls.get('channelDuration').dispatchEvent(new Event('input'));
    }
    updateRelevance();
  };
  const catalogs=new Map();
  const clipStatus=document.createElement('small');
  clipStatus.setAttribute('role','status');
  container.append(clipStatus);
  function showFallback(){
    const missing=animationFields.filter(key=>{
      const value=controls.get(key).value;
      return isLocalClip(value)&&catalogs.get(key)?.size&&!catalogs.get(key).has(value.slice(5));
    });
    clipStatus.textContent=missing.length?t('Отсутствующий клип заменится ближайшей доступной анимацией.'):'';
  }
  addTranslations([['Отсутствующий клип заменится ближайшей доступной анимацией.','The nearest available clip will replace the missing animation.']]);
  async function addAnimations(keys,role){
    const names=await localAnimationNames(role);
    for (const key of keys) {
      catalogs.set(key,new Set(names));
      const control=controls.get(key),existing=new Set([...control.options].map(option=>option.value));
      const group=document.createElement('optgroup');
      group.label='GLB';
      for(const name of names)if(!existing.has('clip:'+name))group.append(new Option(name,'clip:'+name));
      if(group.children.length)control.append(group);
    }
    showFallback();
  }
  addAnimations(animationFields.filter(key=>key!=='impactAnimation'),'hero');
  addAnimations(['impactAnimation'],'target');
  for(const control of controls.values())control.addEventListener('change',showFallback);
  preset.onchange = () => {
    const defaults = presentationPresets[preset.value];
    for (const [key, control] of controls) control.value = defaults?.[key] ?? '';
    updateRelevance();
  };
  for(const control of controls.values())control.addEventListener('change',updateRelevance);
  updateRelevance();
  return () => {
    const result = Object.fromEntries([...controls].filter(([, control]) => control.value !== '').map(([key, control]) =>
      [key, control.type === 'number' ? control.valueAsNumber : control.value]));
    // Visibility is editorial only. Runtime delivery rules ignore dormant parameters.
    return result;
  };
}
