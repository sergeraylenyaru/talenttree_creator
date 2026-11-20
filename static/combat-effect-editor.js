import {validateCombatEffects} from './combat/effect-validation.js';
import {addTranslations, t} from './i18n.js';

addTranslations([
  ['Щит поглощения','Absorption shield'],['Сила лечения','Healing power'],['Запас поглощения','Absorption capacity'],
  ['Доля входящего урона, 0–1','Incoming damage share, 0–1'],['Приоритет щита','Shield priority'],
  ['Зафиксировать характеристики на момент применения','Snapshot stats on application'],['Коэффициент урона оружия','Weapon damage coefficient'],
  ['Продлить','Extend duration'],['Независимые эффекты','Independent effects'],['Скорость','Haste'],
  ['Регенерация здоровья','Health regeneration'],['Регенерация ресурсов','Resource regeneration'],
  ['Максимум здоровья','Maximum health'],['Максимум ресурсов','Maximum resources'],
  ['Уязвимость к физическому урону','Physical vulnerability'],['Уязвимость к магии','Magic vulnerability'],
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
  ['Ранг способности','Ability rank'], ['Обновить без стека','Refresh without stacking'],
  ['Действие с ресурсом','Resource operation'], ['Восстановить','Gain'], ['Отнять','Drain'],
  ['Наносимый урон','Damage dealt'], ['Все школы','All schools'], ['Снять после прямого попадания','Consume on direct hit']
]);

const types = [['shield','Щит поглощения'], ['damage','Урон'], ['healing','Лечение'], ['status','Эффект состояния'], ['resource','Восстановление ресурса']];
const triggers = [['onCast','При применении'], ['onHit','При попадании']];
const schools = [['physical','Физический'],['fire','Огонь'],['frost','Лёд'],['arcane','Тайная магия'],['nature','Природа'],['shadow','Тьма'],['holy','Свет']];
const scaling = [['none','Без масштабирования'],['healingPower','Сила лечения'],['spellPower','Сила заклинаний'],['attackPower','Сила атаки']];
const stats = {
  player: [['spellPower','Сила заклинаний'],['attackPower','Сила атаки'],['healingPower','Сила лечения'],
    ['haste','Скорость'],['armor','Броня'],['damageTaken','Получаемый урон'],['damageDone','Наносимый урон'],['healthRegen','Регенерация здоровья'],
    ['resourceRegen','Регенерация ресурсов'],['maxHealth','Максимум здоровья'],['maxResource','Максимум ресурсов'], ['critChance','Шанс крита (0–1)'], ['movementSpeed','Скорость движения'], ['healingTaken','Получаемое лечение']],
  dummy: [['armor','Броня'], ['damageTaken','Получаемый урон'],['physicalTaken','Уязвимость к физическому урону'],['magicalTaken','Уязвимость к магии']]
};
const refresh = [['refresh','Обновить время'],['refreshOnly','Обновить без стека'],['keep','Сохранить время'],['replace','Заменить'],['extend','Продлить'],['independent','Независимые эффекты']];
const html = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const options = (choices,value) => choices.map(([id,label]) =>
  `<option value="${html(id)}" ${id===value?'selected':''}>${html(label)}</option>`).join('');
const select = (key,label,choices,value) => `<label>${label}<select data-key="${key}">${options(choices,value)}</select></label>`;
const number = (key,label,value,min,max,optional=false) =>
  `<label>${label}<input data-key="${key}" type="number" min="${min}" max="${max}" step="any" ${optional?'':'required'} value="${html(value)}"></label>`;

