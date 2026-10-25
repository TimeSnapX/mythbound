// Mythbound v3.1: small updates mixed into Game.prototype by installV31(Game) (after v3 + PvP).
// Fishing spots with several catches, sleeping in a bed, mounted melee/archery, skill detail panel, pet swap fee,
// armour by attack type + quarter hearts, level-gated trading post, Endurance potions, gentle combat stamina,
// level-up popup above every menu, roll position guard, brighter PvP zones and the two region caves.
import * as THREE from 'three';
import { CROPS, ITEMS, GEAR, SKILLS, SKILL_NAMES, SKILL_ICONS, UNLOCKS, RECIPES, NODE_TYPES, SPELLS, POTIONS, PETS, ENEMY_TYPES, MARKET_ITEMS,
  FISH_SPOT, STAM, armourReduce, MARKET_TIER, MARKET_TIER_REQ, PET_SWAP_COST, SLEEP, ARENA, FADELANDS, CAVES, CAVE_LOOT_COOLDOWN,
  xpForLevel, levelForXp, MAX_LEVEL, cellOf, terrainHeight } from './shared.js';
import * as UI from './ui.js';
import { makeLabel } from './world.js';

const esc = UI.esc, fmt = (n) => Math.round(n).toLocaleString('en-AU');
const nm = (k) => ITEMS[k]?.name || GEAR[k]?.name || k, ic = (k) => ITEMS[k]?.icon || GEAR[k]?.icon || '❔';
export const V31_VERSION = '3.1.0';
const WHATS_NEW_31 = [
  ['🎣', 'Better fishing', `Each spot gives ${FISH_SPOT.min}-${FISH_SPOT.max} catches and you keep fishing automatically. Empty spots come back after ${FISH_SPOT.respawn[0]}-${FISH_SPOT.respawn[1]} s`],
  ['🛏', 'Beds & sleeping', 'Build a bed at a workbench (logs + hides), place it in build mode and sleep through the night'],
  ['🐎', 'Mounted combat', 'Swing and shoot from horseback (no spells). Only big hits knock you off'],
  ['📊', 'Skill details', 'Click any skill to see every unlock by level, your next goal and the XP to go'],
  ['🛡', 'Armour by attack type', 'Plate is strong against melee, leather against arrows, cloth against magic. Hits now go down in quarter hearts'],
  ['⚖', 'Trading post grades', 'Steel, mithril and adamant unlock at higher combat or total levels and cost more'],
  ['💛', 'Endurance potions', 'Old Stamina potions became Endurance potions: no combat stamina cost, faster regen, cheaper rolls for 3 min'],
  ['🐾', 'Pet swap', `Wren swaps your pet for ${fmt(PET_SWAP_COST)} coins`],
  ['🕳', 'Two caves', 'Mire Hollow (swamp) and Wreckers\' Grotto (coast): a mini-boss and a loot chest each'],
  ['🤝', 'Safer trades', 'A final check screen with both sides, plus a trade history'],
];

export function migrateV31(s) {
  if (!s || typeof s !== 'object') return s;
  const conv = (o) => { if (o && o.potion_stamina > 0) { o.potion_endurance = (o.potion_endurance || 0) + o.potion_stamina; delete o.potion_stamina; return true; } if (o) delete o.potion_stamina; return false; };
  let n = (s.inv?.potion_stamina || 0) + (s.bank?.potion_stamina || 0);
  conv(s.inv); conv(s.bank);
  if (s.chests) for (const c of Object.values(s.chests)) if (c && typeof c === 'object') { n += c.potion_stamina || 0; conv(c); }
  if (s.quick === 'potion_stamina') s.quick = 'potion_endurance';
  if (s.stats?.potions?.stamina) { s.stats.potions.endurance = (s.stats.potions.endurance || 0) + s.stats.potions.stamina; delete s.stats.potions.stamina; }
  if (s.market) { if (s.market.stock) delete s.market.stock.potion_stamina; if (s.market.hist) delete s.market.hist.potion_stamina; }
  if (s.escrow) for (const e of Object.values(s.escrow)) conv(e?.give);
  if (typeof s.todOff !== 'number' || !Number.isFinite(s.todOff)) s.todOff = 0;
  s.tradeLog ||= []; s.caves ||= {};
  if (!s.v31) s.v31 = { at: Date.now(), potionsConverted: n };
  return s;
}

