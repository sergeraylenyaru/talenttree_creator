import {classResources} from './resource-costs.js';
import {abilityTemplateSnapshot} from './combat/ability-instance.js';
import {addTranslations, t} from './i18n.js';
import {workshopFlags, workshopNumbers, soundNames} from './combat/workshop-rules.js';
import {presentationOptions, presentationPresets} from './combat/presentation.js';

const words = {
  cooldownGroup:['Общая группа перезарядки','Shared cooldown group'],groupCooldown:['Перезарядка группы, сек.','Group cooldown, sec.'],
  channelPayment:['Оплата канала','Channel payment'],
  swingPolicy:['Автоатака во время применения','Autoattack during cast'],
  attackType:['Таблица атаки','Attack table'],weaponHand:['Рука оружия для расчёта','Weapon hand for calculation'],
  normalizedWeapon:['Нормализованный урон оружия','Normalized weapon damage'],attackSchool:['Школа проверки попадания','Hit-check school'],
  freeWithAura:['Бесплатно при ауре (имя или ID)','Free with aura (name or ID)'],consumeFreeAura:['Расходовать ауру бесплатного применения','Consume free-cast aura'],
  runeSubstitute:['Заменяющие руны (ID)','Substitute rune resource'],
  finisherResource:['Ресурс финишера (ID)','Finisher resource (ID)'],finisherScale:['Множитель за дополнительное очко','Multiplier per extra point'],
  requiredLevel:['Требуемый уровень','Required level'],requiredClass:['Требуемый класс','Required class'],
  requiredStateKey:['Требуемое состояние','Required state'],requiredStateValue:['Значение состояния','State value'],
  baseLevel:['Базовый уровень эффекта','Effect base level'],levelScale:['Прирост эффекта за уровень, %','Effect increase per level, %'],
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
  effectSpeed:['Скорость эффекта','Effect speed'],effectIntensity:['Интенсивность эффекта','Effect intensity'],
  opacity:['Непрозрачность','Opacity'], playback:['Скорость анимации','Animation playback speed'], blend:['Время смешивания','Blend duration'],
  loopAnimation:['Повторять анимацию','Loop animation'], casterEffect:['Эффект на герое','Caster effect'],
  weaponEffect:['Эффект на оружии','Weapon effect'], projectileEffect:['Вид снаряда','Projectile appearance'],
  activationSound:['Звук активации','Activation sound'], castSound:['Звук подготовки','Cast start sound'],
  launchSound:['Звук запуска','Launch sound'], impactSound:['Звук попадания','Impact sound'],
  criticalSound:['Звук критического попадания','Critical hit sound'],tickSound:['Звук тика канала','Channel tick sound'], buffSound:['Звук усиления','Buff sound'],
  debuffSound:['Звук ослабления','Debuff sound'], healSound:['Звук лечения','Healing sound'],
  volume:['Громкость','Volume'], variation:['Разброс высоты звука','Pitch variation']
};
const values = {
  start:['В начале канала','At channel start'],firstTick:['При первом тике','At first tick'],melee:['Ближняя атака','Melee attack'],
  continue:['Продолжать','Continue'],pause:['Приостановить таймер','Pause swing timer'],reset:['Сбросить таймер','Reset swing timer'],
  physical:['Физическая','Physical'],spell:['Заклинание','Spell'],ranged:['Дальняя атака','Ranged attack'],mainHand:['Основная рука','Main hand'],offHand:['Дополнительная рука','Off hand'],
  aim:['В выбранную цель','Toward selected target'], forward:['Перед героем','Along facing'], circle:['Круг','Circle'], cone:['Конус перед героем','Forward cone'], strike:['Удар','Strike'], spark:['Искра','Spark'],
  chime:['Перезвон','Chime'], none:['Нет','None'], melee:['Ближний бой','Melee'], fire:['Огонь','Fire'], frost:['Лёд','Frost'],
  arcane:['Тайная магия','Arcane'], holy:['Свет','Holy'], nature:['Природа','Nature'], shadow:['Тьма','Shadow'],
  healing:['Лечение','Healing'], defense:['Защита','Defense']
};
const groups = [
  ['Доступность и ранг','Availability and rank',['rank','tier','talentRank','rankScale','requiredLevel','requiredClass','requiredStateKey','requiredStateValue','baseLevel','levelScale','disabled','hidden']],
  ['Механика применения','Cast rules',['channelPayment','swingPolicy','attackType','attackSchool','weaponHand','normalizedWeapon','minRange','facing','interruptMovement','uninterruptible','tickInterval','radius','areaShape','freeWithAura','consumeFreeAura','finisherResource','finisherScale','runeSubstitute']],
  ['Заряды и глобальная перезарядка','Charges and global cooldown',['charges','recharge','noGcd','gcdDuration','cooldownGroup','groupCooldown']],
  ['Параметры снаряда','Projectile parameters',['projectileLifetime','collisionRadius','projectileSize','homingStrength','flightDirection']],
  ['Анимация и эффекты','Animation and effects',['casterEffect','weaponEffect','projectileEffect','color','effectScale','effectDuration','effectSpeed','effectIntensity','opacity','playback','blend','loopAnimation']],
  ['Звук','Sound',['activationSound','castSound','launchSound','impactSound','criticalSound','tickSound','buffSound','debuffSound','healSound','volume','variation']]
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

export function workshopOptions(root, ability, character) {
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
      const resources=['finisherResource','runeSubstitute'].includes(key)?classResources(character).filter(resource=>resource.id!=='health'):undefined;
      const options = resources?resources.map(resource=>resource.id):key==='channelPayment'?['start','firstTick']:key==='swingPolicy'?['continue','pause','reset']:key==='attackType'?['melee','ranged','spell']:key==='attackSchool'?['physical','fire','frost','arcane','nature','shadow','holy']:key==='weaponHand'?['mainHand','offHand','ranged']:key.endsWith('Sound') ? soundNames : key.endsWith('Effect') ? presentationOptions.impact : key==='areaShape' ? ['circle','cone'] : key==='flightDirection' ? ['aim','forward'] : undefined;
      const input = document.createElement(options ? 'select' : 'input');
      input.dataset.workshop = key;
      if (options) input.append(new Option(t('Автоматически'), ''), ...options.map(value => new Option(resources?.find(resource=>resource.id===value)?.name??t(values[value]?.[0]??value), value)));
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
    const projectileControl=form?.querySelector('[data-presentation="projectile"]');
    const projectile = projectileControl?.parentElement.hidden ? 'none' : get('projectile');
    const target = get('targeting');
    const byKey = {
      radius:['area','targetArea','ground'].includes(target), areaShape:target==='area',
      minRange:target!=='area'&&target!=='self', facing:target!=='area'&&target!=='self',
      homingStrength:projectile==='homing', projectileLifetime:['straight','homing'].includes(projectile),
      collisionRadius:['straight','homing'].includes(projectile), projectileSize:['straight','homing'].includes(projectile),
      projectileEffect:['straight','homing'].includes(projectile), flightDirection:projectile==='straight',
      tickInterval:Number(get('channelDuration'))>0, tickSound:Number(get('channelDuration'))>0
    };
    for (const [key,visible] of Object.entries(byKey)) controls.get(key).parentElement.hidden=!visible;
    const projectileSection=controls.get('projectileSize').closest('details');
    projectileSection.hidden=!byKey.projectileSize;
  }
  queueMicrotask(relevant);
  const controller=new AbortController(),dialog=root.closest('dialog');
  const cleanup=()=>{if(root.isConnected&&dialog?.open)return;controller.abort();dialog?.removeEventListener('close',cleanup);};
  dialog?.addEventListener('close',cleanup);
  for(const name of ['input','change'])root.closest('form')?.addEventListener(name,relevant,{signal:controller.signal});
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
  ['Огненный шар','Fireball','ember',26,1.25,presentationPresets.fire,[damage('fire',150,{spellCoefficient:.45})]],
  ['Ледяная стрела','Frost Bolt','frost',26,.8,presentationPresets.frost,[damage('frost',110,{spellCoefficient:.35})]],
  ['Удар Света','Holy Strike','light',0,0,{...presentationPresets.sword,impact:'holy'},[damage('holy',110)]],
  ['Свет исцеления','Healing Light','light',0,1,presentationPresets.healing,[healing(220)]],
  ['Взрыв','Area Explosion','arcane',0,0,presentationPresets.area,[damage('arcane',125)],{radius:5}],
  ['Горение','Burning','ember',25,0,{...presentationPresets.fire,projectile:'none'},[damage('fire',45,{duration:6,interval:2,stacks:2})]],
  ['Восстановление','Renewal','nature',0,0,presentationPresets.healing,[healing(55,{duration:8,interval:2})]],
  ['Воодушевление','Battle Focus','light',0,0,presentationPresets.guard,[status('Воодушевление','player','attackPower',25,8)]],
  ['Раскол брони','Sunder Armor','steel',15,0,{category:'spell',delivery:'ranged',targeting:'dummy',projectile:'none',impact:'melee'},[status('Раскол брони','dummy','armor',-35,8)]],
  ['Тайный луч','Arcane Channel','arcane',24,0,{category:'spell',delivery:'ranged',projectile:'none',impact:'arcane',channelDuration:3},[damage('arcane',50)],{tickInterval:1,tickSound:'spark'}],
  ['Огненная зона','Flame Zone','ember',25,0,{...presentationPresets.area,targeting:'ground',impact:'fire'},[damage('fire',40,{duration:6,interval:2})],{radius:4}],
  ['Поглощение','Absorption Ward','light',0,0,presentationPresets.guard,[
    {id:'ward',type:'shield',trigger:'onCast',name:'Поглощение',amount:150,coefficient:0,fraction:1,priority:10,duration:8}
  ]]
];
addTranslations(templates.map(([ru,en])=>[ru,en]));

