// Mythbound core game: player controller, Zelda-style combat, skills, building, quest, saves, multiplayer glue.
import * as THREE from 'three';
import {
  SPAWN, ENTRANCE, DUNGEON_START, VILLAGE, BLOCK, PIECES, RECIPES, SWORDS, ITEMS, NODE_TYPES, ENEMY_TYPES, SKILL_NAMES,
  islandHeight, zoneAt, levelForXp, generateEnemySpawns, EnemySim, cellOf, cellCenter, buildRefusal,
} from './shared.js';
import { buildAvatar, animateAvatar, SKINS, HAIR_COLORS, TUNICS, HAIR_STYLES, hex } from './avatar.js';
import { buildWorld, Particles, makeLabel } from './world.js';
import { buildDungeon, DUNGEON_SPAWNS, CHECKPOINT, dungeonHeight } from './dungeon.js';
import { EnemyView } from './enemies.js';
import { Building } from './building.js';
import { Input } from './input.js';
import { Net } from './net.js';
import * as UI from './ui.js';

const SAVE_KEY = 'mythbound_save_v1';
const PR = 0.4, STEP = 0.55, GRAV = 25;
const QUEST_FLAGS = ['talked', 'entered', 'grapple', 'lever', 'boss', 'shard', 'done'];
const QUEST_TEXT = [
  'Speak with Elder Maren in the village square.',
  'Travel north to the Hollow Barrow and enter it.',
  'Explore the Barrow. Find a way across the chasm.',
  'Grapple across the chasm (G / 🪝) and pull the lever.',
  'Defeat the Barrow Warden. Strike his glowing back, or hit him while he is stunned after a slam.',
  'Open the Warden\'s chest to claim the Mythstone.',
  'Return the Mythstone shard to Elder Maren.',
  'Quest complete! Explore, gather, forge and build. More of the story is coming…',
];
const ATK = { attack1: { dur: 0.3, hit: 0.11, mult: 1 }, attack2: { dur: 0.3, hit: 0.11, mult: 1 }, attack3: { dur: 0.42, hit: 0.17, mult: 1.5 } };
const lerpAngle = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };
const params = new URLSearchParams(location.search);

