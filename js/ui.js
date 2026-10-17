// DOM HUD helpers + panel HTML (inventory/equipment, skills, shops, bank, chests, journal, spellbook, settings).
import { ITEMS, GEAR, SKILLS, SKILL_NAMES, SKILL_ICONS, SKILL_COLORS, xpForLevel, levelForXp, MAX_LEVEL, RECIPES, STATION_NAMES, PIECES, PIECE_ORDER,
  SLOTS, SLOT_NAMES, SHOPS, sellPrice, SPELLS, UNLOCKS, ENCHANTS, burnChance, PETS } from './shared.js';
import { INVENTORY_SLOTS, BANK_SLOTS } from './config.js';
const $ = (s) => document.querySelector(s);
export const el = $;
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nm = (k) => ITEMS[k]?.name || k, ic = (k) => ITEMS[k]?.icon || '?';
const fmt = (n) => Math.floor(n).toLocaleString('en-AU');

export function show(sel, on = true) { $(sel)?.classList.toggle('hidden', !on); }
export function hearts(hp, maxHalves) {
  const n = Math.ceil(maxHalves / 2); let h = '';
  for (let i = 0; i < n; i++) { const v = hp - i * 2; h += `<span class="heart ${v >= 2 ? 'full' : v === 1 ? 'half' : 'empty'}"></span>`; }
  const e = $('#hearts'); if (e.innerHTML !== h) e.innerHTML = h;
}
export function stamina(f, exhausted) { const s = $('#stamina-fill'); s.style.width = (f * 100).toFixed(1) + '%'; s.classList.toggle('low', exhausted || f < 0.25); $('#stamina').classList.toggle('full', f >= 0.999); }
export function fadeMeter(f) { const e = $('#fademeter'); e.classList.toggle('hidden', f <= 0.5); $('#fade-fill').style.width = f.toFixed(0) + '%'; e.classList.toggle('max', f >= 100); }
export function setText(sel, t) { const e = $(sel); if (e && e.textContent !== String(t)) e.textContent = t; }
export function prompt(text) { const p = $('#prompt'); if (text) { if (p.innerHTML !== text) p.innerHTML = text; p.classList.remove('hidden'); } else p.classList.add('hidden'); }
export function toast(text, cls = '') {
  const d = document.createElement('div'); d.className = 'toast ' + cls; d.innerHTML = text; $('#toasts').appendChild(d);
  setTimeout(() => d.classList.add('out'), 2200); setTimeout(() => d.remove(), 2800);
  while ($('#toasts').children.length > 6) $('#toasts').firstChild.remove();
}
let bannerT;
export function banner(text, sub = '', cls = '') { const b = $('#banner'); b.className = cls; b.innerHTML = `<div>${text}</div>${sub ? `<small>${sub}</small>` : ''}`; void b.offsetWidth; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 2800); }
export function quest(title, text, dirDeg, dist) {
  setText('#quest .qt', title); setText('#quest-text', text);
  const d = $('#quest-dir');
  const h = dirDeg === null || dirDeg === undefined ? '' : `<span class="arrow" style="transform:rotate(${dirDeg.toFixed(0)}deg)">➤</span> ${dist.toFixed(0)}m`;
  if (d.innerHTML !== h) d.innerHTML = h;
}
export function zone(name, cls) { const z = $('#zone-badge'); z.textContent = name; z.className = cls; }
export function netBadge(text, cls) { const n = $('#net-badge'); n.textContent = text; n.className = cls; }
export function letterbox(on) { document.body.classList.toggle('locked', on); }
export function chatLine(name, text, cls = '') {
  const log = $('#chat-log'), d = document.createElement('div'); d.className = 'line ' + cls;
  d.innerHTML = name ? `<b>${esc(name)}:</b> ${esc(text)}` : esc(text);
  log.appendChild(d); while (log.children.length > 40) log.firstChild.remove(); log.scrollTop = log.scrollHeight;
}
const costTxt = (cost, inv) => Object.entries(cost).map(([k, n]) => `${n} ${nm(k)} (${inv[k] || 0})`).join(' + ');
export function buildBar(on, piece, rot, inv, plotTxt) {
  show('#buildbar', on); if (!on) return;
  const P = PIECES[piece];
  const alt = P.alt && Object.entries(P.alt).every(([k, n]) => (inv[k] || 0) >= n);
  $('#buildbar').innerHTML = `<div class="bb-slots">${PIECE_ORDER.map((k, i) => `<div class="slot ${k === piece ? 'sel' : ''}" data-piece="${k}" title="${esc(PIECES[k].name)}"><b>${i < 9 ? i + 1 : i === 9 ? 0 : ''}</b>${PIECES[k].icon}</div>`).join('')}</div>
  <div class="bb-info"><b>${esc(P.name)}</b> · facing ${['N', 'E', 'S', 'W'][rot]} · ${esc(alt ? costTxt(P.alt, inv) : costTxt(P.cost, inv))}${P.plot ? ' · <i>home plot only</i>' : ''}<br><small>${plotTxt}</small>
  <span class="hint">Aim with the camera · E/click place · X/right-click remove · R rotate · wheel/1-0 pick · P claim plot · B exit</span></div>`;
}
export function panel(html, cls = '') { const p = $('#panel'); if (html === null) { p.classList.add('hidden'); p.innerHTML = ''; p.className = 'hidden'; return; } p.className = cls; p.innerHTML = `<button class="close" data-close>✕</button>${html}`; }
export function panelOpen() { return !$('#panel').classList.contains('hidden'); }

