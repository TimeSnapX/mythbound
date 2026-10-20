// Mythbound core game (v2): player controller, Zelda-style combat, saves + v1 migration, UI wiring, building, multiplayer glue.
// Big subsystems live in mixins: rpg.js (inventory/equipment/shops/bank), story.js (quests/dialogue), systems.js (bombs, magic, hazards…).
import * as THREE from 'three';
import {
  SPAWN, ENTRANCE, DUNGEON_START, VILLAGE, BLOCK, PIECES, PIECE_ORDER, ITEMS, GEAR, NODE_TYPES, ENEMY_TYPES, SKILLS, SKILL_NAMES,
  islandHeight, zoneAt, levelForXp, xpForLevel, v1LevelForXp, generateEnemySpawns, EnemySim, cellOf, cellCenter, pieceType, pieceRot,
  dungeonAt, inWorldBounds, MINE_START, CAMP, SAVE_VERSION, MAX_LEVEL, gatherSpeed, ALTARS, HEARTHSTONES, FADE_ECHO, SPELLS, PETS,
} from './shared.js';
import { buildAvatar, animateAvatar, SKINS, HAIR_COLORS, TUNICS, HAIR_STYLES, hex } from './avatar.js';
import { buildWorld, Particles, makeLabel } from './world.js';
import { buildDungeon, DUNGEON_SPAWNS, CHECKPOINT, dungeonHeight } from './dungeon.js';
import { buildRidge } from './ridge.js';
import { buildMine, MINE_SPAWNS, MINE_CP, mineHeight } from './mine.js';
import { EnemyView } from './enemies.js';
import { Building } from './building.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { Audio } from './audio.js';
import * as UI from './ui.js';
import { Story, NPC_DEFS } from './story.js';
import { RPG } from './rpg.js';
import { Systems } from './systems.js';
import { initCloud } from './cloud-ui.js';
import { initCoop } from './coop-ui.js';
import { zoneKey, DOWN_TIME, XP_RANGE, PUZZLE_KEYS } from './coop.js';
import { buildRegions } from './regions.js';
import { buildBelfry, buildPyramid, BELFRY_SPAWNS, PYRAMID_SPAWNS, BELFRY_CP, belfryHeight, pyramidHeight } from './belfry.js';
import { BELFRY_START, PYRAMID_START, BELFRY_ENTRANCE } from './shared.js';
import { installV3 } from './v3.js';
import { installPvP } from './pvp-session.js';

const SAVE_KEY = 'mythbound_save_v2', SAVE_KEY_V1 = 'mythbound_save_v1', SETTINGS_KEY = 'mythbound_settings';
const PR = 0.4, STEP = 0.55, GRAV = 25;
const ATK = { attack1: { dur: 0.3, hit: 0.11, mult: 1 }, attack2: { dur: 0.3, hit: 0.11, mult: 1 }, attack3: { dur: 0.42, hit: 0.17, mult: 1.5 } };
const lerpAngle = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };
const params = new URLSearchParams(location.search);
const DEFAULT_SETTINGS = { master: 0.8, music: 0.6, sfx: 0.9, muted: false, quality: 'auto', sens: 1, bigButtons: false, invertY: false };

// v1 save -> v2 save. Nothing is dropped: inventory, flags, builds, position and hearts carry over; XP is re-based so each
// skill keeps the level it had under the v1 curve (capped at 50); the sword becomes an equipped weapon item.
export function migrateSave(old) {
  if (!old || typeof old !== 'object') return null;
  if (old.v >= 2) return old;
  const s = defaultSave();
  s.name = old.name || ''; s.look = { ...s.look, ...(old.look || {}) };
  s.inv = { ...(old.inv || {}) }; s.flags = { ...(old.flags || {}) };
  s.pos = old.pos || null; s.hp = old.hp || 6; s.maxHearts = old.maxHearts || 3;
  s.blocks = Array.isArray(old.blocks) ? old.blocks : [];
  s.migratedFrom = { v: old.v || 1, levels: {} };
  for (const [k, xp] of Object.entries(old.xp || {})) {
    const L = Math.min(MAX_LEVEL, v1LevelForXp(xp || 0)); s.xp[k] = xpForLevel(L); s.migratedFrom.levels[k] = L;
  }
  const sw = old.sword && GEAR[old.sword + '_sword'] ? old.sword + '_sword' : 'wood_sword';
  s.equip.weapon = sw;
  return s;
}
export function defaultSave() {
  const xp = {}; for (const k of SKILLS) xp[k] = 0;
  return { v: SAVE_VERSION, name: '', look: { skin: 0, hair: 0, hairColor: 1, tunic: 0 }, inv: {}, gold: 0, xp, sword: 'wood',
    equip: { weapon: 'wood_sword', shield: 'driftwood_shield', ranged: null, head: null, body: null, legs: null, cape: null },
    enchant: {}, flags: {}, pos: null, hp: 6, maxHearts: 3, blocks: [], doors: [], bank: {}, chests: {}, home: { plot: null, hearth: null },
    pet: null, spell: 'wind_bolt', quick: null, capes: [], fade: 0, totalShown: 0 };
}

