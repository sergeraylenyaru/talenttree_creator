import {iconURL} from '../icons.js';
import {addTranslations, t} from '../i18n.js';

addTranslations([
  ['Урон нанесено', 'Damage done'], ['Подробности урона', 'Damage breakdown'],
  ['Попадания', 'Hits'], ['Критические удары', 'Critical hits']
]);

const format = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1}).format;

export function mountDamageMeter(frame, playerName) {
  const meter = document.createElement('section');
  meter.className = 'tg-damage-meter';
  meter.hidden = true;
  meter.innerHTML = '<strong>Урон нанесено</strong><div class="tg-meter-player"></div><ol></ol>';
  const details = document.createElement('details');
  details.innerHTML = '<summary>Подробности урона</summary><ol></ol>';
  meter.append(details);
  frame.append(meter);
  const player = meter.querySelector('.tg-meter-player');
  const overview = meter.querySelector('ol');
  const breakdown = details.querySelector('ol');
  let last;

  function row(name, icon, value, fraction, ability = false) {
    const entry = document.createElement('li');
    entry.style.setProperty('--tg-share', (fraction * 100) + '%');
    const url = icon && iconURL(icon);
    if (ability) {
      const art = document.createElement('i');
      art.setAttribute('aria-hidden', 'true');
      art.textContent = '✦';
      if (url) {
        const img = new Image();
        img.src = url;
        img.alt = '';
        img.onerror = () => img.remove();
        art.append(img);
      }
      entry.append(art);
    }
    const label = document.createElement('span');
    label.dataset.userContent = '';
    label.textContent = name;
    const numbers = document.createElement('b');
    numbers.textContent = value;
    entry.append(label, numbers);
    return entry;
  }

  return {
    toggle() { meter.hidden = !meter.hidden; return !meter.hidden; },
    hide() { meter.hidden = true; },
    update(state) {
      if (meter.hidden) return;
      if (last === state.statistics) return;
      last = state.statistics;
      const {totalDamage, damageByAbility, damageDetails, damageWindowStart, lastDamageAt} = last;
      const elapsed = lastDamageAt - damageWindowStart;
      const dps = elapsed ? totalDamage / elapsed : 0;
      const contribution = (amount, share) => format(amount) + ' · ' + format(share * 100) + '%';
      const rate = value => format(value) + ' DPS';
      player.replaceChildren(row(playerName, '', contribution(totalDamage, totalDamage ? 1 : 0) + ' · ' + rate(dps), totalDamage ? 1 : 0));
      const rows = Object.entries(damageByAbility).sort((a, b) => b[1] - a[1]);
      overview.replaceChildren(...rows.map(([id, damage]) => {
        const share = damage / totalDamage;
        const {name, icon} = damageDetails[id];
        return row(name, icon, contribution(damage, share) + ' · ' + rate(elapsed ? damage / elapsed : 0), share, true);
      }));
      breakdown.replaceChildren(...rows.map(([id, damage]) => {
        const {name, icon, hits, criticalHits} = damageDetails[id];
        return row(name, icon, contribution(damage, damage / totalDamage) + ' · ' + t('Попадания') + ' ' +
          hits + ' · ' + t('Критические удары') + ' ' + criticalHits, damage / totalDamage, true);
      }));
    }
  };
}
