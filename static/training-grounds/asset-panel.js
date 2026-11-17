import {addTranslations, t} from '../i18n.js';

const roles = {manifest: 'Манифест', environment: 'Окружение', hero: 'Персонаж',
  weapon: 'Оружие', target: 'Манекен', scene: 'Сцена'};
const states = {loading: 'Загрузка', ready: 'Готово', fallback: 'Встроенная сцена', error: 'Ошибка',
  parsing: 'Подготовка геометрии и анимаций'};
addTranslations([
  ['Диагностика ассетов', 'Asset diagnostics'], ['Подробности моделей', 'Model details'], ['Скачать отчёт', 'Download report'],
  ['Скачать манифест', 'Download manifest'], ['Сбросить калибровку', 'Reset calibration'],
  ['Калибровка оружия', 'Weapon calibration'], ['Манифест', 'Manifest'], ['Окружение', 'Environment'],
  ['Персонаж', 'Character'], ['Оружие', 'Weapon'], ['Сцена', 'Scene'], ['Загрузка', 'Loading'],
  ['Готово', 'Ready'], ['Встроенная сцена', 'Built-in scene'], ['Ошибка', 'Error'],
  ['Подготовка геометрии и анимаций', 'Preparing geometry and animations']
]);

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function assetPanel(stage, controller) {
  const panel = document.createElement('details');
  panel.className = 'tg-asset-panel';
  panel.innerHTML = `<summary>Диагностика ассетов</summary><ul aria-live="polite"></ul>
    <button type="button" data-report>Скачать отчёт</button>
    <details data-info><summary>Подробности моделей</summary><pre></pre></details>
    <fieldset hidden><legend>Калибровка оружия</legend><p data-bone></p>
    <div class="tg-fields"></div>
    <button type="button" data-reset>Сбросить калибровку</button>
    <button type="button" data-manifest>Скачать манифест</button></fieldset>`;
  stage.append(panel);
  const list = panel.querySelector('ul');
  const calibration = panel.querySelector('fieldset');
  const info = panel.querySelector('[data-info]');
  const infoText = info.querySelector('pre');
  let statuses = {};
  let original;
  const fields = ['X', 'Y', 'Z', 'RX °', 'RY °', 'RZ °', 'Scale'].map((label, index) => {
    const field = document.createElement('label');
    field.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.required = true;
    input.min = index === 6 ? '0.0001' : '-10000';
    input.max = index === 6 ? '100' : '10000';
    field.append(input);
    calibration.querySelector('.tg-fields').append(field);
    return input;
  });

  function setFields(values) {
    [...values.position, ...values.rotation, values.scale].forEach((value, i) => { fields[i].value = value; });
  }
  function current() {
    if (fields.some(input => !input.validity.valid)) return null;
    const values = fields.map(input => input.valueAsNumber);
    return {position: values.slice(0, 3), rotation: values.slice(3, 6), scale: values[6]};
  }
  for (const input of fields) input.oninput = () => {
    const values = current();
    if (values && controller()?.weaponTransform(values)) showDetails();
  };
  function showDetails() {
    if (info.open) infoText.textContent = JSON.stringify(controller()?.assetReport()?.assets ?? {}, null, 2);
  }
  info.ontoggle = showDetails;
  panel.querySelector('[data-report]').onclick = () => {
    const report = controller()?.assetReport();
    if (report) download('talentforge-asset-report.json', {...report, statuses});
  };
  calibration.querySelector('[data-reset]').onclick = () => {
    if (!original) return;
    setFields(original);
    controller()?.weaponTransform(original);
  };
  calibration.querySelector('[data-manifest]').onclick = () => {
    const values = current();
    const report = controller()?.assetReport();
    if (!values || !report?.manifest?.weapons?.mainHand) return;
    const manifest = structuredClone(report.manifest);
    Object.assign(manifest.weapons.mainHand, values);
    download('manifest.json', manifest);
  };
  return {
    update(role, state, detail) {
      const previous = statuses[role];
      if (previous?.state === state && previous?.detail === detail) return;
      statuses[role] = {state, detail};
      let item = list.querySelector('[data-role="' + role + '"]');
      if (!item) {
        item = document.createElement('li');
        item.dataset.role = role;
        list.append(item);
      }
      item.textContent = [t(roles[role]), t(states[state]),
        typeof detail === 'number' ? detail + '%' : detail].filter(Boolean).join(' · ');
      if (state === 'error') panel.open = true;
      if (state === 'ready') showDetails();
      if (role === 'weapon' && state === 'ready') {
        const report = controller()?.assetReport();
        if (!report?.manifest?.debug) return;
        const info = report.assets.weapon;
        original = structuredClone(info.transform);
        setFields(original);
        calibration.querySelector('[data-bone]').textContent = info.bone;
        calibration.hidden = false;
      }
    },
    clear() {
      statuses = {};
      original = undefined;
      calibration.hidden = true;
      panel.open = false;
      list.replaceChildren();
      info.open = false;
      infoText.textContent = '';
    }
  };
}
