import {iconURL} from '../icons.js';

const lifetime = 1600;
const spread = [-59, 59, -125, 125, -191, 191];

export function mountFloatingCombatText(frame) {
  const layer = document.createElement('div');
  layer.className = 'tg-world-combat-text';
  layer.setAttribute('aria-hidden', 'true');
  frame.append(layer);

  function createSlot(index) {
    const anchor = document.createElement('span');
    anchor.hidden = true;
    const number = document.createElement('b');
    const icon = document.createElement('img');
    const fallback = document.createElement('i');
    const amount = document.createTextNode('');
    icon.onload = () => { icon.hidden = false; fallback.hidden = true; };
    icon.onerror = () => { icon.hidden = true; fallback.hidden = false; };
    icon.alt = '';
    number.append(fallback, icon, amount);
    anchor.append(number);
    layer.append(anchor);
    const offset = spread[index % spread.length];
    return {anchor, number, icon, fallback, amount, offset, row: Math.floor(index / spread.length), expires: 0};
  }

  const slots = [];
  let next = 0;

  return {
    show(event) {
      const now = performance.now();
      let index = next;
      for (let checked = 0; checked < slots.length && slots[index].expires > now; checked++) {
        index = (index + 1) % slots.length;
      }
      const free = slots[index]?.expires <= now;
      if (!free) {
        index = slots.length;
        slots.push(createSlot(index));
      }
      const slot = slots[index];
      next = (index + 1) % slots.length;
      const healing = event.type === 'healing';
      slot.healing = healing;
      slot.expires = now + lifetime;
      slot.anchor.dataset.school = healing ? 'healing' : event.school;
      slot.anchor.classList.toggle('tg-text-critical', event.isCritical);
      slot.amount.data = (healing ? '+' : '') + (healing ? event.effective : event.amount).toLocaleString() +
        (event.isCritical ? '!' : '');
      const url = event.icon && iconURL(event.icon);
      slot.fallback.textContent = healing ? '+' : event.school === 'physical' ? '⚔' : '✦';
      const loaded = Boolean(url) && slot.icon.getAttribute('src') === url && slot.icon.naturalWidth > 0;
      slot.icon.hidden = !loaded;
      slot.fallback.hidden = loaded;
      if (url) slot.icon.src = url;
      else slot.icon.removeAttribute('src');
    },
    project(target, player, now) {
      for (const slot of slots) {
        if (slot.expires <= now) {
          slot.anchor.hidden = true;
          continue;
        }
        const point = slot.healing ? player : target;
        slot.anchor.hidden = !point.visible;
        if (!point.visible) continue;
        const progress = 1 - (slot.expires - now) / lifetime;
        const horizontal = slot.offset * (0.84 + progress * 0.16);
        const rise = 18 + 56 * progress + slot.row * 30;
        slot.anchor.style.left = point.x + '%';
        slot.anchor.style.top = `max(${52 + rise}px, ${point.y}%)`;
        slot.number.style.transform = `translate(calc(-50% + ${horizontal}px), calc(-100% - ${rise}px))`;
        slot.number.style.opacity = String(Math.min(1, (1 - progress) * 2.7));
      }
    },
    clear() {
      for (const slot of slots) {
        slot.expires = 0;
        slot.anchor.hidden = true;
      }
      next = 0;
    }
  };
}