const V31 = {
  // ---------- time of day / sleep ----------
  todOff() { return this.coopGuest ? (this.coopTodOff || 0) : (this.s?.todOff || 0); },
  todBase() { return (Date.now() / 1000 / 600 + 0.12) % 1; },
  atHome() { const pl = this.s.home?.plot; if (!pl || this.coopGuest) return false; const [gx, gz] = cellOf(this.p.x, this.p.z); return gx >= pl.gx - 1 && gx < pl.gx + 9 && gz >= pl.gz - 1 && gz < pl.gz + 9; },
  enemiesNear(x, z, r = SLEEP.enemyRadius) { let n = 0; for (const e of this.allEnemies()) if (e.alive && !e.hidden && !/^[dmby]_/.test(e.id) && Math.hypot(e.x - x, e.z - z) < r) n++; return n; },
  sleepCheck() {
    if (this.inDungeon) return 'You cannot sleep down here.';
    if (!this.isNight()) return 'You can only sleep at night.';
    if (this.pvpMode?.()) return 'Not during a duel.';
    if (this.coopGuest) return "In co-op only the host can sleep. Ask them to use a bed, and everyone wakes up in the morning.";
    const home = this.atHome();
    if (!home && this.enemiesNear(this.p.x, this.p.z)) return 'You cannot sleep with enemies nearby.';
    if (this.coop?.isHost) for (const q of this.coop.joinedPeers) {
      if (q.dead) return `${q.name} is down. Revive them first.`;
      if (Math.abs(q.x) > 2500) return `${q.name} is in a dungeon.`;
      if (this.enemiesNear(q.x, q.z)) return `${q.name} has enemies nearby.`;
    }
    return null;
  },
  trySleep() {
    const why = this.sleepCheck(); this.lastSleep = { ok: !why, why };
    if (why) { UI.toast('🛏 ' + why, 'bad'); return false; }
    this.fade(() => {
      const wake = SLEEP.wakeTod;
      if (this.todOverride != null) this.todOverride = wake;
      this.s.todOff = (((wake - this.todBase()) % 1) + 1) % 1;
      const p = this.p; p.hp = this.maxHp; p.stam = 100; this.poison = 0;
      this.s.stats.sleeps = (this.s.stats.sleeps || 0) + 1;
      if (this.coop?.isHost) this.coop.broadcast({ t: 'tod', off: this.s.todOff, by: this.s.name });
      UI.banner('☀ Good morning!', 'You slept through the night. Fully rested.', 'gold'); this.audio.play('quest'); this.save();
    });
    return true;
  },
  onCoopSlept(by) { UI.banner('☀ Morning', `${by} slept through the night`); },
  // ---------- stamina ----------
  combatStam(kind) {
    if (this.buffs?.endurance) return;
    // attacks alone never take you below STAM.reserve (enough for a dodge roll), and below it they cost nothing and don't pause regen
    const p = this.p, c = STAM[kind] || 0; if (p.stam <= STAM.reserve) return;
    p.stam = Math.max(STAM.reserve, p.stam - c);
    p.stamT = Math.min(p.stamT, 0.8 - STAM.pause); // regen resumes STAM.pause seconds after the attack
    this.combatStamLog = (this.combatStamLog || 0) + (STAM[kind] || 0);
  },
  rollCost() { return this.buffs?.endurance ? STAM.endurance.roll : STAM.roll; },
  // ---------- armour ----------
  defenceBy() {
    const e = this.s.equip, out = { melee: 0, ranged: 0, magic: 0 };
    for (const sl of ['shield', 'head', 'body', 'legs']) { const g = e[sl] && GEAR[e[sl]]; if (g?.defs) for (const k in out) out[k] += g.defs[k]; }
    if (this.buffs?.defence) for (const k in out) out[k] += 2;
    for (const k in out) out[k] = +out[k].toFixed(1);
    return out;
  },
  hitKind(ev, bt) {
    const id = String(ev.id || '');
    if (ev.nova || ev.ink || ev.erupt || id.endsWith(':fb')) return 'magic';
    if (/:v\d+$/.test(id)) return 'ranged';
    return 'melee';
  },
  armourDamage(dmg, kind) {
    dmg = Number(dmg); if (!Number.isFinite(dmg) || dmg <= 0) dmg = 0.5;
    if (kind === 'env' || kind === 'pvp') return Math.max(0.5, Math.round(dmg * 2) / 2);
    return armourReduce(dmg, this.defenceBy()[kind] || 0);
  },
  // ---------- fishing ----------
  fishCatch(n) {
    if (n.fishLeft == null) n.fishLeft = FISH_SPOT.min + Math.floor(this.rand() * (FISH_SPOT.max - FISH_SPOT.min + 1));
    const def = NODE_TYPES[n.type], had = this.s.inv[def.item] || 0;
    this.rewardGather(n);
    if ((this.s.inv[def.item] || 0) <= had) return; // bag full: the catch was not taken, spot keeps its fish
    n.fishLeft--; this.fishLog = (this.fishLog || 0) + 1;
    if (n.fishLeft <= 0) {
      const [a, b] = FISH_SPOT.respawn, secs = a + this.rand() * (b - a);
      this.world.setNodeDepleted(n.id, true, performance.now() + secs * 1000); n.fishLeft = null; n.respawnSecs = secs;
      UI.toast(`🎣 The fish have moved on. This spot returns in about ${Math.round(secs)} s.`, '');
      return;
    }
    if (this.canAdd(def.item, def.qty)) setTimeout(() => { if (this.p.mode === 'normal' && !n.depleted && Math.hypot(this.p.x - n.x, this.p.z - n.z) < 4.5 && !this.inDialog) this.startGather(n); }, 250);
  },
  // ---------- level-up popup (always above menus) ----------
  levelPopup(skill, lv, sub) {
    const el = document.getElementById('levelup'); if (!el) return;
    el.innerHTML = `<b>${SKILL_ICONS[skill] || '⭐'} ${esc(SKILL_NAMES[skill] || skill)} level ${lv}!</b><small>${esc(sub || 'Level up!')}</small>`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    this.lastLevelPopup = { skill, lv, t: Date.now(), panel: this.panelKind || null };
    clearTimeout(this._lvT); this._lvT = setTimeout(() => el.classList.remove('on'), 3200);
  },
  // ---------- skill detail ----------
  skillUnlocks(sk) {
    const out = [], seen = new Set(), add = (lv, text, kind) => { const key = lv + '|' + text.toLowerCase(); if (seen.has(key)) return; seen.add(key); out.push({ lv, text, kind }); };
    for (const [lv, t] of UNLOCKS[sk] || []) add(lv, t, 'perk');
    for (const n of Object.values(NODE_TYPES)) if (n.skill === sk) add(n.level, n.label.replace(/<[^>]+>/g, ''), 'gather');
    for (const r of RECIPES) if (r.skill === sk) add(r.level, r.name, 'recipe');
    for (const [k, g] of Object.entries(GEAR)) if ((g.skill || 'combat') === sk && g.req > 1) add(g.req, `Equip ${g.name}`, 'gear');
    if (sk === 'farming') for (const c of Object.values(CROPS)) add(c.level, `Grow ${c.name}`, 'gather');
    if (sk === 'magic') for (const s of SPELLS) add(s.level, `Spell: ${s.name}`, 'spell');
    return out.sort((a, b) => a.lv - b.lv);
  },
  skillDetailHtml(sk) {
    const x = this.s.xp[sk] || 0, L = levelForXp(x), a = xpForLevel(L), b = xpForLevel(L + 1), f = L >= MAX_LEVEL ? 1 : (x - a) / (b - a);
    const list = this.skillUnlocks(sk), next = list.find((u) => u.lv > L), byLv = new Map();
    for (const u of list) { if (!byLv.has(u.lv)) byLv.set(u.lv, []); byLv.get(u.lv).push(u); }
    const icon = { perk: '⭐', gather: '⛏', recipe: '🛠', gear: '🛡', spell: '✨' };
    return `<h2>${SKILL_ICONS[sk]} ${SKILL_NAMES[sk]} <small>Level ${L}/${MAX_LEVEL}</small></h2>
      <div class="bar"><i style="width:${(f * 100).toFixed(0)}%"></i></div>
      <p class="sub">${fmt(x)} XP${L < MAX_LEVEL ? ` · <b class="skd-xp">${fmt(b - x)} XP to level ${L + 1}</b>` : ' · MAXED'}</p>
      <div class="skd-goal">${next ? `🎯 <b>Next goal: ${esc(next.text)} at level ${next.lv}</b> <small>(${fmt(xpForLevel(next.lv) - x)} XP to go)</small>` : '🏆 Everything in this skill is unlocked.'}</div>
      <p class="sub">${list.filter((u) => u.lv <= L).length}/${list.length} unlocked</p>
      <div class="skd-list">${[...byLv.entries()].map(([lv, us]) => `<div class="skd-lv">Level ${lv} ${lv <= L ? '✔' : '🔒'}</div>${us.map((u) => `<div class="skd-it ${u.lv <= L ? 'on' : 'off'}" data-unlocked="${u.lv <= L ? 1 : 0}">${u.lv <= L ? '✅' : '🔒'} ${icon[u.kind] || ''} ${esc(u.text)}</div>`).join('')}`).join('')}</div>
      <div class="row"><button data-open="skills">◀ All skills</button></div>`;
  },
  // ---------- pet swap ----------
  petSwapMenu(npc) {
    const cur = this.s.pet?.type, types = Object.keys(PETS).filter((t) => t !== cur && ['dog', 'cat', 'bird'].includes(t));
    this.runDialog(npc.name, [{ text: `Fancy a different friend? A swap costs ${fmt(PET_SWAP_COST)} coins. ${this.s.pet?.name || 'Your pet'} stays happy here with me.`, choices: [...types.map((t) => `${PETS[t].icon} ${PETS[t].name} (${fmt(PET_SWAP_COST)} 🪙)`), 'Never mind'], pick: (i) => { this._petSwapPick = types[i] || null; } }],
      () => { const t = this._petSwapPick; this._petSwapPick = null; if (t) this.swapPet(t); }, '', npc);
  },
  swapPet(type) {
    if (!PETS[type] || !this.s.flags.p_done) return false;
    if (this.s.pet?.type === type) { UI.toast('That is already your pet.', ''); return false; }
    if ((this.s.gold || 0) < PET_SWAP_COST) { this.lastPetSwap = { ok: false, why: 'gold' }; UI.toast(`🐾 A pet swap costs ${fmt(PET_SWAP_COST)} coins. You have ${fmt(this.s.gold || 0)}.`, 'bad'); UI.banner('Not enough coins', `Pet swap: ${fmt(PET_SWAP_COST)} 🪙 · you have ${fmt(this.s.gold || 0)}`, 'bad'); return false; }
    this._swapPending = type; this.namePet(type); return true;
  },
  // ---------- trading post tiers ----------
  marketTierOf(k) { return MARKET_TIER[k] || 0; },
  marketUnlocked(k) { const t = this.marketTierOf(k), R = MARKET_TIER_REQ[t]; return this.level('combat') >= R.combat || this.totalLevel() >= R.total; },
  marketLockText(k) { const R = MARKET_TIER_REQ[this.marketTierOf(k)]; return `Combat ${R.combat} or total level ${R.total}`; },
  // ---------- caves ----------
  buildCaves() {
    if (this.caveObjs) return; this.caveObjs = [];
    const rockM = new THREE.MeshLambertMaterial({ color: 0x4a4440, flatShading: true }), darkM = new THREE.MeshLambertMaterial({ color: 0x2a2624, flatShading: true, side: THREE.DoubleSide });
    for (const c of CAVES) {
      const g = new THREE.Group(), y0 = terrainHeight(c.x, c.z);
      for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; if (Math.abs(((a - 0.2) % (Math.PI * 2))) < 0.5) continue; const r = 8.2, s = 1.6 + ((i * 37) % 10) / 10;
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockM); m.position.set(c.x + Math.cos(a) * r, y0 + s * 0.6, c.z + Math.sin(a) * r); m.scale.y = 1.6; m.castShadow = true; g.add(m); }
      const roof = new THREE.Mesh(new THREE.SphereGeometry(9, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), darkM); roof.position.set(c.x, y0 + 0.5, c.z); g.add(roof);
      const chest = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.8), new THREE.MeshLambertMaterial({ color: 0x8a5a2a })); chest.position.set(c.x - 3.5, y0 + 0.4, c.z - 3); g.add(chest);
      const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), new THREE.MeshBasicMaterial({ color: c.light })); glow.position.set(c.x, y0 + 3.6, c.z); g.add(glow);
      const pl = new THREE.PointLight(c.light, 10, 18, 1.4); pl.position.set(c.x, y0 + 3, c.z); g.add(pl);
      const lab = makeLabel(`🕳 ${c.name}`, '#ffe9a8', 0.9); lab.position.set(c.x + Math.cos(0.2) * 9, y0 + 4.2, c.z + Math.sin(0.2) * 9); g.add(lab);
      this.scene.add(g); this.caveObjs.push({ c, g, chest: { x: c.x - 3.5, z: c.z - 3 } });
    }
  },
  caveBossAlive(c) { const e = this.enemyById?.(c.boss + '_0'); return !!(e && e.alive); },
  openCaveChest(c) {
    const s = this.s; s.caves ||= {}; const st = s.caves[c.id] ||= { looted: 0, kills: 0 };
    if (this.caveBossAlive(c)) { UI.toast(`The chest is guarded. Defeat the ${ENEMY_TYPES[c.boss].name.split(' (')[0]} first.`, 'bad'); return false; }
    const left = st.looted + CAVE_LOOT_COOLDOWN - Date.now();
    if (left > 0) { UI.toast(`Empty. It refills in ${Math.ceil(left / 60000)} min.`, ''); return false; }
    st.looted = Date.now(); const [g0, g1] = c.gold; this.giveGold(g0 + Math.floor(this.rand() * (g1 - g0)));
    for (const [k, n] of c.loot) if (this.rand() < 0.7 || k === c.loot[0][0]) this.give(k, n);
    UI.banner(`🕳 ${c.name} treasure!`, 'The chest refills in 30 minutes'); this.audio.play('quest'); this.save(); return true;
  },
  // ---------- lighting in PvP zones ----------
  v31Light() {
    const W = this.world; if (!W?.hemi || this.phase !== 'play') return;
    const z = this.inDungeon ? 'dungeon' : this.zoneName(), pv = z === 'arena' || z === 'fadelands' || !!this.pvpMode?.();
    if (!this.arenaLights) {
      this.arenaLights = [];
      const torchM = new THREE.MeshBasicMaterial({ color: 0xffc060 }), postM = new THREE.MeshLambertMaterial({ color: 0x4a3a2a });
      const ring = (cx, cz, r, n, col) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, x = cx + Math.cos(a) * r, zz = cz + Math.sin(a) * r, y = terrainHeight(x, zz);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.2, 5), postM); post.position.set(x, y + 1.6, zz); this.scene.add(post);
        const fl = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), torchM); fl.position.set(x, y + 3.4, zz); this.scene.add(fl);
        const l = new THREE.PointLight(col, 0, r * 2.2, 1.2); l.position.set(x, y + 3.6, zz); this.scene.add(l); this.arenaLights.push(l); } };
      ring(ARENA.x, ARENA.z, ARENA.r + 0.8, 6, 0xffd090); ring(FADELANDS.x, FADELANDS.z, FADELANDS.r * 0.6, 4, 0xd0c0ff);
    }
    const night = W.night || 0, near = Math.hypot(this.p.x - ARENA.x, this.p.z - ARENA.z) < 70 || Math.hypot(this.p.x - FADELANDS.x, this.p.z - FADELANDS.z) < 70;
    for (const l of this.arenaLights) l.intensity = near ? 8 + night * 22 : 0;
    this.pvpLit = pv;
    if (pv) { // minimum ambient so players stay readable at night
      W.hemi.intensity = Math.max(W.hemi.intensity, 0.95); W.sun.intensity = Math.max(W.sun.intensity, 0.7);
      if (night > 0.3) W.hemi.color.setHex(0xb8c8ff);
      this.scene.fog.far = Math.max(this.scene.fog.far, 150); this.scene.fog.near = Math.max(this.scene.fog.near, 45);
      const bg = this.scene.background; const minL = 0.22; const hsl = {}; bg.getHSL(hsl); if (hsl.l < minL) { bg.setHSL(hsl.h, hsl.s, minL); this.scene.fog.color.copy(bg); }
    }
    document.body.classList.toggle('pvpzone', pv);
  },
  // ---------- roll / position guard ----------
  guardPos() {
    const p = this.p, bad = !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z) || Math.abs(p.x) > 20000 || Math.abs(p.z) > 20000 || p.y < -80 || p.y > 400;
    if (bad) {
      const g = this._goodPos || p.rollSafe || { x: 0, y: 4, z: 0 };
      p.x = g.x; p.y = g.y; p.z = g.z; p.vy = 0; p.kx = p.kz = 0; if (!Number.isFinite(p.ry)) p.ry = 0;
      if (p.mode === 'roll') p.mode = 'normal'; this.posGuardHits = (this.posGuardHits || 0) + 1; return true;
    }
    if (!Number.isFinite(p.kx)) p.kx = 0; if (!Number.isFinite(p.kz)) p.kz = 0; if (!Number.isFinite(p.vy)) p.vy = 0; if (!Number.isFinite(p.ry)) p.ry = 0;
    if (p.grounded && p.mode !== 'grapple') this._goodPos = { x: p.x, y: p.y, z: p.z };
    return false;
  },
  // ---------- what's new ----------
  showWhatsNew() {
    this.wnShown = true; const el = document.getElementById('whatsnew');
    el.innerHTML = `<div class="wncard"><h2>✨ What's new in Mythbound v3.1</h2><ul>${WHATS_NEW_31.map(([i, t, d]) => `<li><span>${i}</span><div><b>${t}</b><small>${d}</small></div></li>`).join('')}</ul><p class="sub">v3.0 added PvP, the Drowned Belfry, four regions, farming, mounts, tasks and the trading post.</p><button data-v3="close-wn" class="primary">Let's go!</button></div>`;
    UI.show('#whatsnew', true);
  },
};

