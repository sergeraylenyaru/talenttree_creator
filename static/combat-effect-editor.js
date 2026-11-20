import {validateCombatEffects} from './combat/effect-validation.js';
import {addTranslations, t} from './i18n.js';

addTranslations([
  ['Эффект состояния','Status effect'], ['Восстановление ресурса','Resource gain'], ['На игрока','Player'],
  ['На манекен','Dummy'], ['Дублировать эффект','Duplicate effect'], ['Выше','Move up'], ['Ниже','Move down'],
  ['Название эффекта','Status name'], ['Длительность, сек.','Duration, sec.'], ['Интервал тика, сек.','Tick interval, sec.'],
  ['Стеки','Max stacks'], ['Обновление','Refresh policy'], ['Обновить время','Refresh duration'],
  ['Сохранить время','Keep duration'], ['Заменить','Replace'], ['Изменение, %','Modifier, %'],
  ['Скорость движения','Movement speed'], ['Получаемый урон','Damage taken'], ['Получаемое лечение','Healing taken'],
  ['Минимальный базовый урон','Minimum base damage'], ['Максимальный базовый урон','Maximum base damage'],
  ['Периодический эффект','Periodic effect'], ['Плоский бонус','Flat bonus'], ['Множитель эффекта','Effect multiplier'],
  ['Множитель крита','Critical multiplier'], ['Коэффициент силы атаки','Attack Power coefficient'],
  ['Коэффициент силы заклинаний','Spell Power coefficient'], ['Единицы ресурса','Resource units'],
  ['Ранг способности','Ability rank']
]);

const types = [['damage','Урон'], ['healing','Лечение'], ['status','Эффект состояния'], ['resource','Восстановление ресурса']];
const triggers = [['onCast','При применении'], ['onHit','При попадании']];
const schools = [['physical','Физический'],['fire','Огонь'],['frost','Лёд'],['arcane','Тайная магия'],['nature','Природа'],['shadow','Тьма'],['holy','Свет']];
const scaling = [['none','Без масштабирования'],['spellPower','Сила заклинаний'],['attackPower','Сила атаки']];
const stats = {
  player: [...scaling.slice(1), ['critChance','Шанс крита (0–1)'], ['movementSpeed','Скорость движения'], ['healingTaken','Получаемое лечение']],
  dummy: [['armor','Броня'], ['damageTaken','Получаемый урон']]
};
const refresh = [['refresh','Обновить время'],['keep','Сохранить время'],['replace','Заменить']];
const html = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const options = (choices,value) => choices.map(([id,label]) =>
  `<option value="${html(id)}" ${id===value?'selected':''}>${html(label)}</option>`).join('');
const select = (key,label,choices,value) => `<label>${label}<select data-key="${key}">${options(choices,value)}</select></label>`;
const number = (key,label,value,min,max,optional=false) =>
  `<label>${label}<input data-key="${key}" type="number" min="${min}" max="${max}" step="any" ${optional?'':'required'} value="${html(value)}"></label>`;

function newEffect(type, id, trigger, resourceId) {
  const base = {id, type, trigger};
  if (type === 'status') return {...base, target:'player', name:t('Эффект состояния'), stat:'attackPower', amount:20, duration:6};
  if (type === 'resource') return {...base, resourceId, amount:10, unit:'points'};
  return {...base, ...(type==='damage'?{school:'physical'}:{}), baseAmount:0, scalingStat:'none', coefficient:0, canCrit:false};
}

