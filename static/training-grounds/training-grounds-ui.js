import {addTranslations, t, getLanguage} from '../i18n.js';
import {classEmblem} from '../class-emblem.js';
import {iconURL} from '../icons.js';
import {schools} from '../combat/build-compiler.js';
import {combatAnalytics} from '../combat/combat-state.js';

const statLabels = {
  spellPower: ['Сила заклинаний', 'Spell power'],
  attackPower: ['Сила атаки', 'Attack power'],
  critChance: ['Шанс крита (0–1)', 'Critical chance (0–1)'],
  critMultiplier: ['Множитель крита', 'Critical multiplier'],
  damageMultiplier: ['Множитель урона', 'Damage multiplier'],
  healingMultiplier: ['Множитель лечения', 'Healing multiplier']
};

const schoolLabels = [
  ['Физический', 'Physical'], ['Огонь', 'Fire'], ['Лёд', 'Frost'], ['Тайная магия', 'Arcane'],
  ['Природа', 'Nature'], ['Тьма', 'Shadow'], ['Свет', 'Holy']
];

addTranslations([['Подготовка', 'Preparing'], ['Поддержание', 'Channeling']]);

const metrics = {
  dps: ['DPS', 'DPS'], totalDamage: ['Всего урона', 'Total damage'],
  totalHealing: ['Всего лечения', 'Total healing'], effectiveHealing: ['Эффективное лечение', 'Effective healing'],
  overhealing: ['Избыточное лечение', 'Overhealing'], casts: ['Завершённые применения', 'Completed casts'],
  criticalHits: ['Критические эффекты', 'Critical effects'], criticalPercent: ['Доля критов', 'Critical rate']
};

const eventLabels = {
  castStarted: ['Начало применения', 'Cast started'], castCompleted: ['Применение завершено', 'Cast completed'],
  castCancelled: ['Применение отменено', 'Cast cancelled'], resourceSpent: ['Потрачен ресурс', 'Resource spent'],
  damage: ['Урон', 'Damage'], healing: ['Лечение игрока', 'Player healing'],
  overhealing: ['Избыточное лечение', 'Overhealing'], cooldownStarted: ['Начало перезарядки', 'Cooldown started'],
  insufficient: ['Недостаточно ресурса', 'Insufficient resource'],
  calculationFailed: ['Ошибка расчёта эффекта', 'Effect calculation failed'],
  castRejected: ['Применение отклонено', 'Cast rejected'],
  attackLaunched: ['Атака началась', 'Attack launched'],
  attackHit: ['Попадание', 'Impact'],
  projectileLaunched: ['Снаряд выпущен', 'Projectile launched'],
  projectileHit: ['Снаряд попал', 'Projectile hit'],
  projectileMissed: ['Снаряд не попал', 'Projectile missed'],
  attackMissed: ['Атака не попала', 'Attack missed'],
  autoStarted: ['Автоатака началась', 'Autoattack started'],
  autoHit: ['Автоатака попала', 'Autoattack hit'],
  autoWaiting: ['Автоатака ожидает', 'Autoattack waiting'],
  targetDefeated: ['Манекен повержен', 'Dummy defeated'],
  targetRestored: ['Манекен восстановлен', 'Dummy restored']
};

const statusLabels = {
  paused: ['Бой на паузе', 'Combat paused'], casting: ['Идёт применение', 'Casting'],
  cooldown: ['Перезарядка', 'Cooldown'], gcd: ['Общая перезарядка', 'Global cooldown'],
  dummyDead: ['Манекен побеждён. Сбрось бой, чтобы продолжить.', 'Dummy defeated. Reset combat to continue.'],
  invalidTarget: ['Выбери манекен', 'Select the dummy'],
  outOfRange: ['Цель вне зоны действия', 'Target out of range'],
  obstructed: ['Препятствие между игроком и целью', 'Line of sight blocked'],
  insufficient: eventLabels.insufficient, calculationFailed: eventLabels.calculationFailed
};

