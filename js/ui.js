// DOM HUD helpers.
import { ITEMS, SKILLS, SKILL_NAMES, xpForLevel, levelForXp, RECIPES, SWORDS, PIECES } from './shared.js';
const $ = (s) => document.querySelector(s);
export const el = $;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function show(sel, on = true) { $(sel).classList.toggle('hidden', !on); }
export function hearts(hp, maxHalves) {
  const n = Math.ceil(maxHalves / 2); let h = '';
  for (let i = 0; i < n; i++) { const v = hp - i * 2; h += `<span class="heart ${v >= 2 ? 'full' : v === 1 ? 'half' : 'empty'}"></span>`; }
  const e = $('#hearts'); if (e.innerHTML !== h) e.innerHTML = h;
}
export function stamina(f, exhausted) { const s = $('#stamina-fill'); s.style.width = (f * 100).toFixed(1) + '%'; s.classList.toggle('low', exhausted || f < 0.25); $('#stamina').classList.toggle('full', f >= 0.999); }
export function prompt(text) { const p = $('#prompt'); if (text) { p.innerHTML = text; p.classList.remove('hidden'); } else p.classList.add('hidden'); }
export function toast(text, cls = '') {
  const d = document.createElement('div'); d.className = 'toast ' + cls; d.innerHTML = text; $('#toasts').appendChild(d);
  setTimeout(() => d.classList.add('out'), 2200); setTimeout(() => d.remove(), 2800);
  while ($('#toasts').children.length > 6) $('#toasts').firstChild.remove();
}
let bannerT;
export function banner(text, sub = '') { const b = $('#banner'); b.innerHTML = `<div>${text}</div>${sub ? `<small>${sub}</small>` : ''}`; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 2600); }
export function quest(text, dirDeg, dist) {
  $('#quest-text').textContent = text;
  const d = $('#quest-dir');
  if (dirDeg === null || dirDeg === undefined) d.innerHTML = '';
  else d.innerHTML = `<span class="arrow" style="transform:rotate(${dirDeg.toFixed(0)}deg)">➤</span> ${dist.toFixed(0)}m`;
}
export function zone(name, cls) { const z = $('#zone-badge'); z.textContent = name; z.className = cls; }
export function netBadge(text, cls) { const n = $('#net-badge'); n.textContent = text; n.className = cls; }
export function letterbox(on) { document.body.classList.toggle('locked', on); }
export function chatLine(name, text, cls = '') {
  const log = $('#chat-log'), d = document.createElement('div'); d.className = 'line ' + cls;
  d.innerHTML = name ? `<b>${esc(name)}:</b> ${esc(text)}` : esc(text);
  log.appendChild(d); while (log.children.length > 40) log.firstChild.remove(); log.scrollTop = log.scrollHeight;
}
export function buildBar(on, piece, inv) {
  show('#buildbar', on); if (!on) return;
  $('#buildbar').innerHTML = Object.entries(PIECES).map(([k, p], i) => {
    const [item, n] = Object.entries(p.cost)[0];
    return `<div class="slot ${k === piece ? 'sel' : ''}" data-piece="${k}"><b>${i + 1}</b> ${esc(p.name)}<small>${n} ${ITEMS[item].name} · have ${inv[item] || 0}</small></div>`;
  }).join('') + '<div class="hint">E/F/click place · X/right-click remove · B exit</div>';
}
export function panel(html) { const p = $('#panel'); if (html === null) { p.classList.add('hidden'); p.innerHTML = ''; return; } p.innerHTML = `<button class="close" data-close>✕</button>${html}`; p.classList.remove('hidden'); }
export function panelOpen() { return !$('#panel').classList.contains('hidden'); }
export function skillsHtml(xp) {
  return '<h2>Skills</h2>' + SKILLS.map((s) => {
    const x = xp[s] || 0, L = levelForXp(x), a = xpForLevel(L), b = xpForLevel(L + 1), f = (x - a) / (b - a);
    return `<div class="skill"><div class="sk-top"><span>${SKILL_NAMES[s]}</span><span>Lv ${L}</span></div><div class="bar"><i style="width:${(f * 100).toFixed(0)}%"></i></div><small>${x} XP · ${b - x} to next level</small></div>`;
  }).join('');
}
export function bagHtml(inv, sword, hasGrapple) {
  const items = Object.entries(inv).filter(([, n]) => n > 0);
  return `<h2>Bag</h2><div class="equip">⚔ ${SWORDS[sword].name} (dmg ${SWORDS[sword].dmg}) · 🛡 Driftwood Shield${hasGrapple ? ' · 🪝 Grapple Hook' : ''}</div>
  <div class="grid">${items.length ? items.map(([k, n]) => `<div class="item"><span>${ITEMS[k]?.icon || '?'}</span>${esc(ITEMS[k]?.name || k)}<b>×${n}</b></div>`).join('') : '<p>Empty. Chop trees and mine rocks!</p>'}</div>`;
}
export function stationHtml(kind, inv, smithLvl) {
  const rs = RECIPES.filter((r) => r.station === kind);
  return `<h2>${kind === 'furnace' ? 'Furnace — Smelting' : 'Anvil — Forging'}</h2><p class="sub">Smithing level ${smithLvl}</p>` + rs.map((r) => {
    const ok = Object.entries(r.input).every(([k, n]) => (inv[k] || 0) >= n) && smithLvl >= r.level;
    const need = Object.entries(r.input).map(([k, n]) => `${n} ${ITEMS[k].name} (${inv[k] || 0})`).join(' + ');
    return `<button class="recipe" data-recipe="${r.id}" ${ok ? '' : 'disabled'}><b>${esc(r.name)}</b><small>${need} · Lv ${r.level} · +${r.xp} XP</small></button>`;
  }).join('');
}
export const HELP_HTML = `<h2>How to play</h2>
<div class="help"><div><h3>PC</h3><ul>
<li><b>WASD</b> move · <b>Shift</b> sprint · <b>click</b> canvas to capture mouse (Esc frees it) · <b>arrows</b> turn camera</li>
<li><b>Left click / J</b> sword combo (3 hits) · <b>hold</b> then release = spin attack</li>
<li><b>Right click / Tab</b> lock-on (Z-target) · move to strafe while locked</li>
<li><b>Q</b> (hold) shield · <b>Space</b> dodge roll</li>
<li><b>E</b> talk / gather / use · <b>G</b> grapple · <b>B</b> build mode (1-3, E place, X remove)</li>
<li><b>C</b> skills · <b>I</b> bag · <b>Enter</b> chat · <b>H</b> help</li></ul></div>
<div><h3>Phone</h3><ul><li>Left stick to move, drag anywhere else to look.</li><li>⚔ attack (hold for spin) · 🛡 shield · ⤾ roll · 🎯 lock-on · ✋ use</li></ul>
<h3>Tips</h3><ul><li>Enemies flash red before attacking — block or roll!</li><li>The village is a safe zone: no fighting, no building.</li><li>Furnace + anvil in the village smithy turn ore into better swords.</li></ul></div></div>`;
export function dialog(name, text, onNext) {
  const d = $('#dialog'); d.classList.remove('hidden');
  $('#dialog-name').textContent = name; $('#dialog-text').textContent = text;
  d.onclick = () => onNext();
}
export function closeDialog() { $('#dialog').classList.add('hidden'); }
export function dialogOpen() { return !$('#dialog').classList.contains('hidden'); }
