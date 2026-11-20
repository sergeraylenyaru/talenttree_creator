import {addTranslations, getLanguage, t} from './i18n.js';
import {localAnimationNames} from './world/animation-catalog.js';
import {animationFields, isLocalClip, presentationLimits, presentationOptions, presentationPresets} from './combat/presentation.js';

const fields = {
  category: ['Категория', 'Category'], delivery: ['Тип доставки', 'Delivery'],
  animation: ['Анимация действия', 'Action animation'], castingAnimation: ['Анимация подготовки', 'Casting animation'],
  attackAnimation: ['Анимация атаки', 'Attack animation'], projectile: ['Снаряд', 'Projectile'],
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
    for (const key of options) select.append(new Option(labelText(labels[key] ?? [key,key]), key));
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
  mode.onchange = () => {
    const selected = modes[mode.value];
    if (!selected) return;
    const [,delivery,projectile,targeting] = selected;
    for (const [key,value] of Object.entries({delivery,projectile,targeting})) controls.get(key).value=value;
    if (mode.value === 'channel' && !Number(controls.get('channelDuration').value)) {
      controls.get('channelDuration').value = '3';
      controls.get('channelDuration').dispatchEvent(new Event('input'));
    }
  };
  let availableClips;
  localAnimationNames().then(names=>{
    availableClips = new Set(names);
    for (const key of animationFields) {
      const control = controls.get(key);
      const existing = new Set([...control.options].map(option=>option.value));
      const group = document.createElement('optgroup');
      group.label = 'GLB';
      for (const name of names) if (!existing.has('clip:'+name)) group.append(new Option(name,'clip:'+name));
      if(group.children.length)control.append(group);
    }
  });
  preset.onchange = () => {
    const defaults = presentationPresets[preset.value];
    for (const [key, control] of controls) control.value = defaults?.[key] ?? '';
  };
  return () => {
    const result = Object.fromEntries([...controls].filter(([, control]) => control.value !== '').map(([key, control]) =>
      [key, control.type === 'number' ? control.valueAsNumber : control.value]));
    if (availableClips?.size && animationFields.some(key=>isLocalClip(result[key]) && !availableClips.has(result[key].slice(5)))) {
      throw Error('Выбранная анимация отсутствует в локальной модели');
    }
    return result;
  };
}
