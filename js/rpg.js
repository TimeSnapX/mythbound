// RPG systems: 30-slot inventory, coins, equipment + stats, crafting, merchants, bank, storage chests, food, loot drops, gems.
import * as THREE from 'three';
import { ITEMS, GEAR, RECIPES, SHOPS, LOOT, SKILL_NAMES, sellPrice, burnChance, gemChance, levelForXp } from './shared.js';
import { INVENTORY_SLOTS, BANK_SLOTS } from './config.js';
import * as UI from './ui.js';

const nm = (k) => ITEMS[k]?.name || k;
export const RPG = {
  // ---------- inventory ----------
  invList() { const out = []; for (const [k, n] of Object.entries(this.s.inv)) { if (!(n > 0) || !ITEMS[k]) continue; if (ITEMS[k].gear) for (let i = 0; i < n; i++) out.push([k, 1]); else out.push([k, n]); } return out; },
  slotsUsed(inv = this.s.inv) { let n = 0; for (const [k, c] of Object.entries(inv)) if (c > 0 && ITEMS[k]) n += ITEMS[k].gear ? c : 1; return n; },
  slotsNeeded(item, n) { if (!ITEMS[item]) return 0; return ITEMS[item].gear ? n : (this.s.inv[item] > 0 ? 0 : 1); },
  canAdd(item, n = 1) { return this.slotsUsed() + this.slotsNeeded(item, n) <= INVENTORY_SLOTS; },
  invFull() { const t = this.t || 0; if (!this._fullT || t - this._fullT > 1.5) { this._fullT = t; UI.toast('🎒 Your inventory is full! (30 slots) Bank or sell something.', 'bad'); this.audio.play('ui'); } this.lastInvFull = t; return false; },
  // give items; returns false (and shows "inventory full") if there is no room
  give(item, n = 1, quiet = false) {
    if (item === 'gold' || item === 'coins') return this.giveGold(n);
    if (!this.canAdd(item, n)) return this.invFull();
    this.s.inv[item] = (this.s.inv[item] || 0) + n;
    if (!quiet) UI.toast(`+${n} ${ITEMS[item].icon} ${ITEMS[item].name}`, 'item');
    return true;
  },
  giveGold(n) { n = Math.round(n); if (n <= 0) return true; this.s.gold = (this.s.gold || 0) + n; UI.toast(`+${n} 🪙 coins`, 'item'); this.audio.play('coin'); return true; },
  has(cost) { return Object.entries(cost).every(([k, n]) => (this.s.inv[k] || 0) >= n); },
  spend(cost) { for (const [k, n] of Object.entries(cost)) { this.s.inv[k] -= n; if (this.s.inv[k] <= 0) delete this.s.inv[k]; } },
  // ---------- equipment ----------
  stats() {
    const e = this.s.equip, g = (sl) => (e[sl] && GEAR[e[sl]]) || null;
    let def = 0; for (const sl of ['shield', 'head', 'body', 'legs']) def += g(sl)?.def || 0;
    return { atk: g('weapon')?.atk || 1, def, rng: g('ranged')?.rng || 0, ench: e.weapon ? (this.s.enchant[e.weapon] || GEAR[e.weapon]?.ench || null) : null };
  },
  equip(item, force = false) {
    const G = GEAR[item]; if (!G || !(this.s.inv[item] > 0)) return false;
    const sk = G.skill || 'combat';
    if (!force && this.level(sk) < G.req) { UI.toast(`Requires ${SKILL_NAMES[sk]} level ${G.req} to equip.`, 'bad'); return false; }
    const old = this.s.equip[G.slot];
    this.s.inv[item]--; if (!this.s.inv[item]) delete this.s.inv[item];
    if (old) this.s.inv[old] = (this.s.inv[old] || 0) + 1;
    this.s.equip[G.slot] = item;
    this.applyGear(); this.audio.play('craft');
    UI.toast(`Equipped ${G.name}`, 'good'); return true;
  },
  unequip(slot) {
    const it = this.s.equip[slot]; if (!it) return false;
    if (slot === 'weapon' && it === 'wood_sword' && !this.canAdd(it)) return this.invFull();
    if (!this.canAdd(it)) return this.invFull();
    this.s.inv[it] = (this.s.inv[it] || 0) + 1; this.s.equip[slot] = slot === 'weapon' ? null : slot === 'shield' ? null : null;
    this.applyGear(); return true;
  },
  applyGear() {
    const e = this.s.equip, col = (sl) => (e[sl] && GEAR[e[sl]] ? { color: GEAR[e[sl]].color } : null);
    this.s.sword = e.weapon ? GEAR[e.weapon].sword : 'wood';
    this.player.setSword(this.s.sword);
    const cape = e.cape ? { color: this.skillColor(e.cape)[0], emblem: this.skillColor(e.cape)[1] } : null;
    this.player.setGear({ head: col('head'), body: col('body'), legs: col('legs'), shield: col('shield'), bow: col('ranged'), cape });
    this.updateNameTag?.();
  },
  // ---------- crafting ----------
  craft(id) {
    const r = RECIPES.find((x) => x.id === id); if (!r) return false;
    const lvl = this.level(r.skill);
    if (lvl < r.level) { UI.toast(`Requires ${SKILL_NAMES[r.skill]} level ${r.level}.`, 'bad'); return false; }
    if (r.needs && !this.s.inv[r.needs]) { UI.toast(`You need a ${nm(r.needs)} to make that.`, 'bad'); return false; }
    if (!this.has(r.input)) { UI.toast('You do not have the materials.', 'bad'); return false; }
    // room check: inputs that empty out free a slot
    const after = { ...this.s.inv }; for (const [k, n] of Object.entries(r.input)) { after[k] -= n; if (after[k] <= 0) delete after[k]; }
    for (const [k, n] of Object.entries(r.out)) after[k] = (after[k] || 0) + n;
    if (this.slotsUsed(after) > INVENTORY_SLOTS) return this.invFull();
    this.spend(r.input);
    const burnt = this.rand() < burnChance(r, lvl);
    if (burnt) { this.give('burnt_food', 1); UI.toast('Oops — you burnt it.', 'bad'); this.audio.play('sizzle'); }
    else {
      for (const [k, n] of Object.entries(r.out)) this.give(k, n);
      if (r.sword && GEAR[r.out && Object.keys(r.out)[0]]) { // v1 behaviour: forging a better sword equips it
        const it = Object.keys(r.out)[0], cur = this.s.equip.weapon ? GEAR[this.s.equip.weapon].atk : 0, better = GEAR[it].atk > cur;
        if (better && this.level('combat') >= GEAR[it].req) this.equip(it, true);
        UI.banner(`Forged a ${GEAR[it].name}!`, better ? `Equipped · attack ${GEAR[it].atk}` : '');
      }
      this.addXp(r.skill, r.xp);
      this.audio.play(r.station === 'anvil' ? 'anvil' : r.station === 'range' ? 'sizzle' : 'craft');
    }
    const st = this.currentStation;
    if (st && st.obj && st.obj.position) this.particles.burst(st.obj.position.x, st.obj.position.y + 1.2, st.obj.position.z, r.station === 'furnace' ? 0xff8a20 : r.station === 'range' ? 0xffd090 : 0xffe080, 14, 3, 0.6);
    if (this.panelKind === r.station) this.openPanel(r.station);
    this.save(); return true;
  },
  // ---------- food ----------
  eat(item) {
    const I = ITEMS[item]; if (!I || !I.heal || !(this.s.inv[item] > 0)) return false;
    if (this.eatT && this.t - this.eatT < 1.2) return false;
    if (this.p.hp >= this.maxHp) { UI.toast('You are already at full health.', ''); return false; }
    this.eatT = this.t; this.s.inv[item]--; if (!this.s.inv[item]) delete this.s.inv[item];
    this.p.hp = Math.min(this.maxHp, this.p.hp + I.heal); this.animOverride = { name: 'eat', t: 0.5 };
    UI.toast(`You eat the ${I.name}. +${I.heal / 2} ♥`, 'good'); this.audio.play('heal'); return true;
  },
  useQuick() {
    const q = this.s.quick;
    if (q === 'bomb') return this.throwBomb();
    if (q && this.s.inv[q] > 0) return this.eat(q);
    const food = Object.keys(this.s.inv).filter((k) => ITEMS[k]?.heal && this.s.inv[k] > 0).sort((a, b) => ITEMS[b].heal - ITEMS[a].heal)[0];
    if (food) return this.eat(food);
    UI.toast('No food in your quick-slot.', 'bad'); return false;
  },
  // ---------- merchants ----------
  buy(shop, item) {
    const p = SHOPS[shop]?.sells[item]; if (!p) return false;
    if (item === 'bomb') { if (!this.s.flags.q3_bombs) return UI.toast('You need a bomb bag first.', 'bad'); if ((this.s.inv.bomb || 0) >= 10) return UI.toast('Your bomb bag is full (10).', 'bad'); }
    if (this.s.gold < p) { UI.toast('Not enough coins.', 'bad'); return false; }
    if (!this.give(item, 1)) return false;
    this.s.gold -= p; this.audio.play('coin'); this.lastTrade = { buy: item, price: p };
    if (this.panelKind === 'shop:' + shop) this.openPanel('shop:' + shop); this.save(); return true;
  },
  sell(shop, item, all = false) {
    const n = all ? this.s.inv[item] || 0 : Math.min(1, this.s.inv[item] || 0), p = sellPrice(item);
    if (!n || !p || ITEMS[item].quest) return false;
    this.s.inv[item] -= n; if (!this.s.inv[item]) delete this.s.inv[item];
    this.s.gold += p * n; this.audio.play('coin'); this.lastTrade = { sell: item, n, price: p * n };
    UI.toast(`Sold ${n} ${nm(item)} for ${p * n} coins`, 'item');
    if (this.panelKind === 'shop:' + shop) this.openPanel('shop:' + shop); this.save(); return true;
  },
  sellJunk(shop) { for (const k of Object.keys(this.s.inv)) if (/_ore$|^log$|^raw_|^burnt_food$|^stone$/.test(k)) this.sell(shop, k, true); },
  // ---------- bank ----------
  bankDeposit(item, n = Infinity) {
    const have = this.s.inv[item] || 0; n = Math.min(n, have); if (!n) return false;
    const b = this.s.bank; if (!(b[item] > 0) && Object.values(b).filter((v) => v > 0).length >= BANK_SLOTS) { UI.toast('Your bank is full!', 'bad'); return false; }
    this.s.inv[item] -= n; if (!this.s.inv[item]) delete this.s.inv[item]; b[item] = (b[item] || 0) + n; return true;
  },
  bankWithdraw(item, n = 1) {
    const b = this.s.bank, have = b[item] || 0; n = Math.min(n, have); if (!n) return false;
    if (ITEMS[item].gear) { let k = 0; while (k < n && this.canAdd(item, 1)) { this.s.inv[item] = (this.s.inv[item] || 0) + 1; k++; } n = k; if (!n) return this.invFull(); }
    else { if (!this.canAdd(item, n)) return this.invFull(); this.s.inv[item] = (this.s.inv[item] || 0) + n; }
    b[item] -= n; if (!b[item]) delete b[item]; return true;
  },
  bankDepositAll() { for (const k of Object.keys(this.s.inv)) if (!ITEMS[k]?.quest) this.bankDeposit(k); this.audio.play('coin'); },
  bankWithdrawAll() { for (const k of Object.keys(this.s.bank)) this.bankWithdraw(k, this.s.bank[k]); },
  chestMove(k, item, toChest) {
    const c = (this.s.chests[k] ||= {});
    if (toChest) { const n = this.s.inv[item] || 0; if (!n) return; this.s.inv[item] = 0; delete this.s.inv[item]; c[item] = (c[item] || 0) + n; }
    else { const n = c[item] || 0; if (!n) return; if (ITEMS[item].gear) { let m = 0; while (m < n && this.canAdd(item, 1)) { this.s.inv[item] = (this.s.inv[item] || 0) + 1; m++; } c[item] -= m; if (m < n) this.invFull(); } else { if (!this.canAdd(item, n)) return this.invFull(); this.s.inv[item] = (this.s.inv[item] || 0) + n; c[item] = 0; } if (!c[item]) delete c[item]; }
    this.audio.play('ui');
  },
  // ---------- loot ----------
  luck() { return this.s.pet?.type === 'cat' ? 1.5 : 1; },
  rollLoot(type, x, z) {
    const L = LOOT[type]; if (!L) return;
    const y = this.terrainH(x, z);
    let g = L.gold[0] + Math.floor(this.rand() * (L.gold[1] - L.gold[0] + 1)); if (this.s.pet?.type === 'dog') g = Math.ceil(g * 1.25);
    if (g > 0) this.dropLoot(x, y, z, 'coins', g);
    for (const [it, ch, q] of L.items) if (this.rand() < Math.min(1, ch * this.luck())) this.dropLoot(x + (this.rand() - 0.5) * 1.2, y, z + (this.rand() - 0.5) * 1.2, it, q);
  },
  dropLoot(x, y, z, item, n) {
    if (!this.lootGeo) { this.lootGeo = { coins: new THREE.CylinderGeometry(0.22, 0.22, 0.08, 8), bag: new THREE.BoxGeometry(0.4, 0.35, 0.4) }; this.lootMat = { coins: new THREE.MeshLambertMaterial({ color: 0xffd040, emissive: 0x553300, flatShading: true }), bag: new THREE.MeshLambertMaterial({ color: 0xb08a50, emissive: 0x221100, flatShading: true }) }; }
    const coin = item === 'coins', m = new THREE.Mesh(coin ? this.lootGeo.coins : this.lootGeo.bag, coin ? this.lootMat.coins : this.lootMat.bag);
    m.position.set(x, y + 0.4, z); this.scene.add(m);
    const L = { item, n, x, y, z, mesh: m, t: 0, id: (this.lootN = (this.lootN || 0) + 1) };
    this.loot.push(L); return L;
  },
  updateLoot(dt) {
    const p = this.p, R = this.s.pet?.type === 'dog' ? 3.2 : 1.6;
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const L = this.loot[i]; L.t += dt;
      L.mesh.rotation.y += dt * 3; L.mesh.position.y = L.y + 0.4 + Math.sin(L.t * 4) * 0.1;
      const d = Math.hypot(L.x - p.x, L.z - p.z);
      if (d < R && Math.abs(L.y - p.y) < 2.5 && p.mode !== 'dead' && L.t > 0.3) {
        const ok = L.item === 'coins' ? this.giveGold(L.n) : this.give(L.item, L.n);
        if (ok) { if (L.item !== 'coins') this.audio.play('pickup'); this.scene.remove(L.mesh); this.loot.splice(i, 1); continue; }
      }
      if (L.t > 120) { this.scene.remove(L.mesh); this.loot.splice(i, 1); }
    }
  },
  // gems: rare extra drop while mining (better odds in Emberfall + Cinderdeep, cat luck)
  rollGem(x) {
    const ch = gemChance(x, this.level('mining')) * this.luck() * (this.debugGemBoost || 1);
    if (this.rand() < ch) { const it = this.rand() < 0.65 ? 'uncut_emerald' : 'uncut_diamond'; if (this.give(it, 1)) { UI.banner(`You found an ${ITEMS[it].name}!`, 'A rare gem glints in the rock'); this.audio.play('level', { pitch: 7 }); } return it; }
    return null;
  },
};
