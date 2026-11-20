import {addTranslations, getLanguage, t} from './i18n.js';
import {presentationLimits, presentationOptions, presentationPresets} from './combat/presentation.js';

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
    for (const key of options) select.append(new Option(labelText(labels[key]), key));
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
    control.value = ability.presentation?.[key] ?? '';
    controls.set(key, control);
    append(key, label, control);
  }
  preset.onchange = () => {
    const defaults = presentationPresets[preset.value];
    for (const [key, control] of controls) control.value = defaults?.[key] ?? '';
  };
  return () => Object.fromEntries([...controls].filter(([, control]) => control.value !== '').map(([key, control]) =>
    [key, control.type === 'number' ? control.valueAsNumber : control.value]));
}
