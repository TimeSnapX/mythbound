// v2 systems mixed into Game.prototype: bombs, archery, magic, projectiles, Fade + lava hazards, hunting traps, rune altars,
// Hearthstones, secrets, runaway pets + companion, Cinderdeep interactions, total level + capes, v2 building (aim, rotate, plots).
import * as THREE from 'three';
import { ITEMS, GEAR, NODE_TYPES, ENEMY_TYPES, SKILLS, SKILL_NAMES, SKILL_COLORS, MAX_LEVEL, ALTARS, SPELLS, PETS, PIECES, PIECE_ORDER,
  HEARTHSTONES, FADE_PATCHES, FADE_ECHO, SECRETS, CAMP, SPAWN, PLOT_CELLS, PLOT_COST, BLOCK, TOTAL_MILESTONE, levelForXp, xpForLevel,
  fadePatchAt, lavaAt, zoneAt, cellOf, cellCenter, buildRefusal, pieceType, islandHeight, LOOT } from './shared.js';
import { mineLava } from './mine.js';
import { makeLabel, mat } from './world.js';
import { buildPet, updatePet } from './pets.js';
import { RUNAWAYS } from './story.js';
import * as UI from './ui.js';

const ARROWS = ['steel_arrow', 'iron_arrow', 'bronze_arrow'];
const hexc = (c) => '#' + c.toString(16).padStart(6, '0');
export const Systems = {
  // ---------- setup ----------
  buildSystems() {
    this.projs = []; this.bombs = []; this.loot = []; this.traps = new Map();
    // rune altars
    this.altars = ALTARS.map((a) => {
      const y = islandHeight(a.x, a.z), g = new THREE.Group(); g.position.set(a.x, y, a.z);
      const stone = mat(0x8a8a90);
      for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), stone); const ang = i / 6 * Math.PI * 2; m.position.set(Math.cos(ang) * 2.2, 0.8, Math.sin(ang) * 2.2); m.castShadow = true; g.add(m); }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 0.6, 6), stone); base.position.y = 0.3; g.add(base);
      const cry = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color: a.color, emissive: a.color, emissiveIntensity: 0.5, flatShading: true })); cry.position.y = 1.6; g.add(cry);
      const lb = makeLabel(a.name, hexc(a.color), 0.8); lb.position.y = 3; g.add(lb);
      this.scene.add(g); this.world.colliders.push({ c: 1, x: a.x, z: a.z, r: 1.1 });
      return { ...a, g, cry };
    });
    // runaway animals for the pet quest
    this.runaways = RUNAWAYS.map((r) => { const P = buildPet(r.type); P.root.position.set(r.x, islandHeight(r.x, r.z) + (r.type === 'bird' ? 2.2 : 0), r.z); this.scene.add(P.root); const lb = makeLabel('runaway ' + PETS[r.type].name.toLowerCase(), '#ffe9a8', 0.6); this.scene.add(lb); lb.position.set(r.x, islandHeight(r.x, r.z) + (r.type === 'bird' ? 3.3 : 1.3), r.z); return { ...r, P, lb }; });
    // bank booth for Oswin + kennel for Wren (village props)
    const booth = new THREE.Group(), bw = mat(0x6b4a2e); booth.position.set(-8, islandHeight(-8, 2), 2 - 1.3);
    const ct = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 0.7), bw); ct.position.y = 0.55; ct.castShadow = true; booth.add(ct);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.9), mat(0xd0b070)); top.position.y = 1.15; booth.add(top);
    const sign = makeLabel('🏦 Bank', '#ffd27a', 0.8); sign.position.set(0, 2.9, 0); booth.add(sign);
    for (const sx of [-1.25, 1.25]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), bw); p.position.set(sx, 1.2, -0.2); booth.add(p); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 1.4), mat(0x2a5fb0)); roof.position.set(0, 2.4, 0.1); roof.rotation.x = 0.2; booth.add(roof);
    this.scene.add(booth); this.world.colliders.push({ minx: -9.4, maxx: -6.6, minz: 0.3, maxz: 1.1, top: 2 });
    const ken = new THREE.Group(); ken.position.set(9.3, islandHeight(9, 9), 9.3); ken.rotation.y = -0.6;
    const kb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.2), mat(0xa0703a)); kb.position.y = 0.5; ken.add(kb);
    const kr = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.7, 4), mat(0xa8452e)); kr.position.y = 1.35; kr.rotation.y = Math.PI / 4; ken.add(kr);
    const kd = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.05), mat(0x2a1a10)); kd.position.set(0, 0.3, 0.61); ken.add(kd);
    this.scene.add(ken); this.world.colliders.push({ c: 1, x: 9.3, z: 9.3, r: 0.9 });
    // plot border
    this.plotLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd040 })); this.plotLine.visible = false; this.scene.add(this.plotLine);
    // trap meshes
    this.trapGeo = new THREE.BoxGeometry(0.5, 0.35, 0.5); this.trapMat = mat(0x8a6a3a);
  },
  // ---------- totals / capes ----------
  totalLevel() { return SKILLS.reduce((a, s) => a + this.level(s), 0); },
  totalXp() { return SKILLS.reduce((a, s) => a + (this.s.xp[s] || 0), 0); },
  skillColor(s) { return SKILL_COLORS[s] || [0x888888, 0xffffff]; },
  onLevelUp(skill, before, after) {
    if (after >= MAX_LEVEL && !this.s.capes.includes(skill)) {
      this.s.capes.push(skill);
      if (!this.s.equip.cape) { this.s.equip.cape = skill; this.applyGear(); }
      UI.banner(`🧥 ${SKILL_NAMES[skill]} Cape unlocked!`, `Level ${MAX_LEVEL} — you are a master of ${SKILL_NAMES[skill]}`, 'gold'); this.audio.play('cape');
    }
    const tot = this.totalLevel(), m = Math.floor(tot / TOTAL_MILESTONE) * TOTAL_MILESTONE;
    if (m > (this.s.totalShown || 0)) { this.s.totalShown = m; setTimeout(() => UI.toast(`⭐ Total level ${m}!`, 'good'), 600); }
    this.updateNameTag();
  },
  updateNameTag() {
    const txt = `${this.s.name}  ⭐${this.totalLevel()}`;
    if (this.nameTagTxt === txt) return; this.nameTagTxt = txt;
    if (this.nameTag) this.scene.remove(this.nameTag);
    this.nameTag = makeLabel(txt, '#ffe9a8', 0.8); this.scene.add(this.nameTag);
  },
  setCape(skill) { if (skill && !this.s.capes.includes(skill)) return false; this.s.equip.cape = skill || null; this.applyGear(); this.save(); return true; },
  // ---------- bombs ----------
  throwBomb() {
    if (!(this.s.inv.bomb > 0)) { UI.toast(this.s.flags.q3_bombs ? 'Out of bombs! Pick Blastcaps or buy more from Tamsin.' : 'You have no bombs.', 'bad'); return false; }
    if (this.zoneName() === 'village' || this.zoneName() === 'camp') { UI.toast('Not in a safe zone!', 'bad'); return false; }
    if (this.bombT && this.t - this.bombT < 0.6) return false;
    this.bombT = this.t; this.s.inv.bomb--; if (!this.s.inv.bomb) delete this.s.inv.bomb;
    const p = this.p, lp = this.lockPos();
    let tx, tz;
    if (lp && !this.p.lock.grapple) { tx = lp.x; tz = lp.z; p.ry = Math.atan2(tx - p.x, tz - p.z); }
    else { const d = 6.5; tx = p.x + Math.sin(p.ry) * d; tz = p.z + Math.cos(p.ry) * d; }
    const m = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2a2a34, flatShading: true }));
    const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 3), new THREE.MeshBasicMaterial({ color: 0xffa020 })); fuse.position.y = 0.32; m.add(ball, fuse);
    m.position.set(p.x, p.y + 1.5, p.z); this.scene.add(m);
    this.bombs.push({ m, fuse, x0: p.x, z0: p.z, y0: p.y + 1.5, tx, tz, t: 0, fly: 0.55, fuseT: 1.1 });
    p.mode = 'normal'; this.animOverride = { name: 'throw', t: 0.35 }; this.audio.play('throw'); this.audio.play('fuse');
    this.lastBomb = { tx, tz }; return true;
  },
  updateBombs(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]; b.t += dt;
      const k = Math.min(1, b.t / b.fly), gy = this.terrainH(b.tx, b.tz);
      const x = b.x0 + (b.tx - b.x0) * k, z = b.z0 + (b.tz - b.z0) * k, y = b.y0 + (gy + 0.3 - b.y0) * k + Math.sin(k * Math.PI) * 2.2;
      b.m.position.set(x, y, z); b.fuse.material.color.setHex(Math.sin(b.t * 30) > 0 ? 0xffe040 : 0xff4010);
      if (b.t >= b.fly + b.fuseT) { this.scene.remove(b.m); this.bombs.splice(i, 1); this.explode(b.tx, gy, b.tz); }
    }
  },
  updateFlashes(dt) {
    if (!this.flashes) return;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.t += dt; const k = f.t / 0.45;
      f.fm.scale.setScalar(0.6 + k * 2.8); f.fm.material.opacity = Math.max(0, 0.85 * (1 - k)); f.fl.intensity = Math.max(0, 6 * (1 - k));
      if (k >= 1) { this.scene.remove(f.fm, f.fl); f.fm.material.dispose(); this.flashes.splice(i, 1); }
    }
  },
  explode(x, y, z) {
    this.particles.burst(x, y + 0.6, z, 0xffa030, 30, 7, 0.7); this.particles.burst(x, y + 0.6, z, 0x504840, 20, 4, 1.0);
    this.shake = 0.45; this.audio.play('boom'); this.lastExplosion = { x, z, t: this.t };
    if (!this._flashGeo) this._flashGeo = new THREE.SphereGeometry(1, 10, 8);
    const fm = new THREE.Mesh(this._flashGeo, new THREE.MeshBasicMaterial({ color: 0xffc050, transparent: true, opacity: 0.85, depthWrite: false }));
    fm.position.set(x, y + 0.8, z); this.scene.add(fm);
    const fl = new THREE.PointLight(0xff9030, 6, 14); fl.position.set(x, y + 1.5, z); this.scene.add(fl);
    (this.flashes ||= []).push({ fm, fl, t: 0 });
    const R = 3.2;
    // enemies
    for (const e of this.targetables()) {
      const d = Math.hypot(e.x - x, e.z - z), T = ENEMY_TYPES[e.type];
      if (e.type === 'magmaw') { if (d < 3.6) this.onEnemyDamaged(e.id, this.msim.damage(e.id, 3, x, z + 0.01, { bomb: true, mouth: true }), true, 'combat'); continue; }
      if (d < R + T.radius) this.damageEnemyRaw(e, 3, x, z, { bomb: true }, 'combat');
    }
    // cracked walls (Cinderdeep) + overworld secrets
    if (this.dungeonId === 'mine') for (const c of this.mine.cracked) {
      if (c.broken || Math.hypot(c.x - x, c.z - z) > c.r) continue;
      this.s.flags[c.flag] = true;
      if (c.pillar) { this.mine.topple(); UI.toast('The pillar cracks… and topples across the lava!', 'good'); }
      else { this.mine.setState(this.s.flags); UI.toast(c.flag === 'q3_wall' ? 'The cracked wall crumbles — the way north is open!' : 'The wall bursts open — a hidden cache!', 'good'); }
      this.particles.burst(c.x, 1.5, c.z, 0x8a7060, 30, 6, 1); this.save();
    }
    if (!this.inDungeon) for (const s of this.ridge.secrets.values()) {
      if (s.broken || Math.hypot(s.wx - x, s.wz - z) > 3.4) continue;
      this.s.flags[s.id + '_b'] = true; this.ridge.setSecret(s.id, true, !!this.s.flags[s.id + '_o']);
      UI.toast('The cracked wall bursts open — a secret!', 'good'); this.audio.play('quest'); this.save();
    }
    const p = this.p, dp = Math.hypot(p.x - x, p.z - z);
    if (dp < 2 && !(p.mode === 'roll' && p.mt < 0.42)) this.hurt(1, x, z);
  },
  // ---------- projectiles (arrows + spells) ----------
  shoot() {
    const bow = this.s.equip.ranged; if (!bow) { UI.toast('Equip a bow first (Fletching makes shortbows).', 'bad'); return false; }
    if (this.shootT && this.t - this.shootT < (this.level('archery') >= 15 ? 0.45 : 0.65)) return false;
    const ar = ARROWS.find((a) => this.s.inv[a] > 0); if (!ar) { UI.toast('No arrows! Fletch some at a workbench.', 'bad'); return false; }
    this.shootT = this.t; this.s.inv[ar]--; if (!this.s.inv[ar]) delete this.s.inv[ar];
    const L = this.level('archery'), dmg = GEAR[bow].rng + ITEMS[ar].arrow + Math.floor(L / 12);
    this.fire({ kind: 'arrow', dmg, speed: 34, range: L >= 5 ? 24 : 18, color: 0xd8c8a0, skill: 'archery' });
    if (L >= 35 && this.rand() < 0.2 && this.s.inv[ar] > 0) { this.s.inv[ar]--; setTimeout(() => this.fire({ kind: 'arrow', dmg, speed: 34, range: 24, color: 0xd8c8a0, skill: 'archery' }), 120); }
    this.animOverride = { name: 'shoot', t: 0.35 }; this.audio.play('bow'); return true;
  },
  castSpell(id = this.s.spell) {
    const sp = SPELLS.find((s) => s.id === id); if (!sp) return false;
    if (this.level('magic') < sp.level) { UI.toast(`Requires Magic level ${sp.level}.`, 'bad'); return false; }
    if (!this.has(sp.cost)) { UI.toast(`Not enough runes for ${sp.name}.`, 'bad'); return false; }
    if (this.castT && this.t - this.castT < 0.8) return false;
    if (sp.kind === 'heal' && this.p.hp >= this.maxHp) { UI.toast('Already at full health.', ''); return false; }
    if (sp.kind === 'enchant') {
      const w = this.s.equip.weapon; if (!w || !['steel_sword', 'emerald_sword', 'diamond_sword', 'iron_sword'].includes(w)) { UI.toast('Equip an iron, steel or gem blade to enchant.', 'bad'); return false; }
    }
    this.castT = this.t; this.spend(sp.cost); this.animOverride = { name: 'cast', t: 0.4 }; this.audio.play(sp.kind === 'heal' ? 'heal' : 'spell');
    const p = this.p;
    if (sp.kind === 'bolt') this.fire({ kind: 'bolt', dmg: sp.dmg, speed: 26, range: 22, color: sp.color, skill: 'magic', xpBase: sp.xp });
    else { this.addXp('magic', sp.xp); this.particles.burst(p.x, p.y + 1.2, p.z, sp.color, 20, 3, 0.8); }
    if (sp.kind === 'heal') this.p.hp = Math.min(this.maxHp, this.p.hp + sp.heal);
    if (sp.kind === 'teleport') { const h = this.s.home?.hearth || { x: CAMP.x + 3, z: CAMP.z + 1 }; this.fade(() => { this.debug.teleport(h.x + 1.5, h.z + 1.5); UI.banner('Teleported', this.s.home?.hearth ? 'Your home Hearthstone' : 'Ashfall Camp Hearthstone'); }); }
    if (sp.kind === 'enchant') { const w = this.s.equip.weapon; this.s.enchant[w] = sp.ench; UI.banner(`✦ ${GEAR[w].name} enchanted`, sp.ench === 'emerald' ? 'Lifesteal: 25% chance to heal on hit' : 'Crit: 20% chance of double damage'); this.applyGear(); }
    if (sp.kind === 'ward') { this.wardT = 90; UI.toast('🌫 Fade Ward: immune to the Fade for 90s', 'good'); }
    this.save(); return true;
  },
  fire(o) {
    const p = this.p, lp = this.lockPos();
    let dx = Math.sin(p.ry), dz = Math.cos(p.ry);
    if (lp && !p.lock.grapple) { const ax = lp.x - p.x, az = lp.z - p.z, l = Math.hypot(ax, az) || 1; dx = ax / l; dz = az / l; p.ry = Math.atan2(dx, dz); }
    else if (!lp) { dx = -Math.sin(this.cam.yaw); dz = -Math.cos(this.cam.yaw); p.ry = Math.atan2(dx, dz); }
    const geo = o.kind === 'arrow' ? new THREE.CylinderGeometry(0.03, 0.03, 0.8, 4).rotateX(Math.PI / 2) : new THREE.IcosahedronGeometry(0.28, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: o.color })); m.position.set(p.x + dx * 0.6, p.y + 1.3, p.z + dz * 0.6); m.lookAt(m.position.x + dx, m.position.y, m.position.z + dz);
    this.scene.add(m); this.projs.push({ ...o, m, x: m.position.x, y: m.position.y, z: m.position.z, dx, dz, d: 0, target: p.lock && !p.lock.grapple ? p.lock.id : null });
  },
  updateProjs(dt) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const q = this.projs[i];
      if (q.target) { const e = this.enemyById(q.target); if (e && e.alive) { const ax = e.x - q.x, az = e.z - q.z, l = Math.hypot(ax, az) || 1; q.dx += (ax / l - q.dx) * Math.min(1, dt * 8); q.dz += (az / l - q.dz) * Math.min(1, dt * 8); const n = Math.hypot(q.dx, q.dz); q.dx /= n; q.dz /= n; } }
      const s = q.speed * dt; q.x += q.dx * s; q.z += q.dz * s; q.d += s;
      q.m.position.set(q.x, q.y, q.z); q.m.lookAt(q.x + q.dx, q.y, q.z + q.dz); if (q.kind === 'bolt') q.m.rotation.z += dt * 10;
      let done = q.d > q.range;
      for (const e of this.targetables()) {
        const T = ENEMY_TYPES[e.type]; if (Math.hypot(e.x - q.x, e.z - q.z) > T.radius + 0.4) continue;
        if (e.type === 'magmaw' && (e.state === 'submerged' || e.state === 'idle')) continue;
        this.damageEnemyRaw(e, q.dmg, q.x - q.dx, q.z - q.dz, {}, q.skill);
        this.addXp(q.skill, q.kind === 'arrow' ? q.dmg * 30 : Math.round(q.xpBase / 2)); done = true; break;
      }
      if (!done && this.inDungeon && this.D.blocked && this.D.blocked(q.x, q.z) && !(this.dungeonId === 'mine' && mineLava(q.x, q.z))) done = true;
      if (done) { this.particles.burst(q.x, q.y, q.z, q.color, 6, 2, 0.3); this.scene.remove(q.m); this.projs.splice(i, 1); }
    }
  },
  // ---------- hazards ----------
  hearthNear(x, z) {
    for (const h of HEARTHSTONES) { const lit = h.lit || (h.flag && this.s.flags[h.flag]); if (lit && Math.hypot(x - h.x, z - h.z) < h.r) return true; }
    const hh = this.s.home?.hearth; if (hh && Math.hypot(x - hh.x, z - hh.z) < 9) return true;
    return false;
  },
  fogCleared(f) { const h = f.hearth && HEARTHSTONES.find((q) => q.id === f.hearth); return !!(h && this.s.flags[h.flag]); },
  updateHazards(dt) {
    const p = this.p; if (p.mode === 'dead' || this.fading) return;
    this.wardT = Math.max(0, (this.wardT || 0) - dt);
    let inFog = false;
    if (!this.inDungeon) {
      const f = fadePatchAt(p.x, p.z, (f) => this.fogCleared(f));
      inFog = !!f && !this.hearthNear(p.x, p.z);
      if (inFog && this.wardT <= 0) this.s.fade = Math.min(100, (this.s.fade || 0) + 9 * dt);
      else this.s.fade = Math.max(0, (this.s.fade || 0) - (this.hearthNear(p.x, p.z) ? 45 : 10) * dt);
      if (inFog && !this.fogWarned) { this.fogWarned = true; UI.toast('🌫 The Fade presses in. Watch your meter — Hearthstones push it back.', 'bad'); this.audio.play('fade'); }
      if (this.s.fade >= 100) { this.fadeHurtT = (this.fadeHurtT || 0) + dt; if (this.fadeHurtT > 2) { this.fadeHurtT = 0; this.hurt(1, p.x - Math.sin(p.ry), p.z - Math.cos(p.ry)); UI.toast('The Fade is unravelling you!', 'bad'); } }
    } else this.s.fade = Math.max(0, (this.s.fade || 0) - 20 * dt);
    this.inFog = inFog;
    this.world.tint.fade += ((inFog ? 0.3 + this.s.fade / 400 : 0) - this.world.tint.fade) * Math.min(1, dt * 2);
    document.body.classList.toggle('fade-on', this.s.fade > 60);
    // lava
    const lava = this.inDungeon ? this.dungeonId === 'mine' && mineLava(p.x, p.z) : p.x > 150 && lavaAt(p.x, p.z);
    if (p.grounded && !lava) { this.safeT = (this.safeT || 0) + dt; if (this.safeT > 0.4) { this.safeT = 0; p.safe = { x: p.x, z: p.z }; } }
    if (lava && p.grounded && p.mode !== 'grapple') {
      UI.toast('🔥 Lava!', 'bad'); this.audio.play('sizzle');
      const sf = p.safe || (this.inDungeon ? this.mine.exitA : { x: CAMP.x, z: CAMP.z });
      this.hurt(2, p.x, p.z); if (p.mode !== 'dead') { p.x = sf.x; p.z = sf.z; p.y = this.groundAt(sf.x, sf.z, 999); p.kx = p.kz = 0; }
    }
  },
  // ---------- hunting ----------
  setTrap(n) {
    const def = NODE_TYPES[n.type];
    if (this.level('hunting') < def.level) return UI.toast(`You need Hunting level ${def.level}.`, 'bad');
    if (!(this.s.inv[def.trap] > 0)) return UI.toast(`You need a ${ITEMS[def.trap].name} (craft one at a workbench).`, 'bad');
    this.s.inv[def.trap]--; if (!this.s.inv[def.trap]) delete this.s.inv[def.trap];
    const L = this.level('hunting'); let t = def.catch * (L >= 25 ? 0.5 : L >= 5 ? 0.85 : 1) * (this.s.pet?.type === 'dog' ? 0.5 : 1);
    const m = new THREE.Mesh(this.trapGeo, this.trapMat); m.position.set(n.x + 0.6, this.terrainH(n.x, n.z) + 0.18, n.z + 0.6); this.scene.add(m);
    this.traps.set(n.id, { n, t, ready: false, m, item: def.trap }); this.audio.play('trap');
    UI.toast(`You set a ${ITEMS[def.trap].name}. Wait nearby…`, '');
  },
  updateTraps(dt) {
    for (const tr of this.traps.values()) if (!tr.ready) { tr.t -= dt; if (tr.t <= 0) { tr.ready = true; this.particles.burst(tr.m.position.x, tr.m.position.y + 0.4, tr.m.position.z, 0xffe080, 10, 2, 0.5); this.audio.play('trap'); UI.toast('🪤 Something is caught in your trap!', 'good'); } else tr.m.rotation.y = Math.sin(this.t * 20) * 0.03; }
  },
  checkTrap(tr) {
    const def = NODE_TYPES[tr.n.type], L = this.level('hunting');
    for (const [it, ch, q] of def.loot) if (this.rand() < ch * (it === 'hide' && L >= 12 ? 1.5 : 1)) this.give(it, q);
    this.give(tr.item, 1, true); this.addXp('hunting', def.xp);
    this.scene.remove(tr.m); this.traps.delete(tr.n.id);
    this.world.setNodeDepleted(tr.n.id, true, performance.now() + def.respawn * 1000); this.save();
  },
  // ---------- runes ----------
  bindRunes(id) {
    const a = ALTARS.find((q) => q.id === id), L = this.level('runemaking'), n = this.s.inv.rune_essence || 0;
    if (!a || L < a.level) return UI.toast(`Requires Runemaking ${a?.level}.`, 'bad');
    if (!n) return UI.toast('You have no Rune Essence (mine it near the altars).', 'bad');
    const mult = 1 + Math.floor(Math.max(0, L - a.level) / 11);
    if (!(this.s.inv[a.rune] > 0) && this.slotsUsed() >= 30 && n > 0) { /* essence slot becomes the rune slot */ }
    delete this.s.inv.rune_essence; this.s.inv[a.rune] = (this.s.inv[a.rune] || 0) + n * mult;
    UI.toast(`+${n * mult} ${ITEMS[a.rune].icon} ${ITEMS[a.rune].name}`, 'item'); this.addXp('runemaking', a.xp * n); this.audio.play('spell');
    const al = this.altars.find((q) => q.id === id); this.particles.burst(al.x, al.g.position.y + 1.6, al.z, a.color, 30, 4, 1);
    if (this.panelKind === 'altar:' + id) this.openPanel('altar:' + id); this.save();
  },
  // ---------- pet ----------
  spawnPet() {
    if (this.petObj) { this.scene.remove(this.petObj.root); this.scene.remove(this.petLabel); this.petObj = null; }
    if (!this.s.pet) return;
    this.petObj = buildPet(this.s.pet.type); this.scene.add(this.petObj.root);
    this.petLabel = makeLabel(this.s.pet.name, '#bfe4ff', 0.6); this.scene.add(this.petLabel);
  },
  updatePets(dt) {
    this.runaways.forEach((r, i) => { // found runaways wait by Wren's kennel until you pick one
      const home = !!this.s.flags[r.flag] && !this.s.flags.p_done; if (home === r.home) return; r.home = home;
      const x = home ? 7.6 + i * 1.3 : r.x, z = home ? 10.6 - i * 0.5 : r.z, y = islandHeight(x, z) + (r.type === 'bird' ? (home ? 1.2 : 2.2) : 0);
      r.P.root.position.set(x, y, z); r.lb.position.set(x, y + 1.2, z); r.lb.visible = !home; r.hx = x; r.hz = z;
    });
    for (const r of this.runaways) { if (r.home) { r.P.root.visible = true; r.lb.visible = false; r.P.root.rotation.y = Math.atan2(this.p.x - r.hx, this.p.z - r.hz) + Math.sin(this.t * 2 + r.hx) * 0.3; if (r.type === 'bird') { const f = Math.sin(this.t * 10) * 0.8; r.P.wings[0].rotation.z = f; r.P.wings[1].rotation.z = -f; } continue; }
      const vis = !!this.s.flags.p_start && !this.s.flags[r.flag]; r.P.root.visible = r.lb.visible = vis; if (vis) { r.P.t = (r.P.t || 0) + dt; r.P.root.rotation.y = Math.sin(this.t * 0.5 + r.x) * 1.5; if (r.type === 'bird') { const f = Math.sin(this.t * 10) * 0.8; r.P.wings[0].rotation.z = f; r.P.wings[1].rotation.z = -f; } } }
    if (!this.petObj) return;
    const P = this.petObj, owner = { x: this.p.x, z: this.p.z, ry: this.p.ry, y: this.p.y };
    updatePet(P, owner, dt, (x, z) => this.groundAt(x, z, this.p.y + 1), this.t);
    this.petLabel.position.set(P.x, P.y + (P.type === 'bird' ? 0.7 : 1.1), P.z);
    if (this.s.pet.type === 'bird') for (const e of this.targetables()) { if (Math.hypot(e.x - this.p.x, e.z - this.p.z) < 28) { const v = this.views.get(e.id); if (v) v.showBarT = Math.max(v.showBarT, 0.3); } }
  },
  // ---------- Cinderdeep interactions ----------
  mineInteracts(add) {
    const p = this.p, M = this.mine, f = this.s.flags, d = (o) => Math.hypot(o.x - p.x, o.z - p.z);
    add(d(M.exitA), 2.2, { kind: 'exit', label: 'Leave Cinderdeep Mine' });
    if (f.q3_boss) add(d(M.exitG), 2.4, { kind: 'exit', label: 'Return to the surface' });
    add(d(M.sw), 2.0, { kind: 'mswitch', label: `Throw the rail switch (now: ${M.sw.on ? 'to the boulder' : 'to the buffer'})` });
    if (!M.cart.done && !M.cart.moving) add(d(M.cart), 2.4, { kind: 'mcart', label: 'Push the minecart' });
    if (!M.bombChest.opened) add(d(M.bombChest), 2.0, { kind: 'mchest', chest: 'bomb', label: 'Open chest' });
    if (f.m_secret && !M.secretChest.opened) add(d(M.secretChest), 2.0, { kind: 'mchest', chest: 'secret', label: 'Open the hidden chest' });
    if (f.q3_boss && !M.bossChest.opened) add(d(M.bossChest), 2.2, { kind: 'mchest', chest: 'boss', label: "Open Magmaw's chest" });
    for (const fl of M.flowers) if (fl.obj.visible) add(d(fl), 1.8, { kind: 'flower', fl, label: 'Pick Blastcap (+3 bombs)' });
  },
  mineInteract(it) {
    const M = this.mine, f = this.s.flags;
    if (it.kind === 'mswitch') { f.m_switch = !f.m_switch; M.setState(f); this.audio.play('door'); UI.toast(f.m_switch ? 'Clunk. The rails now point north — toward the boulder.' : 'Clunk. The rails point east, to the buffer.', ''); this.save(); }
    else if (it.kind === 'mcart') { const r = M.pushCart(); this.audio.play('cart'); UI.toast(r === 'boulder' ? 'The cart rumbles north…' : 'The cart rumbles east…', ''); }
    else if (it.kind === 'flower') { if (!f.q3_bombs) return UI.toast('A Blastcap mushroom. Volatile! You need a bomb bag to carry these.', ''); const n = Math.min(3, 10 - (this.s.inv.bomb || 0)); if (n <= 0) return UI.toast('Your bomb bag is full (10).', 'bad'); if (!this.give('bomb', n)) return; it.fl.until = performance.now() + 40000; this.audio.play('pickup'); }
    else if (it.kind === 'mchest') {
      const c = it.chest === 'bomb' ? M.bombChest : it.chest === 'secret' ? M.secretChest : M.bossChest;
      if (it.chest === 'bomb') { f.q3_bombs = true; this.s.inv.bomb = Math.max(this.s.inv.bomb || 0, 10); UI.banner('You got the Bomb Bag!', this.touch ? 'Tap 💣 to throw a bomb · 10 Blastcap Bombs' : 'Press R to throw a bomb · 10 Blastcap Bombs'); UI.show('#t-bomb', true); }
      if (it.chest === 'secret') { f.m_secret_chest = true; this.giveGold(150); this.give('uncut_diamond', 1); this.give('uncut_emerald', 1); UI.banner('Secret cache!', '150 coins · an uncut diamond and emerald'); }
      if (it.chest === 'boss') { f.q3_shard = true; this.give('cinder_shard', 1); this.give('hook_cast', 1); this.giveGold(100); UI.banner('The Cinder Mythshard!', 'Also: a Hook Cast — Bram\'s anvil can forge grapple anchors with it'); }
      this.particles.burst(c.x, 1.2, c.z, 0xffd040, 26, 4, 1); this.audio.play('quest'); M.setState(f); this.save();
    }
  },
  onMineEvent(ev) {
    if (ev === 'boulder') { this.s.flags.q3_cart = true; this.mine.setState(this.s.flags); this.shake = 0.5; this.audio.play('boom'); UI.toast('CRASH! The cart smashes the boulder to rubble.', 'good'); this.save(); }
    if (ev === 'buffer') UI.toast('The cart slams into the buffer and rolls back. Maybe the switch…?', '');
    if (ev === 'bridge') { this.s.flags.q3_bridge = true; this.mine.setState(this.s.flags); this.shake = 0.6; this.audio.play('boom'); this.save(); }
  },
  // ---------- v2 building ----------
  aimCell() {
    // march along the camera ray from the screen centre until it hits terrain or a built piece
    const cam = this.camera, dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const o = cam.position, p = this.p;
    let hit = null;
    for (let t = 1; t < 22; t += 0.2) {
      const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
      if (Math.hypot(x - p.x, z - p.z) > 8) { if (t > 6) break; else continue; }
      const [gx, gz] = cellOf(x, z), top = this.building.top(gx, gz), g = Math.max(this.terrainH(x, z), top);
      if (y <= g) { hit = { gx, gz }; break; }
    }
    if (!hit) { const fx = p.x + Math.sin(p.ry) * 2.4, fz = p.z + Math.cos(p.ry) * 2.4; const [gx, gz] = cellOf(fx, fz); hit = { gx, gz }; }
    // never target the cell the player stands in unless it's a flat piece
    return { ...hit, k: hit.gx + ',' + hit.gz };
  },
  inPlot(gx, gz) { const pl = this.s.home?.plot; return !!pl && gx >= pl.gx && gx < pl.gx + PLOT_CELLS && gz >= pl.gz && gz < pl.gz + PLOT_CELLS; },
  pieceRefusal(gx, gz, type) {
    const stack = this.building.stacks.get(gx + ',' + gz) || [];
    const r = buildRefusal(gx, gz, stack.length); if (r) return r;
    const last = stack.length && PIECES[pieceType(stack[stack.length - 1])];
    if (last && last.top === false) return `You can't build on top of a ${last.name}.`;
    if (PIECES[type].plot && !this.inPlot(gx, gz)) return `${PIECES[type].name}s can only go on your home plot (claim one with P / 🏠).`;
    const pl = this.s.home?.plot; if (this.plotsOther?.(gx, gz)) return 'That land belongs to someone else.';
    return null;
  },
  costFor(type) { const P = PIECES[type]; return P.alt && this.has(P.alt) && !this.has(P.cost) ? P.alt : P.cost; },
  claimPlot() {
    const { gx, gz } = this.aimCell(), g0 = gx - PLOT_CELLS / 2, h0 = gz - PLOT_CELLS / 2;
    for (const [a, b] of [[g0, h0], [g0 + PLOT_CELLS - 1, h0], [g0, h0 + PLOT_CELLS - 1], [g0 + PLOT_CELLS - 1, h0 + PLOT_CELLS - 1], [gx, gz]]) { const r = buildRefusal(a, b, 0); if (r) { UI.toast('Can\'t claim here: ' + r, 'bad'); return false; } }
    const moving = !!this.s.home?.plot;
    if (!moving && this.s.gold < PLOT_COST) { UI.toast(`Claiming a home plot costs ${PLOT_COST} coins.`, 'bad'); return false; }
    if (!moving) this.s.gold -= PLOT_COST;
    this.s.home = { ...(this.s.home || {}), plot: { gx: g0, gz: h0 } };
    if (moving) this.s.home.hearth = null;
    this.drawPlot(); this.audio.play('quest');
    UI.banner(moving ? 'Home plot moved' : '🏠 Home plot claimed!', 'Raise a Hearthstone on it to respawn here'); this.save(); return true;
  },
  drawPlot() {
    const pl = this.s.home?.plot; this.plotLine.visible = !!pl && this.buildMode; if (!pl) return;
    const pts = [], x0 = pl.gx * BLOCK, z0 = pl.gz * BLOCK, L = PLOT_CELLS * BLOCK;
    const edge = (ax, az, bx, bz) => { for (let i = 0; i < 8; i++) { const x = ax + (bx - ax) * i / 8, z = az + (bz - az) * i / 8; pts.push(new THREE.Vector3(x, islandHeight(x, z) + 0.12, z)); } };
    edge(x0, z0, x0 + L, z0); edge(x0 + L, z0, x0 + L, z0 + L); edge(x0 + L, z0 + L, x0, z0 + L); edge(x0, z0 + L, x0, z0);
    this.plotLine.geometry.dispose(); this.plotLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  },
};
