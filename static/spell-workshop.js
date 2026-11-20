import {addTranslations, t} from './i18n.js';
import {workshopFlags, workshopNumbers, soundNames} from './combat/workshop-rules.js';
import {presentationOptions, presentationPresets} from './combat/presentation.js';

const words = {
  rank:['Ранг способности','Ability rank'], tier:['Редкость','Rarity'], rankScale:['Прирост эффекта за ранг, %','Effect increase per rank, %'], talentRank:['Требуемый ранг таланта','Required talent rank'],
  disabled:['Способность отключена','Ability disabled'], hidden:['Скрыть из боя','Hide from combat'],
  minRange:['Минимальная дальность','Minimum range'], radius:['Радиус области','Area radius'], areaShape:['Форма области','Area shape'],
  noGcd:['Вне глобальной перезарядки','Off global cooldown'], gcdDuration:['Глобальная перезарядка, сек.','Global cooldown, sec.'],
  charges:['Максимум зарядов','Maximum charges'], recharge:['Время восстановления заряда','Charge recharge time'],
  tickInterval:['Интервал тиков канала','Channel tick interval'], uninterruptible:['Не прерывается вручную','Prevent manual interruption'],
  interruptMovement:['Движение прерывает применение','Movement interrupts casting'], facing:['Требуется смотреть на цель','Require facing target'],
  flightDirection:['Направление полёта','Flight direction'], projectileLifetime:['Время жизни снаряда','Projectile lifetime'], collisionRadius:['Радиус столкновения','Collision radius'],
  projectileSize:['Размер снаряда','Projectile size'], homingStrength:['Скорость поворота снаряда','Homing turn rate'],
  color:['Оттенок эффекта','Effect color'], effectScale:['Масштаб эффекта','Effect scale'], effectDuration:['Время эффекта','Effect duration'],
  opacity:['Непрозрачность','Opacity'], playback:['Скорость анимации','Animation playback speed'], blend:['Время смешивания','Blend duration'],
  loopAnimation:['Повторять анимацию','Loop animation'], casterEffect:['Эффект на герое','Caster effect'],
  weaponEffect:['Эффект на оружии','Weapon effect'], projectileEffect:['Вид снаряда','Projectile appearance'],
  activationSound:['Звук активации','Activation sound'], castSound:['Звук подготовки','Cast start sound'],
  launchSound:['Звук запуска','Launch sound'], impactSound:['Звук попадания','Impact sound'],
  tickSound:['Звук тика канала','Channel tick sound'], buffSound:['Звук усиления','Buff sound'],
  debuffSound:['Звук ослабления','Debuff sound'], healSound:['Звук лечения','Healing sound'],
  volume:['Громкость','Volume'], variation:['Разброс высоты звука','Pitch variation']
};
const values = {
  aim:['В выбранную цель','Toward selected target'], forward:['Перед героем','Along facing'], circle:['Круг','Circle'], cone:['Конус перед героем','Forward cone'], strike:['Удар','Strike'], spark:['Искра','Spark'],
  chime:['Перезвон','Chime'], none:['Нет','None'], melee:['Ближний бой','Melee'], fire:['Огонь','Fire'], frost:['Лёд','Frost'],
  arcane:['Тайная магия','Arcane'], holy:['Свет','Holy'], nature:['Природа','Nature'], shadow:['Тьма','Shadow'],
  healing:['Лечение','Healing'], defense:['Защита','Defense']
};
const groups = [
  ['Доступность и ранг','Availability and rank',['rank','tier','talentRank','rankScale','disabled','hidden']],
  ['Механика применения','Cast rules',['minRange','facing','interruptMovement','uninterruptible','tickInterval','radius','areaShape']],
  ['Заряды и глобальная перезарядка','Charges and global cooldown',['charges','recharge','noGcd','gcdDuration']],
  ['Параметры снаряда','Projectile parameters',['projectileLifetime','collisionRadius','projectileSize','homingStrength','flightDirection']],
  ['Анимация и эффекты','Animation and effects',['casterEffect','weaponEffect','projectileEffect','color','effectScale','effectDuration','opacity','playback','blend','loopAnimation']],
  ['Звук','Sound',['activationSound','castSound','launchSound','impactSound','tickSound','buffSound','debuffSound','healSound','volume','variation']]
];
addTranslations([...Object.values(words), ...Object.values(values), ...groups.map(([ru,en])=>[ru,en]),
  ['Модификаторы','Modifiers'], ['Шаблоны способностей','Ability templates'], ['Дополнительные настройки','Advanced settings'], ['Мастерская заклинаний','Spell Workshop'], ['Библиотека заклинаний','Spell Library'], ['Внутренний ID','Internal ID'],
  ['Запустить предпросмотр','Play preview'], ['Остановить предпросмотр','Stop preview'], ['Сбросить предпросмотр','Reset preview'],
  ['Предпросмотр в 3D','Preview in 3D'], ['Сохранить и открыть тренировку','Save and open Training Grounds'],
  ['Визуальный предпросмотр · отдельная сессия','Visual preview · separate session'],
  ['Открыть тренировку','Open Training Grounds'], ['Поддерживаемое заклинание','Channeling spell'],
  ['Мгновенная доставка','Instant delivery'], ['Прямой снаряд','Straight projectile'], ['Самонаведение','Homing'],
  ['Область действия','Area of effect'], ['По точке на земле','Ground-targeted'], ['Поэтапное применение','Delivery mode'],
  ['Сохранить как шаблон','Save as template'], ['Удалить шаблон','Delete template'], ['Применить шаблон','Apply template'],
  ['Поиск способностей','Search abilities'], ['Доступность','Availability'], ['Все способности','All abilities'],
  ['Активные и пассивные','Active and passive'], ['Доступны по умолчанию','Available by default'],
  ['Требуют талант','Talent required'], ['Отключённые','Disabled'], ['Скрытые','Hidden'],
  ['По названию','By name'], ['По перезарядке','By cooldown'], ['По порядку класса','Class order'],
  ['Импорт способности','Import ability'], ['Экспорт','Export'], ['Дублировать','Duplicate'], ['Переименовать','Rename'],
  ['Настройки сохранены как шаблон','Settings saved as a template'], ['Выбери точку на земле','Choose a point on the ground']
]);