export function workshopTemplates(resource, owner = '') {
  const builtIn = templates.map(([ru,,icon,range,cast,presentation,effects,rules],index) => ({
    id:'tf-workshop-'+icon+'-'+index,name:t(ru),description:'', icon:'forge-'+icon, kind:'active', learningMode:'base', range,cast,cooldown:2,resourceCosts:[],
    presentation:Object.fromEntries(Object.entries(presentation).filter(([,v])=>v!==undefined)), combatEffects:effects, workshop:{version:1,...rules}
  }));
  if(resource&&resource.id!=='health')builtIn.push({id:'tf-workshop-resource',name:t('Всплеск ресурса'),description:'',icon:'forge-arcane',
    kind:'active',learningMode:'base',range:0,cast:0,cooldown:2,resourceCosts:[],workshop:{version:1},
    presentation:{targeting:'self',category:'support',impact:'arcane'},
    combatEffects:[{id:'gain',type:'resource',trigger:'onCast',resourceId:resource.id,unit:'percent',amount:10}]});
  return structuredClone([...builtIn,...personalTemplates(owner)]);
}
addTranslations([['Всплеск ресурса','Resource Surge']]);
const templateKey = 'talentforge-spell-templates-v1';
function ownerTemplateKey(owner) {
  if (!owner) return templateKey;
  // Legacy browser templates had no owner. Preserve them for the first account using them.
  const legacyOwner = templateKey + ':legacy-owner';
  if (localStorage.getItem(templateKey) && !localStorage.getItem(legacyOwner)) localStorage.setItem(legacyOwner,owner);
  const key = templateKey + ':' + owner;
  if (!localStorage.getItem(key) && localStorage.getItem(legacyOwner) === owner) {
    localStorage.setItem(key,localStorage.getItem(templateKey));
  }
  return key;
}
export function personalTemplates(owner = '') {
  try {
    const list = JSON.parse(localStorage.getItem(ownerTemplateKey(owner)));
    return Array.isArray(list) ? list.filter(item=>item && typeof item.name==='string').map(item=>({...item,id:item.id??'legacy-template:'+item.name})) : [];
  } catch { return []; }
}
export function rememberTemplate(ability, owner = '', document = {abilities:[]}) {
  const template = abilityTemplateSnapshot(document,ability);
  const list = personalTemplates(owner).filter(item=>item.name!==ability.name);
  list.push({...template,learningMode:'base'});
  localStorage.setItem(ownerTemplateKey(owner),JSON.stringify(list.slice(-40)));
}
