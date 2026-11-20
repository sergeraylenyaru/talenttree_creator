import {mountWorldHUD} from './world-hud.js';
import {assetPanel} from './asset-panel.js';
import {addTranslations, t} from '../i18n.js';

addTranslations([
  ['3D-сцена', '3D arena'], ['Боевой стенд', 'Combat view'],
  ['Приблизить и осмотреть', 'Focus and explore'],
  ['WASD — движение · Shift — ходьба · Пробел — прыжок', 'WASD — move · Shift — walk · Space — jump'],
  ['Перетаскивание — камера · Колесо — масштаб · Клик — выбор цели',
    'Drag — orbit · Wheel — zoom · Click — select target'],
  ['Перетащи для поворота камеры. Касание манекена выбирает цель.',
    'Drag to orbit. Tap the dummy to select it.'],
  ['Качество графики', 'Graphics quality'], ['Низкое', 'Low'], ['Высокое', 'High'],
  ['Учебный персонаж', 'Placeholder character'], ['Локальная модель', 'Local model'],
  ['Ошибка локальной модели', 'Local model error'],
  ['3D недоступна. Открыт боевой стенд.', '3D is unavailable. Combat view is active.'],
  ['Собери модуль командой npm run build:world.', 'Build the module with npm run build:world.'],
  ['Манекен выбран', 'Dummy selected'], ['Манекен повержен', 'Dummy defeated'],
  ['Восстановить манекен', 'Reset dummy'], ['Отладка сцены', 'Scene debug'],
  ['Позиция', 'Position'], ['Поворот', 'Rotation'], ['Анимация', 'Animation'], ['Кость', 'Bone'],
  ['Смещение', 'Offset'], ['Масштаб', 'Scale'], ['Высота пола', 'Ground height'],
  ['Коллизии', 'Collision volumes'], ['Камера', 'Camera'], ['Преграда', 'Obstructed'],
  ['Свободно', 'Clear'], ['До манекена', 'Dummy distance']
]);

const qualityKey = 'talentforge-world-quality';