export function installV31(Game) {
  const P = Game.prototype, base = {};
  for (const k of ['load', 'start', 'addXp', 'shoot', 'castSpell', 'talk', 'adoptPet', 'marketQuote', 'marketBuy', 'marketHtml', 'v3Panel', 'v3Frame', 'v3OverworldInteracts', 'v3Interact', 'drink', 'give', 'onEnemyDamaged']) base[k] = P[k];
  Object.assign(P, V31);
  P.load = function () { base.load.call(this); migrateV31(this.s); };
  P.start = function (...a) { migrateV31(this.s); const r = base.start.apply(this, a); try { this.buildCaves(); } catch (e) { console.warn('caves', e); } if (!this._v31ui) { this._v31ui = true; document.getElementById('panel').addEventListener('click', (e) => { if (this.panelKind !== 'skills') return; const b = e.target.closest('[data-skill]'); if (b) { e.stopPropagation(); this.openPanel('skill:' + b.dataset.skill); } }, true); } return r; };
  P.give = function (item, n = 1, quiet = false) { if (item === 'potion_stamina') item = 'potion_endurance'; return base.give.call(this, item, n, quiet); };
  P.addXp = function (skill, n) {
    const before = this.level(skill), mh = this.maxHp; base.addXp.call(this, skill, n); const after = this.level(skill);
    if (after > before) this.levelPopup(skill, after, skill === 'combat' && this.maxHp > mh ? 'Your heart grows stronger (+1 heart)' : 'Level up!');
  };
  P.shoot = function () { const ok = base.shoot.call(this); if (ok) this.combatStam('shot'); return ok; };
  P.castSpell = function (id) { if (this.mounted) { UI.toast('You cannot cast spells while riding.', 'bad'); return false; } const ok = base.castSpell.call(this, id); if (ok) this.combatStam('spell'); return ok; };
  P.talk = function (npc) { if (npc.id === 'wren' && this.s.flags.p_done) return this.runDialog(npc.name, [{ text: `How is ${this.s.pet?.name || 'your friend'}? Remember to feed them scraps.`, choices: [`Swap my pet (${fmt(PET_SWAP_COST)} coins)`, 'Goodbye'], pick: (i) => { this._wrenPick = i; } }], () => { if (this._wrenPick === 0) this.petSwapMenu(npc); }, '', npc); return base.talk.call(this, npc); };
  P.adoptPet = function (type, name) {
    if (this._swapPending) {
      if (this._swapPending !== type) return false;
      if ((this.s.gold || 0) < PET_SWAP_COST) { this._swapPending = null; this.closePanel(); UI.toast(`🐾 A pet swap costs ${fmt(PET_SWAP_COST)} coins.`, 'bad'); return false; }
      this.s.gold -= PET_SWAP_COST; this._swapPending = null; this.lastPetSwap = { ok: true, type }; UI.toast(`−${fmt(PET_SWAP_COST)} 🪙 pet swap`, '');
    }
    return base.adoptPet.call(this, type, name);
  };
  P.marketQuote = function (k) { const q = base.marketQuote.call(this, k), m = MARKET_TIER_REQ[this.marketTierOf(k)].mult; return m === 1 ? q : { ...q, buy: Math.ceil(q.buy * m), mid: Math.round(q.mid * m) }; };
  P.marketBuy = function (k, n = 1) { if (!this.marketUnlocked(k)) { this.lastMarketLock = k; UI.toast(`🔒 ${nm(k)} unlocks at ${this.marketLockText(k)}.`, 'bad'); return 0; } return base.marketBuy.call(this, k, n); };
  P.marketHtml = function () {
    const M = this.marketEnsure(), tierName = ['Basic', 'Steel grade', 'Mithril grade', 'Adamant grade'];
    const rows = MARKET_ITEMS.filter((k) => ITEMS[k]).map((k) => { const q = this.marketQuote(k), h = M.hist[k], tr = h.length > 1 ? (h[h.length - 1] > h[0] ? '<em class="up">▲</em>' : h[h.length - 1] < h[0] ? '<em class="dn">▼</em>' : '•') : '•', have = this.s.inv[k] || 0, ok = this.marketUnlocked(k), t = this.marketTierOf(k);
      return `<tr class="${ok ? '' : 'locked'}" data-tier="${t}"><td>${ic(k)} ${esc(nm(k))}${t ? ` <small>${tierName[t]}</small>` : ''}</td><td>${M.stock[k]}</td><td>${tr}</td><td>${q.buy}</td><td>${q.sell}</td><td>${ok ? `<button data-v3="mbuy" data-arg="${k}|1" ${M.stock[k] > 0 && this.s.gold >= q.buy ? '' : 'disabled'}>Buy</button><button data-v3="mbuy" data-arg="${k}|10" ${M.stock[k] >= 10 && this.s.gold >= q.buy * 10 ? '' : 'disabled'}>×10</button>` : `<small class="lock">🔒 ${esc(this.marketLockText(k))}</small>`}</td><td><button data-v3="msell" data-arg="${k}|1" ${have ? '' : 'disabled'}>Sell</button><button data-v3="msell" data-arg="${k}|all" ${have ? '' : 'disabled'}>All ${have || ''}</button></td></tr>`; }).join('');
    return `<h2>⚖ Trading post <small>🪙 ${fmt(this.s.gold)} · live NPC market</small></h2><p class="sub">Prices follow supply. Higher grades unlock with your Combat or total level (you: Combat ${this.level('combat')}, total ${this.totalLevel()}) and cost more: steel ×1.15, mithril ×1.4, adamant ×1.8.${this.coop?.active ? ' To trade with a friend, use ⚔ PvP ▸ Trade.' : ''}</p>
    <div class="mtable"><table><tr><th>Item</th><th>Stock</th><th></th><th>Buy</th><th>Sell</th><th></th><th></th></tr>${rows}</table></div>`;
  };
  P.v3Panel = function (kind) { if (kind?.startsWith('skill:') && SKILLS.includes(kind.slice(6))) return [this.skillDetailHtml(kind.slice(6)), 'wide']; return base.v3Panel.call(this, kind); };
  P.v3Frame = function (dt) { base.v3Frame.call(this, dt); };
  P.v3OverworldInteracts = function (add, dist) { base.v3OverworldInteracts.call(this, add, dist); for (const o of this.caveObjs || []) add(dist(o.chest), 2.4, { kind: 'cavechest', c: o.c, label: `Open the ${o.c.name} chest` }); };
  P.v3Interact = function (it) { if (it.kind === 'cavechest') { this.openCaveChest(it.c); return true; } return base.v3Interact.call(this, it); };
  P.drink = function (k) {
    if (k === 'potion_stamina') k = 'potion_endurance';
    const I = ITEMS[k]; if (I?.potion !== 'endurance') return base.drink.call(this, k);
    if (!(this.s.inv[k] > 0) || (this.drinkT && this.t - this.drinkT < 1.2) || this.pvpPotionBlocked?.(k)) return false;
    this.buffs.endurance = STAM.endurance.secs; this.p.stam = 100; this.drinkT = this.t; this.s.inv[k]--; if (!this.s.inv[k]) delete this.s.inv[k];
    this.animOverride = { name: 'eat', t: 0.5 }; this.audio.play('heal'); UI.toast(`You drink the ${I.name}. ${POTIONS.endurance.desc}.`, 'good'); this.pvpDrank?.(k); this.save(); return true;
  };
}