function newEffect(type, id, trigger, resourceId) {
  const base = {id, type, trigger};
  if (type === 'shield') return {...base,name:t('Щит поглощения'),amount:150,fraction:1,coefficient:0,priority:10,duration:8};
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
        if (input.value === '' && (['description','icon','direction','school'].includes(key) || input.type === 'number' && !input.required)) delete effect[key];
        else effect[key] = input.type === 'number' ? input.valueAsNumber : input.type === 'checkbox' ? input.checked : input.value;
      }
    }
  }

  function timing(e) {
    return number('duration','Длительность, сек.',e.duration,.25,300) +
      (['status','shield'].includes(e.type)?'':number('interval','Интервал тика, сек.',e.interval,.25,300)) +
      number('stacks','Стеки',e.stacks ?? 1,1,10) + select('refresh','Обновление',refresh,e.refresh ?? 'refresh');
  }

  function statusIdentity(e){
    return `<label>Название эффекта<input data-key="name" required maxlength="100" value="${html(e.name)}"></label>
    <label>Описание<input data-key="description" maxlength="3000" value="${html(e.description)}"></label>`+
      select('icon','Иконка',[['','Иконка способности'], ...['steel','ember','frost','light','nature','arcane'].map(name=>['forge-'+name,name])],e.icon);
  }
  function fields(e) {
    if(e.type==='shield')return statusIdentity(e)+number('amount','Запас поглощения',e.amount,0,1e9)+
      number('fraction','Доля входящего урона, 0–1',e.fraction,.01,1)+
      number('coefficient','Коэффициент силы заклинаний',e.coefficient,0,1000)+
      number('priority','Приоритет щита',e.priority,0,100)+timing(e);

    if (e.type === 'status') return select('target','Выбор цели',[['player','На игрока'],['dummy','На манекен']],e.target) +
      statusIdentity(e) +
      select('stat','Характеристика масштабирования',stats[e.target],e.stat) + number('amount','Изменение, %',e.amount,-100,500) + timing(e) +
      (e.stat==='damageDone'?select('school','Школа урона',[['','Все школы'],...schools],e.school)+
        '<label><input data-key="consumeOnHit" type="checkbox" '+(e.consumeOnHit?'checked':'')+'>Снять после прямого попадания</label>':'');
    if (e.type === 'resource') return select('resourceId','Ресурс',availableResources.map(r=>[r.id,r.name]),e.resourceId) +
      select('direction','Действие с ресурсом',[['','Восстановить'],['drain','Отнять']],e.direction==='drain'?'drain':'') +
      select('unit','Единицы ресурса',[['points','Единицы'],['percent','Проценты'],['count','Заряды']],e.unit) +
      number('amount','Базовая величина',e.amount,0,1e9);
    return (e.type==='damage'?select('school','Школа урона',schools,e.school):'') +
      select('scalingStat','Характеристика масштабирования',scaling,e.scalingStat) +
      number('baseAmount','Базовая величина',e.baseAmount,0,1e9) +
      number('coefficient','Коэффициент масштабирования',e.coefficient,0,1000) +
      `<label><input type="checkbox" data-key="canCrit" ${e.canCrit?'checked':''}>${e.type==='damage'?'Может критически ударить':'Может критически исцелить'}</label>
      <label><input type="checkbox" data-periodic ${e.duration?'checked':''}>Периодический эффект</label>` +
      (e.duration ? timing(e)+`<label><input type="checkbox" data-key="snapshot" ${e.snapshot?'checked':''}>Зафиксировать характеристики на момент применения</label>` : '') +
      `<details class="workshop-effect-advanced"><summary>Модификаторы</summary><div class="ability-selectors">
      ${e.type==='damage'?number('minAmount','Минимальный базовый урон',e.minAmount,0,1e9,true)+
        number('maxAmount','Максимальный базовый урон',e.maxAmount,0,1e9,true)+number('weaponCoefficient','Коэффициент урона оружия',e.weaponCoefficient,0,1000,true):''}
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
    if (!input.matches('[data-key="type"],[data-key="target"],[data-key="stat"],[data-periodic]')) return;
    capture();
    touched = true;
    const index = [...root.querySelectorAll('[data-combat-row]')].indexOf(input.closest('[data-combat-row]'));
    const effect = effects[index];
    if (input.dataset.key === 'type') effects[index] = newEffect(input.value,effect.id,effect.trigger,availableResources[0]?.id);
    if (input.dataset.key === 'target') effect.stat = stats[effect.target][0][0];
    if (effect.type==='status'&&effect.stat!=='damageDone') {delete effect.school;delete effect.consumeOnHit;}
    if (input.hasAttribute('data-periodic')) {
      if (input.checked) Object.assign(effect,{duration:6,interval:2});
      else for (const key of ['duration','interval','stacks','refresh','snapshot']) delete effect[key];
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