// ---------- skills ----------
export function skillsHtml(g) {
  const xp = g.s.xp, tot = g.totalLevel(), txp = g.totalXp();
  return `<h2>Skills <span class="total">⭐ Total level ${tot} · ${fmt(txp)} XP</span></h2><div class="skills">` + SKILLS.map((s) => {
    const x = xp[s] || 0, L = levelForXp(x), a = xpForLevel(L), b = xpForLevel(L + 1), f = L >= MAX_LEVEL ? 1 : (x - a) / (b - a);
    const next = (UNLOCKS[s] || []).find(([lv]) => lv > L);
    const tip = (UNLOCKS[s] || []).map(([lv, t]) => `${lv <= L ? '✔' : '·'} Lv ${lv}: ${t}`).join('\n');
    const col = '#' + SKILL_COLORS[s][0].toString(16).padStart(6, '0');
    return `<div class="skill" title="${esc(tip)}" data-skill="${s}"><div class="sk-top"><span>${SKILL_ICONS[s]} ${SKILL_NAMES[s]}</span><span>${L >= MAX_LEVEL ? `<i class="capebadge" style="background:${col}"></i>` : ''}Lv ${L}/${MAX_LEVEL}</span></div><div class="bar"><i style="width:${(f * 100).toFixed(0)}%"></i></div><small>${fmt(x)} XP${L < MAX_LEVEL ? ` · ${fmt(b - x)} to Lv ${L + 1}` : ' · MAXED — cape unlocked!'}${next ? `<br>Next: Lv ${next[0]} ${esc(next[1])}` : ''}</small></div>`;
  }).join('') + `</div><p class="sub">Hover (or long-press) a skill to see every unlock. Level ${MAX_LEVEL} = ${fmt(xpForLevel(MAX_LEVEL))} XP and unlocks a skill cape.</p>${g.s.capes.length ? `<button class="recipe" data-open="capes">🧥 Skill capes (${g.s.capes.length})</button>` : ''}`;
}
export function capesHtml(g) {
  return `<h2>Skill Capes</h2><p class="sub">Earned by reaching level ${MAX_LEVEL}. Worn on your back.</p>` + g.s.capes.map((c) => {
    const col = '#' + SKILL_COLORS[c][0].toString(16).padStart(6, '0');
    return `<button class="recipe ${g.s.equip.cape === c ? 'on' : ''}" data-cape="${c}"><i class="capebadge" style="background:${col}"></i><b>${SKILL_NAMES[c]} Cape</b> ${g.s.equip.cape === c ? '(worn)' : ''}</button>`;
  }).join('') + `<button class="recipe" data-cape="">No cape</button>`;
}
// ---------- inventory + equipment ----------
export function bagHtml(g, mode = '') {
  const s = g.s, st = g.stats();
  const eq = SLOTS.map((sl) => { const id = s.equip[sl]; const G = id && GEAR[id];
    return `<div class="eqslot" data-unequip="${id ? sl : ''}" title="${esc(G ? G.name + (G.atk ? ` · Attack ${G.atk}` : '') + (G.def !== undefined ? ` · Defence ${G.def}` : '') + (G.rng ? ` · Ranged ${G.rng}` : '') : SLOT_NAMES[sl])}"><small>${SLOT_NAMES[sl]}</small><span>${G ? G.icon : '—'}</span><em>${G ? esc(G.name) : ''}${id && s.enchant[id] ? ` ✦${ENCHANTS[s.enchant[id]].name}` : ''}</em></div>`; }).join('')
    + `<div class="eqslot" data-open="capes"><small>Cape</small><span>${s.equip.cape ? '🧥' : '—'}</span><em>${s.equip.cape ? SKILL_NAMES[s.equip.cape] + ' Cape' : ''}</em></div>`;
  const items = g.invList();
  const cells = [];
  for (const [k, n] of items) cells.push(`<div class="cell" data-item="${k}" title="${esc(nm(k))}${GEAR[k] ? ` (req ${SKILL_NAMES[GEAR[k].skill || 'combat']} ${GEAR[k].req})` : ''}${ITEMS[k].heal ? ` · heals ${ITEMS[k].heal / 2} ♥` : ''}${mode === 'sell' ? ` · sells for ${sellPrice(k)}g` : ''}"><span>${ic(k)}</span>${n > 1 ? `<b>${n}</b>` : ''}</div>`);
  while (cells.length < INVENTORY_SLOTS) cells.push('<div class="cell empty"></div>');
  return `<h2>Inventory <small>${g.slotsUsed()}/${INVENTORY_SLOTS} slots · 🪙 ${fmt(s.gold)} coins</small></h2>
  <div class="bagwrap"><div><div class="invgrid">${cells.join('')}</div><p class="sub">${mode === 'sell' ? 'Click an item to sell one (shift-click sells all).' : mode === 'bank' ? 'Click to deposit.' : 'Click: equip / eat / set quick-slot. Coins never use a slot.'}</p></div>
  <div class="equipcol"><h3>Equipment</h3><div class="eqgrid">${eq}</div>
  <div class="stats"><div>⚔ Attack <b>${st.atk}</b></div><div>🛡 Defence <b>${st.def}</b></div><div>🏹 Ranged <b>${st.rng}</b></div><div>❤ Max hearts <b>${g.maxHp / 2}</b></div><div>💣 Bombs <b>${s.inv.bomb || 0}${s.flags.q3_bombs ? '/10' : ''}</b></div><div>⭐ Total Lv <b>${g.totalLevel()}</b></div></div>
  ${s.pet ? `<p class="sub">${PETS[s.pet.type].icon} ${esc(s.pet.name)} — ${PETS[s.pet.type].perk}</p>` : ''}</div></div><div id="itemmenu"></div>`;
}
export function itemMenuHtml(g, k) {
  const acts = [];
  if (GEAR[k]) acts.push(`<button data-act-item="equip" data-k="${k}">Equip</button>`);
  if (ITEMS[k].heal) acts.push(`<button data-act-item="eat" data-k="${k}">Eat (+${ITEMS[k].heal / 2}♥)</button>`, `<button data-act-item="quick" data-k="${k}">Set quick-slot</button>`);
  if (k === 'bomb') acts.push(`<button data-act-item="quick" data-k="bomb">Set quick-slot</button>`);
  if (!ITEMS[k].quest) acts.push(`<button data-act-item="drop" data-k="${k}">Drop 1</button>`);
  return `<div class="imenu"><b>${ic(k)} ${esc(nm(k))}</b> ${acts.join('')}</div>`;
}
// ---------- stations ----------
export function stationHtml(g, kind) {
  const inv = g.s.inv, rs = RECIPES.filter((r) => r.station === kind);
  const skills = [...new Set(rs.map((r) => r.skill))];
  return `<h2>${STATION_NAMES[kind]}</h2><p class="sub">${skills.map((sk) => `${SKILL_ICONS[sk]} ${SKILL_NAMES[sk]} ${g.level(sk)}`).join(' · ')}</p><div class="recipes">` + rs.map((r) => {
    const lvl = g.level(r.skill), lvOk = lvl >= r.level, needOk = !r.needs || inv[r.needs];
    const ok = Object.entries(r.input).every(([k, n]) => (inv[k] || 0) >= n) && lvOk && needOk;
    const burn = r.burn ? ` · burn ${(burnChance(r, lvl) * 100).toFixed(0)}%` : '';
    return `<button class="recipe ${lvOk ? '' : 'locked'}" data-recipe="${r.id}" ${ok ? '' : 'disabled'} title="Requires ${SKILL_NAMES[r.skill]} ${r.level}${r.needs ? ' + ' + nm(r.needs) : ''}"><b>${esc(r.name)}</b><small>${costTxt(r.input, inv)} · ${lvOk ? '' : '🔒 '}${SKILL_NAMES[r.skill]} ${r.level}${r.needs ? ` · needs ${nm(r.needs)}${needOk ? ' ✔' : ' ✖'}` : ''} · +${r.xp} XP${burn}</small></button>`;
  }).join('') + '</div>';
}
export function altarHtml(g, a) {
  const lvl = g.level('runemaking'), ess = g.s.inv.rune_essence || 0, mult = 1 + Math.floor(Math.max(0, lvl - a.level) / 11);
  return `<h2>${esc(a.name)}</h2><p class="sub">Runemaking ${lvl} · requires ${a.level} · ${mult} rune${mult > 1 ? 's' : ''} per essence</p>
  <button class="recipe" data-bind="${a.id}" ${ess && lvl >= a.level ? '' : 'disabled'}><b>Bind ${ess} Rune Essence → ${ess * mult} ${nm(a.rune)}</b><small>+${a.xp} XP per essence</small></button>`;
}
// ---------- shops ----------
export function shopHtml(g, id) {
  const S = SHOPS[id], inv = g.s.inv;
  const buy = Object.entries(S.sells).filter(([k]) => k !== 'bomb' || g.s.flags.q3_bombs).map(([k, p]) => `<button class="recipe" data-buy="${k}" ${g.s.gold >= p ? '' : 'disabled'}><span class="ic">${ic(k)}</span><b>${esc(nm(k))}</b> <small>${p} coins · you have ${inv[k] || 0}</small></button>`).join('');
  const sell = g.invList().filter(([k]) => sellPrice(k) > 0 && !ITEMS[k].quest).map(([k, n]) => `<button class="recipe" data-sell="${k}"><span class="ic">${ic(k)}</span><b>${esc(nm(k))} ×${n}</b> <small>${sellPrice(k)} coins each</small></button>`).join('') || '<p class="sub">Nothing to sell.</p>';
  return `<h2>${esc(S.name)} <small>🪙 ${fmt(g.s.gold)}</small></h2><div class="cols"><div><h3>Buy</h3>${buy}</div><div><h3>Sell</h3>${sell}<button class="recipe" data-sellall="1">Sell all ores, logs &amp; raw food</button></div></div>`;
}
// ---------- bank ----------
export function bankHtml(g, q = '') {
  const b = g.s.bank, ql = q.toLowerCase();
  const list = Object.entries(b).filter(([k, n]) => n > 0 && (!ql || nm(k).toLowerCase().includes(ql)));
  const used = Object.values(b).filter((n) => n > 0).length;
  const cells = list.map(([k, n]) => `<div class="cell" data-withdraw="${k}" title="${esc(nm(k))} — click: withdraw 1 · shift-click: all"><span>${ic(k)}</span><b>${n}</b></div>`).join('');
  const invc = g.invList().map(([k, n]) => `<div class="cell" data-deposit="${k}" title="${esc(nm(k))} — click: deposit all"><span>${ic(k)}</span>${n > 1 ? `<b>${n}</b>` : ''}</div>`).join('');
  return `<h2>🏦 Bank <small>${used}/${BANK_SLOTS} slots</small></h2>
  <div class="bankbar"><input id="bank-q" placeholder="Search…" value="${esc(q)}" autocomplete="off"><button data-depositall="1">Deposit all</button><button data-withdrawall="1">Withdraw all</button></div>
  <div class="cols"><div><h3>Bank</h3><div class="invgrid bankgrid">${cells || '<p class="sub">Empty.</p>'}</div></div><div><h3>Inventory ${g.slotsUsed()}/${INVENTORY_SLOTS}</h3><div class="invgrid">${invc || '<p class="sub">Empty.</p>'}</div></div></div>`;
}
export function chestHtml(g, k) {
  const c = g.s.chests[k] || {};
  const cells = Object.entries(c).filter(([, n]) => n > 0).map(([it, n]) => `<div class="cell" data-cwithdraw="${it}"><span>${ic(it)}</span><b>${n}</b></div>`).join('');
  const invc = g.invList().map(([it, n]) => `<div class="cell" data-cdeposit="${it}"><span>${ic(it)}</span>${n > 1 ? `<b>${n}</b>` : ''}</div>`).join('');
  return `<h2>📦 Storage Chest</h2><div class="cols"><div><h3>Chest</h3><div class="invgrid">${cells || '<p class="sub">Empty.</p>'}</div></div><div><h3>Inventory</h3><div class="invgrid">${invc || '<p class="sub">Empty.</p>'}</div></div></div><p class="sub">Click to move a whole stack.</p>`;
}
// ---------- spellbook ----------
export function spellsHtml(g) {
  const L = g.level('magic');
  return `<h2>✨ Spellbook <small>Magic ${L}</small></h2><div class="recipes">` + SPELLS.map((sp) => {
    const ok = L >= sp.level, can = ok && g.has(sp.cost);
    return `<button class="recipe ${g.s.spell === sp.id ? 'on' : ''} ${ok ? '' : 'locked'}" data-spell="${sp.id}" title="Requires Magic ${sp.level}"><b>${sp.icon} ${esc(sp.name)}</b> ${g.s.spell === sp.id ? '<i>(selected · T to cast)</i>' : ''}<small>${ok ? '' : '🔒 '}Magic ${sp.level} · ${costTxt(sp.cost, g.s.inv)}${sp.dmg ? ` · damage ${sp.dmg}` : ''}${can ? '' : ''}</small></button>`;
  }).join('') + '</div><p class="sub">Click a spell to select it, then press T (or ✨ on phone) to cast. Bolts follow your lock-on target.</p>';
}
// ---------- journal ----------
export function journalHtml(g) {
  return '<h2>📜 Journal</h2>' + g.questList().map((q) => `<div class="jq ${q.state}"><h3>${q.state === 'done' ? '✔' : q.state === 'active' ? '➤' : '🔒'} ${esc(q.name)}</h3>
    ${q.state === 'locked' ? `<p class="sub">${esc(q.lockedText)}</p>` : `<ol>${q.steps.map((t, i) => `<li class="${i < q.stage ? 'done' : i === q.stage ? 'cur' : 'todo'}">${i <= q.stage || q.state === 'done' ? esc(t) : '…'}</li>`).join('')}</ol>`}</div>`).join('');
}
// ---------- settings ----------
export function settingsHtml(st) {
  const sl = (k, label) => `<label class="set">${label}<input type="range" min="0" max="1" step="0.05" value="${st[k]}" data-set="${k}"><output>${Math.round(st[k] * 100)}%</output></label>`;
  return `<h2>⚙ Settings</h2>${sl('master', 'Master volume')}${sl('music', 'Music')}${sl('sfx', 'Sound effects')}
  <label class="set chk"><input type="checkbox" data-set="muted" ${st.muted ? 'checked' : ''}> Mute all audio</label>
  <label class="set">Graphics quality <select data-set="quality"><option value="auto" ${st.quality === 'auto' ? 'selected' : ''}>Auto</option><option value="low" ${st.quality === 'low' ? 'selected' : ''}>Low (phones)</option><option value="high" ${st.quality === 'high' ? 'selected' : ''}>High (shadows)</option></select></label>
  <label class="set">Camera sensitivity <input type="range" min="0.3" max="2" step="0.1" value="${st.sens}" data-set="sens"><output>${st.sens}×</output></label>
  <label class="set chk"><input type="checkbox" data-set="bigButtons" ${st.bigButtons ? 'checked' : ''}> Large touch buttons</label>
  <label class="set chk"><input type="checkbox" data-set="invertY" ${st.invertY ? 'checked' : ''}> Invert camera Y</label>
  <p class="sub">Settings save on this device. Quality changes to antialiasing apply after a reload.</p>`;
}
export const HELP_HTML = `<h2>How to play</h2>
<div class="help"><div><h3>PC</h3><ul>
<li><b>WASD</b> move · <b>Shift</b> sprint · <b>click</b> canvas to capture mouse (Esc frees it) · <b>arrows</b> turn camera</li>
<li><b>Left click / J</b> sword combo · <b>hold</b> then release = spin attack · <b>Right click / Tab</b> lock-on</li>
<li><b>Q</b> (hold) shield · <b>Space</b> dodge roll · <b>E</b> talk / gather / use · <b>G</b> grapple</li>
<li><b>R</b> throw bomb · <b>V</b> shoot bow · <b>T</b> cast spell · <b>Z</b> eat quick-slot food</li>
<li><b>B</b> build (R rotate, P claim plot) · <b>C</b> skills · <b>I</b> inventory · <b>L</b> journal · <b>K</b> spellbook · <b>O</b> settings · <b>H</b> help</li></ul></div>
<div><h3>Phone</h3><ul><li>Left stick to move, drag anywhere else to look.</li><li>⚔ attack (hold to spin) · 🛡 shield · ⤾ roll · 🎯 lock-on · ✋ context action · 💣 bomb · 🏹 bow · ✨ spell · 🍖 quick item</li></ul>
<h3>Tips</h3><ul><li>Enemies flash red before attacking — block or roll!</li><li>The grey Fade hurts over time. Stand near a lit Hearthstone to recover.</li><li>Cracked walls hide secrets. Bombs!</li><li>Your inventory holds 30 slots; bank the rest in the village.</li></ul></div></div>`;
export function dialog(name, text, onNext, cls = '', choices = null) {
  const d = $('#dialog'); d.classList.remove('hidden'); d.className = cls;
  $('#dialog-name').textContent = name; $('#dialog-text').textContent = text;
  const c = $('#dialog-choices');
  if (choices) { c.innerHTML = choices.map((o, i) => `<button data-choice="${i}">${esc(o)}</button>`).join(''); c.classList.remove('hidden'); d.onclick = (e) => { const b = e.target.closest('[data-choice]'); if (b) onNext(+b.dataset.choice); }; }
  else { c.innerHTML = ''; c.classList.add('hidden'); d.onclick = () => onNext(); }
}
export function closeDialog() { $('#dialog').classList.add('hidden'); }
export function dialogOpen() { return !$('#dialog').classList.contains('hidden'); }