export function combatEffectEditor(root, ability, resources = []) {
  let effects = structuredClone(ability.combatEffects ?? []);
  let touched = false;
  const availableResources = resources.filter(resource => resource.id !== 'health');
  function capture() {
    for (const [i, row] of [...root.querySelectorAll('[data-combat-row]')].entries()) {
      const effect = effects[i];
      for (const input of row.querySelectorAll('[data-key]')) {
        const key = input.dataset.key;
        if (key === 'type') continue;
        if (input.value === '' && (key === 'icon' || input.type === 'number' && !input.required)) delete effect[key];
        else effect[key] = input.type === 'number' ? input.valueAsNumber : input.type === 'checkbox' ? input.checked : input.value;
      }
    }
  }

  function timing(e) {
    return number('duration','Длительность, сек.',e.duration,.25,300) +
      (e.type==='status'?'':number('interval','Интервал тика, сек.',e.interval,.25,300)) +
      number('stacks','Стеки',e.stacks ?? 1,1,10) + select('refresh','Обновление',refresh,e.refresh ?? 'refresh');
  }

  function fields(e) {
    if (e.type === 'status') return select('target','Выбор цели',[['player','На игрока'],['dummy','На манекен']],e.target) +
      `<label>Название эффекта<input data-key="name" required maxlength="100" value="${html(e.name)}"></label>` +
      select('icon','Иконка',[['','Иконка способности'], ...['steel','ember','frost','light','nature','arcane'].map(name=>['forge-'+name,name])],e.icon) +
      select('stat','Характеристика масштабирования',stats[e.target],e.stat) + number('amount','Изменение, %',e.amount,-100,500) + timing(e);
    if (e.type === 'resource') return select('resourceId','Ресурс',availableResources.map(r=>[r.id,r.name]),e.resourceId) +
      select('unit','Единицы ресурса',[['points','Единицы'],['percent','Проценты'],['count','Заряды']],e.unit) +
      number('amount','Базовая величина',e.amount,0,1e9);
    return (e.type==='damage'?select('school','Школа урона',schools,e.school):'') +
      select('scalingStat','Характеристика масштабирования',scaling,e.scalingStat) +
      number('baseAmount','Базовая величина',e.baseAmount,0,1e9) +
      number('coefficient','Коэффициент масштабирования',e.coefficient,0,1000) +
      `<label><input type="checkbox" data-key="canCrit" ${e.canCrit?'checked':''}>${e.type==='damage'?'Может критически ударить':'Может критически исцелить'}</label>
      <label><input type="checkbox" data-periodic ${e.duration?'checked':''}>Периодический эффект</label>` +
      (e.duration ? timing(e) : '') +
      `<details class="workshop-effect-advanced"><summary>Модификаторы</summary><div class="ability-selectors">
      ${e.type==='damage'?number('minAmount','Минимальный базовый урон',e.minAmount,0,1e9,true)+
        number('maxAmount','Максимальный базовый урон',e.maxAmount,0,1e9,true):''}
      ${number('flatBonus','Плоский бонус',e.flatBonus,0,1e9,true)}
      ${number('attackCoefficient','Коэффициент силы атаки',e.attackCoefficient,0,1000,true)}
      ${number('spellCoefficient','Коэффициент силы заклинаний',e.spellCoefficient,0,1000,true)}
      ${number('multiplier','Множитель эффекта',e.multiplier,0,1000,true)}
      ${number('critMultiplier','Множитель крита',e.critMultiplier,0,1000,true)}
      </div></details>`;
  }

  function render() {
    root.innerHTML = `<section class="combat-effects"><h3>БОЕВЫЕ ЭФФЕКТЫ</h3><div class="combat-effect-list">
      ${effects.map((e,i)=>`<fieldset data-combat-row><legend>${i+1}. ${types.find(([kind])=>kind===e.type)?.[1]}</legend>
      <div class="ability-selectors">${select('type','Тип эффекта',types.filter(([type])=>type!=='resource'||availableResources.length||e.type==='resource'),e.type)}
      ${select('trigger','Срабатывание',triggers,e.trigger)}${fields(e)}</div><div class="workshop-effect-actions">
      <button type="button" data-up ${i===0?'disabled':''}>Выше</button>
      <button type="button" data-down ${i===effects.length-1?'disabled':''}>Ниже</button>
      <button type="button" data-duplicate ${effects.length>=32?'disabled':''}>Дублировать эффект</button>
      <button type="button" data-remove>Удалить эффект</button></div></fieldset>`).join('')}</div>
      <button type="button" data-add ${effects.length>=32?'disabled':''}>＋ Добавить эффект</button></section>`;
  }

  root.onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    capture();
    touched = true;
    if (button.hasAttribute('data-add')) effects.push(newEffect('damage',crypto.randomUUID(),'onHit'));
    else {
      const index = [...root.querySelectorAll('[data-combat-row]')].indexOf(button.closest('[data-combat-row]'));
      const effect = effects[index];
      if (button.hasAttribute('data-remove')) effects.splice(index,1);
      if (button.hasAttribute('data-duplicate')) effects.splice(index+1,0,{...effect,id:crypto.randomUUID()});
      if (button.hasAttribute('data-up') || button.hasAttribute('data-down')) {
        const destination = index + (button.hasAttribute('data-up')?-1:1);
        [effects[index],effects[destination]] = [effects[destination], effects[index]];
      }
    }
    render();
  };
  root.onchange = event => {
    const input = event.target;
    if (!input.matches('[data-key="type"],[data-key="target"],[data-periodic]')) return;
    capture();
    touched = true;
    const index = [...root.querySelectorAll('[data-combat-row]')].indexOf(input.closest('[data-combat-row]'));
    const effect = effects[index];
    if (input.dataset.key === 'type') effects[index] = newEffect(input.value,effect.id,effect.trigger,availableResources[0]?.id);
    if (input.dataset.key === 'target') effect.stat = stats[effect.target][0][0];
    if (input.hasAttribute('data-periodic')) {
      if (input.checked) Object.assign(effect,{duration:6,interval:2});
      else for (const key of ['duration','interval','stacks','refresh']) delete effect[key];
    }
    render();
  };
  render();
  return () => {
    capture();
    if (!touched && !Object.hasOwn(ability,'combatEffects')) return undefined;
    validateCombatEffects({combatEffects:effects});
    return structuredClone(effects);
  };
}