export function mountTrainingWorld(dialog, actions) {
  const arena = dialog.querySelector('.tg-arena');
  const toolbar = document.createElement('div');
  toolbar.className = 'tg-world-toolbar';
  toolbar.innerHTML = `<button type="button" class="tg-world-toggle" aria-pressed="false">3D-сцена</button>
    <label class="tg-quality" hidden>Качество графики <select><option value="low">Низкое</option><option value="high">Высокое</option></select></label>
    <button type="button" class="tg-target-reset" hidden>Восстановить манекен</button>
    <label class="tg-world-debug-control" hidden><input type="checkbox"> Отладка сцены</label>
    <button type="button" class="tg-world-log" hidden aria-expanded="false">Журнал боя</button>
    <span class="tg-world-status muted" role="status"></span>`;
  const stage = document.createElement('div');
  stage.className = 'tg-world-stage';
  stage.hidden = true;
  stage.innerHTML = `<div class="tg-world-frame">
    <button class="tg-world-target" type="button" hidden>Манекен</button>
    <span class="tg-world-model">Учебный персонаж</span>
    <pre class="tg-world-debug" hidden></pre>
  </div>
  <p class="tg-world-keys muted">WASD — движение · Shift — ходьба · Пробел — прыжок<br>
    Перетаскивание — камера · Колесо — масштаб · Клик — выбор цели</p>
  <p class="tg-world-touch muted">Перетащи для поворота камеры. Касание манекена выбирает цель.</p>`;
  arena.querySelector('.tg-clock').after(toolbar, stage);

  const toggle = toolbar.querySelector('button');
  const reset = toolbar.querySelector('.tg-target-reset');
  reset.onclick = actions.resetTarget;
  const quality = toolbar.querySelector('select');
  const status = toolbar.querySelector('.tg-world-status');
  const log=toolbar.querySelector('.tg-world-log');
  log.onclick=()=>{
    const open=dialog.classList.toggle('tg-game-log-open');
    log.setAttribute('aria-expanded',String(open));
  };
  const frame = stage.querySelector('.tg-world-frame');
  const marker = stage.querySelector('.tg-world-target');
  const model = stage.querySelector('.tg-world-model');
  const debug = toolbar.querySelector('.tg-world-debug-control input');
  const overlay = stage.querySelector('.tg-world-debug');
  let debugRefresh = 0;
  debug.onchange = () => {
    controller?.setDebug(debug.checked);
    overlay.hidden = !debug.checked;
    debugRefresh = 0;
  };

  function updateDebug(now) {
    if (!debug.checked || now < debugRefresh) return;
    debugRefresh = now + 100;
    const state = controller.debugState();
    const format = value => value.toFixed(2);
    const vector = values => values.map(format).join(', ');
    const {weapon} = state;
    overlay.textContent = [
      t('Позиция') + ' · ' + vector(state.position),
      t('Поворот') + ' · ' + format(state.rotation) + '°',
      t('Анимация') + ' · ' + state.animation,
      ...(weapon ? [
        t('Кость') + ' · ' + weapon.bone,
        t('Смещение') + ' · ' + vector(weapon.position),
        t('Поворот') + ' · ' + vector(weapon.rotation) + '°',
        t('Масштаб') + ' · ' + format(weapon.scale)
      ] : []),
      t('Высота пола') + ' · ' + format(state.ground),
      t('Коллизии') + ' · ' + state.volumes,
      t('Камера') + ' · ' + t(state.obstructed ? 'Преграда' : 'Свободно'),
      t('До манекена') + ' · ' + format(state.dummyDistance)
    ].join('\n');
  }
  const floats = arena.querySelector('#tg-floats');
  const heals = arena.querySelector('#tg-heals');
  const originalFloatParent = floats.parentElement;
  const castbar=arena.querySelector('#tg-cast');
  const castParent=castbar.parentElement;
  const hud=mountWorldHUD(frame,actions.build,actions.practice,id=>{
    actions.cast(id);
    hud.update(actions.runtime(),dialog.querySelector('#tg-feedback').textContent);
    canvas?.focus({preventScroll:true});
  });
  frame.append(hud.controls);
  const dummyVital = arena.querySelector('#tg-label-dummy').closest('.tg-vital');
  let controller;
  let canvas;
  let generation = 0;
  const assets = assetPanel(stage, () => controller);

  try { quality.value = localStorage.getItem(qualityKey) === 'high' ? 'high' : 'low'; }
  catch { quality.value = 'low'; }

  function switchToCombat() {
    generation++;
    assets.clear();
    if (controller) actions.leave();
    controller?.dispose();
    controller = undefined;
    canvas?.remove();
    canvas = undefined;
    originalFloatParent.append(floats, heals);
    castParent.append(castbar);
    hud.select(false);
    dummyVital.classList.remove('tg-target-selected');
    arena.classList.remove('tg-show-world');
    dialog.classList.remove('tg-game-log-open');
    log.hidden=true;
    log.setAttribute('aria-expanded','false');
    stage.hidden = true;
    marker.hidden = true;
    marker.removeAttribute('aria-pressed');
    quality.parentElement.hidden = true;
    reset.hidden = true;
    debug.parentElement.hidden = true;
    debug.checked = false;
    debug.onchange();
    toggle.disabled = false;
    toggle.setAttribute('aria-pressed', 'false');
    toggle.textContent = '3D-сцена';
  }

  async function enter() {
    const version = ++generation;
    toggle.disabled = true;
    status.textContent = '';
    let module;
    try {
      module = await import('/world/generated/world.js');
    } catch {
      if (version !== generation || !dialog.open) return;
      switchToCombat();
      status.textContent = 'Собери модуль командой npm run build:world.';
      return;
    }
    if (version !== generation || !dialog.open) return;
    canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Приблизить и осмотреть');
    frame.prepend(canvas);
    model.textContent = 'Учебный персонаж';
    try {
      controller = module.createWorld(canvas, {
        asset(role, state, detail) { assets.update(role, state, detail); },
        debugDefault(enabled) { debug.checked = enabled; debug.onchange(); },
        targetAlive: () => actions.state().dummy.health > 0,
        marker({x, y, visible}) {
          marker.hidden = !visible;
          if (!visible) return;
          marker.style.left = x.toFixed(2) + '%';
          marker.style.top = y.toFixed(2) + '%';
          floats.style.setProperty('--tg-target-x', marker.style.left);
          floats.style.setProperty('--tg-target-y', marker.style.top);
        },
        playerMarker({x, y}) {
          heals.style.setProperty('--tg-player-x', x + '%');
          heals.style.setProperty('--tg-player-y', y + '%');
        },
        portrait(role,url) { hud.portrait(role,url); },
        selection(selected,unit) {
          hud.select(selected,unit);
          marker.setAttribute('aria-pressed', String(selected));
          dummyVital.classList.toggle('tg-target-selected', selected);
          status.textContent = selected ? t('Манекен выбран') : '';
        },
        model(kind, error) {
          model.textContent = kind === 'imported' ? 'Локальная модель' : 'Ошибка локальной модели';
          model.title = error || '';
          if (error) status.textContent = t('Ошибка локальной модели') + ' · ' + error;
        },
        unavailable() {
          switchToCombat();
          status.textContent = '3D недоступна. Открыт боевой стенд.';
        }
      });
      actions.enter();
      controller.setQuality(quality.value);
      frame.append(floats, heals, castbar);
      arena.classList.add('tg-show-world');
      log.hidden=false;
      stage.hidden = false;
      canvas.focus({preventScroll:true});
      quality.parentElement.hidden = false;
      reset.hidden = false;
      debug.parentElement.hidden = false;
      updateCombat(actions.state());
      toggle.disabled = false;
      toggle.setAttribute('aria-pressed', 'true');
      toggle.textContent = 'Боевой стенд';
      controller.update(performance.now());
    } catch {
      switchToCombat();
      status.textContent = '3D недоступна. Открыт боевой стенд.';
    }
  }

  toggle.onclick = () => {
    if (controller) {
      switchToCombat();
      status.textContent = '';
    } else enter();
  };
  quality.onchange = () => {
    controller?.setQuality(quality.value);
    try { localStorage.setItem(qualityKey, quality.value); }
    catch { /* The active scene still uses the chosen quality. */ }
  };
  marker.onclick = () => {
    controller?.selectDummy();
    canvas?.focus({preventScroll: true});
  };
  if (matchMedia('(pointer: fine) and (min-width: 760px)').matches) enter();

  function updateCombat(state) {
    if (!controller) return;
    controller.combatState(state.combatTime, state.dummy.health);
    hud.update(actions.runtime(),dialog.querySelector('#tg-feedback').textContent);
    const label = actions.state().dummy.health ? t('Манекен') : t('Манекен повержен');
    if (marker.textContent !== label) marker.textContent = label;
  }

  return {
    delivery: ability => controller?.delivery(ability),
    combatState: updateCombat,
    clearCombat(state) {
      controller?.clearCombat();
      updateCombat(state);
    },
    hit(critical, reaction) { controller?.combatHit(critical, reaction); },
    update(now) {
      if (!controller) return;
      try {
        controller.update(now);
        if (controller) updateDebug(now);
      }
      catch {
        switchToCombat();
        status.textContent = '3D недоступна. Открыт боевой стенд.';
      }
    },
    dispose: switchToCombat
  };
}