export class Game {
  constructor() {
    this.canvas = document.getElementById('c');
    this.touch = params.has('touch') ? params.get('touch') !== '0' : (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
    const quality = params.get('gfx') || (this.touch ? 'low' : 'high');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(params.has('scale') ? +params.get('scale') : Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = quality === 'high'; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 420);
    this.world = buildWorld(this.scene, { shadows: quality === 'high' });
    this.dungeon = buildDungeon(this.scene);
    this.particles = new Particles(this.scene);
    this.building = new Building(this.scene);
    this.input = new Input(this.canvas);
    this.input.noPointerLock = params.has('nolock');
    if (this.touch) { document.body.classList.add('touch'); UI.show('#touch'); this.input.attachTouch(document.getElementById('touch')); }
    this.clock = new THREE.Clock(); this.t = 0;
    this.todOverride = params.has('tod') ? +params.get('tod') : null;
    this.cam = { yaw: 0, pitch: 0.38, dist: 7.5, pos: new THREE.Vector3(0, 20, 40) };
    this.views = new Map(); this.remotes = new Map(); this.netEnemies = new Map();
    this.hitSeen = new Map(); this.enemySpawnType = new Map(generateEnemySpawns().map((s) => [s.id, s.type]));
    this.phase = 'create'; this.buildMode = false; this.piece = 'wood'; this.dialogQ = null; this.messages = [];
    this.localSim = new EnemySim(generateEnemySpawns());
    this.player = buildAvatar(); this.scene.add(this.player.root);
    this.p = { x: SPAWN.x, y: 4, z: SPAWN.z, vy: 0, ry: Math.PI, mode: 'normal', mt: 0, combo: 0, queued: false, stam: 100, stamT: 9, hp: 6, inv: 0, lock: null, grounded: true, speed: 0, hitDone: false, kx: 0, kz: 0 };
    this.addFx();
    this.spawnNPCs();
    this.load();
    this.resize(); addEventListener('resize', () => this.resize());
    this.bindUI();
    addEventListener('beforeunload', () => this.save());
    setInterval(() => this.phase === 'play' && this.save(), 5000);
    window.MB = this; // test / debug hook
    this.debug = {
      teleport: (x, z, y) => { this.p.x = x; this.p.z = z; this.p.y = y ?? this.groundAt(x, z, 999); this.p.vy = 0; this.tpFlag = true; },
      give: (item, n = 1) => { this.s.inv[item] = (this.s.inv[item] || 0) + n; },
      flag: (f, v = true) => { this.s.flags[f] = v; this.dungeon.setState(this.dstate()); },
      tod: (v) => (this.todOverride = v),
    };
  }

  // ---------------- setup ----------------
  addFx() {
    this.trail = new THREE.Mesh(new THREE.RingGeometry(1.0, 2.5, 20, 1, 0, Math.PI * 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.scene.add(this.trail); this.trailT = 0;
    this.reticle = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 3), new THREE.MeshBasicMaterial({ color: 0xffd040, depthTest: false }));
    this.reticle.rotation.x = Math.PI; this.reticle.renderOrder = 20; this.reticle.visible = false; this.scene.add(this.reticle);
    this.chain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 4).translate(0, 0.5, 0).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9a9aa0 }));
    this.chain.visible = false; this.scene.add(this.chain);
    this.hook = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.35, 4).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xc0c4cc, flatShading: true }));
    this.hook.visible = false; this.scene.add(this.hook);
  }
  spawnNPCs() {
    const defs = [
      { id: 'elder', name: 'Elder Maren', x: 0, z: 1.5, look: { skin: 0, hair: 1, hairColor: 4, tunic: 3 }, ry: 0 },
      { id: 'smith', name: 'Bram the Smith', x: -13, z: 13.5, look: { skin: 3, hair: 3, hairColor: 0, tunic: 5 }, ry: 2.4 },
      { id: 'pip', name: 'Pip the Builder', x: 7, z: 30, look: { skin: 1, hair: 2, hairColor: 2, tunic: 4 }, ry: Math.PI },
    ];
    this.npcs = defs.map((d) => {
      const av = buildAvatar(d.look); av.root.position.set(d.x, islandHeight(d.x, d.z), d.z); av.root.rotation.y = d.ry; this.scene.add(av.root);
      const label = makeLabel(d.name, '#ffe9a8', 0.85); label.position.set(d.x, islandHeight(d.x, d.z) + 2.4, d.z); this.scene.add(label);
      const mark = makeLabel('!', '#ffd040', 1.6); mark.position.set(d.x, islandHeight(d.x, d.z) + 3.1, d.z); mark.visible = false; this.scene.add(mark);
      this.world.colliders.push({ c: 1, x: d.x, z: d.z, r: 0.5 });
      return { ...d, av, mark };
    });
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.fov = w < h ? 72 : 60; this.camera.updateProjectionMatrix();
  }

  // ---------------- save / load ----------------
  defaultSave() { return { v: 1, name: '', look: { skin: 0, hair: 0, hairColor: 1, tunic: 0 }, inv: {}, xp: { combat: 0, woodcutting: 0, mining: 0, smithing: 0 }, sword: 'wood', flags: {}, pos: null, hp: 6, maxHearts: 3, blocks: [], dungeon: {} }; }
  load() {
    let s = null; try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
    this.hasSave = !!(s && s.name);
    this.s = Object.assign(this.defaultSave(), s || {});
  }
  save() {
    if (!this.s.name) return;
    const inD = zoneAt(this.p.x, this.p.z) === 'dungeon';
    this.s.pos = inD ? { x: ENTRANCE.x, z: ENTRANCE.z + 5 } : { x: +this.p.x.toFixed(2), z: +this.p.z.toFixed(2) };
    this.s.hp = this.p.hp;
    if (!this.online) this.s.blocks = this.building.serialize();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.s)); } catch {}
  }
  get maxHp() { return (this.s.maxHearts + Math.floor((levelForXp(this.s.xp.combat) - 1) / 3)) * 2; }
  level(skill) { return levelForXp(this.s.xp[skill] || 0); }
  dstate() { const f = this.s.flags; return { chest: f.grapple, lever: f.lever, boss: f.boss, bossChest: f.shard }; }
  questStage() { return QUEST_FLAGS.findIndex((f) => !this.s.flags[f]) === -1 ? 7 : QUEST_FLAGS.findIndex((f) => !this.s.flags[f]); }

  // ---------------- character creation ----------------
  showCreate() {
    UI.show('#create'); UI.show('#hud', false);
    const L = { ...this.s.look }; let name = this.s.name || '';
    if (this.hasSave) { UI.show('#cc-continue'); UI.show('#cc-form', false); document.getElementById('cc-cont-btn').textContent = `Continue as ${this.s.name}`; }
    const swatches = (id, list, key, isText) => {
      const box = document.getElementById(id); box.innerHTML = '';
      list.forEach((c, i) => {
        const b = document.createElement('button'); if (isText) { b.textContent = c; b.className = 'txt'; } else b.style.background = hex(c);
        b.dataset.i = i; b.setAttribute('aria-label', `${key} ${i}`);
        b.onclick = () => { L[key] = i; refresh(); }; box.appendChild(b);
      });
    };
    const refresh = () => {
      for (const [id, key] of [['cc-skin', 'skin'], ['cc-hair', 'hair'], ['cc-haircolor', 'hairColor'], ['cc-tunic', 'tunic']]) document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('sel', +b.dataset.i === L[key]));
      this.player.setLook({ ...L, sword: 'wood' });
      document.getElementById('cc-start').disabled = !document.getElementById('cc-name').value.trim();
    };
    swatches('cc-skin', SKINS, 'skin'); swatches('cc-hair', HAIR_STYLES, 'hair', true); swatches('cc-haircolor', HAIR_COLORS, 'hairColor'); swatches('cc-tunic', TUNICS, 'tunic');
    const nameEl = document.getElementById('cc-name'); nameEl.value = name; nameEl.oninput = refresh;
    document.getElementById('cc-random').onclick = () => { L.skin = (Math.random() * SKINS.length) | 0; L.hair = (Math.random() * 3) | 0; L.hairColor = (Math.random() * HAIR_COLORS.length) | 0; L.tunic = (Math.random() * TUNICS.length) | 0; if (!nameEl.value) nameEl.value = ['Kael', 'Lyra', 'Bren', 'Ysolde', 'Tamsin', 'Orin'][(Math.random() * 6) | 0]; refresh(); };
    document.getElementById('cc-start').onclick = () => {
      const n = nameEl.value.trim().slice(0, 16); if (!n) return;
      this.s = this.defaultSave(); this.s.name = n; this.s.look = { ...L }; this.start(true);
    };
    document.getElementById('cc-new-btn').onclick = () => { UI.show('#cc-continue', false); UI.show('#cc-form'); this.hasSave = false; nameEl.value = ''; refresh(); nameEl.focus(); };
    document.getElementById('cc-cont-btn').onclick = () => this.start(false);
    document.getElementById('cc-mode').textContent = this.serverUrl ? `Server: ${this.serverUrl}` : 'Single player · progress saves on this device. Multiplayer coming soon.';
    this.player.setLook({ ...L, sword: this.s.sword });
    refresh();
    this.p.x = 3; this.p.z = 24; this.p.y = islandHeight(3, 24); this.p.ry = 0.5;
  }

  async start(fresh) {
    UI.show('#create', false); UI.show('#hud');
    this.player.setLook({ ...this.s.look, sword: this.s.sword });
    const pos = this.s.pos || SPAWN;
    this.p.x = pos.x; this.p.z = pos.z; this.p.y = this.groundAt(pos.x, pos.z, 999); this.p.ry = Math.PI; this.cam.yaw = 0;
    this.p.hp = Math.min(this.maxHp, this.s.hp || this.maxHp);
    if (!this.online) { this.building.clear(); for (const [k, arr] of this.s.blocks || []) this.building.setStack(k, arr); }
    this.dungeon.setState(this.dstate());
    this.resetDungeonSim();
    UI.show('#t-grapple', !!this.s.flags.grapple);
    this.phase = 'play';
    UI.chatLine(null, `Welcome to Mythbound, ${this.s.name}! Press H for controls.`, 'sys');
    if (fresh) setTimeout(() => UI.banner('Mythbound', 'Speak with Elder Maren to begin'), 400);
    if (this.serverUrl) await this.connect();
    else UI.netBadge('Solo · offline', 'offline');
    this.save();
  }

  // ---------------- networking ----------------
  async connect() {
    UI.netBadge('Connecting…', 'warn');
    this.net = new Net(this.serverUrl, {
      welcome: (m) => {
        this.myId = m.id;
        if (m.you && Math.hypot(m.you.x - this.p.x, m.you.z - this.p.z) > 3) { this.p.x = m.you.x; this.p.z = m.you.z; this.p.y = this.groundAt(m.you.x, m.you.z, 999); }
        for (const p of m.players) this.addRemote(p);
        for (const id of m.nodes) this.world.setNodeDepleted(id, true);
        this.building.clear(); for (const [k, arr] of m.blocks) this.building.setStack(k, arr);
        this.applyEnemySnap(m.e);
      },
      join: (m) => this.addRemote(m.p),
      leave: (m) => this.removeRemote(m.id),
      look: (m) => { const r = this.remotes.get(m.id); if (r) r.av.setSword(m.look.sword); },
      snap: (m) => {
        for (const [id, x, y, z, ry, a] of m.p) { if (id === this.myId) continue; const r = this.remotes.get(id); if (r) { r.tx = x; r.ty = y; r.tz = z; r.tr = ry; if (r.a !== a) { r.a = a; r.at = 0; } } }
        this.applyEnemySnap(m.e);
      },
      ev: (m) => { for (const e of m.ev) this.handleEnemyEvent(e); },
      ehit: (m) => { const e = this.netEnemies.get(m.id); if (e) { e.hp = m.hp; if (m.killed) { e.alive = false; e.state = 'dead'; e.st = 0; } } this.onEnemyDamaged(m.id, m, m.by === this.myId); },
      node: (m) => this.world.setNodeDepleted(m.id, !!m.dep),
      gatherOk: (m) => this.rewardGather(this.world.nodes.get(m.id)),
      gatherFail: () => UI.toast('Someone got there first.', 'bad'),
      blocks: (m) => this.onBlocks(m),
      buildFail: (m) => { UI.toast(m.reason, 'bad'); this.lastBuild = { ok: false, reason: m.reason }; },
      chat: (m) => { UI.chatLine(m.sys ? null : m.name, m.text, m.sys ? 'sys' : m.id === this.myId ? 'me' : ''); this.messages.push(m); },
      correct: (m) => { this.p.x = m.x; this.p.y = m.y; this.p.z = m.z; this.p.vy = 0; },
      full: () => UI.toast('Server is full.', 'bad'),
      disconnect: () => { this.online = false; UI.netBadge('Disconnected · solo', 'warn'); UI.chatLine(null, 'Lost connection to the server. Continuing offline.', 'sys'); for (const id of [...this.remotes.keys()]) this.removeRemote(id); this.localSim = new EnemySim(generateEnemySpawns()); },
    });
    const ok = await this.net.connect({ name: this.s.name, look: { ...this.s.look, sword: this.s.sword }, x: +this.p.x.toFixed(2), z: +this.p.z.toFixed(2) });
    this.online = ok;
    if (ok) { UI.netBadge('Online', 'online'); UI.chatLine(null, 'Connected to the realm. Press Enter to chat.', 'sys'); }
    else { UI.netBadge('Server unreachable · solo', 'warn'); UI.chatLine(null, 'Could not reach the server — playing solo.', 'sys'); }
  }
  applyEnemySnap(list) {
    for (const [id, x, z, ry, state, st, hp, alive, kind, atk] of list) {
      let e = this.netEnemies.get(id);
      const type = this.enemySpawnType.get(id);
      if (!e) { e = { id, type, max: ENEMY_TYPES[type].hp }; this.netEnemies.set(id, e); }
      if (e.state !== state) e.st = st;
      Object.assign(e, { x, z, ry, state, hp, alive: !!alive, kind, atk });
    }
  }
  addRemote(p) {
    if (p.id === this.myId || this.remotes.has(p.id)) return;
    const av = buildAvatar(p.look); this.scene.add(av.root);
    const label = makeLabel(p.name, '#bfe4ff', 0.85); this.scene.add(label);
    this.remotes.set(p.id, { id: p.id, name: p.name, av, label, x: p.x, y: p.y, z: p.z, ry: p.ry || 0, tx: p.x, ty: p.y, tz: p.z, tr: p.ry || 0, a: p.a || 'idle', at: 0 });
  }
  removeRemote(id) { const r = this.remotes.get(id); if (!r) return; this.scene.remove(r.av.root); this.scene.remove(r.label); this.remotes.delete(id); }
  sendState(dt) {
    if (!this.online) return;
    this.sendT = (this.sendT || 0) + dt;
    if (this.sendT < 0.1 && !this.tpFlag) return;
    this.sendT = 0;
    const p = this.p;
    this.net.send({ t: 'state', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), ry: +p.ry.toFixed(2), a: this.animName(), dead: p.mode === 'dead', sword: this.s.sword, tp: this.tpFlag ? 1 : 0 });
    this.tpFlag = false;
  }

  // ---------------- UI wiring ----------------
  bindUI() {
    document.getElementById('btn-skills').onclick = () => this.togglePanel('skills');
    document.getElementById('btn-bag').onclick = () => this.togglePanel('bag');
    document.getElementById('btn-help').onclick = () => this.togglePanel('help');
    document.getElementById('panel').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return this.closePanel();
      const r = e.target.closest('[data-recipe]'); if (r) this.craft(r.dataset.recipe);
    });
    document.getElementById('buildbar').addEventListener('click', (e) => { const s = e.target.closest('[data-piece]'); if (s) { this.piece = s.dataset.piece; this.refreshBuildBar(); } });
    const ci = document.getElementById('chat-input');
    ci.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const t = ci.value.trim(); if (t) this.sendChat(t); ci.value = ''; ci.blur(); e.preventDefault(); }
      if (e.key === 'Escape') ci.blur();
      e.stopPropagation();
    });
  }
  sendChat(text) {
    if (this.online) this.net.send({ t: 'chat', text });
    else { UI.chatLine(this.s.name, text, 'me'); UI.chatLine(null, '(Solo mode — nobody else can hear you.)', 'sys'); }
  }
  togglePanel(kind) { if (this.panelKind === kind && UI.panelOpen()) return this.closePanel(); this.openPanel(kind); }
  openPanel(kind) {
    this.panelKind = kind;
    if (kind === 'skills') UI.panel(UI.skillsHtml(this.s.xp));
    else if (kind === 'bag') UI.panel(UI.bagHtml(this.s.inv, this.s.sword, this.s.flags.grapple));
    else if (kind === 'help') UI.panel(UI.HELP_HTML);
    else UI.panel(UI.stationHtml(kind, this.s.inv, this.level('smithing')));
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closePanel() { UI.panel(null); this.panelKind = null; }
  refreshBuildBar() { UI.buildBar(this.buildMode, this.piece, this.s.inv); }

  // ---------------- skills / items ----------------
  addXp(skill, n) {
    const before = this.level(skill); this.s.xp[skill] = (this.s.xp[skill] || 0) + n;
    UI.toast(`+${n} ${SKILL_NAMES[skill]} XP`, 'xp');
    const after = this.level(skill);
    if (after > before) {
      UI.banner(`${SKILL_NAMES[skill]} level ${after}!`, skill === 'combat' && after % 3 === 1 ? 'Your heart grows stronger (+1 heart)' : 'Level up!');
      this.particles.burst(this.p.x, this.p.y + 1.5, this.p.z, 0xffd040, 24, 5, 1);
      if (skill === 'combat') this.p.hp = this.maxHp;
    }
  }
  give(item, n) { this.s.inv[item] = (this.s.inv[item] || 0) + n; UI.toast(`+${n} ${ITEMS[item].icon} ${ITEMS[item].name}`, 'item'); }
  has(cost) { return Object.entries(cost).every(([k, n]) => (this.s.inv[k] || 0) >= n); }
  spend(cost) { for (const [k, n] of Object.entries(cost)) this.s.inv[k] -= n; }
  craft(id) {
    const r = RECIPES.find((x) => x.id === id); if (!r) return;
    if (this.level('smithing') < r.level) return UI.toast(`Requires Smithing level ${r.level}.`, 'bad');
    if (!this.has(r.input)) return UI.toast('You do not have the materials.', 'bad');
    this.spend(r.input);
    if (r.out) for (const [k, n] of Object.entries(r.out)) this.give(k, n);
    if (r.sword) {
      const better = SWORDS[r.sword].dmg > SWORDS[this.s.sword].dmg;
      if (better) { this.s.sword = r.sword; this.player.setSword(r.sword); }
      UI.banner(`Forged a ${SWORDS[r.sword].name}!`, better ? `Equipped · damage ${SWORDS[r.sword].dmg}` : '');
    }
    this.addXp('smithing', r.xp);
    const st = this.world.stations.find((s) => s.kind === r.station);
    this.particles.burst(st.obj.position.x, st.obj.position.y + 1.2, st.obj.position.z, r.station === 'furnace' ? 0xff8a20 : 0xffe080, 14, 3, 0.6);
    this.openPanel(r.station); this.save();
  }

  // ---------------- terrain / collision ----------------
  get inDungeon() { return zoneAt(this.p.x, this.p.z) === 'dungeon'; }
  terrainH(x, z) { return zoneAt(x, z) === 'dungeon' ? dungeonHeight(x, z) : islandHeight(x, z); }
  groundAt(x, z, feetY) {
    let g = this.terrainH(x, z);
    if (zoneAt(x, z) !== 'dungeon') for (const c of this.building.columnsAround(x, z, PR * 0.6)) if (c.top <= feetY + STEP && c.top > g) g = c.top;
    return g;
  }
  collide(nx, nz, moving) {
    const p = this.p; const inD = zoneAt(nx, nz) === 'dungeon';
    const list = inD ? this.dungeon.colliders : this.world.colliders;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of list) {
        if (c.disabled) continue;
        if (c.c) {
          const dx = nx - c.x, dz = nz - c.z; if (Math.abs(dx) > c.r + 1 || Math.abs(dz) > c.r + 1) continue;
          const d = Math.hypot(dx, dz), m = c.r + PR;
          if (d < m && d > 1e-4) { nx = c.x + (dx / d) * m; nz = c.z + (dz / d) * m; }
        } else {
          const cx = Math.max(c.minx, Math.min(nx, c.maxx)), cz = Math.max(c.minz, Math.min(nz, c.maxz));
          const dx = nx - cx, dz = nz - cz, d = Math.hypot(dx, dz);
          if (d < PR) {
            if (d > 1e-4) { nx = cx + (dx / d) * PR; nz = cz + (dz / d) * PR; }
            else { // inside: push out along the shortest axis
              const o = [[c.minx - PR - nx, 0], [c.maxx + PR - nx, 0], [0, c.minz - PR - nz], [0, c.maxz + PR - nz]].sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
              nx += o[0]; nz += o[1];
            }
          }
        }
      }
    }
    let step = false;
    if (!inD) {
      for (const c of this.building.columnsAround(nx, nz, PR)) {
        if (c.top <= p.y + STEP || c.base > p.y + 1.7) continue;
        const cx = Math.max(c.minx, Math.min(nx, c.maxx)), cz = Math.max(c.minz, Math.min(nz, c.maxz));
        const dx = nx - cx, dz = nz - cz, d = Math.hypot(dx, dz);
        if (d < PR) {
          if (c.top - p.y <= BLOCK + 0.15) step = true;
          if (d > 1e-4) { nx = cx + (dx / d) * PR; nz = cz + (dz / d) * PR; }
        }
      }
      if (islandHeight(nx, nz) < -1.2) { nx = p.x; nz = p.z; }
      if (Math.hypot(nx, nz) > 160) { nx = p.x; nz = p.z; }
    }
    p.x = nx; p.z = nz;
    if (step && moving && p.grounded) { p.vy = 9; p.grounded = false; }
  }

  // ---------------- enemies ----------------
  resetDungeonSim() {
    const spawns = DUNGEON_SPAWNS.filter((s) => !(s.id === 'd_warden' && this.s.flags.boss));
    this.dsim = new EnemySim(spawns, { height: dungeonHeight, blocked: (x, z) => this.dungeon.blocked(x, z), respawn: false });
    for (const [id, v] of this.views) if (id.startsWith('d_')) { v.dispose(); this.views.delete(id); }
  }
  overworldEnemies() { return this.online ? this.netEnemies : this.localSim.enemies; }
  allEnemies() { const out = []; for (const e of this.overworldEnemies().values()) out.push(e); for (const e of this.dsim.enemies.values()) out.push(e); return out; }
  enemyById(id) { return id.startsWith('d_') ? this.dsim.enemies.get(id) : this.overworldEnemies().get(id); }
  updateEnemies(dt) {
    const me = [{ id: 'me', x: this.p.x, z: this.p.z, dead: this.p.mode === 'dead' }];
    if (!this.online) for (const ev of this.localSim.update(dt, me)) this.handleEnemyEvent(ev);
    else for (const e of this.netEnemies.values()) e.st += dt;
    if (this.inDungeon) for (const ev of this.dsim.update(dt, me)) this.handleEnemyEvent(ev);
    for (const e of this.allEnemies()) {
      let v = this.views.get(e.id);
      if (!v) { v = new EnemyView(this.scene, e); this.views.set(e.id, v); }
      const far = Math.abs(e.x - this.p.x) + Math.abs(e.z - this.p.z) > 110;
      v.root.visible = !far; if (far) { v.ring.visible = false; continue; }
      v.update(e, dt, this.t, (x, z) => this.terrainH(x, z), this.camera, this.p.lock && this.p.lock.id === e.id);
    }
  }
  handleEnemyEvent(ev) {
    if (ev.t !== 'hit') return;
    const p = this.p;
    if (p.mode === 'dead') return;
    const key = ev.id; if (this.hitSeen.get(key) === ev.atk) return;
    const d = Math.hypot(p.x - ev.x, p.z - ev.z);
    if (ev.slam) { this.particles.burst(ev.x, this.terrainH(ev.x, ev.z) + 0.2, ev.z, 0x8a8070, 18, 5, 0.6); this.shake = 0.35; }
    if (d > ev.r + PR) return;
    this.hitSeen.set(key, ev.atk);
    if (p.mode === 'roll' && p.mt > 0.03 && p.mt < 0.42) { this.lastDodge = this.t; return; } // i-frames
    if (p.inv > 0) return;
    // shield block: facing the attacker
    const ax = ev.sx - p.x, az = ev.sz - p.z, al = Math.hypot(ax, az) || 1;
    const facing = Math.sin(p.ry) * (ax / al) + Math.cos(p.ry) * (az / al);
    if (p.mode === 'block' && facing > 0.3 && p.stam > 0) {
      this.useStam(12 * ev.dmg); this.lastBlock = this.t;
      this.particles.burst(p.x + Math.sin(p.ry) * 0.7, p.y + 1.2, p.z + Math.cos(p.ry) * 0.7, 0xfff0a0, 10, 4, 0.3);
      p.kx = -ax / al * 3; p.kz = -az / al * 3;
      if (p.stam <= 0) { UI.toast('Guard broken!', 'bad'); p.mode = 'hurt'; p.mt = 0; }
      return;
    }
    this.hurt(ev.dmg, ev.sx, ev.sz);
  }
  hurt(dmg, sx, sz) {
    const p = this.p; if (p.mode === 'dead') return;
    p.hp = Math.max(0, p.hp - dmg); p.inv = 1.0;
    const ax = p.x - sx, az = p.z - sz, al = Math.hypot(ax, az) || 1;
    p.kx = (ax / al) * 9; p.kz = (az / al) * 9; p.mode = 'hurt'; p.mt = 0; p.combo = 0;
    this.particles.burst(p.x, p.y + 1.2, p.z, 0xff3030, 10, 3, 0.4);
    this.shake = 0.25; document.body.classList.add('hurt'); setTimeout(() => document.body.classList.remove('hurt'), 150);
    if (p.hp <= 0) this.die();
  }
  die() {
    const p = this.p; p.mode = 'dead'; p.mt = 0; p.lock = null;
    UI.banner('You have fallen…', 'The legend is not over yet');
  }
  respawn() {
    const p = this.p; const inD = this.inDungeon;
    this.fade(() => {
      const pt = inD ? DUNGEON_START : SPAWN;
      this.debug.teleport(pt.x, pt.z); p.hp = this.maxHp; p.mode = 'normal'; p.inv = 2; p.stam = 100;
      if (inD) this.resetDungeonSim();
    });
  }
  targetables() {
    const zoneD = this.inDungeon, out = [];
    for (const e of this.allEnemies()) if (e.alive && e.id.startsWith('d_') === zoneD) out.push(e);
    return out;
  }
  doHit(kind) {
    const p = this.p, base = SWORDS[this.s.sword].dmg;
    const spin = kind === 'spin';
    const dmg = spin ? base * 2 : Math.ceil(base * ATK[kind].mult);
    const reach = spin ? 3.8 : 2.5;
    const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
    let hits = 0;
    for (const e of this.targetables()) {
      const T = ENEMY_TYPES[e.type];
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      if (d > reach + T.radius) continue;
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (!spin && dot < 0.25 && d > T.radius + 0.6) continue;
      hits++; this.damageEnemy(e, dmg, kind);
    }
    // swing trail
    this.trailT = 0.16; this.trail.position.set(p.x, p.y + 1.1, p.z);
    this.trail.geometry.dispose();
    const len = spin ? Math.PI * 2 : kind === 'attack3' ? 0.5 : Math.PI * 0.9;
    this.trail.geometry = new THREE.RingGeometry(spin ? 1.2 : 0.9, spin ? 3.6 : 2.5, 20, 1, 0, len).rotateX(-Math.PI / 2);
    this.trail.rotation.set(0, p.ry - Math.PI / 2 - len / 2 + (kind === 'attack2' ? 0.2 : 0), kind === 'attack2' ? 0.35 : kind === 'attack1' ? -0.15 : 0);
    if (kind === 'attack3') this.trail.rotation.y = p.ry - Math.PI / 2 - 0.25;
    return hits;
  }
  damageEnemy(e, dmg, kind) {
    const T = ENEMY_TYPES[e.type];
    const px = e.x - Math.sin(Math.atan2(e.x - this.p.x, e.z - this.p.z)) * T.radius, pz = e.z - Math.cos(Math.atan2(e.x - this.p.x, e.z - this.p.z)) * T.radius;
    this.particles.burst(px, this.p.y + 1.1, pz, 0xffffff, 6, 3, 0.25);
    if (e.id.startsWith('d_')) this.onEnemyDamaged(e.id, this.dsim.damage(e.id, dmg, this.p.x, this.p.z), true);
    else if (this.online) this.net.send({ t: 'attack', id: e.id, dmg, kind });
    else this.onEnemyDamaged(e.id, this.localSim.damage(e.id, dmg, this.p.x, this.p.z), true);
    this.lastAttackHit = { id: e.id, t: this.t };
  }
  onEnemyDamaged(id, r, mine) {
    if (!r || r.ok === false) return;
    const e = this.enemyById(id), v = this.views.get(id);
    if (r.blocked) {
      if (v) v.flash(0x4466ff);
      if (e) this.particles.burst(e.x, this.terrainH(e.x, e.z) + 2.5, e.z, 0xa0c0ff, 8, 3, 0.3);
      if (mine && (!this.clangT || this.t - this.clangT > 3)) { this.clangT = this.t; UI.toast('Clang! His armour is too thick — hit his glowing back or strike after a slam.', 'bad'); }
      return;
    }
    if (v) v.flash(); if (v) v.showBarT = 4;
    if (r.killed) {
      if (e) this.particles.burst(e.x, this.terrainH(e.x, e.z) + 0.8, e.z, 0x9a8aff, 22, 4, 0.8);
      if (this.p.lock && this.p.lock.id === id) this.p.lock = null;
      if (mine) this.addXp('combat', r.xp || ENEMY_TYPES[e?.type || this.enemySpawnType.get(id) || 'mossling'].xp);
      if (id === 'd_warden') { this.s.flags.boss = true; this.dungeon.setState(this.dstate()); UI.banner('Barrow Warden defeated!', 'A chest appears…'); this.save(); }
    }
  }

  // ---------------- interactions ----------------
  findInteract() {
    const p = this.p, near = [];
    const add = (d, max, o) => { if (d < max) near.push({ d, ...o }); };
    if (!this.inDungeon) {
      for (const n of this.npcs) add(Math.hypot(n.x - p.x, n.z - p.z), 2.8, { kind: 'npc', label: `Talk to ${n.name}`, npc: n });
      for (const s of this.world.stations) add(Math.hypot(s.x - p.x, s.z - p.z), 2.6, { kind: 'station', label: s.label, station: s.kind });
      for (const n of this.world.nodes.values()) {
        if (n.depleted) continue;
        const dx = n.x - p.x, dz = n.z - p.z; if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
        const def = NODE_TYPES[n.type];
        add(Math.hypot(dx, dz), n.type === 'tree' || n.type === 'oak' ? 2.3 : 2.7, { kind: 'node', label: `${def.label} <small>(${SKILL_NAMES[def.skill]} ${def.level})</small>`, node: n });
      }
      const en = this.world.entrance; add(Math.hypot(en.x - p.x, en.z - p.z), 2.6, { kind: 'enter', label: 'Enter the Hollow Barrow' });
    } else {
      const D = this.dungeon;
      if (!D.chest.opened) add(Math.hypot(D.chest.x - p.x, D.chest.z - p.z), 2.0, { kind: 'chest', label: 'Open chest' });
      if (!D.lever.pulled) add(Math.hypot(D.lever.x - p.x, D.lever.z - p.z), 1.8, { kind: 'lever', label: 'Pull lever' });
      if (this.s.flags.boss && !D.bossChest.opened) add(Math.hypot(D.bossChest.x - p.x, D.bossChest.z - p.z), 2.0, { kind: 'bossChest', label: 'Open the Warden\'s chest' });
      add(Math.hypot(D.exitA.x - p.x, D.exitA.z - p.z), 2.0, { kind: 'exit', label: 'Leave the Barrow' });
      if (this.s.flags.boss) add(Math.hypot(D.exitD.x - p.x, D.exitD.z - p.z), 2.2, { kind: 'exit', label: 'Return to the surface' });
    }
    near.sort((a, b) => a.d - b.d);
    return near[0] || null;
  }
  interact(it) {
    const p = this.p, D = this.dungeon;
    switch (it.kind) {
      case 'npc': return this.talk(it.npc);
      case 'station': return this.openPanel(it.station);
      case 'node': return this.startGather(it.node);
      case 'enter': return this.enterDungeon();
      case 'exit': return this.exitDungeon();
      case 'chest':
        this.s.flags.grapple = true; D.setState(this.dstate());
        this.particles.burst(D.chest.x, 1.2, D.chest.z, 0xffd040, 26, 4, 1);
        UI.banner('You got the Grapple Hook!', this.touch ? 'Tap 🪝 near a golden ring to pull yourself across' : 'Press G (or lock on) near a golden ring to pull yourself across');
        UI.show('#t-grapple', true); this.save(); return;
      case 'lever':
        this.s.flags.lever = true; D.setState(this.dstate()); D.gate.position.y = 0; UI.toast('A heavy gate grinds open somewhere nearby…', 'good'); this.shake = 0.3; this.save(); return;
      case 'bossChest':
        this.s.flags.shard = true; D.setState(this.dstate()); this.give('mythstone', 1);
        this.particles.burst(D.bossChest.x, 1.2, D.bossChest.z, 0x80e0ff, 30, 5, 1.2);
        UI.banner('You found a Mythstone Shard!', 'Bring it to Elder Maren'); this.save(); return;
    }
  }
  talk(npc) {
    const n = this.s.name, st = this.questStage();
    let lines, after = null;
    if (npc.id === 'elder') {
      if (!this.s.flags.talked) {
        lines = [`Ah, a new face! Welcome to Mythbound Isle, ${n}.`, 'Long ago our heroes were bound into legend — that is why the isle bears its name.', 'But the old Hollow Barrow to the north has begun to stir. Mosslings and Grubkins creep closer every night.', 'Deep inside, a Warden of stone guards a Mythstone shard — a piece of the old legend. Will you bring it back?',
          this.touch ? 'Follow the path north. Use 🎯 to lock on, 🛡 to block and ⤾ to roll. Hold ⚔ to charge a spin attack!' : 'Follow the path north. Tab or right-click locks on, hold Q to block, Space to roll. Hold attack to charge a spin!'];
        after = () => { this.s.flags.talked = true; UI.toast('Quest started: The Hollow Barrow', 'good'); this.save(); };
      } else if (this.s.flags.shard && !this.s.flags.done) {
        lines = ['You… you found it! The Mythstone shard hums with old power.', 'Take this Heart Container. You have more than earned it.', `There are more shards scattered beyond the sea, ${n}. But that is a story for another day.`];
        after = () => { this.s.flags.done = true; this.s.inv.mythstone = Math.max(0, (this.s.inv.mythstone || 1) - 1); this.s.maxHearts += 1; this.p.hp = this.maxHp; UI.banner('Quest complete!', 'Heart Container: +1 max heart'); this.save(); };
      } else if (this.s.flags.done) lines = ['The isle sleeps easier thanks to you. Why not build yourself a home out in the Wilds?'];
      else lines = ['The Hollow Barrow lies to the north. Watch your foes — they flash red just before they strike.'];
    } else if (npc.id === 'smith') {
      lines = ['Need a better blade? Mine copper and tin in the eastern hills.', 'Smelt them into bronze at my furnace, then hammer out a sword on the anvil.', 'Iron needs Mining and Smithing level 3 — but it hits like a mule.'];
    } else {
      lines = [this.touch ? 'Tap 🧱 out in the Wilds to build! Pick a piece, then ＋ to place and － to remove.' : 'Press B out in the Wilds to build! 1 wood block, 2 stone block, 3 plank floor. E or click to place, X or right-click to remove.', 'Not in here, mind — the village is protected. No building, no brawling.', 'Logs come from trees, stone from plain grey rocks.'];
    }
    let i = 0; this.inDialog = true;
    const next = () => {
      if (i >= lines.length) { UI.closeDialog(); this.inDialog = false; this.dialogNext = null; after?.(); return; }
      UI.dialog(npc.name, lines[i++], next);
    };
    this.dialogNext = next; next();
    npc.av.root.rotation.y = Math.atan2(this.p.x - npc.x, this.p.z - npc.z);
  }
  startGather(n) {
    const def = NODE_TYPES[n.type];
    if (this.level(def.skill) < def.level) return UI.toast(`You need ${SKILL_NAMES[def.skill]} level ${def.level}.`, 'bad');
    const p = this.p; p.mode = 'gather'; p.mt = 0; p.gnode = n; p.ry = Math.atan2(n.x - p.x, n.z - p.z);
  }
  finishGather(n) {
    if (n.depleted) return UI.toast('Nothing left here.', 'bad');
    if (this.online) return this.net.send({ t: 'gather', id: n.id });
    this.world.setNodeDepleted(n.id, true, performance.now() + NODE_TYPES[n.type].respawn * 1000);
    this.rewardGather(n);
  }
  rewardGather(n) {
    if (!n) return; const def = NODE_TYPES[n.type];
    this.give(def.item, def.qty); this.addXp(def.skill, def.xp);
    this.particles.burst(n.x, this.terrainH(n.x, n.z) + 1, n.z, def.skill === 'woodcutting' ? 0x6aa040 : 0x9a9a9a, 12, 3, 0.6);
    if (this.buildMode) this.refreshBuildBar();
    this.save();
  }
  fade(fn) { const f = document.getElementById('fade'); f.classList.add('on'); this.fading = true; setTimeout(() => { fn(); f.classList.remove('on'); this.fading = false; }, 380); }
  enterDungeon() {
    this.fade(() => {
      this.debug.teleport(DUNGEON_START.x, DUNGEON_START.z, 0); this.p.ry = Math.PI; this.cam.yaw = 0;
      this.s.flags.entered = true; this.resetDungeonSim(); this.p.lock = null;
      if (this.buildMode) this.toggleBuild();
      UI.banner('The Hollow Barrow'); this.save();
    });
  }
  exitDungeon() {
    this.fade(() => { this.debug.teleport(ENTRANCE.x, ENTRANCE.z + 5); this.p.ry = 0; this.cam.yaw = Math.PI; this.p.lock = null; UI.banner('Mythbound Isle'); this.save(); });
  }

  // ---------------- building ----------------
  toggleBuild() {
    if (!this.buildMode && this.inDungeon) return UI.toast('The barrow resists your building.', 'bad');
    this.buildMode = !this.buildMode; this.input.buildMode = this.buildMode;
    this.building.ghost.visible = this.buildMode; UI.show('#tbuild', this.buildMode && this.touch);
    this.refreshBuildBar();
    if (this.buildMode) UI.toast(this.zoneName() === 'village' ? 'Building is not allowed in the village. Head out to the Wilds.' : 'Build mode', this.zoneName() === 'village' ? 'bad' : 'good');
  }
  buildTarget() {
    const p = this.p; const fx = p.x + Math.sin(p.ry) * 2.4, fz = p.z + Math.cos(p.ry) * 2.4;
    const [gx, gz] = cellOf(fx, fz); return { gx, gz, k: gx + ',' + gz };
  }
  place() {
    const { gx, gz, k } = this.buildTarget();
    const stack = this.building.stacks.get(k) || [];
    const reason = buildRefusal(gx, gz, stack.length);
    if (reason) { UI.toast(reason, 'bad'); this.lastBuild = { ok: false, reason }; return false; }
    const piece = PIECES[this.piece];
    if (!this.has(piece.cost)) { const [it, n] = Object.entries(piece.cost)[0]; const r = `You need ${n} ${ITEMS[it].name} — ${it === 'log' ? 'chop a tree' : 'mine a grey rock'}.`; UI.toast(r, 'bad'); this.lastBuild = { ok: false, reason: r }; return false; }
    if (this.online) { this.net.send({ t: 'build', gx, gz, m: this.piece }); this.pendingBuild = { k, piece: this.piece }; return true; }
    this.spend(piece.cost); this.building.setStack(k, [...stack, this.piece]); this.afterPlace(gx, gz);
    this.lastBuild = { ok: true, k }; this.save(); return true;
  }
  afterPlace(gx, gz) {
    const [cx, cz] = cellCenter(gx, gz);
    this.particles.burst(cx, this.building.top(gx, gz), cz, 0xd0b080, 8, 2.5, 0.4);
    // don't trap the player inside a fresh block
    const p = this.p;
    if (Math.abs(p.x - cx) < BLOCK / 2 + PR && Math.abs(p.z - cz) < BLOCK / 2 + PR) { const top = this.building.top(gx, gz); if (top > p.y) p.y = top; }
    this.refreshBuildBar();
  }
  removePiece() {
    const { gx, gz, k } = this.buildTarget();
    const stack = this.building.stacks.get(k);
    if (!stack || !stack.length) return UI.toast('Nothing to remove there.', 'bad');
    if (this.online) return this.net.send({ t: 'unbuild', gx, gz });
    const piece = stack[stack.length - 1];
    this.building.setStack(k, stack.slice(0, -1));
    for (const [it, n] of Object.entries(PIECES[piece].cost)) this.s.inv[it] = (this.s.inv[it] || 0) + n;
    this.refreshBuildBar(); this.save();
  }
  onBlocks(m) {
    const prev = (this.building.stacks.get(m.k) || []).length;
    this.building.setStack(m.k, m.s);
    if (m.by !== this.myId) return;
    const [gx, gz] = m.k.split(',').map(Number);
    if (m.s.length > prev) { this.spend(PIECES[m.s[m.s.length - 1]].cost); this.afterPlace(gx, gz); this.lastBuild = { ok: true, k: m.k }; }
    else if (m.removed) { for (const [it, n] of Object.entries(PIECES[m.removed].cost)) this.s.inv[it] = (this.s.inv[it] || 0) + n; this.refreshBuildBar(); }
    this.save();
  }

  // ---------------- grapple ----------------
  tryGrapple() {
    const p = this.p;
    if (!this.s.flags.grapple) return UI.toast('You don\'t have a grapple hook yet.', 'bad');
    let target = null;
    if (p.lock && p.lock.grapple) target = p.lock;
    else {
      let best = 1e9; const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
      for (const g of this.inDungeon ? this.dungeon.grapplePoints : []) {
        const dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz);
        if (d > 24 || d < 1.5) continue;
        const camF = -(dx * Math.sin(this.cam.yaw) + dz * Math.cos(this.cam.yaw)) / d;
        if ((dx * fx + dz * fz) / d < 0.5 && camF < 0.6) continue;
        if (d < best) { best = d; target = g; }
      }
    }
    p.mode = 'grapple'; p.mt = 0; p.gr = target ? { ...target, hit: true } : { x: p.x + Math.sin(p.ry) * 10, y: p.y + 1.5, z: p.z + Math.cos(p.ry) * 10, hit: false };
    if (target) p.ry = Math.atan2(target.x - p.x, target.z - p.z);
    else UI.toast('Nothing to latch onto.', 'bad');
  }

  // ---------------- lock-on ----------------
  toggleLock() {
    const p = this.p;
    if (p.lock) { p.lock = null; return; }
    let best = null, bs = 1e9;
    const cfx = -Math.sin(this.cam.yaw), cfz = -Math.cos(this.cam.yaw);
    const cands = this.targetables().map((e) => ({ id: e.id, x: e.x, z: e.z, e }));
    if (this.s.flags.grapple && this.inDungeon) for (const g of this.dungeon.grapplePoints) cands.push({ id: 'gp_' + g.id, x: g.x, z: g.z, grapple: true, g });
    for (const c of cands) {
      const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
      if (d > (c.grapple ? 24 : 16)) continue;
      const score = d * (1 + (1 - (dx * cfx + dz * cfz) / (d || 1)) * 1.2) + (c.grapple ? 6 : 0);
      if (score < bs) { bs = score; best = c; }
    }
    if (best) p.lock = best.grapple ? { id: best.id, grapple: true, ...best.g, gid: best.g.id } : { id: best.id };
    else UI.toast('No target nearby.', '');
  }
  lockPos() {
    const l = this.p.lock; if (!l) return null;
    if (l.grapple) return { x: l.x, y: l.y, z: l.z };
    const e = this.enemyById(l.id); if (!e || !e.alive) { this.p.lock = null; return null; }
    const v = this.views.get(l.id);
    return { x: v ? v.x : e.x, y: this.terrainH(e.x, e.z) + (ENEMY_TYPES[e.type].boss ? 3 : 1.2), z: v ? v.z : e.z };
  }

  // ---------------- stamina ----------------
  useStam(n) { this.p.stam = Math.max(0, this.p.stam - n); this.p.stamT = 0; }

  // ---------------- player update ----------------
  animName() {
    const p = this.p;
    if (p.mode === 'attack') return 'attack' + p.combo;
    if (['charge', 'spin', 'block', 'roll', 'gather', 'hurt', 'dead', 'grapple'].includes(p.mode)) return p.mode;
    if (!p.grounded) return 'jump';
    return p.speed > 6.5 ? 'run' : p.speed > 0.3 ? 'walk' : 'idle';
  }
  updatePlayer(dt) {
    const p = this.p, I = this.input;
    p.mt += dt; p.inv -= dt; p.stamT += dt;
    if (p.stamT > 0.8 && p.mode !== 'block' && p.mode !== 'charge') p.stam = Math.min(100, p.stam + 30 * dt);
    const uiBlocked = this.inDialog || UI.panelOpen() || this.fading;
    // global UI keys
    if (I.wasPressed('escape')) { if (UI.panelOpen()) this.closePanel(); else if (this.buildMode) this.toggleBuild(); }
    if (I.wasPressed('skills')) this.togglePanel('skills');
    if (I.wasPressed('bag')) this.togglePanel('bag');
    if (I.wasPressed('help')) this.togglePanel('help');
    if (I.wasPressed('chat')) { const ci = document.getElementById('chat-input'); setTimeout(() => ci.focus(), 0); if (document.pointerLockElement) document.exitPointerLock(); }
    if (this.inDialog) { if (I.wasPressed('interact') || I.wasPressed('attack') || I.wasPressed('place')) this.dialogNext?.(); }

    let mv = uiBlocked ? { x: 0, y: 0 } : I.move();
    const moving = Math.hypot(mv.x, mv.y) > 0.1;
    const lockP = this.lockPos();
    if (p.lock && lockP && Math.hypot(lockP.x - p.x, lockP.z - p.z) > 26) p.lock = null;
    // basis: camera-relative, or target-relative when locked (strafing)
    let fx, fz;
    if (lockP) { const dx = lockP.x - p.x, dz = lockP.z - p.z, d = Math.hypot(dx, dz) || 1; fx = dx / d; fz = dz / d; }
    else { fx = -Math.sin(this.cam.yaw); fz = -Math.cos(this.cam.yaw); }
    // right vector = (-fz, fx); W/S along forward, A/D along right (strafe around the target when locked)
    const wx = fx * mv.y - fz * mv.x, wz = fz * mv.y + fx * mv.x;
    const wl = Math.hypot(wx, wz);

    if (!uiBlocked && p.mode !== 'dead' && p.mode !== 'hurt' && p.mode !== 'grapple') {
      if (I.wasPressed('build')) this.toggleBuild();
      if (this.buildMode) {
        if (I.wasPressed('piece1')) this.piece = 'wood'; if (I.wasPressed('piece2')) this.piece = 'stone'; if (I.wasPressed('piece3')) this.piece = 'floor';
        if (I.wasPressed('cycle')) { const ks = Object.keys(PIECES); this.piece = ks[(ks.indexOf(this.piece) + 1) % ks.length]; }
        if (I.wasPressed('piece1') || I.wasPressed('piece2') || I.wasPressed('piece3') || I.wasPressed('cycle')) this.refreshBuildBar();
        if (I.wasPressed('place') || I.wasPressed('interact')) this.place();
        if (I.wasPressed('remove')) this.removePiece();
      }
      if (I.wasPressed('lock') && !this.buildMode) this.toggleLock();
      const free = p.mode === 'normal' || p.mode === 'block';
      if (free && !this.buildMode) {
        if (I.wasPressed('attack')) { if (this.zoneName() === 'village') UI.toast('Put that away — the village is a safe zone.', ''); else { p.mode = 'attack'; p.combo = 1; p.mt = 0; p.hitDone = false; p.queued = false; p.held = true; if (lockP) p.ry = Math.atan2(lockP.x - p.x, lockP.z - p.z); } }
        else if (I.wasPressed('roll') && p.stam >= 10 && p.grounded) { p.mode = 'roll'; p.mt = 0; this.useStam(22); p.rdx = wl > 0.1 ? wx / wl : (lockP ? -fx : Math.sin(p.ry)); p.rdz = wl > 0.1 ? wz / wl : (lockP ? -fz : Math.cos(p.ry)); }
        else if (I.wasPressed('grapple')) this.tryGrapple();
        else if (I.wasPressed('interact') && !this.inDialog) { const it = this.findInteract(); if (it) this.interact(it); }
      }
      if (p.mode === 'normal' && I.isDown('shield') && !this.buildMode) { p.mode = 'block'; p.mt = 0; }
      if (p.mode === 'block' && !I.isDown('shield')) p.mode = 'normal';
      if (p.mode === 'attack') {
        if (I.wasPressed('attack')) { if (p.mt > ATK['attack' + p.combo].dur * 0.35) p.queued = true; p.held = true; }
        if (I.wasReleased('attack')) p.held = false;
      }
      if (p.mode === 'charge' && I.wasReleased('attack')) {
        if (p.mt >= 0.8 && p.stam >= 20) { p.mode = 'spin'; p.mt = 0; p.hitDone = false; this.useStam(30); }
        else p.mode = 'normal';
      }
      if (p.mode === 'gather' && (moving || I.wasPressed('attack') || I.wasPressed('roll'))) p.mode = 'normal';
    }
    if (I.wasReleased('attack') && p.mode === 'attack') p.held = false;

    // ---- mode logic ----
    let speed = 0, dirx = 0, dirz = 0;
    switch (p.mode) {
      case 'normal': case 'block': {
        const sprint = I.isDown('sprint') && !lockP && moving && p.stam > 0 && p.mode === 'normal';
        speed = p.mode === 'block' ? 2.2 : lockP ? 4.6 : sprint ? 8.5 : 5.6;
        if (sprint) this.useStam(14 * dt);
        if (wl > 0.1) { dirx = wx / wl; dirz = wz / wl; speed *= Math.min(1, Math.hypot(mv.x, mv.y)); } else speed = 0;
        if (lockP) p.ry = lerpAngle(p.ry, Math.atan2(lockP.x - p.x, lockP.z - p.z), 1 - Math.exp(-dt * 14));
        else if (speed > 0) p.ry = lerpAngle(p.ry, Math.atan2(dirx, dirz), 1 - Math.exp(-dt * 12));
        break;
      }
      case 'attack': {
        const A = ATK['attack' + p.combo];
        if (!p.hitDone && p.mt >= A.hit) { p.hitDone = true; this.doHit('attack' + p.combo); }
        if (p.mt < A.hit) { speed = 3; dirx = Math.sin(p.ry); dirz = Math.cos(p.ry); }
        if (p.mt >= A.dur) {
          if (p.queued && p.combo < 3) { p.combo++; p.mt = 0; p.hitDone = false; p.queued = false; if (lockP) p.ry = Math.atan2(lockP.x - p.x, lockP.z - p.z); }
          else if (p.held) { p.mode = 'charge'; p.mt = 0; }
          else { p.mode = 'normal'; p.combo = 0; }
        }
        break;
      }
      case 'charge':
        speed = wl > 0.1 ? 2.4 : 0; if (speed) { dirx = wx / wl; dirz = wz / wl; }
        if (lockP) p.ry = Math.atan2(lockP.x - p.x, lockP.z - p.z); else if (speed) p.ry = lerpAngle(p.ry, Math.atan2(dirx, dirz), 0.2);
        if (p.mt > 0.8 && !p.chargeFx) { p.chargeFx = true; this.particles.burst(p.x, p.y + 1.2, p.z, 0xfff2a0, 8, 2, 0.3); }
        if (!I.isDown('attack') && p.mt > 0.05 && !I.wasReleased('attack')) { p.mode = 'normal'; }
        break;
      case 'spin':
        p.chargeFx = false;
        if (!p.hitDone && p.mt >= 0.12) { p.hitDone = true; this.doHit('spin'); }
        if (p.mt > 0.55) p.mode = 'normal';
        break;
      case 'roll': {
        const k = p.mt < 0.4 ? 1 : 0.3; speed = 11 * k; dirx = p.rdx; dirz = p.rdz;
        if (!lockP) p.ry = Math.atan2(dirx, dirz);
        if (p.mt > 0.5) p.mode = 'normal';
        break;
      }
      case 'gather': {
        const n = p.gnode, def = NODE_TYPES[n.type];
        if (Math.floor(p.mt * 1.6) !== Math.floor((p.mt - dt) * 1.6)) { this.particles.burst(n.x, this.terrainH(n.x, n.z) + 1, n.z, def.skill === 'woodcutting' ? 0x8a6a3a : 0xbbbbbb, 4, 2, 0.3); n.obj.rotation.z = 0.06; }
        n.obj.rotation.z *= 0.85;
        if (n.depleted) p.mode = 'normal';
        else if (p.mt >= def.time) { p.mode = 'normal'; this.finishGather(n); }
        break;
      }
      case 'hurt':
        p.kx *= Math.exp(-dt * 6); p.kz *= Math.exp(-dt * 6);
        if (p.mt > 0.35) p.mode = 'normal';
        break;
      case 'dead':
        if (p.mt > 2.2 && !this.respawning) { this.respawning = true; this.respawn(); setTimeout(() => (this.respawning = false), 600); }
        break;
      case 'grapple': {
        const g = p.gr;
        if (p.mt < 0.22) { /* chain flies out */ }
        else if (!g.hit) { if (p.mt > 0.45) p.mode = 'normal'; }
        else {
          const tx = g.land ? g.land.x : g.x, tz = g.land ? g.land.z : g.z;
          const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
          const sp = 22 * dt;
          if (d <= sp + 0.05) { p.x = tx; p.z = tz; p.y = this.groundAt(tx, tz, 999); p.vy = 0; p.mode = 'normal'; p.lock = null; this.tpFlag = false; }
          else { p.x += (dx / d) * sp; p.z += (dz / d) * sp; p.y += ((Math.max(this.groundAt(tx, tz, 999), 0) + 1.0) - p.y) * Math.min(1, dt * 6); p.vy = 0; }
        }
        break;
      }
    }
    if (p.mode !== 'charge') p.chargeFx = false;
    // knockback
    if (Math.abs(p.kx) + Math.abs(p.kz) > 0.05) { this.collide(p.x + p.kx * dt, p.z + p.kz * dt, false); p.kx *= Math.exp(-dt * 8); p.kz *= Math.exp(-dt * 8); }
    // horizontal movement
    if (speed > 0) {
      const wade = !this.inDungeon && p.y < 0.1 ? 0.6 : 1;
      this.collide(p.x + dirx * speed * wade * dt, p.z + dirz * speed * wade * dt, true);
    }
    p.speed = speed;
    // vertical
    if (p.mode !== 'grapple') {
      const g = this.groundAt(p.x, p.z, p.y);
      if (p.y > g + 0.02 || p.vy > 0) { p.vy -= GRAV * dt; p.y += p.vy * dt; p.grounded = false; if (p.y <= g) { p.y = g; p.vy = 0; p.grounded = true; } }
      else { if (g - p.y < STEP + 0.05) p.y = g; p.vy = 0; p.grounded = true; }
    }
    // fell into the chasm
    if (this.inDungeon && p.y < -5 && p.mode !== 'dead') {
      const cp = p.z < -36 ? CHECKPOINT : DUNGEON_START;
      this.debug.teleport(cp.x, cp.z, 0); p.ry = Math.PI; p.lock = null; p.mode = 'normal';
      UI.toast('You fell into the chasm!', 'bad'); this.hurt(1, p.x, p.z + 1); if (p.mode === 'hurt') { p.kx = p.kz = 0; }
    }
    // avatar
    this.player.root.position.set(p.x, p.y, p.z); this.player.root.rotation.y = p.ry;
    this.player.root.visible = !(p.inv > 0 && p.mode !== 'dead' && Math.sin(this.t * 40) > 0.3);
    const tool = p.mode === 'gather' ? (NODE_TYPES[p.gnode.type].skill === 'woodcutting' ? 'axe' : 'pick') : null;
    animateAvatar(this.player, { anim: this.animName(), t: p.mt, speed: speed / 5.6, charge: p.mode === 'charge' ? Math.min(1, p.mt / 0.8) : 0, tool }, dt);
    // grapple chain visuals
    if (p.mode === 'grapple') {
      const g = p.gr; const hx = p.x + Math.sin(p.ry) * 0.4, hy = p.y + 1.4, hz = p.z + Math.cos(p.ry) * 0.4;
      let f = Math.min(1, p.mt / 0.22); if (!g.hit && p.mt > 0.22) f = Math.max(0, 1 - (p.mt - 0.22) / 0.23);
      const ex = hx + (g.x - hx) * f, ey = hy + (g.y - hy) * f, ez = hz + (g.z - hz) * f;
      this.chain.visible = this.hook.visible = true;
      this.chain.position.set(hx, hy, hz); this.chain.lookAt(ex, ey, ez); this.chain.scale.set(1, 1, Math.hypot(ex - hx, ey - hy, ez - hz) || 0.01);
      this.hook.position.set(ex, ey, ez); this.hook.lookAt(ex + (ex - hx), ey + (ey - hy), ez + (ez - hz));
    } else this.chain.visible = this.hook.visible = false;
    // trail fade
    this.trailT -= dt; this.trail.material.opacity = Math.max(0, this.trailT / 0.16) * 0.55; this.trail.position.set(p.x, p.y + 1.1, p.z);
    // lock-on visuals
    const lp = this.lockPos();
    this.reticle.visible = !!lp; UI.letterbox(!!lp);
    if (lp) { this.reticle.position.set(lp.x, lp.y + (p.lock.grapple ? 1 : 1.4) + Math.sin(this.t * 6) * 0.12, lp.z); this.reticle.rotation.y = this.t * 3; this.reticle.material.color.setHex(p.lock.grapple ? 0x60e0ff : 0xffd040); }
  }

  zoneName() { return zoneAt(this.p.x, this.p.z); }

  // ---------------- camera ----------------
  updateCamera(dt) {
    const p = this.p, c = this.cam, I = this.input;
    const look = I.consumeLook(), ck = I.camKeys();
    c.yaw -= look.x * 0.0028 + ck.x * dt * 2.2; c.pitch += look.y * 0.0022 + ck.y * dt * 1.4;
    if (I.wheel) { c.dist = Math.max(4, Math.min(14, c.dist + I.wheel * 0.6)); I.wheel = 0; }
    const minP = this.inDungeon ? 0.55 : 0.05;
    c.pitch = Math.max(minP, Math.min(1.25, c.pitch));
    const lp = this.lockPos();
    const focus = new THREE.Vector3(p.x, p.y + 1.6, p.z);
    if (lp) {
      // Z-targeting camera: behind the player, offset to one side so the target stays visible
      const base = Math.atan2(p.x - lp.x, p.z - lp.z);
      if (c.lockSide === undefined || !this.wasLocked) c.lockSide = Math.sin(c.yaw - base) >= 0 ? 1 : -1;
      c.yaw = lerpAngle(c.yaw, base + 0.38 * c.lockSide, 1 - Math.exp(-dt * 6));
      c.pitch += (Math.max(c.pitch, 0.42) - c.pitch) * (1 - Math.exp(-dt * 4));
      focus.lerp(new THREE.Vector3(lp.x, lp.y, lp.z), 0.3);
    }
    if (this.phase === 'create') {
      const a = this.player.root.position;
      const wide = innerWidth > 800;
      focus.set(a.x - (wide ? Math.cos(p.ry) * 0.9 : 0), a.y + (wide ? 1.15 : 0.6), a.z + (wide ? Math.sin(p.ry) * 0.9 : 0));
      const camPos = new THREE.Vector3(a.x + Math.sin(p.ry) * 4.3, a.y + 1.6, a.z + Math.cos(p.ry) * 4.3);
      this.camera.position.copy(camPos); this.camera.lookAt(focus); return;
    }
    this.wasLocked = !!lp;
    const dist = this.inDungeon ? Math.min(c.dist, 8.5) : c.dist;
    const want = new THREE.Vector3(focus.x + Math.sin(c.yaw) * Math.cos(c.pitch) * dist, focus.y + Math.sin(c.pitch) * dist, focus.z + Math.cos(c.yaw) * Math.cos(c.pitch) * dist);
    // camera collision: pull in when trees / houses / dungeon walls are between the player and the camera
    const tHit = this.camBlock(focus, want);
    if (tHit < 1) want.lerpVectors(focus, want, Math.max(tHit - 0.06, 1.4 / dist));
    const g = this.terrainH(want.x, want.z); if (want.y < g + 0.6 && g > -20) want.y = g + 0.6;
    if (c.snap) { c.pos.copy(want); c.snap = false; }
    if (c.pos.distanceTo(want) > 30) c.pos.copy(want); else c.pos.lerp(want, 1 - Math.exp(-dt * 12));
    this.camera.position.copy(c.pos);
    if (this.shake > 0) { this.shake -= dt; this.camera.position.x += (Math.random() - 0.5) * this.shake; this.camera.position.y += (Math.random() - 0.5) * this.shake; }
    this.camera.lookAt(focus);
  }

  camBlock(f, w) {
    const dx = w.x - f.x, dz = w.z - f.z, dy = w.y - f.y; let tMin = 1;
    const list = this.inDungeon ? this.dungeon.colliders : this.world.colliders;
    const a = dx * dx + dz * dz; if (a < 1e-6) return 1;
    for (const c of list) {
      if (!c.cam || c.disabled) continue;
      let t;
      if (c.c) {
        const fx = f.x - c.x, fz = f.z - c.z; if (Math.abs(fx) > 20 || Math.abs(fz) > 20) continue;
        const b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - c.cam * c.cam;
        if (cc < 0) continue; const disc = b * b - 4 * a * cc; if (disc < 0) continue;
        t = (-b - Math.sqrt(disc)) / (2 * a);
      } else {
        if (f.x > c.minx && f.x < c.maxx && f.z > c.minz && f.z < c.maxz) continue;
        let t0 = 0, t1 = 1;
        for (const [o, d, lo, hi] of [[f.x, dx, c.minx, c.maxx], [f.z, dz, c.minz, c.maxz]]) {
          if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) { t0 = 2; break; } continue; }
          let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) { t0 = 2; break; }
        }
        t = t0;
      }
      if (t > 0 && t < tMin && f.y + dy * t < c.top) tMin = t;
    }
    return tMin;
  }

  // ---------------- HUD ----------------
  updateHUD() {
    const p = this.p;
    UI.hearts(p.hp, this.maxHp); UI.stamina(p.stam / 100, p.stam < 10);
    const z = this.zoneName();
    if (z !== this.lastZone) { this.lastZone = z; UI.zone(z === 'village' ? '🛡 Oakhollow Village · safe' : z === 'dungeon' ? '☠ The Hollow Barrow' : '🌲 The Wilds · build & fight', z); if (z === 'wild' && this.lastZoneShown === 'village') UI.toast('Entering the Wilds', ''); this.lastZoneShown = z; }
    const st = this.questStage();
    let tgt = null;
    const D = this.dungeon;
    if (st === 0 || st === 6) tgt = this.inDungeon ? { x: D.exitA.x, z: D.exitA.z } : { x: 0, z: 1.5 };
    else if (st === 1) tgt = this.inDungeon ? null : this.world.entrance;
    else if (this.inDungeon) tgt = st === 2 ? D.chest : st === 3 ? D.lever : st === 4 ? { x: D.chest.x, z: -82 } : st === 5 ? D.bossChest : null;
    else if (st >= 2 && st <= 5) tgt = this.world.entrance;
    if (tgt) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z;
      const ang = Math.atan2(dx, dz) - Math.atan2(-Math.sin(this.cam.yaw), -Math.cos(this.cam.yaw));
      UI.quest(QUEST_TEXT[st], -ang * 180 / Math.PI - 90, Math.hypot(dx, dz));
    } else UI.quest(QUEST_TEXT[st], null);
    for (const n of this.npcs) n.mark.visible = (n.id === 'elder' && (st === 0 || st === 6));
    // prompt
    let pr = null;
    if (!this.inDialog && !UI.panelOpen() && (p.mode === 'normal' || p.mode === 'block')) {
      if (this.buildMode) pr = null;
      else { const it = this.findInteract(); if (it) pr = `<kbd>${this.touch ? '✋' : 'E'}</kbd>${it.label}`; this.currentInteract = it; }
    }
    if (p.mode === 'gather') pr = `<kbd>…</kbd>${NODE_TYPES[p.gnode.type].skill === 'woodcutting' ? 'Chopping' : 'Mining'}…`;
    UI.prompt(pr);
    // ghost
    if (this.buildMode) {
      const { gx, gz, k } = this.buildTarget(), [cx, cz] = cellCenter(gx, gz), piece = PIECES[this.piece];
      const stack = this.building.stacks.get(k) || [];
      const okk = !buildRefusal(gx, gz, stack.length) && this.has(piece.cost);
      const gh = this.building.ghost; gh.geometry = this.building.geo[this.piece];
      gh.position.set(cx, this.building.top(gx, gz) + piece.h / 2, cz); gh.material.color.setHex(okk ? 0x40ff60 : 0xff4040);
    }
  }

  updateRemotes(dt) {
    const k = 1 - Math.exp(-dt * 12);
    for (const r of this.remotes.values()) {
      r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; r.ry = lerpAngle(r.ry, r.tr, k); r.at += dt;
      const sp = Math.hypot(r.tx - r.x, r.tz - r.z) * 8;
      r.av.root.position.set(r.x, r.y, r.z); r.av.root.rotation.y = r.ry;
      const a = r.a;
      animateAvatar(r.av, { anim: a, t: r.at, speed: a === 'run' ? 1.5 : a === 'walk' ? Math.max(0.6, Math.min(1, sp / 5)) : 0, tool: a === 'gather' ? 'axe' : null }, dt);
      r.label.position.set(r.x, r.y + 2.5, r.z);
    }
  }

  updateNodes() {
    if (this.online) return; const now = performance.now();
    for (const n of this.world.nodes.values()) if (n.depleted && n.until && now > n.until) this.world.setNodeDepleted(n.id, false);
  }

  // ---------------- main loop ----------------
  run() {
    document.getElementById('loading').classList.add('hidden');
    this.showCreate();
    this.cam.snap = true;
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, this.clock.getDelta()); this.t += dt; this.frameCount = (this.frameCount || 0) + 1;
      this.frame(dt);
    };
    loop();
  }
  frame(dt) {
    if (this.phase === 'play') {
      this.updatePlayer(dt); this.updateEnemies(dt); this.updateRemotes(dt); this.updateNodes(); this.sendState(dt); this.updateHUD();
    } else {
      this.p.ry = 0.4; // camera angle for the creation close-up
      this.player.root.position.set(this.p.x, this.p.y, this.p.z);
      this.player.root.rotation.y = Math.sin(this.t * 0.6) * 0.6 + 0.4;
      animateAvatar(this.player, { anim: 'idle', t: 0, speed: 0 }, dt);
    }
    for (const n of this.npcs) animateAvatar(n.av, { anim: 'idle', t: 0, speed: 0 }, dt);
    this.updateCamera(dt);
    this.world.updateWater(this.t); this.dungeon.update(this.t, dt); this.particles.update(dt);
    const tod = this.todOverride ?? ((Date.now() / 1000 / 600 + 0.12) % 1);
    this.world.setTime(tod, new THREE.Vector3(this.p.x, this.p.y, this.p.z), this.inDungeon);
    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  }
}