export function registerTrainingTranslations() {
  addTranslations([
    ...Object.values(statLabels), ...schoolLabels, ...Object.values(metrics), ...Object.values(eventLabels),
    ...Object.values(statusLabels),
    ['Тренировочная площадка', 'Training Grounds'], ['Вернуться к дереву', 'Return to tree'],
    ['Пауза', 'Pause'], ['Продолжить бой', 'Resume combat'], ['Сбросить бой', 'Reset combat'],
    ['Манекен', 'Training dummy'], ['Боевой таймер', 'Combat timer'],
    ['Отменить применение', 'Cancel cast'], ['Боевые способности', 'Combat abilities'],
    ['Пассивные способности', 'Passive abilities'],
    ['Нет открытых активных способностей.', 'No unlocked active abilities.'],
    ['Добавь боевые эффекты в редакторе способностей.', 'Add combat effects in the ability editor.'],
    ['Поддерживаемые способности срабатывают один раз при завершении.',
      'Channeled abilities resolve once on completion.'],
    ['Боевые показатели', 'Combat statistics'], ['Урон по способностям', 'Damage by ability'],
    ['Журнал боя', 'Combat log'], ['Очистить журнал', 'Clear log'],
    ['Боевых событий пока нет.', 'No combat events yet.'], ['Настройки площадки', 'Training settings'],
    ['Характеристики игрока', 'Player stats'], ['Множители по школам', 'School multipliers'],
    ['Настройки манекена', 'Dummy settings'], ['Максимум здоровья', 'Maximum health'],
    ['Броня', 'Armor'], ['Сопротивление', 'Resistance'],
    ['Множитель получаемого урона', 'Damage taken multiplier'],
    ['Множитель получаемого лечения игрока', 'Player healing received multiplier'],
    ['Общая перезарядка, сек.', 'Global cooldown, sec.'],
    ['Применить и сбросить бой', 'Apply and reset combat'],
    ['Мгновенное', 'Instant'], ['Бесплатно', 'Free'], ['Нет эффектов', 'No effects'],
    ['Крит', 'Critical'], ['Очки билда', 'Build points']
  ]);
}

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,
  char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const userText = value => `<span data-user-content>${escapeHTML(value)}</span>`;

function field(name, label, value, max = Number.MAX_SAFE_INTEGER, min = 0) {
  return `<label>${label}<input required type="number" step="any" name="${name}" value="${value}" min="${min}" max="${max}"></label>`;
}

function settingsMarkup(settings) {
  return `<details class="tg-panel tg-settings"><summary>Настройки площадки</summary>
    <form class="tg-settings-form">
      <fieldset><legend>Характеристики игрока</legend><div class="tg-fields">
        ${Object.entries(statLabels).map(([key, [label]]) =>
          field(key, label, settings.stats[key], key === 'critChance' ? 1 : undefined)).join('')}
        ${field('healingTakenMultiplier', 'Множитель получаемого лечения игрока', settings.healingTakenMultiplier)}
        ${field('globalCooldown', 'Общая перезарядка, сек.', settings.globalCooldown, 3)}
      </div></fieldset>
      <fieldset><legend>Множители по школам</legend><div class="tg-fields">
        ${schools.map((school, index) => field('school-' + school, schoolLabels[index][0],
          settings.stats.schoolDamageMultipliers[school])).join('')}
      </div></fieldset>
      <fieldset><legend>Настройки манекена</legend><div class="tg-fields">
        ${field('maxHealth', 'Максимум здоровья', settings.dummy.maxHealth, undefined, 1)}
        ${field('armor', 'Броня', settings.dummy.armor)}
        ${field('damageTakenMultiplier', 'Множитель получаемого урона', settings.dummy.damageTakenMultiplier)}
        ${schools.slice(1).map((school, index) => field('resist-' + school, 'Сопротивление · ' + schoolLabels[index + 1][0],
          settings.dummy.resistances[school])).join('')}
      </div></fieldset>
      <button class="primary">Применить и сбросить бой</button>
    </form>
  </details>`;
}

function readSettings(form) {
  const data = new FormData(form);
  const value = key => Number(data.get(key));
  return {
    stats: {
      ...Object.fromEntries(Object.keys(statLabels).map(key => [key, value(key)])),
      schoolDamageMultipliers: Object.fromEntries(schools.map(school => [school, value('school-' + school)]))
    },
    dummy: {
      maxHealth: value('maxHealth'), armor: value('armor'), damageTakenMultiplier: value('damageTakenMultiplier'),
      resistances: Object.fromEntries(schools.slice(1).map(school => [school, value('resist-' + school)]))
    },
    healingTakenMultiplier: value('healingTakenMultiplier'),
    globalCooldown: value('globalCooldown')
  };
}

function bar(label, key, color) {
  return `<div class="tg-vital"><span id="tg-label-${key}">${label}</span>
    <div class="resource-bar" style="--resource-color:${color}"><span></span><strong></strong></div>
    <meter class="tg-meter" aria-labelledby="tg-label-${key}" min="0"></meter>
  </div>`;
}

