import {addTranslations, t} from '../i18n.js';

addTranslations([
  ['3D-сцена', '3D arena'], ['Боевой стенд', 'Combat view'],
  ['Приблизить и осмотреть', 'Focus and explore'],
  ['WASD — движение · Shift — бег · Пробел — прыжок', 'WASD — move · Shift — run · Space — jump'],
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
  ['Восстановить манекен', 'Reset dummy']
]);

const qualityKey = 'talentforge-world-quality';

export function mountTrainingWorld(dialog, actions) {
  const arena = dialog.querySelector('.tg-arena');
  const toolbar = document.createElement('div');
  toolbar.className = 'tg-world-toolbar';
  toolbar.innerHTML = `<button type="button" class="tg-world-toggle" aria-pressed="false">3D-сцена</button>
    <label class="tg-quality" hidden>Качество графики <select><option value="low">Низкое</option><option value="high">Высокое</option></select></label>
    <button type="button" class="tg-target-reset" hidden>Восстановить манекен</button>
    <span class="tg-world-status muted" role="status"></span>`;
  const stage = document.createElement('div');
  stage.className = 'tg-world-stage';
  stage.hidden = true;
  stage.innerHTML = `<div class="tg-world-frame">
    <button class="tg-world-target" type="button" hidden>Манекен</button>
    <span class="tg-world-model">Учебный персонаж</span>
  </div>
  <p class="tg-world-keys muted">WASD — движение · Shift — бег · Пробел — прыжок<br>
    Перетаскивание — камера · Колесо — масштаб · Клик — выбор цели</p>
  <p class="tg-world-touch muted">Перетащи для поворота камеры. Касание манекена выбирает цель.</p>`;
  arena.querySelector('.tg-clock').after(toolbar, stage);

  const toggle = toolbar.querySelector('button');
  const reset = toolbar.querySelector('.tg-target-reset');
  reset.onclick = actions.resetTarget;
  const quality = toolbar.querySelector('select');
  const status = toolbar.querySelector('.tg-world-status');
  const frame = stage.querySelector('.tg-world-frame');
  const marker = stage.querySelector('.tg-world-target');
  const model = stage.querySelector('.tg-world-model');
  const floats = arena.querySelector('#tg-floats');
  const originalFloatParent = floats.parentElement;
  const dummyVital = arena.querySelector('#tg-label-dummy').closest('.tg-vital');
  let controller;
  let canvas;
  let generation = 0;

  try { quality.value = localStorage.getItem(qualityKey) === 'high' ? 'high' : 'low'; }
  catch { quality.value = 'low'; }

  function switchToCombat() {
    generation++;
    if (controller) actions.leave();
    controller?.dispose();
    controller = undefined;
    canvas?.remove();
    canvas = undefined;
    originalFloatParent.append(floats);
    dummyVital.classList.remove('tg-target-selected');
    arena.classList.remove('tg-show-world');
    stage.hidden = true;
    marker.hidden = true;
    marker.removeAttribute('aria-pressed');
    quality.parentElement.hidden = true;
    reset.hidden = true;
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
        targetAlive: () => actions.state().dummy.health > 0,
        marker({x, y, visible}) {
          marker.hidden = !visible;
          if (!visible) return;
          marker.style.left = x.toFixed(2) + '%';
          marker.style.top = y.toFixed(2) + '%';
          floats.style.setProperty('--tg-target-x', marker.style.left);
          floats.style.setProperty('--tg-target-y', marker.style.top);
        },
        selection(selected) {
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
      frame.append(floats);
      arena.classList.add('tg-show-world');
      stage.hidden = false;
      quality.parentElement.hidden = false;
      reset.hidden = false;
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
    const label = actions.state().dummy.health ? t('Манекен') : t('Манекен повержен');
    if (marker.textContent !== label) marker.textContent = label;
  }

  return {
    delivery: ability => controller?.delivery(ability),
    combatState: updateCombat,
    clearPose() { controller?.clearPose(); },
    clearCombat(state) {
      controller?.clearCombat();
      updateCombat(state);
    },
    hit() { controller?.combatHit(); },
    update(now) {
      if (!controller) return;
      try { controller.update(now); }
      catch {
        switchToCombat();
        status.textContent = '3D недоступна. Открыт боевой стенд.';
      }
    },
    dispose: switchToCombat
  };
}