export function workshopOptions(root, ability) {
  const controls = new Map();
  const advanced = document.createElement('details');
  const heading = document.createElement('summary');
  heading.textContent = 'Дополнительные настройки';
  advanced.append(heading);
  root.append(advanced);
  for (const [name,,keys] of groups) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = name;
    const panel = document.createElement('div');
    panel.className = 'workshop-settings-grid';
    for (const key of keys) {
      const label = document.createElement('label');
      const options = key.endsWith('Sound') ? soundNames : key.endsWith('Effect') ? presentationOptions.impact : key==='areaShape' ? ['circle','cone'] : key==='flightDirection' ? ['aim','forward'] : undefined;
      const input = document.createElement(options ? 'select' : 'input');
      input.dataset.workshop = key;
      if (options) input.append(new Option(t('Автоматически'), ''), ...options.map(value => new Option(t(values[value][0]), value)));
      else if (workshopFlags.includes(key)) input.type = 'checkbox';
      else if (workshopNumbers[key]) {
        const [min,max,defaultValue] = workshopNumbers[key];
        input.type = 'number';
        input.min = min;
        input.max = max;
        input.step = ['rank','talentRank','charges'].includes(key) ? '1' : 'any';
        input.placeholder = defaultValue;
      } else {
        input.maxLength = key==='color' ? 7 : 40;
        if (key==='color') input.placeholder = '#ff7529';
      }
      const value = ability.workshop?.[key];
      if (input.type==='checkbox') input.checked = Boolean(value);
      else input.value = value ?? '';
      controls.set(key,input);
      label.append(words[key][0],input);
      panel.append(label);
    }
    details.append(summary,panel);
    advanced.append(details);
  }
  function relevant() {
    const form = root.closest('form');
    const get = name => form?.querySelector(`[data-presentation="${name}"]`)?.value;
    const projectile = get('projectile');
    const target = get('targeting');
    const byKey = {
      radius:['area','targetArea','ground'].includes(target), areaShape:target==='area',
      minRange:target!=='area'&&target!=='self', facing:target!=='area'&&target!=='self',
      homingStrength:projectile==='homing', projectileLifetime:['straight','homing'].includes(projectile),
      collisionRadius:['straight','homing'].includes(projectile), projectileSize:['straight','homing'].includes(projectile),
      projectileEffect:['straight','homing'].includes(projectile), flightDirection:projectile==='straight'
    };
    for (const [key,visible] of Object.entries(byKey)) controls.get(key).parentElement.hidden=!visible;
    const projectileSection=controls.get('projectileSize').closest('details');
    projectileSection.hidden=!byKey.projectileSize;
  }
  queueMicrotask(relevant);
  root.closest('form')?.addEventListener('change', relevant, {signal: (() => {
    const controller = new AbortController();
    root.closest('dialog')?.addEventListener('close',()=>controller.abort(),{once:true});
    return controller.signal;
  })()});
  return () => {
    const rules = {};
    for (const [key,input] of controls) {
      if (input.type==='checkbox' ? !input.checked : !input.value.trim()) continue;
      rules[key] = input.type==='checkbox' ? true : input.type==='number' ? input.valueAsNumber : input.value.trim();
    }
    return Object.keys(rules).length || ability.workshop ? {version:1,...rules} : undefined;
  };
}