export class Game {
  constructor() {
    this.canvas = document.getElementById('c');
    this.settings = { ...DEFAULT_SETTINGS }; try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch {}
    this.touch = params.has('touch') ? params.get('touch') !== '0' : (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
    const quality = params.get('gfx') || (this.settings.quality !== 'auto' ? this.settings.quality : this.touch ? 'low' : 'high');
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(params.has('scale') ? +params.get('scale') : Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = quality === 'high'; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 420);
    this.world = buildWorld(this.scene, { shadows: quality === 'high' });
    this.ridge = buildRidge(this.scene, this.world, { shadows: quality === 'high' });
    this.dungeon = buildDungeon(this.scene);
    this.mine = buildMine(this.scene); this.mine.group.visible = false;
    this.r3 = buildRegions(this.scene, this.world, { shadows: quality === 'high', quality });
    this.belfry = buildBelfry(this.scene); this.belfry.group.visible = false;
    this.pyramid = buildPyramid(this.scene); this.pyramid.group.visible = false;
    this.particles = new Particles(this.scene);
    this.building = new Building(this.scene);
    this.audio = new Audio(this.settings);
    this.input = new Input(this.canvas);
    this.input.noPointerLock = params.has('nolock');
    if (this.touch) { document.body.classList.add('touch'); UI.show('#touch'); this.input.attachTouch(document.getElementById('touch')); }
    document.body.classList.toggle('bigbtn', !!this.settings.bigButtons);
    this.clock = new THREE.Clock(); this.t = 0;
    this.rng = Math.random; this.rand = () => this.rng();
    this.todOverride = params.has('tod') ? +params.get('tod') : null;
    this.cam = { yaw: 0, pitch: 0.38, dist: 7.5, pos: new THREE.Vector3(0, 20, 40) };
    this.views = new Map(); this.remotes = new Map(); this.netEnemies = new Map();
    this.hitSeen = new Map(); this.enemySpawnType = new Map([...generateEnemySpawns(), ...DUNGEON_SPAWNS, ...MINE_SPAWNS, ...BELFRY_SPAWNS, ...PYRAMID_SPAWNS].map((s) => [s.id, s.type]));
    this.phase = 'create'; this.buildMode = false; this.piece = 'wood'; this.rot = 0; this.messages = [];
    this.localSim = new EnemySim(generateEnemySpawns());
    this.msim = new EnemySim([]); this.bsim = new EnemySim([]); this.ysim = new EnemySim([]);
    this.player = buildAvatar(); this.scene.add(this.player.root);
    this.p = { x: SPAWN.x, y: 4, z: SPAWN.z, vy: 0, ry: Math.PI, mode: 'normal', mt: 0, combo: 0, queued: false, stam: 100, stamT: 9, hp: 6, inv: 0, lock: null, grounded: true, speed: 0, hitDone: false, kx: 0, kz: 0 };
    this.addFx();
    this.spawnNPCs();
    this.buildSystems();
    this.load();
    this.v3Init(); this.pvpInit();
    this.resize(); addEventListener('resize', () => this.resize());
    this.bindUI();
    initCloud(this); // cloud saves (Sign in with Google + Firestore); "coming soon" while js/firebase-config.js is a placeholder
    initCoop(this); // v2.2 online co-op (host-authoritative WebRTC, Firestore signaling, RTDB relay fallback); solo is unchanged until you host or join
    addEventListener('beforeunload', () => this.save());
    setInterval(() => this.phase === 'play' && this.save(), 5000);
    window.MB = this; // test / debug hook
    const self = this;
    this.debug = {
      teleport: (x, z, y) => { this.p.x = x; this.p.z = z; this.p.y = y ?? this.groundAt(x, z, 999); this.p.vy = 0; this.tpFlag = true; this.p.safe = { x, z }; },
      give: (item, n = 1) => { if (item === 'gold' || item === 'coins') this.s.gold += n; else this.s.inv[item] = (this.s.inv[item] || 0) + n; },
      gold: (n) => (this.s.gold += n),
      flag: (f, v = true) => { this.s.flags[f] = v; this.applyWorldState(); },
      flags: (list) => { for (const f of list) this.s.flags[f] = true; this.applyWorldState(); },
      tod: (v) => (this.todOverride = v),
      setLevel: (skill, L) => { const b = this.level(skill); this.s.xp[skill] = xpForLevel(L); if (L > b) this.onLevelUp(skill, b, L); this.updateNameTag(); },
      maxSkill: (skill = 'combat') => self.debug.setLevel(skill, MAX_LEVEL),
      maxAll: () => { for (const k of SKILLS) self.debug.setLevel(k, MAX_LEVEL); },
      seed: (n) => { let a = n; this.rng = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; },
      pet: (type, name) => this.adoptPet(type, name),
      gemBoost: (k) => (this.debugGemBoost = k),
      heal: () => (this.p.hp = this.maxHp),
      god: (on = true) => (this.god = on),
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
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 40, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    this.beacon.visible = false; this.scene.add(this.beacon);
  }
  spawnNPCs() {
    this.npcs = NPC_DEFS.map((d) => {
      const y = islandHeight(d.x, d.z);
      const av = buildAvatar(d.look); av.root.position.set(d.x, y, d.z); av.root.rotation.y = d.ry; this.scene.add(av.root);
      const label = makeLabel(d.name, '#ffe9a8', 0.85); label.position.set(d.x, y + 2.4, d.z); this.scene.add(label);
      const mark = makeLabel('!', '#ffd040', 1.6); mark.position.set(d.x, y + 3.1, d.z); mark.visible = false; this.scene.add(mark);
      const qmark = makeLabel('?', '#80e0ff', 1.6); qmark.position.copy(mark.position); qmark.visible = false; this.scene.add(qmark);
      this.world.colliders.push({ c: 1, x: d.x, z: d.z, r: 0.5 });
      return { ...d, av, mark, qmark, y, ry0: d.ry, phase: Math.random() * 10 };
    });
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.fov = w < h ? 72 : 60; this.camera.updateProjectionMatrix();
  }

  // ---------------- save / load ----------------
  defaultSave() { return defaultSave(); }
  load() {
    let s = null, from = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
    if (!s) { try { const o = JSON.parse(localStorage.getItem(SAVE_KEY_V1)); if (o && o.name) { s = migrateSave(o); from = 1; } } catch {} }
    this.hasSave = !!(s && s.name);
    const d = defaultSave();
    this.s = Object.assign(d, s || {});
    this.s.xp = Object.assign(defaultSave().xp, this.s.xp || {}); this.s.equip = Object.assign(defaultSave().equip, this.s.equip || {});
    this.s.home ||= { plot: null, hearth: null }; this.s.capes ||= []; this.s.bank ||= {}; this.s.chests ||= {}; this.s.enchant ||= {};
    this.migrated = from;
  }
  save() {
    if (!this.s.name || this.phase !== 'play') return;
    const inD = zoneAt(this.p.x, this.p.z) === 'dungeon';
    if (inD) this.s.pos = this.dungeonId === 'mine' ? { x: this.ridge.mineEntrance.x - 4, z: this.ridge.mineEntrance.z } : { x: ENTRANCE.x, z: ENTRANCE.z + 5 };
    else this.s.pos = { x: +this.p.x.toFixed(2), z: +this.p.z.toFixed(2) };
    this.s.hp = this.p.hp; this.s.v = SAVE_VERSION; this.s.savedAt = Date.now(); this.s.playtime = +(this.s.playtime || 0).toFixed(1);
    if (!this.online) { this.s.blocks = this.building.serialize(); this.s.doors = [...this.building.open]; }
    if (this.noSave) return; // a cloud save is being applied (page reloading)
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.s)); } catch {}
    this.cloud?.markDirty();
  }
  // ---------------- cloud saves (see cloud.js / cloud-ui.js) ----------------
  saveSummary(s) { return { characterName: s.name || '', totalLevel: SKILLS.reduce((a, k) => a + levelForXp((s.xp || {})[k] || 0), 0), playtime: Math.round(s.playtime || 0), version: s.v || 1 }; }
  // This device's save as a cloud document (null when there is no named save). Uses the exact stored JSON string.
  localSaveDoc(device) {
    let raw = null, s = null;
    try { raw = localStorage.getItem(SAVE_KEY); s = JSON.parse(raw); } catch {}
    if (!s || !s.name) { if (this.hasSave && this.s.name) { s = this.s; raw = JSON.stringify(s); } else return null; } // e.g. a migrated v1 save not yet re-saved
    return { data: raw, ...this.saveSummary(s), clientUpdatedAt: s.savedAt || 0, device };
  }
  // Use a cloud save on this device. Runs through the same v1 -> v2 migration as local saves.
  // The save it replaces is kept in localStorage under mythbound_save_v2_before_cloud.
  applyCloudSave(data) {
    let o, s; try { o = JSON.parse(data); s = migrateSave(o); } catch { return false; }
    if (!s || !s.name) return false;
    try { const cur = localStorage.getItem(SAVE_KEY); if (cur && cur !== data) localStorage.setItem(SAVE_KEY + '_before_cloud', cur); localStorage.setItem(SAVE_KEY, s === o ? data : JSON.stringify(s)); } catch { return false; }
    if (this.phase === 'play') { this.noSave = true; UI.banner('Cloud save loaded', 'Restarting…'); setTimeout(() => location.reload(), 600); return true; }
    this.load(); if (o.v !== s.v) this.migrated = 1; this.showCreate(); return true;
  }
  saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch {} this.audio.apply(); document.body.classList.toggle('bigbtn', !!this.settings.bigButtons); }
  get maxHp() { return Math.min(20, this.s.maxHearts + Math.floor((this.level('combat') - 1) / 3)) * 2; }
  level(skill) { return levelForXp(this.s.xp[skill] || 0); }
  // co-op guests see the host's dungeon puzzle state (levers, rails, bosses); chests stay personal
  worldFlag(k) { const H = this.coopGuest && this.coop?.hostPuzzle; return H && PUZZLE_KEYS.includes(k) ? !!H[k] : !!this.s.flags[k]; }
  mineFlags() { const H = this.coopGuest && this.coop?.hostPuzzle; return H ? { ...this.s.flags, m_switch: !!H.m_switch, q3_cart: !!H.q3_cart, q3_bridge: !!H.q3_bridge, q3_boss: !!H.q3_boss } : this.s.flags; }
  dstate() { const f = this.s.flags; return { chest: f.grapple, lever: this.worldFlag('lever'), boss: this.worldFlag('boss'), bossChest: f.shard }; }
  applyWorldState() {
    const f = this.s.flags;
    this.dungeon.setState(this.dstate()); this.mine.setState(this.mineFlags());
    for (const h of HEARTHSTONES) if (h.flag) this.ridge.setHearthLit(h.id, !!f[h.flag]);
    for (const fp of this.ridge.fog.values()) this.ridge.setFogCleared(fp.id, this.fogCleared(fp));
    for (const s of this.ridge.secrets.values()) this.ridge.setSecret(s.id, !!f[s.id + '_b'], !!f[s.id + '_o']);
    UI.show('#t-grapple', !!f.grapple); UI.show('#t-bomb', !!f.q3_bombs || (this.s.inv.bomb > 0));
    UI.show('#t-bow', !!this.s.equip.ranged); UI.show('#t-spell', this.level('magic') > 1 || Object.keys(this.s.inv).some((k) => ITEMS[k]?.rune));
  }

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
        b.onclick = () => { L[key] = i; refresh(); this.audio.play('ui'); }; box.appendChild(b);
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
      this.s = defaultSave(); this.s.name = n; this.s.look = { ...L }; this.start(true);
    };
    document.getElementById('cc-new-btn').onclick = () => { UI.show('#cc-continue', false); UI.show('#cc-form'); this.hasSave = false; nameEl.value = ''; refresh(); nameEl.focus(); };
    document.getElementById('cc-cont-btn').onclick = () => this.start(false);
    document.getElementById('cc-mode').textContent = this.serverUrl ? `Server: ${this.serverUrl}` : 'Single player · progress saves on this device.';
    this.player.setLook({ ...L, sword: this.s.sword });
    refresh();
    this.p.x = 3; this.p.z = 24; this.p.y = islandHeight(3, 24); this.p.ry = 0.5;
  }

  async start(fresh) {
    UI.show('#create', false); UI.show('#hud');
    this.player.setLook({ ...this.s.look, sword: this.s.sword });
    this.phase = 'play';
    this.applyGear();
    const pos = this.s.pos || SPAWN;
    this.p.x = pos.x; this.p.z = pos.z; this.p.y = this.groundAt(pos.x, pos.z, 999); this.p.ry = Math.PI; this.cam.yaw = 0;
    this.p.hp = Math.min(this.maxHp, this.s.hp || this.maxHp);
    if (!this.online) { this.building.clear(); for (const [k, arr] of this.s.blocks || []) this.building.setStack(k, arr); for (const key of this.s.doors || []) { const [k, i] = key.split('#'); if (this.building.stacks.get(k)) this.building.toggleDoor(k, +i); } }
    this.applyWorldState(); this.resetDungeonSim(); this.resetMineSim();
    this.spawnPet(); this.drawPlot(); this.updateNameTag();
    UI.chatLine(null, `Welcome to Mythbound, ${this.s.name}! Press H for controls.`, 'sys');
    if (this.migrated) { UI.chatLine(null, 'Your v1 save was upgraded to v2: items, builds, quest progress and skill levels were kept.', 'sys'); setTimeout(() => UI.banner('Welcome back!', 'Your legend continues in Mythbound v2'), 600); }
    else if (fresh) setTimeout(() => UI.banner('Mythbound', 'Speak with Elder Maren to begin'), 400);
    if (this.serverUrl) await this.connect();
    else UI.netBadge('Solo · offline', 'offline');
    this.save();
  }
  // ---------------- co-op (see coop.js) ----------------
  // Guest: the host welcomed us. Show the host's world (enemies, nodes, builds, puzzle state); our own save is not touched.
  coopEnterHost(m, C) {
    if (this.buildMode) this.toggleBuild();
    this.closePanel?.(); this.p.lock = null;
    this.coopGuest = true; this.online = true; this.myId = C.me; this.net = { send: (x) => C.toHost(x) };
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    for (const q of m.players || []) this.addRemote({ ...q, name: String(q.name || '').slice(0, 16) });
    this.building.clear(); for (const [k, arr] of m.blocks || []) if (typeof k === 'string' && Array.isArray(arr)) this.building.setStack(k, arr);
    for (const key of m.doors || []) { const [k, i] = String(key).split('#'); if (this.building.stacks.get(k)) this.building.toggleDoor(k, +i); }
    for (const n of this.world.nodes.values()) if (n.depleted) this.world.setNodeDepleted(n.id, false);
    for (const id of m.nodes || []) this.world.setNodeDepleted(id, true);
    for (const v of this.views.values()) v.dispose(); this.views.clear(); this.netEnemies.clear(); this.netProj = [];
    this.applyEnemySnap(m.e || []);
    C.hostPuzzle = m.puzzle || {}; C.hostPlot = m.plot || null; C.allowBuild = !!m.perms?.build;
    this.applyWorldState(); this.drawPlot();
    const y = Number.isFinite(m.you?.x) ? this.fade(() => { this.debug.teleport(m.you.x, m.you.z); this.cam.snap = true; }) : null;
    UI.netBadge(`Co-op · ${C.via === 'relay' ? 'relay' : 'direct'}`, 'online');
    UI.banner(`${C.lobby?.hostName || 'Your friend'}'s world`, 'Co-op · your own character, items and save');
    UI.chatLine(null, `Joined ${C.lobby?.hostName || 'the host'}'s world. Press Enter to chat. Your progress keeps saving to your own save.`, 'sys');
    this.onCoopChange?.(); this.save();
  }
  // Guest: back to our own world (host left, link dropped, or we left). Progress was saved all along; save again now.
  coopReturnHome(msg) {
    this.coopGuest = false; this.online = false; this.net = null; this.myId = null; this.netProj = [];
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    if (this.buildMode) this.toggleBuild();
    for (const v of this.views.values()) v.dispose(); this.views.clear(); this.netEnemies.clear();
    this.localSim = new EnemySim(generateEnemySpawns()); this.resetDungeonSim(); this.resetMineSim();
    this.building.clear(); for (const [k, arr] of this.s.blocks || []) this.building.setStack(k, arr);
    for (const key of this.s.doors || []) { const [k, i] = key.split('#'); if (this.building.stacks.get(k)) this.building.toggleDoor(k, +i); }
    for (const n of this.world.nodes.values()) if (n.depleted) this.world.setNodeDepleted(n.id, false);
    if (this.p.mode === 'dead') { this.p.mode = 'normal'; this.p.hp = Math.max(2, Math.ceil(this.maxHp / 2)); this.downedT = 0; }
    if (this.inDungeon) { const mine = this.dungeonId === 'mine'; const pt = mine ? { x: this.ridge.mineEntrance.x - 4, z: this.ridge.mineEntrance.z } : { x: ENTRANCE.x, z: ENTRANCE.z + 5 }; this.debug.teleport(pt.x, pt.z); }
    this.applyWorldState(); this.drawPlot();
    UI.netBadge('Solo · offline', 'offline');
    UI.banner('Back in your own world', 'Progress saved');
    UI.chatLine(null, msg + ' Your progress is saved.', 'sys');
    this.save(); this.cloud?.flush();
    this.onCoopChange?.();
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
    for (const [id, x, z, ry, state, st, hp, alive, kind, atk, max, t] of list) {
      let e = this.netEnemies.get(id);
      const type = this.enemySpawnType.get(id) || (ENEMY_TYPES[t] ? t : null); if (!type) continue;
      if (!e) { e = { id, type, max: ENEMY_TYPES[type].hp }; this.netEnemies.set(id, e); }
      if (e.state !== state) e.st = st;
      Object.assign(e, { x, z, ry, state, hp, alive: !!alive, kind, atk });
      if (Number.isFinite(max) && max > 0) e.max = max; // co-op: bosses scale with party size
    }
  }
  // co-op guest: the host reports a hit / kill. Kill XP goes to everyone nearby; loot is rolled on each player's own device.
  coopEnemyHit(m) {
    const e = this.netEnemies.get(m.id);
    if (e) { e.hp = m.hp; if (Number.isFinite(m.max)) e.max = m.max; if (m.killed) { e.alive = false; e.state = 'dead'; e.st = 0; } if (m.flipped) { e.state = 'flipped'; e.st = 0; } if (m.stunned) { e.state = 'stunned'; e.st = 0; } }
    const mineHit = m.by === this.myId, p = this.p;
    const near = Number.isFinite(m.x) && zoneKey(p.x, p.z) === zoneKey(m.x, m.z) && Math.hypot(m.x - p.x, m.z - p.z) < XP_RANGE;
    const r = { ok: true, hp: m.hp, blocked: !!m.blocked, killed: !!m.killed, flipped: !!m.flipped, stunned: !!m.stunned };
    if ((r.flipped || r.stunned || r.blocked) && !mineHit) { const v = this.views.get(m.id); v?.flash(r.blocked ? 0x4466ff : 0xffd040); return; }
    this.onEnemyDamaged(m.id, r, r.killed ? near : mineHit, mineHit ? this.pendingSkill || 'combat' : 'combat');
  }
  addRemote(p) {
    if (p.id === this.myId || this.remotes.has(p.id)) return;
    const av = buildAvatar(p.look); this.scene.add(av.root);
    const label = makeLabel(p.name, '#bfe4ff', 0.85); this.scene.add(label);
    this.remotes.set(p.id, { id: p.id, name: p.name, av, label, x: p.x, y: p.y, z: p.z, ry: p.ry || 0, tx: p.x, ty: p.y, tz: p.z, tr: p.ry || 0, a: p.a || 'idle', at: 0, host: !!p.host });
  }
  // co-op: a new position sample for a remote player (interpolated in updateRemotes with a small delay)
  remoteSample(id, x, y, z, ry, a, dead) {
    const r = this.remotes.get(id); if (!r || ![x, y, z].every(Number.isFinite)) return;
    const t = performance.now(); r.buf ||= [];
    const last = r.buf[r.buf.length - 1];
    if (last) r.iv = r.iv ? r.iv * 0.8 + (t - last.t) * 0.2 : t - last.t;
    if (Math.hypot(x - r.tx, z - r.tz) > 15) { r.buf.length = 0; r.x = x; r.y = y; r.z = z; } // teleport: snap
    r.buf.push({ t, x, y, z, ry: Number.isFinite(ry) ? ry : r.tr }); if (r.buf.length > 24) r.buf.shift();
    r.tx = x; r.ty = y; r.tz = z; r.tr = Number.isFinite(ry) ? ry : r.tr;
    a = typeof a === 'string' ? a.slice(0, 12) : 'idle'; if (r.a !== a) { r.a = a; r.at = 0; }
    r.dead = !!dead;
  }
  removeRemote(id) { const r = this.remotes.get(id); if (!r) return; this.scene.remove(r.av.root); this.scene.remove(r.label); this.remotes.delete(id); }
  sendState(dt) {
    if (!this.online) return;
    this.sendT = (this.sendT || 0) + dt;
    const iv = this.coopGuest ? 1 / (this.coop.via === 'relay' ? 4 : 12) : 0.1; // co-op: 12 Hz direct, 4 Hz over the relay
    if (this.sendT < iv && !this.tpFlag) return;
    this.sendT = 0;
    const p = this.p;
    this.net.send({ t: 'state', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), ry: +p.ry.toFixed(2), a: this.animName(), dead: p.mode === 'dead', sword: this.s.sword, tp: this.tpFlag ? 1 : 0, hp: p.hp, mhp: this.maxHp, mo: this.mounted ? 1 : 0 });
    this.tpFlag = false;
  }

  // ---------------- UI wiring ----------------
  bindUI() {
    const on = (id, kind) => (document.getElementById(id).onclick = () => { this.audio.play('ui'); this.togglePanel(kind); });
    on('btn-skills', 'skills'); on('btn-bag', 'bag'); on('btn-help', 'help'); on('btn-journal', 'journal'); on('btn-spells', 'spells'); on('btn-settings', 'settings');
    const panel = document.getElementById('panel');
    panel.addEventListener('click', (e) => {
      const q = (sel) => e.target.closest(sel);
      let b;
      if (q('[data-close]')) return this.closePanel();
      if ((b = q('[data-recipe]'))) return this.craft(b.dataset.recipe);
      if ((b = q('[data-open]'))) return this.openPanel(b.dataset.open);
      if ((b = q('[data-cape]'))) { this.setCape(b.dataset.cape || null); return this.openPanel('capes'); }
      if ((b = q('[data-item]'))) { const k = b.dataset.item; if (this.panelKind === 'bag') { document.getElementById('itemmenu').innerHTML = UI.itemMenuHtml(this, k); } return; }
      if ((b = q('[data-act-item]'))) { const k = b.dataset.k, a = b.dataset.actItem; if (a === 'equip') this.equip(k); if (a === 'eat') this.eat(k); if (a === 'quick') { this.s.quick = k; UI.toast(`Quick-slot: ${ITEMS[k].name}`, ''); } if (a === 'drop') { this.s.inv[k]--; if (!this.s.inv[k]) delete this.s.inv[k]; this.dropLoot(this.p.x + Math.sin(this.p.ry), this.p.y, this.p.z + Math.cos(this.p.ry), k, 1).t = -2; } this.applyWorldState(); this.save(); return this.openPanel('bag'); }
      if ((b = q('[data-unequip]'))) { if (b.dataset.unequip) { this.unequip(b.dataset.unequip); this.save(); this.openPanel('bag'); } return; }
      const shop = this.panelKind?.startsWith('shop:') && this.panelKind.slice(5);
      if ((b = q('[data-buy]'))) return this.buy(shop, b.dataset.buy);
      if ((b = q('[data-sell]'))) return this.sell(shop, b.dataset.sell, e.shiftKey);
      if (q('[data-sellall]')) { this.sellJunk(shop); return this.openPanel(this.panelKind); }
      if ((b = q('[data-deposit]'))) { this.bankDeposit(b.dataset.deposit); this.save(); return this.openPanel('bank'); }
      if ((b = q('[data-withdraw]'))) { this.bankWithdraw(b.dataset.withdraw, e.shiftKey ? Infinity : 1); this.save(); return this.openPanel('bank'); }
      if (q('[data-depositall]')) { this.bankDepositAll(); this.save(); return this.openPanel('bank'); }
      if (q('[data-withdrawall]')) { this.bankWithdrawAll(); this.save(); return this.openPanel('bank'); }
      const ck = this.panelKind?.startsWith('chest:') && this.panelKind.slice(6);
      if ((b = q('[data-cdeposit]'))) { this.chestMove(ck, b.dataset.cdeposit, true); this.save(); return this.openPanel(this.panelKind); }
      if ((b = q('[data-cwithdraw]'))) { this.chestMove(ck, b.dataset.cwithdraw, false); this.save(); return this.openPanel(this.panelKind); }
      if ((b = q('[data-spell]'))) { const sp = SPELLS.find((x) => x.id === b.dataset.spell); if (sp && this.level('magic') >= sp.level) { this.s.spell = sp.id; UI.show('#t-spell', true); } else UI.toast(`Requires Magic level ${sp.level}.`, 'bad'); return this.openPanel('spells'); }
      if ((b = q('[data-bind]'))) return this.bindRunes(b.dataset.bind);
      if ((b = q('[data-petname]'))) return this.adoptPet(b.dataset.petname, document.getElementById('pet-name').value.trim());
    });
    panel.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'bank-q') { const v = t.value; this.openPanel('bank', v); const n = document.getElementById('bank-q'); n.focus(); n.setSelectionRange(v.length, v.length); return; }
      if (t.dataset.set) { const k = t.dataset.set; this.settings[k] = t.type === 'checkbox' ? t.checked : t.tagName === 'SELECT' ? t.value : +t.value; const o = t.parentElement.querySelector('output'); if (o) o.textContent = k === 'sens' ? this.settings[k] + '×' : Math.round(this.settings[k] * 100) + '%'; this.saveSettings(); }
    });
    panel.addEventListener('change', (e) => { const t = e.target; if (t.dataset.set && (t.type === 'checkbox' || t.tagName === 'SELECT')) { this.settings[t.dataset.set] = t.type === 'checkbox' ? t.checked : t.value; this.saveSettings(); } });
    panel.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && e.target.id === 'pet-name') panel.querySelector('[data-petname]')?.click(); if (e.key === 'Escape') this.closePanel(); });
    document.getElementById('buildbar').addEventListener('click', (e) => { const s = e.target.closest('[data-piece]'); if (s) { this.piece = s.dataset.piece; this.refreshBuildBar(); } });
    const ci = document.getElementById('chat-input');
    ci.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const t = ci.value.trim(); if (t) this.sendChat(t); ci.value = ''; ci.blur(); e.preventDefault(); }
      if (e.key === 'Escape') ci.blur();
      e.stopPropagation();
    });
  }
  sendChat(text) {
    if (this.coop?.active) return this.coop.chat(text);
    if (this.online) this.net.send({ t: 'chat', text });
    else { UI.chatLine(this.s.name, text, 'me'); UI.chatLine(null, '(Solo mode — nobody else can hear you.)', 'sys'); }
  }
  togglePanel(kind) { if (this.panelKind === kind && UI.panelOpen()) return this.closePanel(); this.openPanel(kind); }
  openPanel(kind, arg) {
    this.panelKind = kind;
    if (kind === 'skills') UI.panel(UI.skillsHtml(this), 'wide');
    else if (kind === 'bag') UI.panel(UI.bagHtml(this), 'wide');
    else if (kind === 'help') UI.panel(UI.HELP_HTML, 'wide');
    else if (kind === 'journal') UI.panel(UI.journalHtml(this));
    else if (kind === 'settings') UI.panel(UI.settingsHtml(this.settings, this.cloudUI?.html() || ''));
    else if (kind === 'spells') UI.panel(UI.spellsHtml(this));
    else if (kind === 'capes') UI.panel(UI.capesHtml(this));
    else if (kind === 'bank') UI.panel(UI.bankHtml(this, arg || ''), 'wide');
    else if (kind.startsWith('shop:')) UI.panel(UI.shopHtml(this, kind.slice(5)), 'wide');
    else if (kind.startsWith('chest:')) UI.panel(UI.chestHtml(this, kind.slice(6)), 'wide');
    else if (kind.startsWith('altar:')) UI.panel(UI.altarHtml(this, ALTARS.find((a) => a.id === kind.slice(6))));
    else UI.panel(UI.stationHtml(this, kind), 'wide');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closePanel() { UI.panel(null); this.panelKind = null; }
  refreshBuildBar() {
    const pl = this.s.home?.plot;
    UI.buildBar(this.buildMode, this.piece, this.rot, this.s.inv, pl ? `🏠 Home plot claimed${this.s.home.hearth ? ' · Hearthstone set' : ' · build a Hearthstone on it to respawn there'}` : `No home plot yet — press P / 🏠 to claim one here (${100} coins). 🪙 ${this.s.gold}`);
  }

  // ---------------- skills ----------------
  addXp(skill, n) {
    if (!n) return;
    const before = this.level(skill); this.s.xp[skill] = Math.min(xpForLevel(MAX_LEVEL) * 2, (this.s.xp[skill] || 0) + n);
    UI.toast(`+${n} ${SKILL_NAMES[skill]} XP`, 'xp');
    const after = this.level(skill);
    if (after > before) {
      const heart = skill === 'combat' && Math.floor((after - 1) / 3) > Math.floor((before - 1) / 3) && this.maxHp < 40;
      UI.banner(`${SKILL_NAMES[skill]} level ${after}!`, heart ? 'Your heart grows stronger (+1 heart)' : 'Level up!');
      this.particles.burst(this.p.x, this.p.y + 1.5, this.p.z, 0xffd040, 24, 5, 1); this.audio.play('level');
      if (skill === 'combat') this.p.hp = this.maxHp;
      this.onLevelUp(skill, before, after);
      if (skill === 'magic') UI.show('#t-spell', true);
    }
  }
  // ---------------- terrain / collision ----------------
  get inDungeon() { return zoneAt(this.p.x, this.p.z) === 'dungeon'; }
  get dungeonId() { return this.inDungeon ? dungeonAt(this.p.x) : null; }
  get D() { const d = this.dungeonId; return d === 'mine' ? this.mine : d === 'belfry' ? this.belfry : d === 'pyramid' ? this.pyramid : this.dungeon; }
  dungeonObj(d) { return d === 'mine' ? this.mine : d === 'belfry' ? this.belfry : d === 'pyramid' ? this.pyramid : this.dungeon; }
  terrainH(x, z) { if (zoneAt(x, z) !== 'dungeon') return islandHeight(x, z); const d = dungeonAt(x); return d === 'mine' ? mineHeight(x, z) : d === 'belfry' ? belfryHeight(x, z) : d === 'pyramid' ? pyramidHeight(x, z) : dungeonHeight(x, z); }
  groundAt(x, z, feetY) {
    let g = this.terrainH(x, z);
    if (zoneAt(x, z) !== 'dungeon') for (const c of this.building.columnsAround(x, z, PR * 0.6)) if (c.top <= feetY + STEP && c.top > g) g = c.top;
    return g;
  }
  collide(nx, nz, moving) {
    const p = this.p; const inD = zoneAt(nx, nz) === 'dungeon';
    const list = inD ? this.dungeonObj(dungeonAt(nx)).colliders : this.world.colliders;
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
      if (!inWorldBounds(nx, nz)) { nx = p.x; nz = p.z; }
    }
    p.x = nx; p.z = nz;
    if (step && moving && p.grounded) { p.vy = 9; p.grounded = false; }
  }

  // ---------------- enemies ----------------
  // co-op host: don't reset a dungeon that friends are still fighting in
  canResetDungeon(id) { return !(this.coop?.isHost && this.coop.joinedPeers.some((q) => zoneKey(q.x, q.z) === id)); }
  resetDungeonSim() {
    const spawns = DUNGEON_SPAWNS.filter((s) => !(s.id === 'd_warden' && this.s.flags.boss));
    this.dsim = new EnemySim(spawns, { height: dungeonHeight, blocked: (x, z) => this.dungeon.blocked(x, z), respawn: false });
    for (const [id, v] of this.views) if (id.startsWith('d_')) { v.dispose(); this.views.delete(id); }
    this.coop?.applyBossScale();
  }
  resetMineSim() {
    const spawns = MINE_SPAWNS.filter((s) => !(s.id === 'm_magmaw' && this.s.flags.q3_boss));
    this.msim = new EnemySim(spawns, { height: mineHeight, blocked: (x, z) => this.mine.blocked(x, z), respawn: false });
    for (const [id, v] of this.views) if (id.startsWith('m_')) { v.dispose(); this.views.delete(id); }
    this.coop?.applyBossScale();
  }
  resetV3Sim(which) {
    const B = which === 'belfry', f = this.s.flags;
    const spawns = (B ? BELFRY_SPAWNS : PYRAMID_SPAWNS).filter((s) => !(s.id === 'b_keeper' && f.bf_boss) && !(s.id === 'b_vael' && f.bf_vael));
    const D = B ? this.belfry : this.pyramid, sim = new EnemySim(spawns, { height: B ? belfryHeight : pyramidHeight, blocked: (x, z) => D.blocked?.(x, z) || false, respawn: false });
    if (B) this.bsim = sim; else this.ysim = sim;
    const pre = B ? 'b_' : 'y_'; for (const [id, v] of this.views) if (id.startsWith(pre)) { v.dispose(); this.views.delete(id); }
    this.coop?.applyBossScale();
  }
  overworldEnemies() { return this.online ? this.netEnemies : this.localSim.enemies; }
  allEnemies() { const out = []; if (this.coopGuest) { for (const e of this.netEnemies.values()) out.push(e); return out; } for (const e of this.overworldEnemies().values()) out.push(e); for (const e of this.dsim.enemies.values()) out.push(e); for (const e of this.msim.enemies.values()) out.push(e); for (const e of this.bsim.enemies.values()) out.push(e); for (const e of this.ysim.enemies.values()) out.push(e); return out; }
  enemyById(id) { if (this.coopGuest) return this.netEnemies.get(id); const s = this.simFor(id); return s === this.localSim ? this.overworldEnemies().get(id) : s.enemies.get(id); }
  simFor(id) { return id.startsWith('d_') ? this.dsim : id.startsWith('m_') ? this.msim : id.startsWith('b_') ? this.bsim : id.startsWith('y_') ? this.ysim : this.localSim; }
  // co-op host with friends connected: every sim runs for everyone in its zone, events are tagged with their zone
  updateEnemiesHost(dt) {
    const C = this.coop, myZ = zoneKey(this.p.x, this.p.z), evs = [];
    const all = [{ id: 'me', x: this.p.x, z: this.p.z, dead: this.p.mode === 'dead' }];
    for (const q of C.joinedPeers) if (q.has) all.push({ id: q.uid, x: q.x, z: q.z, dead: q.dead });
    const run = (sim, zk, always) => { const ps = all.filter((p) => zoneKey(p.x, p.z) === zk); if (!ps.length && !always) return; for (const ev of sim.update(dt, ps)) { ev.zn = zk; evs.push(ev); } };
    run(this.localSim, 'ow', true); run(this.dsim, 'barrow'); run(this.msim, 'mine'); run(this.bsim, 'belfry'); run(this.ysim, 'pyramid');
    for (const ev of evs) if (ev.zn === myZ) this.handleEnemyEvent(ev);
    C.hostEvents(evs);
  }
  updateEnemies(dt) {
    const me = [{ id: 'me', x: this.p.x, z: this.p.z, dead: this.p.mode === 'dead' }];
    if (this.coopGuest) { for (const e of this.netEnemies.values()) e.st += dt; }
    else if (this.coop?.isHost && this.coop.joinedPeers.length) this.updateEnemiesHost(dt);
    else {
      if (!this.online) for (const ev of this.localSim.update(dt, me)) this.handleEnemyEvent(ev);
      else for (const e of this.netEnemies.values()) e.st += dt;
      if (this.dungeonId === 'barrow') for (const ev of this.dsim.update(dt, me)) this.handleEnemyEvent(ev);
      if (this.dungeonId === 'mine') for (const ev of this.msim.update(dt, me)) this.handleEnemyEvent(ev);
      if (this.dungeonId === 'belfry') for (const ev of this.bsim.update(dt, me)) this.handleEnemyEvent(ev);
      if (this.dungeonId === 'pyramid') for (const ev of this.ysim.update(dt, me)) this.handleEnemyEvent(ev);
    }
    for (const e of this.allEnemies()) {
      let v = this.views.get(e.id);
      if (!v) { v = new EnemyView(this.scene, e); this.views.set(e.id, v); }
      const far = Math.abs(e.x - this.p.x) + Math.abs(e.z - this.p.z) > 110;
      v.root.visible = !far; if (far) { v.ring.visible = false; if (v.lane) v.lane.visible = false; continue; }
      v.update(e, dt, this.t, (x, z) => this.terrainH(x, z), this.camera, this.p.lock && this.p.lock.id === e.id);
    }
    // fireballs from Cinder Imps
    this.fireballs ||= new Map();
    const live = new Set();
    const projs = this.coopGuest ? (this.netProj || []).map(([key, x, z]) => ({ key, x, z })) : [this.localSim, this.msim, this.bsim, this.ysim].flatMap((sim) => sim.proj.map((q) => ({ key: q.n + ':' + q.id, x: q.x, z: q.z })));
    for (const q of projs) {
      live.add(q.key);
      let m = this.fireballs.get(q.key);
      if (!m) { m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: 0xff6a10 })); this.scene.add(m); this.fireballs.set(q.key, m); }
      m.position.set(q.x, this.terrainH(q.x, q.z) + 1.2, q.z); m.rotation.y += dt * 8;
    }
    for (const [k, m] of this.fireballs) if (!live.has(k)) { this.scene.remove(m); this.fireballs.delete(k); }
  }
  handleEnemyEvent(ev) {
    if (ev.t === 'fire') this.audio.play('fire');
    const bt = ev.boss || this.enemyById(ev.id || '')?.type || this.enemySpawnType.get(ev.id);
    const isMag = !bt || bt === 'magmaw';
    if (ev.t === 'roar') { this.audio.play('roar'); if (isMag) UI.banner('Magmaw, the Furnace Worm', 'Bomb its open maw!', 'boss'); else if (bt !== 'vael' && ENEMY_TYPES[bt]?.boss) UI.banner(ENEMY_TYPES[bt].name, ENEMY_TYPES[bt].hint || 'Watch for the glowing tell, then roll!', 'boss'); }
    if (ev.t === 'phase') { this.shake = 0.5; this.audio.play('roar'); UI.toast(isMag ? (ev.phase === 3 ? 'Magmaw is enraged — the ground erupts beneath you!' : 'Magmaw thrashes and dives deeper…') : `${ENEMY_TYPES[bt]?.name || 'The boss'} enters phase ${ev.phase}!${bt === 'vael' ? ' Ink lines sweep the floor. Roll through them!' : ''}`, 'bad'); }
    if (ev.t !== 'hit') return;
    const p = this.p;
    if (p.mode === 'dead') return;
    const key = ev.id; if (this.hitSeen.get(key) === ev.atk) return;
    const d = Math.hypot(p.x - ev.x, p.z - ev.z);
    if (ev.slam || ev.erupt) { this.particles.burst(ev.x, this.terrainH(ev.x, ev.z) + 0.2, ev.z, ev.erupt ? 0xff6020 : 0x8a8070, 18, 5, 0.6); this.shake = 0.35; }
    if (d > ev.r + PR) return;
    this.hitSeen.set(key, ev.atk);
    if (p.mode === 'roll' && p.mt > 0.03 && p.mt < 0.42) { this.lastDodge = this.t; return; } // i-frames
    if (p.inv > 0) return;
    const ax = ev.sx - p.x, az = ev.sz - p.z, al = Math.hypot(ax, az) || 1;
    const facing = Math.sin(p.ry) * (ax / al) + Math.cos(p.ry) * (az / al);
    if (p.mode === 'block' && facing > 0.3 && p.stam > 0 && !ev.unblockable) {
      this.useStam(12 * ev.dmg * (1 - Math.min(0.5, this.stats().def * 0.04))); this.lastBlock = this.t; this.audio.play('block');
      this.particles.burst(p.x + Math.sin(p.ry) * 0.7, p.y + 1.2, p.z + Math.cos(p.ry) * 0.7, 0xfff0a0, 10, 4, 0.3);
      p.kx = -ax / al * 3; p.kz = -az / al * 3;
      if (p.stam <= 0) { UI.toast('Guard broken!', 'bad'); p.mode = 'hurt'; p.mt = 0; }
      return;
    }
    this.onStatusHit?.(ev);
    this.hurt(ev.dmg, ev.sx, ev.sz);
  }
  hurt(dmg, sx, sz, stun = 0.35) {
    const p = this.p; if (p.mode !== 'dead' && this.mounted) this.dismount('You were knocked off your mount!');
    if (p.mode === 'dead' || this.god) return;
    this.stunDur = stun;
    // armour: each point of defence gives a 5% chance to shrug off half a heart (min 1)
    const def = this.stats().def; if (dmg > 1 && this.rand() < def * 0.05) dmg -= 1;
    p.hp = Math.max(0, p.hp - dmg); p.inv = 1.0;
    const ax = p.x - sx, az = p.z - sz, al = Math.hypot(ax, az) || 1;
    p.kx = (ax / al) * 9; p.kz = (az / al) * 9; p.mode = 'hurt'; p.mt = 0; p.combo = 0;
    this.particles.burst(p.x, p.y + 1.2, p.z, 0xff3030, 10, 3, 0.4); this.audio.play('hurt');
    this.shake = 0.25; document.body.classList.add('hurt'); setTimeout(() => document.body.classList.remove('hurt'), 150);
    if (p.hp <= 0) this.die();
  }
  die() {
    const p = this.p; p.mode = 'dead'; p.mt = 0; p.lock = null;
    if (this.coop?.active && this.coop.partySize > 1) { this.downedT = DOWN_TIME; UI.banner('You are down!', `A friend can revive you (hold ${this.touch ? '✋' : 'E'} for 3 s) · or you respawn at a Hearthstone`); }
    else UI.banner('You have fallen…', 'The legend is not over yet');
  }
  // co-op: a friend held interact next to you for 3 s
  coopRevived(by) {
    const p = this.p; if (p.mode !== 'dead') return;
    p.mode = 'normal'; p.mt = 0; p.hp = Math.max(2, Math.ceil(this.maxHp / 2)); p.inv = 2; p.stam = 100; this.downedT = 0;
    this.particles.burst(p.x, p.y + 1.2, p.z, 0x80ffb0, 30, 4, 1); this.audio.play('heal');
    UI.banner('Revived!', `${by} got you back on your feet`); this.tpFlag = true;
  }
  respawnPoint() {
    if (this.inDungeon) {
      if (this.dungeonId === 'belfry') { const z = this.p.z, f = this.s.flags; return z < -112 && f.bf_boss ? BELFRY_CP.vael : z < -84 && f.bf_ledge ? BELFRY_CP.loft : z < -66 && f.bf_ledge ? BELFRY_CP.ledge : z < -28 && f.hookshot ? BELFRY_CP.cistern : BELFRY_START; }
      if (this.dungeonId === 'pyramid') return PYRAMID_START;
      if (this.dungeonId === 'mine') { const z = this.p.z; return z < -112 ? MINE_CP.arena : z < -91 && this.s.flags.q3_bridge ? MINE_CP.lavaN : z < -60 ? MINE_CP.lava : MINE_START; }
      return DUNGEON_START;
    }
    if (this.s.home?.hearth && !this.coopGuest) return { x: this.s.home.hearth.x + 1.5, z: this.s.home.hearth.z + 1.5 }; // in a friend's world: the village / camp Hearthstone
    return this.p.x > 150 ? { x: CAMP.x + 1, z: CAMP.z + 2 } : SPAWN;
  }
  respawn() {
    const p = this.p; const inD = this.inDungeon, did = this.dungeonId;
    this.fade(() => {
      const pt = this.respawnPoint();
      this.debug.teleport(pt.x, pt.z); p.hp = this.maxHp; p.mode = 'normal'; p.inv = 2; p.stam = 100; this.s.fade = 0;
      if (inD && did === 'barrow' && this.canResetDungeon('barrow')) this.resetDungeonSim();
      if (inD && did === 'mine' && this.canResetDungeon('mine')) this.resetMineSim();
      if (inD && (did === 'belfry' || did === 'pyramid') && this.canResetDungeon(did)) this.resetV3Sim(did);
      this.pvpRespawned?.();
    });
  }
  targetables() {
    const zoneD = this.inDungeon, out = [];
    const pre = { mine: 'm_', belfry: 'b_', pyramid: 'y_' }[this.dungeonId] || 'd_', dun = /^[dmby]_/;
    for (const e of this.allEnemies()) if (e.alive && !e.hidden && (zoneD ? e.id.startsWith(pre) : !dun.test(e.id))) out.push(e);
    return out;
  }
  doHit(kind) {
    const p = this.p, st = this.stats(), base = st.atk;
    const spin = kind === 'spin';
    const dmg = spin ? base * 2 : Math.ceil(base * ATK[kind].mult);
    const reach = spin ? 3.8 : 2.5;
    const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
    let hits = 0;
    this.audio.play(spin ? 'spin' : 'swing');
    for (const e of this.targetables()) {
      const T = ENEMY_TYPES[e.type];
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      if (d > reach + T.radius) continue;
      if (e.type === 'magmaw' && (e.state === 'submerged' || e.state === 'idle')) continue;
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (!spin && dot < 0.25 && d > T.radius + 0.6) continue;
      hits++; this.damageEnemy(e, dmg, kind);
    }
    hits += this.pvpMelee?.(kind, reach) || 0;
    this.trailT = 0.16; this.trail.position.set(p.x, p.y + 1.1, p.z);
    this.trail.geometry.dispose();
    const len = spin ? Math.PI * 2 : kind === 'attack3' ? 0.5 : Math.PI * 0.9;
    this.trail.geometry = new THREE.RingGeometry(spin ? 1.2 : 0.9, spin ? 3.6 : 2.5, 20, 1, 0, len).rotateX(-Math.PI / 2);
    this.trail.rotation.set(0, p.ry - Math.PI / 2 - len / 2 + (kind === 'attack2' ? 0.2 : 0), kind === 'attack2' ? 0.35 : kind === 'attack1' ? -0.15 : 0);
    if (kind === 'attack3') this.trail.rotation.y = p.ry - Math.PI / 2 - 0.25;
    return hits;
  }
  damageEnemy(e, dmg, kind) {
    const ench = this.stats().ench;
    let crit = false;
    if (ench === 'diamond' && this.rand() < 0.2) { dmg *= 2; crit = true; }
    if (ench === 'emerald' && this.rand() < 0.25 && this.p.hp < this.maxHp) { this.p.hp += 1; this.particles.burst(this.p.x, this.p.y + 1.4, this.p.z, 0x40ff80, 6, 2, 0.4); }
    this.damageEnemyRaw(e, dmg, this.p.x, this.p.z, {}, 'combat', crit);
  }
  damageEnemyRaw(e, dmg, fx, fz, opts = {}, skill = 'combat', crit = false) {
    const T = ENEMY_TYPES[e.type], ang = Math.atan2(e.x - fx, e.z - fz);
    this.particles.burst(e.x - Math.sin(ang) * T.radius, this.terrainH(e.x, e.z) + 1.1, e.z - Math.cos(ang) * T.radius, crit ? 0x80e0ff : 0xffffff, crit ? 12 : 6, 3, 0.25);
    this.audio.play('hit');
    if (crit) UI.toast('💠 Critical hit!', 'good');
    if (this.coopGuest) { this.net.send({ t: 'attack', id: e.id, dmg, kind: skill, bomb: opts.bomb ? 1 : 0, mouth: opts.mouth ? 1 : 0 }); this.pendingSkill = skill; } // co-op guest: the host decides
    else if (e.id.startsWith('d_')) this.onEnemyDamaged(e.id, this.dsim.damage(e.id, dmg, fx, fz, opts), true, skill);
    else if (/^[mby]_/.test(e.id)) this.onEnemyDamaged(e.id, this.simFor(e.id).damage(e.id, dmg, fx, fz, opts), true, skill);
    else if (this.online) { this.net.send({ t: 'attack', id: e.id, dmg, kind: skill }); this.pendingSkill = skill; }
    else this.onEnemyDamaged(e.id, this.localSim.damage(e.id, dmg, fx, fz, opts), true, skill);
    this.lastAttackHit = { id: e.id, t: this.t };
  }
  onEnemyDamaged(id, r, mine, skill = this.pendingSkill || 'combat', by = null) {
    if (!r || r.ok === false) return;
    const e = this.enemyById(id), v = this.views.get(id);
    if (this.coop?.isHost) this.coop.hostEnemyResult(id, r, by || this.coop.me, e);
    if (r.flipped) { if (v) v.flash(0xffd040); UI.toast('The Shellback flips onto its back — strike its belly!', 'good'); return; }
    if (r.stunned) { this.shake = 0.6; this.audio.play('boom'); UI.toast('Magmaw chokes on the bomb! Its molten heart is exposed — STRIKE!', 'good'); if (v) v.flash(0xffd040); return; }
    if (r.blocked) {
      if (v) v.flash(0x4466ff); this.audio.play('clang');
      if (e) this.particles.burst(e.x, this.terrainH(e.x, e.z) + 2.5, e.z, 0xa0c0ff, 8, 3, 0.3);
      if (mine && (!this.clangT || this.t - this.clangT > 3)) {
        this.clangT = this.t;
        UI.toast(e?.type === 'shellback' ? 'Clang! Its shell is too hard. A bomb might flip it…' : e?.type === 'magmaw' ? 'Its hide is molten rock. Throw a bomb into its mouth while it inhales!' : 'Clang! His armour is too thick — hit his glowing back or strike after a slam.', 'bad');
      }
      return;
    }
    if (v) { v.flash(); v.showBarT = 4; }
    if (r.killed) {
      const type = e?.type || this.enemySpawnType.get(id) || 'mossling';
      if (e) this.particles.burst(e.x, this.terrainH(e.x, e.z) + 0.8, e.z, 0x9a8aff, 22, 4, 0.8);
      this.audio.play('kill');
      if (this.p.lock && this.p.lock.id === id) this.p.lock = null;
      if (mine) { this.addXp(skill === 'archery' || skill === 'magic' ? skill : 'combat', this.coopGuest ? ENEMY_TYPES[type].xp : r.xp || ENEMY_TYPES[type].xp); if (e) this.rollLoot(type, e.x, e.z); } // loot is personal: rolled and dropped only on this player's screen
      this.v3Kill?.(id, type, mine);
      if (id === 'd_warden' && (mine || !this.coopGuest)) { this.s.flags.boss = true; this.dungeon.setState(this.dstate()); UI.banner('Barrow Warden defeated!', 'A chest appears…'); this.save(); }
      if (id === 'm_magmaw' && (mine || !this.coopGuest)) { this.s.flags.q3_boss = true; this.mine.setState(this.mineFlags()); this.shake = 1; UI.banner('Magmaw defeated!', 'The lava cools… a chest rises from the crucible'); this.save(); }
    }
  }
  // ---------------- interactions ----------------
  findInteract() {
    const p = this.p, near = [], f = this.s.flags;
    const add = (d, max, o) => { if (d < max) near.push({ d, ...o }); };
    const dist = (o) => Math.hypot(o.x - p.x, o.z - p.z);
    if (this.coop?.active) for (const r of this.remotes.values()) if (r.dead && r.av.root.visible) add(dist(r) - 1, 1.6, { kind: 'revive', r, label: `Hold to revive ${UI.esc(r.name)}` });
    if (!this.inDungeon) {
      for (const n of this.npcs) add(dist(n), 2.8, { kind: 'npc', label: `Talk to ${n.name}`, npc: n });
      for (const s of this.world.stations) add(dist(s), 2.6, { kind: 'station', label: s.label, station: s.kind, st: s });
      for (const n of this.world.nodes.values()) {
        if (n.depleted) continue;
        const dx = n.x - p.x, dz = n.z - p.z; if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
        const def = NODE_TYPES[n.type], tr = this.traps.get(n.id);
        const lbl = tr ? (tr.ready ? 'Check trap' : 'Trap set… waiting') : `${def.label} <small>(${SKILL_NAMES[def.skill]} ${def.level})</small>`;
        add(Math.hypot(dx, dz), def.fish ? 3.2 : n.type === 'tree' || n.type === 'oak' || n.type === 'ashtree' ? 2.3 : 2.7, { kind: tr ? (tr.ready ? 'trapcheck' : 'none') : 'node', label: lbl, node: n, tr });
      }
      add(dist(this.world.entrance), 2.6, { kind: 'enter', label: 'Enter the Hollow Barrow' });
      add(dist(this.ridge.mineEntrance), 2.8, { kind: 'enterMine', label: 'Enter Cinderdeep Mine' });
      for (const a of this.altars) add(dist(a), 3.0, { kind: 'altar', a, label: `Use ${a.name} <small>(Runemaking ${a.level})</small>` });
      const hr = this.ridge.hearths.get('h_ridge');
      if (hr && !hr.lit) add(dist(hr), 3, { kind: 'hearthLight', label: f.q2_echo ? 'Relight the Hearthstone' : 'A cold, dormant Hearthstone' });
      if (f.q2_start && !f.q2_echo) add(dist(FADE_ECHO), 2.6, { kind: 'echo', label: 'Touch the Fade-echo' });
      for (const s of this.ridge.secrets.values()) if (s.broken && !s.opened) add(Math.hypot(s.cx - p.x, s.cz - p.z), 2.2, { kind: 'secret', s, label: 'Open the hidden chest' });
      for (const r of this.runaways) if (r.P.root.visible && !r.home) add(dist(r), 2.6, { kind: 'runaway', r, label: `Calm the runaway ${PETS[r.type].name.toLowerCase()}` });
      if (!this.buildMode) for (const b of this.building.interactablesNear(p.x, p.z, 2.4)) {
        if (Math.abs(b.y - p.y) > 3.5) continue;
        const L = { door: this.building.isOpen(b.k, b.i) ? 'Close door' : 'Open door', chest: 'Open storage chest', bench: 'Use workbench', campfire: 'Cook on campfire', hearth: this.s.home?.hearth && Math.hypot(this.s.home.hearth.x - b.x, this.s.home.hearth.z - b.z) < 0.1 ? 'Your Hearthstone (respawn point)' : 'Bind to this Hearthstone', bankchest: 'Open bank chest' }[b.type];
        add(b.d + 0.2, 2.4, { kind: 'piece', b, label: L });
      }
      this.v3OverworldInteracts(add, dist);
      this.pvpInteracts?.(add, dist);
    } else if (this.dungeonId === 'belfry') { this.belfryInteracts(add, dist);
    } else if (this.dungeonId === 'pyramid') { this.pyramidInteracts(add, dist);
    } else if (this.dungeonId === 'mine') {
      this.mineInteracts(add);
    } else {
      const D = this.dungeon;
      if (!D.chest.opened) add(dist(D.chest), 2.0, { kind: 'chest', label: 'Open chest' });
      if (!D.lever.pulled) add(dist(D.lever), 1.8, { kind: 'lever', label: 'Pull lever' });
      if (f.boss && !D.bossChest.opened) add(dist(D.bossChest), 2.0, { kind: 'bossChest', label: 'Open the Warden\'s chest' });
      add(dist(D.exitA), 2.0, { kind: 'exit', label: 'Leave the Barrow' });
      if (f.boss) add(dist(D.exitD), 2.2, { kind: 'exit', label: 'Return to the surface' });
    }
    for (const L of this.loot) if (Math.hypot(L.x - p.x, L.z - p.z) < 1.5) { /* auto-pickup */ }
    near.sort((a, b) => a.d - b.d);
    return near.filter((n) => n.kind !== 'none')[0] || near[0] || null;
  }
  interact(it) {
    const D = this.dungeon, f = this.s.flags;
    if (it.kind === 'revive') return this.coop?.startRevive(it.r.id);
    if (this.coopGuest) { // in a friend's world: puzzles and the host's furniture are the host's
      const fw = { lever: 'lever', mswitch: 'mswitch', mcart: 'mcart', bf_valve: 'bf_valve' }[it.kind];
      if (fw) { this.net.send({ t: 'act', k: fw, i: it.i }); this.audio.play('ui'); return; }
      if (it.kind === 'piece' && it.b.type === 'door') { this.net.send({ t: 'act', k: 'door', key: it.b.k, i: it.b.i }); this.audio.play('door'); return; }
      if (it.kind === 'piece' && (it.b.type === 'hearth' || it.b.type === 'chest')) return UI.toast('That belongs to the host of this world.', '');
    }
    if (this.v3Interact(it) || this.pvpInteract?.(it)) return;
    switch (it.kind) {
      case 'npc': it.npc.av.root.rotation.y = Math.atan2(this.p.x - it.npc.x, this.p.z - it.npc.z); return this.talk(it.npc);
      case 'station': this.currentStation = it.st; return this.openPanel(it.station);
      case 'node': return NODE_TYPES[it.node.type].trap ? this.setTrap(it.node) : this.startGather(it.node);
      case 'trapcheck': return this.checkTrap(it.tr);
      case 'enter': return this.enterDungeon();
      case 'enterMine': return this.enterMine();
      case 'exit': return this.exitDungeon();
      case 'altar': return this.openPanel('altar:' + it.a.id);
      case 'echo': f.q2_start = f.q2_camp = true; return this.vision();
      case 'hearthLight':
        if (!f.q2_echo) return UI.toast('The stone is cold. Something in the fog nearby calls to your shard…', '');
        f.q2_lit = true; this.applyWorldState(); this.audio.play('quest'); this.s.fade = 0;
        this.particles.burst(it.x ?? this.p.x, this.p.y + 2, this.p.z, 0xffd27a, 40, 6, 1.2);
        UI.banner('The Ridge Hearthstone burns again!', 'The Fade recoils. Return to Scout Corin.'); this.save(); return;
      case 'secret': {
        const s = it.s; f[s.id + '_o'] = true; this.ridge.setSecret(s.id, true, true);
        if (s.id === 's_isle') { this.giveGold(60); this.give('lantern_oil', 1); this.give('uncut_emerald', 1); } else { this.giveGold(120); this.give('uncut_diamond', 1); this.give('fire_shard', 2); }
        UI.banner('Secret treasure!', 'Bombs reveal what walls hide'); this.audio.play('quest'); this.save(); return;
      }
      case 'runaway': return this.findRunaway(it.r);
      case 'piece': {
        const b = it.b;
        if (b.type === 'door') { this.building.toggleDoor(b.k, b.i); this.audio.play('door'); this.save(); return; }
        if (b.type === 'chest') return this.openPanel('chest:' + b.k + '#' + b.i);
        if (b.type === 'bankchest') return this.openPanel('bank');
        if (b.type === 'bench') { this.currentStation = { obj: b.mesh }; return this.openPanel('workbench'); }
        if (b.type === 'campfire') { this.currentStation = { obj: b.mesh }; return this.openPanel('range'); }
        if (b.type === 'hearth') { this.s.home.hearth = { x: b.x, z: b.z }; this.audio.play('quest'); UI.banner('Hearthstone bound', 'You will respawn here'); this.save(); return; }
        return;
      }
      case 'chest':
        f.grapple = true; D.setState(this.dstate());
        this.particles.burst(D.chest.x, 1.2, D.chest.z, 0xffd040, 26, 4, 1); this.audio.play('quest');
        UI.banner('You got the Grapple Hook!', this.touch ? 'Tap 🪝 near a golden ring to pull yourself across' : 'Press G (or lock on) near a golden ring to pull yourself across');
        UI.show('#t-grapple', true); this.save(); return;
      case 'lever':
        f.lever = true; D.setState(this.dstate()); D.gate.position.y = 0; UI.toast('A heavy gate grinds open somewhere nearby…', 'good'); this.shake = 0.3; this.audio.play('door'); this.save(); return;
      case 'bossChest':
        f.shard = true; D.setState(this.dstate()); this.give('mythstone', 1);
        this.particles.burst(D.bossChest.x, 1.2, D.bossChest.z, 0x80e0ff, 30, 5, 1.2); this.audio.play('quest');
        UI.banner('You found a Mythstone Shard!', 'Bring it to Elder Maren'); this.save(); return;
      default: if (it.kind?.startsWith('m') || it.kind === 'flower') return this.mineInteract(it);
    }
  }
  startGather(n) {
    const def = NODE_TYPES[n.type];
    if (this.level(def.skill) < def.level) return UI.toast(`You need ${SKILL_NAMES[def.skill]} level ${def.level}.`, 'bad');
    if (!this.canAdd(def.item, def.qty)) return this.invFull();
    const p = this.p; p.mode = 'gather'; p.mt = 0; p.gnode = n; p.ry = Math.atan2(n.x - p.x, n.z - p.z);
    p.gtime = def.time * gatherSpeed(this.level(def.skill));
  }
  finishGather(n) {
    if (n.depleted) return UI.toast('Nothing left here.', 'bad');
    if (this.online && !NODE_TYPES[n.type].fish && !['essence', 'ashtree', 'coal'].includes(n.type) && !n.id.match(/^(riron|rrock)/)) return this.net.send({ t: 'gather', id: n.id });
    this.world.setNodeDepleted(n.id, true, performance.now() + NODE_TYPES[n.type].respawn * 1000);
    this.rewardGather(n);
  }
  rewardGather(n) {
    if (!n) return; const def = NODE_TYPES[n.type], L = this.level(def.skill);
    const dbl = (def.skill === 'woodcutting' && L >= 30 || def.skill === 'fishing' && L >= 25) && this.rand() < 0.2;
    if (!this.give(def.item, def.qty * (dbl ? 2 : 1))) return;
    this.addXp(def.skill, def.xp);
    if (def.gems) this.rollGem(n.x);
    this.audio.play(def.skill === 'woodcutting' ? 'chop' : def.skill === 'fishing' ? 'splash' : 'mine');
    this.particles.burst(n.x, this.terrainH(n.x, n.z) + 1, n.z, def.skill === 'woodcutting' ? 0x6aa040 : def.fish ? 0x80c0ff : 0x9a9a9a, 12, 3, 0.6);
    if (this.buildMode) this.refreshBuildBar();
    this.save();
  }
  fade(fn) { const f = document.getElementById('fade'); f.classList.add('on'); this.fading = true; setTimeout(() => { fn(); f.classList.remove('on'); this.fading = false; }, 380); }
  enterDungeon() {
    this.fade(() => {
      this.debug.teleport(DUNGEON_START.x, DUNGEON_START.z, 0); this.p.ry = Math.PI; this.cam.yaw = 0;
      this.s.flags.entered = true; if (this.canResetDungeon('barrow')) this.resetDungeonSim(); this.p.lock = null;
      if (this.buildMode) this.toggleBuild();
      UI.banner('The Hollow Barrow'); this.save();
    });
  }
  enterMine() {
    this.fade(() => {
      this.debug.teleport(MINE_START.x, MINE_START.z, 0); this.p.ry = Math.PI; this.cam.yaw = 0;
      if (this.s.flags.q3_start) this.s.flags.q3_enter = true;
      if (this.canResetDungeon('mine')) this.resetMineSim(); this.mine.setState(this.mineFlags()); this.p.lock = null;
      if (this.buildMode) this.toggleBuild();
      UI.banner('Cinderdeep Mine', 'The air shimmers with heat'); this.save();
    });
  }
  exitDungeon() {
    if (this.dungeonId === 'belfry') return this.fade(() => { this.debug.teleport(BELFRY_ENTRANCE.x, BELFRY_ENTRANCE.z + 4); this.p.ry = 0; this.cam.yaw = Math.PI; this.p.lock = null; UI.banner('Mythbound Isle'); this.save(); });
    if (this.dungeonId === 'pyramid') return this.fade(() => { const e = this.r3.pyramid; this.debug.teleport(e.x, e.z + 5); this.p.ry = 0; this.cam.yaw = Math.PI; this.p.lock = null; UI.banner('Sunscar Desert'); this.save(); });
    if (this.dungeonId === 'mine') return this.fade(() => { const me = this.ridge.mineEntrance; this.debug.teleport(me.x - 4, me.z); this.p.ry = -Math.PI / 2; this.cam.yaw = Math.PI / 2; this.p.lock = null; UI.banner('Emberfall Ridge'); this.save(); });
    this.fade(() => { this.debug.teleport(ENTRANCE.x, ENTRANCE.z + 5); this.p.ry = 0; this.cam.yaw = Math.PI; this.p.lock = null; UI.banner('Mythbound Isle'); this.save(); });
  }

  // ---------------- building (v2: aim where you look, rotate, home plots) ----------------
  toggleBuild() {
    if (!this.buildMode && this.inDungeon) return UI.toast('The rock resists your building.', 'bad');
    if (!this.buildMode && this.coopGuest && !(this.coop.allowBuild && this.coop.hostPlot)) return UI.toast("Building is off in a friend's world. The host can let you build on their home plot (Co-op ▸ Allow building).", 'bad');
    this.buildMode = !this.buildMode; this.input.buildMode = this.buildMode;
    this.building.ghost.visible = this.buildMode; UI.show('#tbuild', this.buildMode && this.touch);
    this.refreshBuildBar(); this.drawPlot();
    const z = this.zoneName();
    if (this.buildMode) UI.toast(z === 'village' || z === 'camp' ? 'Building is not allowed in safe zones. Head out to the Wilds.' : 'Build mode — aim with the camera', z === 'village' || z === 'camp' ? 'bad' : 'good');
  }
  buildTarget() { return this.aimCell(); }
  place() {
    const { gx, gz, k } = this.buildTarget();
    const stack = this.building.stacks.get(k) || [];
    const reason = this.pieceRefusal(gx, gz, this.piece);
    if (reason) { UI.toast(reason, 'bad'); this.lastBuild = { ok: false, reason }; return false; }
    const cost = this.costFor(this.piece);
    if (!this.has(cost)) { const r = `You need ${Object.entries(cost).map(([it, n]) => `${n} ${ITEMS[it].name}`).join(' + ')}.`; UI.toast(r, 'bad'); this.lastBuild = { ok: false, reason: r }; return false; }
    const entry = this.rot ? `${this.piece}@${this.rot}` : this.piece;
    if (this.online) { this.net.send({ t: 'build', gx, gz, m: entry }); this.pendingBuild = { k, piece: entry }; return true; }
    this.spend(cost); this.building.setStack(k, [...stack, entry]); this.afterPlace(gx, gz);
    if (this.piece === 'hearth') { const [cx, cz] = cellCenter(gx, gz); this.s.home.hearth = { x: cx, z: cz }; UI.banner('Hearthstone raised!', 'You will respawn at your home'); }
    this.lastBuild = { ok: true, k }; this.save(); return true;
  }
  afterPlace(gx, gz) {
    const [cx, cz] = cellCenter(gx, gz);
    this.particles.burst(cx, this.building.top(gx, gz), cz, 0xd0b080, 8, 2.5, 0.4); this.audio.play('place');
    const p = this.p;
    if (Math.abs(p.x - cx) < BLOCK / 2 + PR && Math.abs(p.z - cz) < BLOCK / 2 + PR) { const top = this.building.top(gx, gz); if (top > p.y && top - p.y < 3.5) p.y = top; }
    this.refreshBuildBar();
  }
  removePiece() {
    if (this.coopGuest) return UI.toast('Only the host can remove pieces in their world.', 'bad');
    const { gx, gz, k } = this.buildTarget();
    const stack = this.building.stacks.get(k);
    if (!stack || !stack.length) return UI.toast('Nothing to remove there.', 'bad');
    if (this.online) return this.net.send({ t: 'unbuild', gx, gz });
    const entry = stack[stack.length - 1], type = pieceType(entry);
    if (type === 'chest' && Object.values(this.s.chests[k + '#' + (stack.length - 1)] || {}).some((n) => n > 0)) return UI.toast('Empty the chest first.', 'bad');
    this.building.setStack(k, stack.slice(0, -1));
    for (const [it, n] of Object.entries(PIECES[type].cost)) this.s.inv[it] = (this.s.inv[it] || 0) + n;
    if (type === 'hearth' && this.s.home.hearth) { const [cx, cz] = cellCenter(gx, gz); if (Math.hypot(cx - this.s.home.hearth.x, cz - this.s.home.hearth.z) < 0.1) this.s.home.hearth = null; }
    this.audio.play('place'); this.refreshBuildBar(); this.save();
  }
  onBlocks(m) {
    const prev = (this.building.stacks.get(m.k) || []).length;
    this.building.setStack(m.k, m.s);
    if (m.by !== this.myId) return;
    const [gx, gz] = m.k.split(',').map(Number);
    if (m.s.length > prev) { this.spend(PIECES[pieceType(m.s[m.s.length - 1])].cost); this.afterPlace(gx, gz); this.lastBuild = { ok: true, k: m.k }; }
    else if (m.removed) { for (const [it, n] of Object.entries(PIECES[pieceType(m.removed)].cost)) this.s.inv[it] = (this.s.inv[it] || 0) + n; this.refreshBuildBar(); }
    this.save();
  }

  // ---------------- grapple ----------------
  grapplePoints() {
    if (this.inDungeon) { const d = this.dungeonId; return d === 'barrow' ? this.dungeon.grapplePoints : d === 'belfry' ? this.belfry.grapplePoints.filter((g) => !g.hook || this.s.flags.hookshot) : []; }
    return this.building.anchors().map((a) => {
      const dx = a.x - this.p.x, dz = a.z - this.p.z, d = Math.hypot(dx, dz) || 1;
      return { ...a, land: { x: a.x - dx / d * 0.85, z: a.z - dz / d * 0.85 }, landY: a.y - 3.15 };
    });
  }
  tryGrapple() {
    const p = this.p;
    if (!this.s.flags.grapple && !this.s.flags.hookshot) return UI.toast('You don\'t have a grapple hook yet.', 'bad');
    if (this.mounted) this.dismount();
    const RANGE = this.s.flags.hookshot ? 36 : 24;
    let target = null;
    if (p.lock && p.lock.grapple) target = p.lock;
    else {
      let best = 1e9; const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
      for (const g of this.grapplePoints()) {
        const dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz);
        if (d > (g.hook ? RANGE : 24) || d < 1.5) continue;
        const camF = -(dx * Math.sin(this.cam.yaw) + dz * Math.cos(this.cam.yaw)) / d;
        if ((dx * fx + dz * fz) / d < 0.5 && camF < 0.6) continue;
        if (d < best) { best = d; target = g; }
      }
    }
    p.mode = 'grapple'; p.mt = 0; p.gr = target ? { ...target, hit: true } : { x: p.x + Math.sin(p.ry) * 10, y: p.y + 1.5, z: p.z + Math.cos(p.ry) * 10, hit: false };
    this.audio.play('grapple');
    if (target) p.ry = Math.atan2(target.x - p.x, target.z - p.z);
    else UI.toast(this.inDungeon ? 'Nothing to latch onto.' : 'Nothing to latch onto. Build a Grapple Anchor!', 'bad');
  }

  // ---------------- lock-on ----------------
  toggleLock() {
    const p = this.p;
    if (p.lock) { p.lock = null; return; }
    let best = null, bs = 1e9;
    const cfx = -Math.sin(this.cam.yaw), cfz = -Math.cos(this.cam.yaw);
    const cands = [...(this.pvpTargets?.() || [])].concat(this.targetables().filter((e) => !(e.type === 'magmaw' && e.state === 'submerged')).map((e) => ({ id: e.id, x: e.x, z: e.z, e })));
    if (this.s.flags.grapple || this.s.flags.hookshot) for (const g of this.grapplePoints()) cands.push({ id: 'gp_' + g.id, x: g.x, z: g.z, grapple: true, g });
    for (const c of cands) {
      const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
      if (d > (c.grapple ? (c.g?.hook && this.s.flags.hookshot ? 36 : 24) : 16)) continue;
      const score = d * (1 + (1 - (dx * cfx + dz * cfz) / (d || 1)) * 1.2) + (c.grapple ? 6 : 0);
      if (score < bs) { bs = score; best = c; }
    }
    if (best) p.lock = best.grapple ? { id: best.id, grapple: true, ...best.g, gid: best.g.id } : { id: best.id };
    else UI.toast('No target nearby.', '');
  }
  lockPos() {
    const l = this.p.lock; if (!l) return null;
    if (l.grapple) return { x: l.x, y: l.y, z: l.z };
    if (l.id.startsWith('pl_')) { const q = this.pvpLockPos?.(l.id); if (!q) this.p.lock = null; return q || null; }
    const e = this.enemyById(l.id); if (!e || !e.alive) { this.p.lock = null; return null; }
    const v = this.views.get(l.id);
    return { x: v ? v.x : e.x, y: this.terrainH(e.x, e.z) + (e.type === 'magmaw' ? 5 : ENEMY_TYPES[e.type].boss ? 3 : 1.2), z: v ? v.z : e.z };
  }
  useStam(n) { this.p.stam = Math.max(0, this.p.stam - n); this.p.stamT = 0; }
  // ---------------- player update ----------------
  animName() {
    const p = this.p;
    if (p.mode === 'attack') return 'attack' + p.combo;
    if (['charge', 'spin', 'block', 'roll', 'gather', 'hurt', 'dead', 'grapple'].includes(p.mode)) return p.mode;
    if (this.animOverride && this.animOverride.t > 0) return this.animOverride.name;
    if (!p.grounded) return 'jump';
    return p.speed > 6.5 ? 'run' : p.speed > 0.3 ? 'walk' : 'idle';
  }
  updatePlayer(dt) {
    const p = this.p, I = this.input;
    p.mt += dt; p.inv -= dt; p.stamT += dt;
    if (p.stamT > 0.8 && p.mode !== 'block' && p.mode !== 'charge') p.stam = Math.min(100, p.stam + 30 * dt);
    const uiBlocked = this.inDialog || UI.panelOpen() || this.fading;
    if (this.animOverride) { this.animOverride.t -= dt; this.animOverride.mt = (this.animOverride.mt || 0) + dt; if (this.animOverride.t <= 0) this.animOverride = null; }
    // global UI keys
    if (I.wasPressed('escape')) { if (UI.panelOpen()) this.closePanel(); else if (this.buildMode) this.toggleBuild(); }
    if (I.wasPressed('skills')) this.togglePanel('skills');
    if (I.wasPressed('bag')) this.togglePanel('bag');
    if (I.wasPressed('help')) this.togglePanel('help');
    if (I.wasPressed('journal')) this.togglePanel('journal');
    if (I.wasPressed('spellbook')) this.togglePanel('spells');
    if (I.wasPressed('settings')) this.togglePanel('settings');
    if (I.wasPressed('chat')) { const ci = document.getElementById('chat-input'); setTimeout(() => ci.focus(), 0); if (document.pointerLockElement) document.exitPointerLock(); }
    if (this.inDialog) {
      if (I.wasPressed('interact') || I.wasPressed('attack') || I.wasPressed('place')) this.dialogNext?.();
      for (let i = 1; i <= 4; i++) if (I.wasPressed('piece' + i)) this.dialogChoose?.(i - 1);
    }

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
        let ch = false;
        for (let i = 1; i <= 10; i++) if (I.wasPressed('piece' + i)) { const page = this.piecePage || 0, idx = page * 10 + i - 1; if (PIECE_ORDER[idx]) { this.piece = PIECE_ORDER[idx]; ch = true; } }
        if (I.wasPressed('cycle') || I.wheel) { const dir = I.wheel ? Math.sign(I.wheel) : 1; I.wheel = 0; const ks = PIECE_ORDER; this.piece = ks[(ks.indexOf(this.piece) + dir + ks.length) % ks.length]; ch = true; }
        if (I.wasPressed('bomb') || I.wasPressed('rotate')) { this.rot = (this.rot + 1) & 3; ch = true; this.audio.play('ui'); }
        if (I.wasPressed('claim')) this.claimPlot();
        if (ch) this.refreshBuildBar();
        if (I.wasPressed('place') || I.wasPressed('interact')) this.place();
        if (I.wasPressed('remove')) this.removePiece();
      }
      if (I.wasPressed('lock') && !this.buildMode) this.toggleLock();
      const free = p.mode === 'normal' || p.mode === 'block';
      const mountedBlock = this.mounted && (I.wasPressed('attack') || I.wasPressed('bow') || I.wasPressed('spell') || I.wasPressed('bomb'));
      if (mountedBlock) { this.dismount(); UI.toast('You hop off your mount to fight.', ''); }
      if (free && !this.buildMode && !mountedBlock) {
        if (I.wasPressed('attack')) { if (this.pvpSafe?.()) UI.toast('No fighting here.', ''); else if (this.zoneName() === 'village' || this.zoneName() === 'camp') UI.toast('Put that away — the village is a safe zone.', ''); else { p.mode = 'attack'; p.combo = 1; p.mt = 0; p.hitDone = false; p.queued = false; p.held = true; if (lockP) p.ry = Math.atan2(lockP.x - p.x, lockP.z - p.z); } }
        else if (I.wasPressed('roll') && p.stam >= 10 && p.grounded) { p.mode = 'roll'; p.mt = 0; this.useStam(22); p.rdx = wl > 0.1 ? wx / wl : (lockP ? -fx : Math.sin(p.ry)); p.rdz = wl > 0.1 ? wz / wl : (lockP ? -fz : Math.cos(p.ry)); }
        else if (I.wasPressed('grapple')) this.tryGrapple();
        else if (I.wasPressed('bomb')) this.throwBomb();
        else if (I.wasPressed('bow')) { if (this.zoneName() === 'village' || this.zoneName() === 'camp') UI.toast('Not in a safe zone.', ''); else this.shoot(); }
        else if (I.wasPressed('spell')) { const sp = SPELLS.find((x) => x.id === this.s.spell); if ((sp?.kind === 'bolt') && (this.zoneName() === 'village' || this.zoneName() === 'camp')) UI.toast('Not in a safe zone.', ''); else this.castSpell(); }
        else if (I.wasPressed('quick')) this.useQuick();
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
        speed = (p.mode === 'block' ? 2.2 : lockP ? 4.6 : sprint ? 8.5 : 5.6) * (this.mounted ? this.mountSpeed() * (sprint ? 0.85 : 1) : 1) * (this.slowT > 0 ? 0.55 : 1) * (this.buffs?.stamina ? 1.05 : 1);
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
        if (Math.floor(p.mt * 1.6) !== Math.floor((p.mt - dt) * 1.6)) { this.audio.play(def.skill === 'woodcutting' ? 'chop' : def.fish ? 'splash' : 'mine'); this.particles.burst(n.x, this.terrainH(n.x, n.z) + 1, n.z, def.skill === 'woodcutting' ? 0x8a6a3a : 0xbbbbbb, 4, 2, 0.3); n.obj.rotation.z = 0.06; }
        n.obj.rotation.z *= 0.85;
        if (n.depleted) p.mode = 'normal';
        else if (p.mt >= (p.gtime || def.time)) { p.mode = 'normal'; this.finishGather(n); }
        break;
      }
      case 'hurt':
        p.kx *= Math.exp(-dt * 6); p.kz *= Math.exp(-dt * 6);
        if (p.mt > (this.stunDur ?? 0.35)) p.mode = 'normal';
        break;
      case 'dead':
        if (p.mt > (this.downedT && this.coop?.active ? this.downedT : 2.2) && !this.respawning) { this.downedT = 0; this.respawning = true; this.respawn(); setTimeout(() => (this.respawning = false), 600); }
        break;
      case 'grapple': {
        const g = p.gr;
        if (p.mt < 0.22) { /* chain flies out */ }
        else if (!g.hit) { if (p.mt > 0.45) p.mode = 'normal'; }
        else {
          const tx = g.land ? g.land.x : g.x, tz = g.land ? g.land.z : g.z;
          const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
          const sp = 22 * dt;
          if (d <= sp + 0.05) { p.x = tx; p.z = tz; p.y = g.landY ?? this.groundAt(tx, tz, 999); p.vy = 0; p.mode = 'normal'; p.lock = null; this.tpFlag = false; }
          else { p.x += (dx / d) * sp; p.z += (dz / d) * sp; p.y += ((Math.max(g.landY ?? this.groundAt(tx, tz, 999), 0) + 1.0) - p.y) * Math.min(1, dt * 6); p.vy = 0; }
        }
        break;
      }
    }
    if (p.mode !== 'charge') p.chargeFx = false;
    // knockback
    if (Math.abs(p.kx) + Math.abs(p.kz) > 0.05) { this.collide(p.x + p.kx * dt, p.z + p.kz * dt, false); p.kx *= Math.exp(-dt * 8); p.kz *= Math.exp(-dt * 8); }
    // horizontal movement
    if (speed > 0) {
      const wade = !this.inDungeon && p.y < 0.1 ? 0.6 : 1; if (this.mounted && wade < 1 && p.y < -0.6) this.dismount('Too deep to ride.');
      this.collide(p.x + dirx * speed * wade * dt, p.z + dirz * speed * wade * dt, true);
    }
    p.speed = speed;
    // footsteps
    if (speed > 0.5 && p.grounded) { this.stepT = (this.stepT || 0) + dt * speed; if (this.stepT > 2.6) { this.stepT = 0; const onB = this.building.columnsAround(p.x, p.z, 0.3).some((c) => Math.abs(c.top - p.y) < 0.1); this.audio.play('step', { surface: onB ? 'wood' : this.inDungeon ? 'stone' : 'grass', vol: speed > 7 ? 0.09 : 0.06 }); } }
    // vertical
    if (p.mode !== 'grapple') {
      const g = this.groundAt(p.x, p.z, p.y);
      if (p.y > g + 0.02 || p.vy > 0) { p.vy -= GRAV * dt; p.y += p.vy * dt; p.grounded = false; if (p.y <= g) { p.y = g; p.vy = 0; p.grounded = true; } }
      else { if (g - p.y < STEP + 0.05) p.y = g; p.vy = 0; p.grounded = true; }
    }
    // fell into the chasm
    if (this.inDungeon && p.y < -5 && p.mode !== 'dead') {
      const cp = this.dungeonId === 'barrow' ? (p.z < -36 ? CHECKPOINT : DUNGEON_START) : this.respawnPoint();
      this.debug.teleport(cp.x, cp.z, 0); p.ry = Math.PI; p.lock = null; p.mode = 'normal';
      UI.toast('You fell into the chasm!', 'bad'); this.hurt(1, p.x, p.z + 1); if (p.mode === 'hurt') { p.kx = p.kz = 0; }
    }
    // avatar
    this.player.root.position.set(p.x, p.y + (this.mounted ? 0.85 : 0), p.z); this.player.root.rotation.y = p.ry;
    this.player.root.visible = !(p.inv > 0 && p.mode !== 'dead' && Math.sin(this.t * 40) > 0.3);
    const gd = p.mode === 'gather' && NODE_TYPES[p.gnode.type];
    const tool = gd ? (gd.skill === 'woodcutting' ? 'axe' : gd.fish ? 'rod' : 'pick') : null;
    const an = this.animName();
    animateAvatar(this.player, { anim: an, t: this.animOverride && an === this.animOverride.name ? this.animOverride.mt : p.mt, speed: speed / 5.6, charge: p.mode === 'charge' ? Math.min(1, p.mt / 0.8) : 0, tool }, dt);
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
    const sens = this.settings.sens || 1, inv = this.settings.invertY ? -1 : 1;
    c.yaw -= look.x * 0.0028 * sens + ck.x * dt * 2.2; c.pitch += (look.y * 0.0022 * sens + ck.y * dt * 1.4) * inv;
    if (I.wheel && !this.buildMode) { c.dist = Math.max(4, Math.min(14, c.dist + I.wheel * 0.6)); I.wheel = 0; }
    const minP = this.inDungeon ? (this.dungeonId === 'mine' && p.z < -110 ? 0.15 : 0.55) : 0.05; // boss arena is open: allow a lower camera to see Magmaw
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
    const list = this.inDungeon ? this.D.colliders : this.world.colliders;
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
    UI.hearts(p.hp, this.maxHp); UI.stamina(p.stam / 100, p.stam < 10); UI.fadeMeter(this.s.fade || 0);
    const z = this.zoneName(), zk = z + (this.dungeonId || '');
    if (zk !== this.lastZone) {
      this.lastZone = zk;
      UI.zone(this.v3ZoneLabel?.(z) || (z === 'village' ? '🛡 Oakhollow Village · safe' : z === 'camp' ? '🔥 Ashfall Camp · safe' : z === 'ember' ? '🌋 Emberfall Ridge' : z === 'dungeon' ? (this.dungeonId === 'mine' ? '⛏ Cinderdeep Mine' : '☠ The Hollow Barrow') : '🌲 The Wilds · build & fight'), z);
      if (z === 'ember' && this.lastZoneShown === 'camp' && !this.s.flags.seenRidge) { this.s.flags.seenRidge = true; UI.banner('Emberfall Ridge', 'Ash, lava and the creeping Fade'); }
      if (z === 'camp' && this.s.flags.q2_start && !this.s.flags.q2_camp) UI.toast('Ashfall Camp — find Scout Corin', '');
      this.lastZoneShown = z;
    }
    UI.setText('#me-name', this.s.name); UI.setText('#totalbadge', `⭐ ${this.totalLevel()}`); UI.setText('#gold', `🪙 ${this.s.gold.toLocaleString('en-AU')}`);
    const q = this.s.quick, qk = q === 'bomb' ? '💣' : q && this.s.inv[q] > 0 ? `${ITEMS[q].icon}×${this.s.inv[q]}` : '';
    UI.setText('#quickslot', qk); UI.show('#quickslot', !!qk);
    UI.setText('#bombcount', `💣 ${this.s.inv.bomb || 0}`); UI.show('#bombcount', !!this.s.flags.q3_bombs);
    const qh = this.questHud(), tgt = qh.tgt;
    if (tgt) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z;
      const ang = Math.atan2(dx, dz) - Math.atan2(-Math.sin(this.cam.yaw), -Math.cos(this.cam.yaw));
      UI.quest(qh.title, qh.text, -ang * 180 / Math.PI - 90, Math.hypot(dx, dz));
      const far = Math.hypot(dx, dz) > 12;
      this.beacon.visible = far; if (far) this.beacon.position.set(tgt.x, this.terrainH(tgt.x, tgt.z) + 20, tgt.z);
    } else { UI.quest(qh.title, qh.text, null); this.beacon.visible = false; }
    for (const n of this.npcs) { const m = this.npcMarker(n.id); n.mark.visible = m === '!'; n.qmark.visible = m === '?'; const b = Math.sin(this.t * 3) * 0.12; n.mark.position.y = n.qmark.position.y = n.y + 3.1 + b; }
    let pr = null;
    if (!this.inDialog && !UI.panelOpen() && (p.mode === 'normal' || p.mode === 'block')) {
      if (this.buildMode) pr = null;
      else { const it = this.findInteract(); if (it) pr = `<kbd>${this.touch ? '✋' : 'E'}</kbd>${it.label}`; this.currentInteract = it; }
    }
    if (p.mode === 'gather') { const d = NODE_TYPES[p.gnode.type]; pr = `<kbd>…</kbd>${d.skill === 'woodcutting' ? 'Chopping' : d.fish ? 'Fishing' : 'Mining'}…`; }
    if (this.coop?.reviving) pr = `<kbd>${this.touch ? '✋' : 'E'}</kbd>Reviving… ${Math.round((this.reviveProgress || 0) * 100)}%`;
    else if (p.mode === 'dead' && this.downedT && this.coop?.active) pr = `<kbd>💀</kbd>Downed · a friend can revive you · Hearthstone in ${Math.max(0, Math.ceil(this.downedT - p.mt))} s`;
    UI.prompt(pr);
    if (this.nameTag) { this.nameTag.position.set(p.x, p.y + 2.55, p.z); this.nameTag.visible = !this.touch || true; }
    if (this.buildMode) {
      const { gx, gz } = this.buildTarget(), [cx, cz] = cellCenter(gx, gz);
      const okk = !this.pieceRefusal(gx, gz, this.piece) && this.has(this.costFor(this.piece));
      this.building.setGhost(this.piece, this.rot, cx, this.building.top(gx, gz), cz, okk);
      this.building.ghost.visible = true;
    }
  }
  updateRemotes(dt) {
    const k = 1 - Math.exp(-dt * 12), now = performance.now(), myZ = zoneKey(this.p.x, this.p.z);
    for (const r of this.remotes.values()) {
      const px = r.x, pz = r.z;
      if (r.buf && r.buf.length) {
        // snapshot interpolation: render ~1.6 snapshot intervals in the past (about 130 ms direct, 400 ms via relay)
        const b = r.buf, rt = now - Math.max(90, Math.min(650, (r.iv || 83) * 1.6));
        let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
        const A = b[Math.max(0, i - 1)], B = b[i];
        if (rt >= b[b.length - 1].t) { const L = b[b.length - 1]; r.x += (L.x - r.x) * k; r.y += (L.y - r.y) * k; r.z += (L.z - r.z) * k; r.ry = lerpAngle(r.ry, L.ry, k); }
        else { const f = B.t > A.t ? Math.max(0, Math.min(1, (rt - A.t) / (B.t - A.t))) : 1; r.x = A.x + (B.x - A.x) * f; r.y = A.y + (B.y - A.y) * f; r.z = A.z + (B.z - A.z) * f; r.ry = lerpAngle(A.ry, B.ry, f); }
        while (b.length > 2 && b[1].t < rt - 200) b.shift();
      } else { r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; r.ry = lerpAngle(r.ry, r.tr, k); }
      r.at += dt;
      const sp = r.buf ? Math.hypot(r.x - px, r.z - pz) / Math.max(dt, 1e-3) : Math.hypot(r.tx - r.x, r.tz - r.z) * 8;
      r.av.root.position.set(r.x, r.y, r.z); r.av.root.rotation.y = r.ry;
      const vis = !this.coop?.active || zoneKey(r.x, r.z) === myZ; r.av.root.visible = vis; r.label.visible = vis;
      if (r.emote) { r.emote.t -= dt; if (r.emote.t <= 0) r.emote = null; }
      const a = r.emote && !r.dead && (r.a === 'idle' || r.a === 'walk') ? r.emote.name : r.a;
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
      if (this.phase === 'play') this.s.playtime = (this.s.playtime || 0) + dt;
      this.frame(dt);
    };
    loop();
  }
  musicTrack() {
    if (this.phase !== 'play') return 'village';
    if (this.visionOn) return 'vael';
    if (this.dungeonId === 'mine') { const m = this.msim.enemies.get('m_magmaw'); return m && m.alive && m.state !== 'idle' ? 'boss' : 'mine'; }
    { const m = this.v3Music?.(); if (m) return m; }
    if (this.dungeonId === 'barrow') { const w = this.dsim.enemies.get('d_warden'); return w && w.alive && w.state !== 'idle' && w.state !== 'return' ? 'boss' : 'barrow'; }
    const z = this.zoneName(); return z === 'village' ? 'village' : z === 'camp' ? 'camp' : z === 'ember' ? 'ember' : 'wild';
  }
  frame(dt) {
    if (this.phase === 'play') {
      this.updatePlayer(dt); this.updateEnemies(dt); this.updateRemotes(dt); this.updateNodes(); this.sendState(dt); this.coop?.update(dt);
      this.updateBombs(dt); this.updateFlashes(dt); this.updateProjs(dt); this.updateHazards(dt); this.updateTraps(dt); this.updateLoot(dt); this.updatePets(dt);
      this.v3Frame(dt); this.pvpFrame?.(dt);
      this.updateHUD();
    } else {
      this.p.ry = 0.4;
      this.player.root.position.set(this.p.x, this.p.y, this.p.z);
      this.player.root.rotation.y = Math.sin(this.t * 0.6) * 0.6 + 0.4;
      animateAvatar(this.player, { anim: 'idle', t: 0, speed: 0 }, dt);
    }
    // NPCs: idle fidgets, face + gesture while talking to you
    for (const n of this.npcs) {
      const talking = this.inDialog && this.talkNpc === n;
      const near = this.phase === 'play' && Math.hypot(n.x - this.p.x, n.z - this.p.z) < 5;
      if (talking || near) n.av.root.rotation.y = lerpAngle(n.av.root.rotation.y, Math.atan2(this.p.x - n.x, this.p.z - n.z), Math.min(1, dt * 5));
      else n.av.root.rotation.y = lerpAngle(n.av.root.rotation.y, n.ry0, Math.min(1, dt * 2));
      const cyc = (this.t + n.phase) % 12;
      const anim = talking ? 'talk' : near && cyc < 1.6 && !n.waved ? 'wave' : cyc > 7 && cyc < 10 ? 'idle2' : 'idle';
      if (near && cyc >= 1.6) n.waved = true; if (!near) n.waved = false;
      n.av.t = (n.av.t || 0) + dt;
      animateAvatar(n.av, { anim, t: cyc, speed: 0 }, dt);
    }
    for (const a of this.altars) a.cry.rotation.y = this.t * 1.5;
    this.updateCamera(dt);
    this.world.updateWater(this.t); this.dungeon.update(this.t, dt); this.particles.update(dt); this.building.update(this.t, dt);
    const did = this.phase === 'play' ? this.dungeonId : null;
    this.mine.group.visible = did === 'mine'; this.dungeon.group.visible = did !== 'mine';
    if (did === 'mine' || (this.coop?.isHost && this.coop.joinedPeers.some((q) => zoneKey(q.x, q.z) === 'mine'))) for (const ev of this.mine.update(this.t, dt)) this.onMineEvent(ev);
    const focus = new THREE.Vector3(this.p.x, this.p.y, this.p.z);
    this.ridge.update(this.t, dt, focus, this.zoneName());
    const tod = this.todOverride ?? ((Date.now() / 1000 / 600 + 0.12) % 1);
    this.world.setTime(tod, focus, this.inDungeon, did || this.zoneName());
    this.v3Visuals(dt);
    this.audio.setTrack(this.musicTrack());
    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  }
}
Object.assign(Game.prototype, RPG, Story, Systems);
installV3(Game);
installPvP(Game);