function abilityMarkup(ability, index) {
  const icon = iconURL(ability.icon || 'inv_misc_questionmark');
  const cost = ability.resourceCosts.filter(cost => cost.amount).map(cost =>
    `${cost.amount}${cost.unit === 'percent' ? '%' : ''} ${userText(cost.resourceName)}`).join(' · ');
  return `<button type="button" class="tg-ability" data-tg-ability="${index}">
    <span class="tg-ability-icon"><span aria-hidden="true">✦</span>${icon ? `<img src="${escapeHTML(icon)}" alt="">` : ''}
      ${index < 9 ? `<kbd>${index + 1}</kbd>` : ''}<span class="tg-cooldown" hidden></span></span>
    <span class="tg-ability-info"><strong data-user-content>${escapeHTML(ability.name)}</strong>
      <small>${cost || 'Бесплатно'}</small>
      <small>${ability.cast + (ability.channelDuration ?? 0) ? `${ability.cast + (ability.channelDuration ?? 0)} сек.` : 'Мгновенное'}${ability.combatEffects.length ? '' : ' · Нет эффектов'}</small>
    </span>
  </button>`;
}

function replaceText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

export function renderTrainingGrounds(dialog, build, settings, actions) {
  const count = new Intl.NumberFormat(getLanguage(), {maximumFractionDigits: 2});
  const fmt = value => count.format(value);
  const abilities = build.activeAbilities;
  dialog.innerHTML = `
    <div class="tg-top">
      <div><button type="button" id="tg-return" autofocus>← Вернуться к дереву</button>
      <h2 id="tg-title">Тренировочная площадка</h2>
      <p class="tg-build"><strong data-user-content>${escapeHTML(build.name)}</strong>
        <span>Очки билда · ${build.points} / ${build.budget}</span>
        ${build.primaryBranch ? userText(build.primaryBranch) : ''}</p></div>
      <div class="tg-controls"><button type="button" id="tg-pause"></button>
        <button type="button" id="tg-reset">Сбросить бой</button></div>
    </div>
    <div class="tg-layout">
      <div class="tg-main">
        <section class="tg-arena tg-panel" aria-label="Тренировочная площадка">
          <div class="tg-clock"><span>Боевой таймер</span><strong id="tg-time"></strong></div>
          <div class="tg-figures">
            <div class="tg-player">${classEmblem(build.icon)}<strong data-user-content>${escapeHTML(build.name)}</strong></div>
            <div class="tg-dummy"><div class="tg-target" aria-hidden="true"></div><strong>Манекен</strong>
              <div id="tg-floats" aria-hidden="true"></div><div id="tg-heals" aria-hidden="true"></div></div>
          </div>
          <div class="tg-vitals">
            <div>${bar('Здоровье', 'player', '#459254')}
              ${build.resources.map((resource, index) => bar(userText(resource.name), 'resource-' + index, resource.color)).join('')}
            </div>
            <div>${bar('Манекен', 'dummy', '#bd5157')}</div>
          </div>
          <div id="tg-cast" hidden><div class="tg-cast-heading"><span class="tg-cast-art" aria-hidden="true">✦<img id="tg-cast-icon" alt="" hidden></span><strong id="tg-cast-name" data-user-content></strong><span id="tg-cast-phase"></span><time id="tg-cast-remaining"></time></div>
            <progress id="tg-progress" aria-labelledby="tg-cast-name"></progress>
            <button type="button" id="tg-cancel">Отменить применение</button></div>
        </section>
        <section class="tg-panel"><h3>Боевые способности</h3>
          <div class="tg-actions">${abilities.map(abilityMarkup).join('')}</div>
          ${abilities.length ? '' : '<p class="muted">Нет открытых активных способностей.</p>'}
          ${abilities.length && abilities.every(a => !a.combatEffects.length) ? '<p class="muted">Добавь боевые эффекты в редакторе способностей.</p>' : ''}
          ${abilities.some(a => a.channelDuration) ? '<p class="muted">Поддерживаемые способности срабатывают один раз при завершении.</p>' : ''}
          ${build.passiveAbilities.length ? `<details><summary>Пассивные способности</summary><ul>${build.passiveAbilities.map(a => `<li>${userText(a.name)}</li>`).join('')}</ul></details>` : ''}
          <p class="tg-feedback" role="status" id="tg-feedback"></p>
        </section>
      </div>
      <aside class="tg-side">
        <section class="tg-panel"><h3>Боевые показатели</h3>
          <dl class="tg-stats">${Object.entries(metrics).map(([key, [label]]) => `<div><dt>${label}</dt><dd data-metric="${key}"></dd></div>`).join('')}</dl>
          <h4>Урон по способностям</h4><ul id="tg-contribution"></ul>
        </section>
        <section class="tg-panel"><div class="tg-log-head"><h3>Журнал боя</h3>
          <button type="button" id="tg-clear">Очистить журнал</button></div>
          <p class="muted" id="tg-empty-log">Боевых событий пока нет.</p><ol id="tg-log" tabindex="0" aria-label="Журнал боя"></ol>
        </section>
      </aside>
    </div>
    ${settingsMarkup(settings)}`;

  const $ = selector => dialog.querySelector(selector);
  const buttons = [...dialog.querySelectorAll('.tg-ability')];
  const castIcon = $('#tg-cast-icon');
  castIcon.onload = () => { castIcon.hidden = false; };
  castIcon.onerror = () => { castIcon.hidden = true; };
  const metricValues = [...dialog.querySelectorAll('[data-metric]')];
  const meters = [...dialog.querySelectorAll('.tg-vital')].map(node => ({
    meter: node.querySelector('meter'), fill: node.querySelector('.resource-bar span'), text: node.querySelector('strong')
  }));
  let previousLog;
  let previousStats;
  let lastEvent = 0;

  function setVital(index, current, max, unit = '') {
    const {meter, fill, text} = meters[index];
    if (meter.max !== max) meter.max = max;
    if (meter.getAttribute('value') !== String(current)) meter.value = current;
    const width = `${current / max * 100}%`;
    if (fill.style.width !== width) fill.style.width = width;
    replaceText(text, `${fmt(current)} / ${fmt(max)}${unit}`);
  }

  function showLog(events) {
    if (events === previousLog) return;
    previousLog = events;
    $('#tg-empty-log').hidden = events.length > 0;
    const list = $('#tg-log');
    list.hidden = !events.length;
    list.innerHTML = events.slice(-80).reverse().map(event => {
      const detail = event.reason && statusLabels[event.reason] ? ' · ' + statusLabels[event.reason][0]
        : event.type === 'cooldownStarted'
        ? ` · ${fmt(event.amount)} сек. / GCD ${fmt(event.globalCooldown)} сек.`
        : event.amount !== undefined ? ` · ${fmt(event.amount)}` : '';
      return `<li data-event="${event.type}" class="${event.isCritical ? 'tg-critical' : ''}">
        <time>${event.time.toFixed(1)}</time> <strong>${eventLabels[event.type][0]}</strong>
        ${userText(event.abilityName)}${detail}${event.resourceName ? ' ' + userText(event.resourceName) : ''}
        ${event.isCritical ? '<b>Крит</b>' : ''}</li>`;
    }).join('');
    for (const event of events) {
      if (event.id <= lastEvent) continue;
      lastEvent = event.id;
      if (event.type === 'calculationFailed') replaceText($('#tg-feedback'), t(eventLabels.calculationFailed[0]));
      if (event.type === 'castRejected' && statusLabels[event.reason]) replaceText($('#tg-feedback'), t(statusLabels[event.reason][0]));
      if (event.type === 'attackMissed' || event.type === 'projectileMissed') {
        replaceText($('#tg-feedback'), t((statusLabels[event.reason] ?? eventLabels[event.type])[0]));
      }
      const healing = event.type === 'healing';
      if (!healing && event.type !== 'damage') continue;
      const amount = healing ? event.effective : event.amount;
      if (!amount) continue;
      if (!healing) actions.damage?.(event.isCritical,
        abilities.find(ability => ability.id === event.abilityId)?.presentation?.hitReaction);
      if (actions.combatText?.(event)) continue;
      const float = document.createElement('span');
      float.className = event.isCritical ? 'tg-float tg-critical' : 'tg-float';
      if (healing) float.classList.add('tg-healing');
      float.textContent = `${healing ? '+' : '−'}${fmt(amount)}${event.isCritical ? '!' : ''}`;
      const floats = $(healing ? '#tg-heals' : '#tg-floats');
      if (floats.childElementCount >= 6) floats.firstElementChild.remove();
      float.addEventListener('animationend', () => float.remove(), {once: true});
      floats.append(float);
    }
  }

  function update(runtime) {
    const {state} = runtime;
    const {player, dummy, activeCast} = state;
    replaceText($('#tg-pause'), t(runtime.paused ? 'Продолжить бой' : 'Пауза'));
    replaceText($('#tg-time'), state.combatTime.toFixed(1) + ' s');
    setVital(0, player.health, player.maxHealth);
    build.resources.forEach((resource, index) => setVital(index + 1, player.resources[resource.id].current,
      resource.max, resource.unit === 'percent' ? '%' : ''));
    setVital(meters.length - 1, dummy.health, dummy.maxHealth);
    $('#tg-cast').hidden = !activeCast;
    if (activeCast) {
      replaceText($('#tg-cast-name'), activeCast.ability.name);
      const progress = $('#tg-progress');
      const start = activeCast.channeling ? activeCast.castEnd : activeCast.start;
      const end = activeCast.channeling ? activeCast.end : activeCast.castEnd;
      replaceText($('#tg-cast-phase'), t(activeCast.channeling ? 'Поддержание' : 'Подготовка'));
      const url = iconURL(activeCast.ability.icon || 'inv_misc_questionmark');
      if (castIcon.getAttribute('src') !== url) {
        castIcon.hidden = true;
        castIcon.src = url;
      }
      replaceText($('#tg-cast-remaining'), Math.max(0,end-state.combatTime).toFixed(1)+' s');
      progress.max = end - start;
      progress.value = state.combatTime - start;
    }
    buttons.forEach((button, index) => {
      const {reason, remaining} = runtime.availability(abilities[index].id);
      const blocked = reason !== undefined && reason !== 'insufficient';
      if (button.disabled !== blocked) button.disabled = blocked;
      const badge = button.querySelector('.tg-cooldown');
      badge.hidden = !remaining;
      if (remaining) replaceText(badge, Math.ceil(remaining * 10) / 10 + ' s');
      if ((button.dataset.state || undefined) !== reason) {
        button.dataset.state = reason || '';
        button.title = statusLabels[reason] ? t(statusLabels[reason][0]) : '';
      }
    });

    const stats = combatAnalytics(state);
    for (const metric of metricValues) {
      const key = metric.dataset.metric;
      replaceText(metric, fmt(stats[key]) + (key === 'criticalPercent' ? '%' : ''));
    }
    if (previousStats !== state.statistics) {
      previousStats = state.statistics;
      $('#tg-contribution').innerHTML = abilities.filter(a => Object.hasOwn(stats.damageByAbility, a.id))
        .sort((a, b) => stats.damageByAbility[b.id] - stats.damageByAbility[a.id])
        .map(a => `<li>${userText(a.name)} <strong>${fmt(stats.damageByAbility[a.id])}</strong></li>`).join('') || '<li>—</li>';
    }
    showLog(state.combatLog);
  }

  function castAbility(id) {
    if (!id) return;
    const {ok, reason, failedCost} = actions.cast(id);
    const feedback = $('#tg-feedback');
    feedback.replaceChildren();
    if (!ok && statusLabels[reason]) {
      feedback.append(t(statusLabels[reason][0]));
      if (failedCost) {
        const name = document.createElement('span');
        name.dataset.userContent = '';
        name.textContent = failedCost.resourceName;
        feedback.append(' · ', name);
      }
    }
  }

  buttons.forEach((button, index) => button.onclick = () => castAbility(abilities[index].id));
  dialog.onkeydown = event => {
    if (event.key === 'Escape' && !$('#tg-cast').hidden) {
      event.preventDefault();
      if (!event.repeat) actions.cancel();
      return;
    }
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
        event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      const button = dialog.querySelectorAll('.tg-show-world [data-world-slot]')[Number(event.key)-1];
      if (button) button.click();
      else castAbility(abilities[Number(event.key) - 1]?.id);
    }
  };
  $('#tg-return').onclick = () => dialog.close();
  $('#tg-pause').onclick = actions.pause;
  $('#tg-reset').onclick = actions.reset;
  $('#tg-cancel').onclick = actions.cancel;
  $('#tg-clear').onclick = actions.clear;
  $('.tg-settings-form').onsubmit = event => {
    event.preventDefault();
    actions.settings(readSettings(event.currentTarget));
    $('.tg-settings').open = false;
    $('#tg-return').focus();
  };

  return {
    update, castAbility,
    reset(runtime) {
      $('#tg-feedback').replaceChildren();
      $('#tg-floats').replaceChildren();
      $('#tg-heals').replaceChildren();
      lastEvent = 0;
      update(runtime);
    }
  };
}