const damage = (school,baseAmount,more={}) => ({id:'damage',type:'damage',trigger:'onHit',school,baseAmount,scalingStat:'none',coefficient:0,canCrit:true,...more});
const healing = (baseAmount,more={}) => ({id:'heal',type:'healing',trigger:'onCast',baseAmount,scalingStat:'spellPower',coefficient:.35,canCrit:true,...more});
const status = (name,target,stat,amount,duration) => ({id:'status',type:'status',trigger:'onCast',name,target,stat,amount,duration});
const templates = [
  ['Быстрый удар','Quick Strike','steel',0,0,{...presentationPresets.sword},[damage('physical',55,{attackCoefficient:.15})]],
  ['Тяжёлый удар','Heavy Strike','steel',0,.5,presentationPresets.twoHand,[damage('physical',140,{attackCoefficient:.35})]],
  ['Выстрел','Physical Shot','steel',24,0,presentationPresets.bow,[damage('physical',75)]],
  ['Огненный шар','Fireball','ember',26,1.25,presentationPresets.fire,[damage('fire',180,{spellCoefficient:.45})]],
  ['Ледяная стрела','Frost Bolt','frost',26,.8,presentationPresets.frost,[damage('frost',110,{spellCoefficient:.35})]],
  ['Удар Света','Holy Strike','light',0,0,{...presentationPresets.sword,impact:'holy'},[damage('holy',110)]],
  ['Свет исцеления','Healing Light','light',0,1,presentationPresets.healing,[healing(220)]],
  ['Взрыв','Area Explosion','arcane',0,0,presentationPresets.area,[damage('arcane',125)],{radius:5}],
  ['Горение','Burning','ember',25,0,{...presentationPresets.fire,projectile:'none'},[damage('fire',45,{duration:6,interval:2,stacks:2})]],
  ['Восстановление','Renewal','nature',0,0,presentationPresets.healing,[healing(55,{duration:8,interval:2})]],
  ['Воодушевление','Battle Focus','light',0,0,presentationPresets.guard,[status('Воодушевление','player','attackPower',25,8)]],
  ['Раскол брони','Sunder Armor','steel',15,0,{category:'spell',delivery:'ranged',targeting:'dummy',projectile:'none',impact:'melee'},[status('Раскол брони','dummy','armor',-35,8)]],
  ['Тайный луч','Arcane Channel','arcane',24,0,{category:'spell',delivery:'ranged',projectile:'none',impact:'arcane',channelDuration:3},[damage('arcane',50)],{tickInterval:1,tickSound:'spark'}],
  ['Огненная зона','Flame Zone','ember',25,0,{...presentationPresets.area,targeting:'ground',impact:'fire'},[damage('fire',40,{duration:6,interval:2})],{radius:4}]
];
addTranslations(templates.map(([ru,en])=>[ru,en]));

export function workshopTemplates() {
  const builtIn = templates.map(([ru,,icon,range,cast,presentation,effects,rules]) => ({
    name:t(ru),description:'', icon:'forge-'+icon, kind:'active', learningMode:'base', range,cast,cooldown:2,resourceCosts:[],
    presentation:Object.fromEntries(Object.entries(presentation).filter(([,v])=>v!==undefined)), combatEffects:effects, workshop:{version:1,...rules}
  }));
  return [...builtIn,...personalTemplates()];
}
const templateKey = 'talentforge-spell-templates-v1';
export function personalTemplates() {
  try {
    const list = JSON.parse(localStorage.getItem(templateKey));
    return Array.isArray(list) ? list.filter(item=>item && typeof item.name==='string') : [];
  } catch { return []; }
}
export function rememberTemplate(ability) {
  const {id, talentId, branchId, branchOnly, ...template} = ability;
  const list = personalTemplates().filter(item=>item.name!==ability.name);
  list.push({...template,learningMode:'base'});
  localStorage.setItem(templateKey,JSON.stringify(list.slice(-40)));
}
