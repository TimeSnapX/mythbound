// Mythbound v3.0 systems, mixed into Game.prototype by installV3(Game):
// save migration v2 -> v3, regions (discovery, Cold / Heat meters, weather, day/night hooks), world map + fast travel,
// daily / weekly tasks with streaks, ~40 achievements + collection log, farming + herblore potions, mounts, the trading
// post (NPC liquidity market), Drowned Belfry / pyramid logic, side quests per region, Act 1 finale, what's-new splash
// and the phone layout editor. PvP lives in pvp-session.js.
import * as THREE from 'three';
import { ENEMY_TYPES, isSafeZone,
  ITEMS, GEAR, NODE_TYPES, SKILLS, REGIONS, V3_HEARTHS, SHRINE, OASIS, PORT, FADELANDS, ARENA,
  BELFRY_START, PYRAMID_START, BELFRY_ENTRANCE, POTIONS, CROPS, PATCHES, MOUNTS, STABLE, ASHWOLF_DEN, SHOPS, COSMETICS,
  MARKET_ITEMS, TASK_POOL, TASK_REWARD, STREAK_BONUS, SPAWN, CAMP, BLOCK, cellCenter, islandHeight, RECIPES, SAVE_VERSION,
} from './shared.js';
import * as UI from './ui.js';
import { makeLabel } from './world.js';
import { NPC_DEFS, QUESTS } from './story.js';
import { PLATES, PLATE_ORDER, bstate } from './belfry.js';
import { REGION_FOG } from './regions.js';

const esc = UI.esc;
const nm = (k) => ITEMS[k]?.name || GEAR[k]?.name || k;
const ic = (k) => ITEMS[k]?.icon || GEAR[k]?.icon || '❔';
const fmt = (n) => Math.round(n).toLocaleString('en-AU');
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const weekKey = (d = new Date()) => { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return 'W' + dayKey(m); }; // local Monday
const hashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const seeded = (seed) => { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const REGION_OF_ZONE = { frost: 'frost', desert: 'desert', oasis: 'desert', swamp: 'swamp', coast: 'coast', port: 'coast' };

// ---------------- save migration (v2 -> v3): adds the new fields, keeps everything else untouched ----------------
export function v3Fields() {
  return { tasks: null, ach: {}, coll: { items: {}, bosses: {} }, patches: {}, mounts: { wolf: false, horse: false }, mountPref: null,
    market: null, stats: { kills: 0, harvests: 0, potions: {}, travels: 0, trades: 0, tasksDone: 0, duelWins: 0, arenaWins: 0, pvpKills: 0, bossKills: 0 },
    cosmetic: { cape: null, title: null } };
}
export function migrateV3(s) {
  if (!s || typeof s !== 'object') return s;
  const was = s.v || 1, f = v3Fields();
  for (const [k, v] of Object.entries(f)) if (s[k] === undefined) s[k] = v;
  s.stats = { ...f.stats, ...(s.stats || {}) }; s.coll = { items: {}, bosses: {}, ...(s.coll || {}) }; s.mounts = { wolf: false, horse: false, ...(s.mounts || {}) };
  s.cosmetic = { cape: null, title: null, ...(s.cosmetic || {}) }; s.ach ||= {}; s.patches ||= {};
  s.xp ||= {}; for (const k of SKILLS) if (typeof s.xp[k] !== 'number') s.xp[k] = 0;
  if (was < 3) { s.migratedV3 = { from: was, at: Date.now() }; s.v = SAVE_VERSION; }
  return s;
}

// ---------------- new NPCs and quests (registered before the Game builds its NPCs) ----------------
const H3 = Object.fromEntries(V3_HEARTHS.map((h) => [h.id, h]));
NPC_DEFS.push(
  { id: 'stablemaster', name: 'Hallam the Stablemaster', x: STABLE.x + 2.6, z: STABLE.z + 2.2, look: { skin: 3, hair: 2, hairColor: 1, tunic: 2 }, ry: -0.8, shop: 'stable' },
  { id: 'broker', name: 'Ysolde the Broker', x: 5.5, z: -5, look: { skin: 1, hair: 1, hairColor: 0, tunic: 5 }, ry: -0.6 },
  { id: 'arenamaster', name: 'Arena-master Dace', x: ARENA.x, z: ARENA.z - ARENA.r - 2, look: { skin: 2, hair: 3, hairColor: 2, tunic: 1 }, ry: 0 },
  { id: 'sable', name: 'Warden Sable', x: FADELANDS.x - FADELANDS.r - 2.5, z: FADELANDS.z + 3, look: { skin: 4, hair: 0, hairColor: 4, tunic: 3 }, ry: Math.PI / 2 },
  { id: 'olaf', name: 'Hermit Olaf', x: H3.h_frost.x + 3.5, z: H3.h_frost.z + 2, look: { skin: 0, hair: 3, hairColor: 4, tunic: 0 }, ry: Math.PI },
  { id: 'zahra', name: 'Zahra the Merchant', x: OASIS.x + 3, z: OASIS.z + 0.6, look: { skin: 3, hair: 1, hairColor: 0, tunic: 4 }, ry: 0, shop: 'oasis' },
  { id: 'amun', name: 'Teller Amun (bank)', x: OASIS.x - 4, z: OASIS.z + 2, look: { skin: 3, hair: 0, hairColor: 0, tunic: 1 }, ry: 0.6 },
  { id: 'ysolde2', name: 'Bazaar Broker', x: OASIS.x - 2, z: OASIS.z + 3.2, look: { skin: 2, hair: 1, hairColor: 1, tunic: 5 }, ry: 0 },
  { id: 'mag', name: 'Old Mag', x: H3.h_swamp.x + 3, z: H3.h_swamp.z + 2.5, look: { skin: 1, hair: 1, hairColor: 4, tunic: 3 }, ry: -1.2 },
  { id: 'brine', name: 'Captain Brine', x: PORT.x + 3, z: PORT.z + 1.6, look: { skin: 0, hair: 3, hairColor: 3, tunic: 2 }, ry: 0, shop: 'port' },
  { id: 'lin', name: 'Purser Lin (bank)', x: PORT.x - 4, z: PORT.z + 3.6, look: { skin: 4, hair: 2, hairColor: 0, tunic: 1 }, ry: 0 },
);
const V3_NPCS = new Set(['stablemaster', 'broker', 'arenamaster', 'sable', 'olaf', 'zahra', 'amun', 'ysolde2', 'mag', 'brine', 'lin']);
QUESTS.push(
  { id: 'q4', name: 'The Drowned Belfry', req: 'q3_done', lockedText: 'Finish "Into Cinderdeep" first.', main: 1,
    flags: ['q4_start', 'q4_enter', 'hookshot', 'bf_key', 'bf_ledge', 'bf_boss', 'bf_vael', 'act1_done'], steps: [
      'Speak with Elder Maren about the drowned bells tolling at night.', 'Find the Drowned Belfry in the western marsh of the isle and go inside.',
      'Search the flooded nave for the Hookshot.', 'Bell Cistern: ring the Low bell to drain the basin, then take the sluice key from the bottom.',
      'Ring the High bell (the key unlocks its chain) and ride the floating bell-deck up to the north ledge.', 'Hookshot across to the loft and defeat the Bellkeeper.',
      'Enter the Scriptorium and stop Vael the Unwriter. Watch her ink lines and dodge-roll through them.', "Open the chest and take Vael's Broken Quill."] },
  { id: 'sq_frost', name: "The Shrine's Light", req: 'disc_frost', lockedText: 'Discover Frostspire Peaks first (north causeway).', side: 1, region: 'frost', flags: ['sf_start', 'sf_bloom', 'sf_shrine', 'sf_done'], steps: [
    'Talk to Hermit Olaf by the Frostspire Hearthstone.', 'Gather 3 Frostbloom from the snowy slopes.', 'Lay the Frostbloom at the summit shrine.', 'Return to Hermit Olaf.'] },
  { id: 'sq_desert', name: 'The Sun Idol', req: 'disc_desert', lockedText: 'Discover the Sunscar Desert first (south causeway).', side: 1, region: 'desert', flags: ['sd_start', 'sd_enter', 'py_open', 'py_idol', 'sd_done'], steps: [
    'Talk to Zahra in the oasis.', 'Enter the ruined pyramid.', 'Step on the pressure plates in the order shown by the glyphs.', 'Take the Sun Idol.', 'Bring the Sun Idol to Zahra.'] },
  { id: 'sq_swamp', name: "The Bog Witch's Charm", req: 'disc_swamp', lockedText: 'Discover Mirewood Swamp first (west causeway).', side: 1, region: 'swamp', flags: ['sw_start', 'sw_charm', 'sw_done'], steps: [
    'Talk to Old Mag at the Mirewood Hearthstone.', 'Defeat bog witches until one drops her charm.', 'Bring the charm to Old Mag.'] },
  { id: 'sq_coast', name: 'X Marks the Spot', req: 'disc_coast', lockedText: 'Discover Starfall Coast first (east causeway).', side: 1, region: 'coast', flags: ['sc_start', 'sc_map', 'sc_dig', 'sc_done'], steps: [
    'Talk to Captain Brine at the port.', 'Defeat pirates on the beaches until one drops a torn map.', 'Dig at the X on the southern beach.', 'Return to Captain Brine.'] },
);
const QBY = Object.fromEntries(QUESTS.map((q) => [q.id, q]));
export const DIG_SPOT = { x: REGIONS.coast.x + 6, z: REGIONS.coast.z + 34 };

// ---------------- achievements (43) ----------------
const lvMax = (g) => Math.max(...SKILLS.map((k) => g.level(k)));
const A = (id, icon, name, desc, check) => ({ id, icon, name, desc, check });
export const ACHIEVEMENTS = [
  A('first_blood', '🗡', 'First Blood', 'Defeat your first enemy', (g) => g.s.stats.kills >= 1),
  A('slayer100', '⚔', 'Monster Hunter', 'Defeat 100 enemies', (g) => g.s.stats.kills >= 100),
  A('slayer500', '💀', 'Scourge of the Wilds', 'Defeat 500 enemies', (g) => g.s.stats.kills >= 500),
  A('warden', '🗿', 'Barrow Breaker', 'Defeat the Barrow Warden', (g) => !!g.s.flags.boss),
  A('magmaw', '🌋', 'Furnace Quencher', 'Defeat Magmaw', (g) => !!g.s.flags.q3_boss),
  A('bellkeeper', '🔔', 'Silence the Bells', 'Defeat the Bellkeeper', (g) => !!g.s.flags.bf_boss),
  A('vael', '🪶', 'Unwritten No More', 'Defeat Vael the Unwriter', (g) => !!g.s.flags.bf_vael),
  A('act1', '📖', 'Act 1 Complete', 'Finish the first act of the story', (g) => !!g.s.flags.act1_done),
  A('wyrm', '🐉', 'Wyrmslayer', 'Defeat the Frost Wyrm', (g) => (g.s.coll.bosses.frostwyrm || 0) > 0),
  A('worm', '🪱', 'Dune Breaker', 'Defeat the Sunscar Sandworm', (g) => (g.s.coll.bosses.sandworm || 0) > 0),
  A('disc_frost', '🏔', 'Into the Cold', 'Discover Frostspire Peaks', (g) => !!g.s.flags.disc_frost),
  A('disc_desert', '🏜', 'Sun-scorched', 'Discover the Sunscar Desert', (g) => !!g.s.flags.disc_desert),
  A('disc_swamp', '🌿', 'Bog Trotter', 'Discover Mirewood Swamp', (g) => !!g.s.flags.disc_swamp),
  A('disc_coast', '⚓', 'Sea Legs', 'Discover Starfall Coast', (g) => !!g.s.flags.disc_coast),
  A('explorer', '🧭', 'Cartographer', 'Discover all four new regions', (g) => ['frost', 'desert', 'swamp', 'coast'].every((k) => g.s.flags['disc_' + k])),
  A('hearths', '🔥', 'Keeper of Flames', 'Light all four region Hearthstones', (g) => V3_HEARTHS.every((h) => g.s.flags['hl_' + h.id])),
  A('traveller', '🗺', 'Frequent Traveller', 'Fast travel 10 times', (g) => g.s.stats.travels >= 10),
  A('lv10', '⭐', 'Apprentice', 'Reach level 10 in any skill', (g) => lvMax(g) >= 10),
  A('lv30', '🌟', 'Journeyman', 'Reach level 30 in any skill', (g) => lvMax(g) >= 30),
  A('lv50', '👑', 'Master', 'Reach level 50 in any skill', (g) => lvMax(g) >= 50),
  A('total200', '📈', 'Well Rounded', 'Reach total level 200', (g) => g.totalLevel() >= 200),
  A('farmer', '🌱', 'Green Thumb', 'Harvest your first farming patch', (g) => g.s.stats.harvests >= 1),
  A('farmer25', '🎃', 'Harvest Festival', 'Harvest 25 farming patches', (g) => g.s.stats.harvests >= 25),
  A('brewer', '🧪', 'Brewer', 'Mix your first potion', (g) => Object.keys(g.s.stats.potions).length >= 1),
  A('alchemist', '⚗', 'Alchemist', 'Mix all eight kinds of potion', (g) => Object.keys(POTIONS).every((k) => g.s.stats.potions[k])),
  A('rider', '🐎', 'Saddle Up', 'Get your first mount', (g) => g.s.mounts.wolf || g.s.mounts.horse),
  A('stable', '🐺', 'Full Stable', 'Own both the ash-wolf and the horse', (g) => g.s.mounts.wolf && g.s.mounts.horse),
  A('duelist', '🤺', 'Duelist', 'Win a duel', (g) => g.s.stats.duelWins >= 1),
  A('gladiator', '🏟', 'Gladiator', 'Win an arena round', (g) => g.s.stats.arenaWins >= 1),
  A('champion', '🏆', 'Arena Champion', 'Win 10 arena rounds', (g) => g.s.stats.arenaWins >= 10),
  A('skull', '☠', 'Marked', 'Enter the Fadelands with the skull flag', (g) => !!g.s.flags.fl_entered),
  A('reaper', '⚰', 'Fade Reaper', 'Defeat a flagged player in the Fadelands', (g) => g.s.stats.pvpKills >= 1),
  A('trader', '⚖', 'Merchant Prince', 'Make 10 trades at the trading post', (g) => g.s.stats.trades >= 10),
  A('tycoon', '💰', 'Tycoon', 'Hold 10,000 coins', (g) => g.s.gold >= 10000),
  A('nightfish', '🌙', 'Night Owl', 'Catch a Moonfish (night only)', (g) => !!g.s.coll.items.raw_moonfish),
  A('rainfish', '🌈', 'Rain Dancer', 'Catch a Rainbow Trout (rain only)', (g) => !!g.s.coll.items.raw_rainbow),
  A('deepsea', '🐟', 'Deep Waters', 'Catch a Swordfish at Starfall', (g) => !!g.s.coll.items.raw_swordfish),
  A('streak7', '📅', 'Creature of Habit', 'Reach a 7-day task streak', (g) => (g.s.tasks?.best || 0) >= 7),
  A('tasks25', '✅', 'Taskmaster', 'Complete 25 daily or weekly tasks', (g) => g.s.stats.tasksDone >= 25),
  A('mithril', '🔵', 'Blue Steel', 'Smelt a Mithril Bar', (g) => !!g.s.coll.items.mithril_bar),
  A('adamant', '🟩', 'Adamant Will', 'Smelt an Adamant Bar', (g) => !!g.s.coll.items.adamant_bar),
  A('pyramid', '🏺', 'Tomb Raider', 'Take the Sun Idol from the pyramid', (g) => !!g.s.flags.py_idol),
  A('collector', '📗', 'Collector', 'Fill 40 collection log slots', (g) => g.collCount() >= 40),
];
// ---------------- collection log ----------------
export const COLLECTION = {
  Bosses: ['warden', 'magmaw', 'bellkeeper', 'vael', 'frostwyrm', 'sandworm'],
  'Rare drops': ['wyrm_scale', 'worm_tooth', 'vael_quill', 'ink_shard', 'seed_ranarr', 'pirate_map', 'warm_cloak', 'witch_charm', 'uncut_diamond', 'uncut_emerald'],
  Fish: ['raw_trout', 'raw_icefish', 'raw_moonfish', 'raw_rainbow', 'raw_swordfish'],
  Herbs: ['herb_guam', 'herb_marrentill', 'herb_ranarr', 'herb_sunleaf', 'herb_frostbloom', 'herb_bloodmoss'],
  Potions: Object.values(POTIONS).map((p) => p.item),
  'Ores & bars': ['copper_ore', 'tin_ore', 'iron_ore', 'coal', 'mithril_ore', 'adamant_ore', 'bronze_bar', 'iron_bar', 'steel_bar', 'mithril_bar', 'adamant_bar'],
  Farming: ['potato', 'pumpkin', 'apple'],
  Cosmetics: Object.keys(COSMETICS),
};
for (const [k, v] of Object.entries(COLLECTION)) if (k !== 'Bosses') COLLECTION[k] = v.filter((i) => ITEMS[i]);
const COLL_ITEMS = new Set(Object.entries(COLLECTION).filter(([k]) => k !== 'Bosses').flatMap(([, v]) => v));
const BOSS_NAMES = { warden: 'Barrow Warden', magmaw: 'Magmaw', bellkeeper: 'The Bellkeeper', vael: 'Vael the Unwriter', frostwyrm: 'The Frost Wyrm', sandworm: 'Sunscar Sandworm' };

// ---------------- what's new ----------------
const WHATS_NEW = [
  ['⚔', 'PvP', 'Duels with rules, the Ashfall Arena (1v1 / 2v2), the opt-in Fadelands and a season leaderboard'],
  ['🔔', 'The Drowned Belfry', 'Hookshot, a water-level bell puzzle, the Bellkeeper and Vael the Unwriter. Act 1 finale!'],
  ['🗺', 'Four new regions', 'Frostspire Peaks, Sunscar Desert, Mirewood Swamp and Starfall Coast, with fast travel'],
  ['🌱', 'Farming & Herblore', 'Grow herbs and crops on your home plot in real time, then mix potions'],
  ['🐎', 'Mounts', 'Tame an ash-wolf or buy a horse at the Oakhollow stable'],
  ['✅', 'Tasks & achievements', '3 dailies and 2 weeklies with streaks, 43 achievements and a collection log'],
  ['⚖', 'Trading post', 'Buy and sell at live prices, and trade safely with friends in co-op'],
  ['🌧', 'Day, night & weather', 'Night-only and rain-only fish, night monsters, blizzards and sandstorms'],
  ['📱', 'Phone controls 2.0', 'Bigger buttons and a drag-to-move layout editor (Settings)'],
];

export function mount3D(kind) {
  const g = new THREE.Group(), c = kind === 'wolf' ? 0x6a6a72 : 0x7a5030, d = kind === 'wolf' ? 0x3a3a40 : 0x3a2414;
  const m = (geo, col, x, y, z) => { const o = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col, flatShading: true })); o.position.set(x, y, z); g.add(o); return o; };
  const L = kind === 'wolf' ? 0.55 : 0.75;
  m(new THREE.BoxGeometry(0.7, 0.55, 1.6), c, 0, L + 0.25, 0);
  const head = m(new THREE.BoxGeometry(0.45, 0.45, kind === 'wolf' ? 0.6 : 0.75), c, 0, L + 0.65, 0.95); head.rotation.x = kind === 'wolf' ? 0 : 0.5;
  if (kind === 'wolf') { m(new THREE.ConeGeometry(0.1, 0.25, 4), d, -0.13, L + 0.95, 0.85); m(new THREE.ConeGeometry(0.1, 0.25, 4), d, 0.13, L + 0.95, 0.85); }
  else m(new THREE.BoxGeometry(0.12, 0.5, 0.9), d, 0, L + 0.7, 0.45);
  const legs = []; for (const [x, z] of [[-0.25, 0.6], [0.25, 0.6], [-0.25, -0.6], [0.25, -0.6]]) legs.push(m(new THREE.BoxGeometry(0.16, L, 0.16).translate(0, -L / 2, 0), d, x, L, z));
  const tail = m(new THREE.BoxGeometry(0.12, 0.12, 0.6).translate(0, 0, -0.3), d, 0, L + 0.4, -0.8); tail.rotation.x = -0.5;
  if (kind === 'horse') m(new THREE.BoxGeometry(0.75, 0.12, 0.7), 0x8a2a20, 0, L + 0.56, 0);
  g.userData = { legs, tail, L };
  return g;
}

// ======================================================================================================
const V3 = {
  v3Init() {
    migrateV3(this.s);
    this.buffs = {}; this.cold = 0; this.heat = 0; this.poison = 0; this.weatherOverride = null; this.mounted = null; this.weather = 'clear';
    // belfry entrance on the isle (west marsh)
    { const y = islandHeight(BELFRY_ENTRANCE.x, BELFRY_ENTRANCE.z), g = new THREE.Group(); g.position.set(BELFRY_ENTRANCE.x, y, BELFRY_ENTRANCE.z); this.scene.add(g);
      const st = new THREE.MeshLambertMaterial({ color: 0x5a6670, flatShading: true });
      for (const sx of [-1.8, 1.8]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 0.8), st); p.position.set(sx, 2.5, 0); g.add(p); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.8, 1), st); top.position.y = 5.2; g.add(top);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 1.2, 8), new THREE.MeshLambertMaterial({ color: 0xb08a3a })); bell.position.y = 4.2; g.add(bell);
      const dark = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 4.4), new THREE.MeshBasicMaterial({ color: 0x050a0c, side: THREE.DoubleSide })); dark.position.set(0, 2.2, 0); g.add(dark);
      const l = makeLabel('🔔 The Drowned Belfry', '#bfe4ff', 0.9); l.position.set(BELFRY_ENTRANCE.x, y + 6.4, BELFRY_ENTRANCE.z); this.scene.add(l);
      this.world.colliders.push({ c: 1, x: BELFRY_ENTRANCE.x - 1.8, z: BELFRY_ENTRANCE.z, r: 0.5 }, { c: 1, x: BELFRY_ENTRANCE.x + 1.8, z: BELFRY_ENTRANCE.z, r: 0.5 }); }
    // apothecary benches (herblore) in the new towns
    for (const [x, z] of [[OASIS.x + 6, OASIS.z + 4], [PORT.x + 1, PORT.z - 6]]) { const y = islandHeight(x, z), o = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.8), new THREE.MeshLambertMaterial({ color: 0x6a4a8a })); o.position.set(x, y + 0.45, z); this.scene.add(o); this.world.stations.push({ kind: 'workbench', x, z, y, obj: o, label: 'Use the apothecary bench <small>(Herblore · Crafting)</small>' }); this.world.colliders.push({ c: 1, x, z, r: 0.7 }); }
    // tameable ash-wolf at the den
    this.denWolf = mount3D('wolf'); this.denWolf.position.set(ASHWOLF_DEN.x + 1.5, islandHeight(ASHWOLF_DEN.x + 1.5, ASHWOLF_DEN.z), ASHWOLF_DEN.z); this.scene.add(this.denWolf);
    this.mountObj = null; this.patchObjs = new Map();
    for (const h of V3_HEARTHS) this.r3.setHearth(h.id, !!this.s.flags['hl_' + h.id]);
    this.v3BuildUI(); this.v3ApplyLayout();
    addEventListener('resize', () => this.v3ApplyLayout());
  },
  // ------------- UI scaffolding -------------
  v3BuildUI() {
    const tb = document.getElementById('topbtns'), inst = document.getElementById('btn-install');
    const add = (id, icon, title, kind) => { const b = document.createElement('button'); b.id = id; b.textContent = icon; b.title = title; b.onclick = () => { this.audio.play('ui'); this.togglePanel(kind); }; tb.insertBefore(b, inst); };
    add('btn-map', '🗺', 'World map & fast travel (M)', 'map'); add('btn-tasks', '✅', 'Tasks, achievements & collection log (Y)', 'tasks'); add('btn-pvp', '⚔', 'PvP: duels, arena, trade, leaderboard (U)', 'pvp');
    const tl = document.getElementById('topleft');
    for (const [id, label] of [['coldmeter', '❄ Cold'], ['heatmeter', '☀ Heat'], ['poisonmeter', '☠ Poison']]) { const d = document.createElement('div'); d.id = id; d.className = 'v3meter hidden'; d.innerHTML = `<span>${label}</span><div><i></i></div>`; tl.appendChild(d); }
    const bf = document.createElement('div'); bf.id = 'buffs'; tl.appendChild(bf);
    const sk = document.createElement('span'); sk.id = 'skullbadge'; sk.className = 'hidden'; sk.textContent = '☠ PvP flagged'; document.getElementById('badges').appendChild(sk);
    const wb = document.createElement('span'); wb.id = 'weather-badge'; document.getElementById('badges').appendChild(wb);
    const tb1 = document.getElementById('tbtns'), tb2 = document.getElementById('tbtns2');
    if (tb1) { const m = document.createElement('button'); m.dataset.act = 'mount'; m.id = 't-mount'; m.textContent = '🐎'; m.className = 'hidden'; tb1.appendChild(m); }
    if (tb2) for (const [act, id, icon] of [['map', 't-map', '🗺'], ['tasks', 't-tasks', '✅'], ['pvp', 't-pvp', '⚔']]) { const b = document.createElement('button'); b.dataset.act = act; b.id = id; b.textContent = icon; tb2.appendChild(b); }
    for (const id of ['t-mount', 't-map', 't-tasks', 't-pvp']) { const b = document.getElementById(id); if (b) this.input.bindTouchButton(b); }
    const mk = (id) => { const d = document.createElement('div'); d.id = id; d.className = 'hidden'; document.body.appendChild(d); return d; };
    mk('whatsnew'); mk('act1'); mk('layoutbar'); mk('pvphud'); mk('invite');
    document.body.addEventListener('click', (e) => this.v3Click(e));
    document.getElementById('panel').addEventListener('click', (e) => this.v3PanelClick(e));
  },
  v3Click(e) { if (e.v3done) return; const b = e.target.closest('[data-v3]'); if (!b || b.closest('#panel')) return; this.v3Action(b.dataset.v3, b.dataset.arg, e); },
  v3PanelClick(e) {
    const b = e.target.closest('[data-v3]'); if (b) { e.v3done = true; return this.v3Action(b.dataset.v3, b.dataset.arg, e); }
    const it = e.target.closest('[data-item]');
    if (it && this.panelKind === 'bag') { // extra item-menu actions for v3 items
      const k = it.dataset.item, menu = document.querySelector('#itemmenu .imenu'); if (!menu) return;
      const I = ITEMS[k] || {}, extra = [];
      if (I.potion || I.cool) extra.push(`<button data-v3="drink" data-arg="${k}">Drink</button>`);
      if (I.potion) extra.push(`<button data-act-item="quick" data-k="${k}">Set quick-slot</button>`);
      if (COSMETICS[k]) extra.push(`<button data-v3="cosmetic" data-arg="${k}">Wear / remove</button>`);
      if (I.seed) extra.push(`<button data-v3="planthint" data-arg="${k}">Plant…</button>`);
      menu.insertAdjacentHTML('beforeend', extra.join(''));
    }
  },
  v3Action(a, arg, e) {
    switch (a) {
      case 'close-wn': this.settings.seenV3 = true; this.saveSettings(); UI.show('#whatsnew', false); return;
      case 'close-act1': UI.show('#act1', false); return;
      case 'travel': return this.fastTravel(arg);
      case 'tab': return this.openPanel(arg);
      case 'claim': return this.claimTask(arg);
      case 'drink': this.drink(arg); return this.openPanel('bag');
      case 'cosmetic': return this.wearCosmetic(arg);
      case 'planthint': return UI.toast('Plant seeds at a farming patch on your home plot (claim one with P / 🏠 in build mode).', '');
      case 'plant': { const [pid, seed] = arg.split('|'); this.plant(pid, seed); return this.closePanel(); }
      case 'compost': this.compost(arg); return this.openPanel('farm:' + arg);
      case 'mbuy': { const [k, n] = arg.split('|'); this.marketBuy(k, +n); return this.openPanel('market'); }
      case 'msell': { const [k, n] = arg.split('|'); this.marketSell(k, n === 'all' ? Infinity : +n); return this.openPanel('market'); }
      case 'qbuy': this.tokenBuy(arg); return this.openPanel('qm');
      case 'mount': return this.toggleMount(arg);
      case 'layout': this.closePanel(); return this.layoutEdit(true);
      case 'layout-done': return this.layoutEdit(false);
      case 'layout-reset': this.settings.layout = {}; this.saveSettings(); this.v3ApplyLayout(); return;
      case 'btnscale': this.settings.btnScale = +arg; this.saveSettings(); this.v3ApplyLayout(); return this.openPanel('settings');
      case 'wn': this.closePanel(); return this.showWhatsNew(true);
      default: return this.pvpAction?.(a, arg, e);
    }
  },
  v3Panel(kind) {
    const map = { map: () => this.mapHtml(), tasks: () => this.tasksHtml(), ach: () => this.achHtml(), coll: () => this.collHtml(), market: () => this.marketHtml(), qm: () => this.qmHtml(), mounts: () => this.mountsHtml(), journal: () => this.journalHtml3() };
    if (map[kind]) return [map[kind](), 'wide'];
    if (kind.startsWith('farm:')) return [this.farmHtml(kind.slice(5)), ''];
    return this.pvpPanel?.(kind) || null;
  },
  afterPanel(kind) {
    if (kind === 'map') this.drawMap();
    if (kind === 'settings') document.getElementById('panel').insertAdjacentHTML('beforeend', `<h3>📱 Phone controls</h3><div class="cloud-actions"><button data-v3="layout">✥ Edit button layout</button><button data-v3="layout-reset">Reset layout</button></div>
      <div class="set">Touch button size <span class="seg">${[1, 1.15, 1.3, 1.5].map((v) => `<button data-v3="btnscale" data-arg="${v}" class="${(this.settings.btnScale || (this.touch ? 1.15 : 1)) === v ? 'on' : ''}">${Math.round(v * 100)}%</button>`).join('')}</span></div>
      <div class="cloud-actions"><button data-v3="wn">✨ What's new in v3</button></div>`);
  },
  // ------------- per frame -------------
  isNight() { return !this.inDungeon && (this.world.night || 0) > 0.55; },
  weatherAt(zone) {
    if (this.inDungeon) return 'clear';
    if (this.weatherOverride) return this.weatherOverride;
    const r = REGION_OF_ZONE[zone] || (['ember', 'camp', 'fadelands', 'arena'].includes(zone) ? 'ember' : 'isle');
    const v = seeded(hashStr(r + Math.floor(Date.now() / 180000)))();
    if (r === 'frost') return v < 0.4 ? 'snow' : v < 0.65 ? 'blizzard' : 'clear';
    if (r === 'desert') return v < 0.3 ? 'sand' : 'clear';
    if (r === 'swamp') return v < 0.5 ? 'rain' : 'clear';
    if (r === 'ember') return v < 0.35 ? 'ash' : 'clear';
    return v < 0.28 ? 'rain' : 'clear';
  },
  v3Visuals(dt) {
    const p = this.p, z = this.phase === 'play' ? this.zoneName() : 'village', did = this.phase === 'play' ? this.dungeonId : null;
    this.weather = this.weatherAt(z);
    this.r3.update(this.t, dt, p, this.weather, this.world.night || 0, !!did);
    this.belfry.group.visible = did === 'belfry'; this.pyramid.group.visible = did === 'pyramid';
    if (did === 'belfry' || did === 'pyramid') this.dungeon.group.visible = false;
    if (did === 'belfry') this.belfry.update(this.t, dt); if (did === 'pyramid') this.pyramid.update(this.t, dt);
    if (!did) { // regional fog + weather (cheap: fog / colour only, no extra lights)
      const rk = REGION_OF_ZONE[z], fog = this.scene.fog, day = 1 - (this.world.night || 0);
      if (rk) { const c = (this._rc ||= new THREE.Color()).setHex(REGION_FOG[rk]).multiplyScalar(0.25 + 0.75 * day); fog.color.lerp(c, 0.55); }
      if (this.weather === 'blizzard' || this.weather === 'sand') { fog.near = 4; fog.far = Math.min(fog.far, 60); fog.color.lerp(this._wc ||= new THREE.Color(this.weather === 'sand' ? 0xd8b880 : 0xe8eef4), 0.5 * (0.3 + day * 0.7)); }
      else if (this.weather === 'rain' || this.weather === 'snow') { fog.far = Math.min(fog.far, 115); fog.color.multiplyScalar(0.88); }
      this.scene.background.copy(fog.color);
    }
  },
  v3Frame(dt) {
    const p = this.p, s = this.s, z = this.zoneName();
    this.localSim.isNight ||= () => this.isNight();
    const rk = REGION_OF_ZONE[z];
    if (rk && !s.flags['disc_' + rk]) this.discover(rk);
    if (z === 'arena') s.flags.seenArena = true;
    for (const k of Object.keys(this.buffs)) { this.buffs[k] -= dt; if (this.buffs[k] <= 0) { delete this.buffs[k]; UI.toast(`${POTIONS[k] ? ITEMS[POTIONS[k].item].name : k} wore off.`, ''); } }
    if (this.buffs.stamina) p.stam = 100;
    if (this.buffs.fade && this.inFog) s.fade = Math.max(0, (s.fade || 0) - 4.5 * dt);
    this.slowT = Math.max(0, (this.slowT || 0) - dt);
    this.updateClimate(dt, z); this.updateMount(dt); this.updatePatches(); this.updateBelfry(dt); this.updatePyramid();
    this.denWolf.visible = !s.mounts.wolf && !this.inDungeon;
    this.v3T = (this.v3T || 0) + dt;
    if (this.v3T > 1) { this.v3T = 0; this.tasksEnsure(); this.checkAch(); this.v3Hud(); this.marketTick(); }
    if (!this.settings.seenV3 && !this.wnShown && this.t > 1.5 && !this.inDialog && !UI.panelOpen()) this.showWhatsNew();
    const I = this.input, blocked = this.inDialog || this.fading;
    if (!blocked) { if (I.wasPressed('map')) this.togglePanel('map'); if (I.wasPressed('tasks')) this.togglePanel('tasks'); if (I.wasPressed('mount')) this.toggleMount(); if (I.wasPressed('pvp')) this.togglePanel('pvp'); }
  },
  v3Hud() {
    const W = this.weather, ico = { clear: this.isNight() ? '🌙' : '☀', rain: '🌧', snow: '🌨', blizzard: '❄', sand: '🌪', ash: '🌫' }[W] || '';
    UI.setText('#weather-badge', this.inDungeon ? '' : `${ico} ${W === 'clear' ? (this.isNight() ? 'Night' : 'Day') : W === 'sand' ? 'Sandstorm' : W[0].toUpperCase() + W.slice(1)}`);
    const bf = Object.entries(this.buffs).map(([k, t]) => `<span>${POTIONS[k] ? ITEMS[POTIONS[k].item].icon : '✨'}${Math.ceil(t)}s</span>`).join('');
    const el = document.getElementById('buffs'); if (el.innerHTML !== bf) el.innerHTML = bf;
    UI.show('#t-mount', !!(this.s.mounts.wolf || this.s.mounts.horse));
  },
  meter(id, v) { const e = document.getElementById(id); e.classList.toggle('hidden', v <= 0.5); e.querySelector('i').style.width = v.toFixed(0) + '%'; e.classList.toggle('max', v >= 100); },
  // ------------- Cold / Heat / poison -------------
  warmGear() { return this.s.equip.head === 'fur_hood' || (this.s.inv.warm_cloak > 0); },
  coolGear() { return this.s.equip.head === 'desert_wrap'; },
  nearFire() {
    const p = this.p; if (this.hearthNear(p.x, p.z)) return true;
    for (const h of V3_HEARTHS) if (this.s.flags['hl_' + h.id] && Math.hypot(h.x - p.x, h.z - p.z) < 8) return true;
    for (const b of this.building.interactablesNear(p.x, p.z, 5)) if (b.type === 'campfire') return true;
    return false;
  },
  updateClimate(dt, z) {
    const p = this.p; if (p.mode === 'dead') return;
    const frost = z === 'frost', desert = z === 'desert', fire = (frost || this.cold > 0) && this.nearFire();
    if (frost && !this.buffs.warmth && !fire) { let r = 3.2 * (this.weather === 'blizzard' ? 2.2 : this.weather === 'snow' ? 1.3 : 1) * (this.isNight() ? 1.4 : 1); if (this.warmGear()) r *= 0.35; this.cold = Math.min(100, this.cold + r * dt); }
    else this.cold = Math.max(0, this.cold - (fire || this.buffs.warmth ? 30 : 12) * dt);
    if (desert && !this.buffs.cooling && !this.isNight()) { let r = 3.0 * (this.weather === 'sand' ? 2 : 1); if (this.coolGear()) r *= 0.35; this.heat = Math.min(100, this.heat + r * dt); }
    else this.heat = Math.max(0, this.heat - (z === 'oasis' || this.buffs.cooling ? 30 : 10) * dt);
    if (frost && this.cold > 20 && !this.coldWarned) { this.coldWarned = true; UI.toast('❄ The cold bites. Wear a fur hood, drink a Warmth potion or stand by a fire.', 'bad'); }
    if (desert && this.heat > 20 && !this.heatWarned) { this.heatWarned = true; UI.toast('☀ The sun beats down. Drink from a waterskin, wear a desert wrap or rest in the oasis.', 'bad'); }
    for (const [k, v] of [['cold', this.cold], ['heat', this.heat]]) if (v >= 100) { this[k + 'T'] = (this[k + 'T'] || 0) + dt; if (this[k + 'T'] > 3) { this[k + 'T'] = 0; this.hurt(1, p.x - Math.sin(p.ry), p.z - Math.cos(p.ry)); UI.toast(k === 'cold' ? 'You are freezing!' : 'Heatstroke!', 'bad'); } }
    if (z === 'swamp' && p.y < 0.3 && p.grounded && !this.buffs.antipoison) this.poison = Math.max(this.poison, 4);
    if (this.poison > 0) {
      if (this.buffs.antipoison) this.poison = 0;
      this.poison -= dt; this.poisonT = (this.poisonT || 0) + dt;
      if (this.poisonT > 2.2) { this.poisonT = 0; if (p.hp > 1) { p.hp -= 1; this.particles.burst(p.x, p.y + 1.2, p.z, 0x60d040, 6, 2, 0.4); } }
    }
    this.meter('coldmeter', this.cold); this.meter('heatmeter', this.heat); this.meter('poisonmeter', this.poison > 0 ? Math.min(100, this.poison * 15) : 0);
  },
  onStatusHit(ev) {
    if (ev.poison && !this.buffs.antipoison) { if (this.poison <= 0) UI.toast('☠ Poisoned! Antipoison cures it.', 'bad'); this.poison = Math.max(this.poison, 6); }
    if (ev.slow) this.slowT = 1.2;
  },
  // ------------- discovery / hearthstones / fast travel -------------
  discover(rk) {
    const R = REGIONS[rk]; this.s.flags['disc_' + rk] = true;
    UI.banner(`${R.icon} ${R.name}`, R.sub, 'region'); this.audio.play('quest');
    this.taskEvent('region', { region: rk }); this.checkAch(); this.save();
  },
  lightHearth(h) {
    if (this.s.flags['hl_' + h.id]) return;
    this.s.flags['hl_' + h.id] = true; this.r3.setHearth(h.id, true); this.audio.play('quest');
    this.particles.burst(h.x, islandHeight(h.x, h.z) + 2, h.z, 0xffd27a, 30, 5, 1);
    UI.banner(`${h.name} lit`, 'Fast travel unlocked here (🗺 / M)'); this.checkAch(); this.save();
  },
  travelPoints() {
    const f = this.s.flags, out = [{ id: 'village', name: 'Oakhollow Village', x: SPAWN.x, z: SPAWN.z, ok: true, icon: '🛡' }];
    out.push({ id: 'camp', name: 'Ashfall Camp', x: CAMP.x + 1, z: CAMP.z + 2, ok: !!(f.q2_start || f.seenRidge), icon: '🔥' });
    out.push({ id: 'arena', name: 'Ashfall Arena', x: ARENA.x, z: ARENA.z - ARENA.r - 4, ok: !!f.seenArena, icon: '⚔' });
    for (const h of V3_HEARTHS) out.push({ id: h.id, name: h.name, x: h.x + 1.5, z: h.z + 2, ok: !!f['hl_' + h.id], icon: REGIONS[h.region].icon, region: h.region });
    return out;
  },
  fastTravel(id) {
    const pt = this.travelPoints().find((q) => q.id === id), p = this.p;
    if (!pt || !pt.ok) return UI.toast('You have not unlocked that destination yet.', 'bad');
    if (this.inDungeon) return UI.toast('You cannot fast travel from inside a dungeon.', 'bad');
    if (p.mode === 'dead') return;
    if (this.pvpBusy?.()) return UI.toast('Not during a duel, an arena round or while flagged for PvP.', 'bad');
    if (this.allEnemies().some((e) => e.alive && ['chase', 'tell', 'attack', 'windup'].includes(e.state) && Math.hypot(e.x - p.x, e.z - p.z) < 14)) return UI.toast('You cannot fast travel while enemies are on you.', 'bad');
    this.closePanel(); this.lastTravel = id;
    this.fade(() => { this.debug.teleport(pt.x, pt.z); this.cam.snap = true; p.lock = null; this.s.stats.travels++; UI.banner(pt.name, 'Fast travel'); this.checkAch(); this.save(); });
    return true;
  },
  mapHtml() {
    const pts = this.travelPoints();
    return `<h2>🗺 World map</h2><div class="mapwrap"><canvas id="worldmap" width="520" height="520"></canvas>
      <div class="maplist"><h3>Fast travel</h3>${pts.map((q) => `<button class="recipe" data-v3="travel" data-arg="${q.id}" ${q.ok ? '' : 'disabled'}><b>${q.icon} ${esc(q.name)}</b><small>${q.ok ? 'Travel here' : q.region ? '🔒 Light this Hearthstone first' : '🔒 Visit it first'}</small></button>`).join('')}
      <p class="sub">${Object.entries(REGIONS).map(([k, R]) => (this.s.flags['disc_' + k] ? `${R.icon} ${R.name}` : '❔ Undiscovered')).join(' · ')}</p></div></div>`;
  },
  drawMap() {
    const c = document.getElementById('worldmap'); if (!c) return; const x = c.getContext('2d'), S = c.width, sc = S / 720;
    const P = (wx, wz) => [(wx + 340) * sc, (wz + 350) * sc];
    x.fillStyle = '#1d4a6a'; x.fillRect(0, 0, S, S);
    const disc = (wx, wz, r, col) => { const [a, b] = P(wx, wz); x.beginPath(); x.arc(a, b, r * sc, 0, 6.29); x.fillStyle = col; x.fill(); };
    disc(0, 0, 150, '#5a8a3a'); disc(260, 0, 110, '#6a5048');
    const col = { frost: '#e8f0f8', desert: '#d8b878', swamp: '#4a6a3a', coast: '#e0d0a0' };
    for (const [k, R] of Object.entries(REGIONS)) disc(R.x, R.z, R.r, this.s.flags['disc_' + k] ? col[k] : '#55606a');
    x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 3; x.font = 'bold 13px sans-serif'; x.textAlign = 'center';
    const lbl = (wx, wz, t) => { const [a, b] = P(wx, wz); x.strokeText(t, a, b); x.fillText(t, a, b); };
    for (const [k, R] of Object.entries(REGIONS)) lbl(R.x, R.z, this.s.flags['disc_' + k] ? `${R.icon} ${R.name}` : '❔ ???');
    lbl(0, 4, '🛡 Oakhollow'); lbl(CAMP.x, CAMP.z, '🔥 Camp'); lbl(ARENA.x, ARENA.z, '⚔ Arena'); lbl(FADELANDS.x, FADELANDS.z, '☠ Fadelands'); lbl(BELFRY_ENTRANCE.x, BELFRY_ENTRANCE.z, '🔔 Belfry');
    for (const q of this.travelPoints()) { const [a, b] = P(q.x, q.z); x.beginPath(); x.arc(a, b, 5, 0, 6.29); x.fillStyle = q.ok ? '#ffd040' : '#777'; x.fill(); }
    if (!this.inDungeon) { const [a, b] = P(this.p.x, this.p.z); x.save(); x.translate(a, b); x.rotate(-this.p.ry + Math.PI); x.beginPath(); x.moveTo(0, -9); x.lineTo(6, 7); x.lineTo(-6, 7); x.closePath(); x.fillStyle = '#ff4040'; x.fill(); x.restore(); }
  },
  // ------------- tasks -------------
  tasksEnsure(now = new Date()) {
    const s = this.s, dk = dayKey(now), wk = weekKey(now);
    s.tasks ||= { day: null, week: null, daily: [], weekly: [], streak: 0, best: 0, lastFull: null, weekRegions: [] };
    const T = s.tasks;
    const roll = (key, n, weekly) => { const r = seeded(hashStr(key)), pool = TASK_POOL.filter((q) => weekly || !q.weekly), out = [];
      for (let g = 0; out.length < n && g < 200; g++) { const q = pool[Math.floor(r() * pool.length)]; if (out.some((o) => o.id === q.id)) continue; const k = q.n[0] + Math.floor(r() * (q.n[1] - q.n[0] + 1)), cnt = weekly && !q.weekly ? k * 3 : k; out.push({ id: q.id, kind: q.kind, skill: q.skill || null, n: cnt, p: 0, done: false, claimed: false, name: q.name(cnt), xp: q.xp }); }
      return out; };
    if (T.day !== dk) { // local-midnight reset; the streak survives only if yesterday's three dailies were all claimed
      const y = new Date(now); y.setDate(y.getDate() - 1);
      if (T.lastFull !== dayKey(y) && T.lastFull !== dk) T.streak = 0;
      T.day = dk; T.daily = roll('d' + dk + (s.name || ''), 3, false);
    }
    if (T.week !== wk) { T.week = wk; T.weekly = roll('w' + wk + (s.name || ''), 2, true); T.weekRegions = []; }
    return T;
  },
  taskEvent(kind, o = {}) {
    const T = this.tasksEnsure();
    if (kind === 'region') { if (T.weekRegions.includes(o.region)) return; T.weekRegions.push(o.region); }
    for (const t of [...T.daily, ...T.weekly]) {
      if (t.done || t.kind !== kind || (t.skill && t.skill !== o.skill)) continue;
      t.p = Math.min(t.n, t.p + (o.n || 1));
      if (t.p >= t.n) { t.done = true; UI.toast(`✅ Task complete: ${t.name}. Claim it in ✅ Tasks`, 'good'); this.audio.play('achieve'); }
    }
  },
  claimTask(key) {
    const T = this.tasksEnsure(), [grp, i] = key.split(':'), t = T[grp]?.[+i];
    if (!t || !t.done || t.claimed) return false;
    t.claimed = true; const R = TASK_REWARD[grp];
    if (grp === 'daily' && T.daily.every((q) => q.claimed) && T.lastFull !== T.day) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      T.streak = T.lastFull === dayKey(y) ? (T.streak || 0) + 1 : 1; T.lastFull = T.day; T.best = Math.max(T.best || 0, T.streak);
      UI.banner(`🔥 ${T.streak}-day streak!`, `Task rewards +${Math.round((STREAK_BONUS(T.streak) - 1) * 100)}%`);
    }
    const k = STREAK_BONUS(T.streak || 1);
    this.giveGold(Math.round(R.coins * k)); this.addXp(t.xp || 'combat', Math.round(R.xp * k));
    this.s.stats.tasksDone++; this.checkAch(); this.save(); if (this.panelKind === 'tasks') this.openPanel('tasks'); return true;
  },
  tasksHtml() {
    const T = this.tasksEnsure(), row = (grp, t, i) => `<div class="task ${t.claimed ? 'claimed' : t.done ? 'done' : ''}"><b>${esc(t.name)}</b><div class="bar"><i style="width:${(t.p / t.n * 100).toFixed(0)}%"></i></div><small>${t.p}/${t.n}</small>${t.done && !t.claimed ? `<button data-v3="claim" data-arg="${grp}:${i}">Claim</button>` : t.claimed ? '<span>✔</span>' : ''}</div>`;
    const nm2 = new Date(); nm2.setHours(24, 0, 0, 0); const hrs = Math.ceil((nm2 - new Date()) / 3600000);
    return `${this.logTabs('tasks')}<h2>✅ Tasks <small>🔥 Streak ${T.streak || 0} (best ${T.best || 0}) · rewards ×${STREAK_BONUS(T.streak || 1).toFixed(1)}</small></h2>
    <h3>Daily <small>reset at local midnight (in ~${hrs} h) · ${TASK_REWARD.daily.coins} coins + ${fmt(TASK_REWARD.daily.xp)} XP each</small></h3>${T.daily.map((t, i) => row('daily', t, i)).join('')}
    <h3>Weekly <small>reset Monday · ${TASK_REWARD.weekly.coins} coins + ${fmt(TASK_REWARD.weekly.xp)} XP each</small></h3>${T.weekly.map((t, i) => row('weekly', t, i)).join('')}
    <p class="sub">Claim all three dailies each day to grow your streak (+10% rewards per day, up to +50%).</p>`;
  },
  logTabs(cur) { return `<div class="tabs">${[['tasks', '✅ Tasks'], ['ach', '🏅 Achievements'], ['coll', '📗 Collection log'], ['mounts', '🐎 Mounts']].map(([k, t]) => `<button data-v3="tab" data-arg="${k}" class="${k === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`; },
  // ------------- achievements + collection log -------------
  checkAch() {
    const s = this.s; if (!s.ach || this.phase !== 'play') return;
    for (const a of ACHIEVEMENTS) { if (s.ach[a.id]) continue; let ok = false; try { ok = a.check(this); } catch {} if (ok) { s.ach[a.id] = Date.now(); UI.toast(`🏅 Achievement: ${a.icon} ${a.name}`, 'ach'); this.audio.play('achieve'); this.lastAch = a.id; } }
  },
  achHtml() {
    const s = this.s, n = ACHIEVEMENTS.filter((a) => s.ach[a.id]).length;
    return `${this.logTabs('ach')}<h2>🏅 Achievements <small>${n}/${ACHIEVEMENTS.length}</small></h2><div class="achgrid">${ACHIEVEMENTS.map((a) => `<div class="ach ${s.ach[a.id] ? 'got' : ''}"><span>${a.icon}</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`).join('')}</div>`;
  },
  collCount() { const c = this.s.coll; return Object.keys(c.items).length + Object.keys(c.bosses).length; },
  collItem(k) { const c = this.s.coll; if (!COLL_ITEMS.has(k) || c.items[k]) return; c.items[k] = Date.now(); UI.toast(`📗 New collection log entry: ${ic(k)} ${nm(k)}`, 'coll'); this.lastColl = k; },
  collBoss(type) { if (!BOSS_NAMES[type]) return; const c = this.s.coll; c.bosses[type] = (c.bosses[type] || 0) + 1; if (c.bosses[type] === 1) UI.toast(`📗 Collection log: ${BOSS_NAMES[type]}`, 'coll'); this.s.stats.bossKills++; this.taskEvent('boss'); },
  collHtml() {
    const c = this.s.coll, total = Object.values(COLLECTION).reduce((a, v) => a + v.length, 0);
    return `${this.logTabs('coll')}<h2>📗 Collection log <small>${this.collCount()}/${total}</small></h2>` + Object.entries(COLLECTION).map(([cat, list]) => `<h3>${cat}</h3><div class="invgrid colgrid">${list.map((k) => cat === 'Bosses' ? `<div class="cell ${c.bosses[k] ? '' : 'empty'}" title="${esc(BOSS_NAMES[k])}"><span>${c.bosses[k] ? '💀' : '❔'}</span>${c.bosses[k] ? `<b>${c.bosses[k]}</b>` : ''}</div>` : `<div class="cell ${c.items[k] ? '' : 'empty'}" title="${esc(nm(k))}"><span>${c.items[k] ? ic(k) : '❔'}</span></div>`).join('')}</div>`).join('');
  },
  // ------------- potions -------------
  drink(k) {
    const I = ITEMS[k]; if (!I || !(this.s.inv[k] > 0) || !(I.potion || I.cool)) return false;
    if (this.drinkT && this.t - this.drinkT < 1.2) return false;
    if (this.pvpPotionBlocked?.(k)) return false;
    const p = this.p;
    if (I.cool) { this.heat = Math.max(0, this.heat - 60); UI.toast('💧 Refreshing. The heat eases.', 'good'); }
    else switch (I.potion) {
      case 'health': if (p.hp >= this.maxHp) { UI.toast('You are already at full health.', ''); return false; } p.hp = Math.min(this.maxHp, p.hp + 12); break;
      case 'antipoison': this.poison = 0; this.buffs.antipoison = 90; break;
      case 'stamina': this.buffs.stamina = 60; break;
      case 'attack': this.buffs.attack = 90; break;
      case 'defence': this.buffs.defence = 90; break;
      case 'warmth': this.buffs.warmth = 180; this.cold = 0; break;
      case 'cooling': this.buffs.cooling = 180; this.heat = 0; break;
      case 'fade': this.buffs.fade = 180; break;
      default: return false;
    }
    this.drinkT = this.t; this.s.inv[k]--; if (!this.s.inv[k]) delete this.s.inv[k];
    this.animOverride = { name: 'eat', t: 0.5 }; this.audio.play('heal');
    if (I.potion) UI.toast(`You drink the ${I.name}. ${POTIONS[I.potion].desc}.`, 'good');
    this.pvpDrank?.(k); this.save(); return true;
  },
  // ------------- farming -------------
  patchPos(pt) { const pl = this.s.home?.plot; if (!pl) return null; const [cx, cz] = cellCenter(pl.gx, pl.gz); return { x: cx - BLOCK / 2 + pt.dx * BLOCK, z: cz - BLOCK / 2 + pt.dz * BLOCK }; },
  patchState(id) { const P = this.s.patches[id]; if (!P || !CROPS[P.seed]) return { st: 'empty' }; const C = CROPS[P.seed], need = C.mins * 60000 * (P.compost ? 0.8 : 1), f = Math.max(0, Math.min(1, (Date.now() - P.t0) / need)); return { st: f >= 1 ? 'ready' : 'growing', f, C, P, left: Math.max(0, need - (Date.now() - P.t0)) }; },
  updatePatches() {
    const pl = this.s.home?.plot, key = pl ? pl.gx + ',' + pl.gz : '';
    if (this.patchKey !== key) { for (const o of this.patchObjs.values()) this.scene.remove(o.g); this.patchObjs.clear(); this.patchKey = key; }
    if (!pl) return;
    for (const pt of PATCHES) {
      let o = this.patchObjs.get(pt.id);
      if (!o) { const pos = this.patchPos(pt), g = new THREE.Group(), y = islandHeight(pos.x, pos.z); g.position.set(pos.x, y, pos.z);
        const soil = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 1.3), new THREE.MeshLambertMaterial({ color: 0x5a3a20 })); soil.position.y = 0.08; g.add(soil);
        const plant = new THREE.Mesh(pt.kind === 'tree' ? new THREE.ConeGeometry(0.6, 1.8, 6).translate(0, 0.9, 0) : new THREE.ConeGeometry(0.4, 0.8, 5).translate(0, 0.4, 0), new THREE.MeshLambertMaterial({ color: 0x4a9a2a, flatShading: true })); plant.position.y = 0.16; g.add(plant);
        this.scene.add(g); o = { g, plant, ...pos, pt }; this.patchObjs.set(pt.id, o); }
      o.g.visible = !this.inDungeon && !this.coopGuest;
      const st = this.patchState(pt.id); o.plant.visible = st.st !== 'empty'; o.st = st.st;
      if (st.st !== 'empty') { const k = 0.25 + 0.75 * st.f; o.plant.scale.set(k, k, k); o.plant.material.color.setHex(st.st === 'ready' ? 0xe0c040 : 0x4a9a2a); }
    }
  },
  farmHtml(pid) {
    const pt = PATCHES.find((q) => q.id === pid), st = this.patchState(pid), L = this.level('farming');
    if (!pt) return '<h2>Farming</h2>';
    if (st.st === 'growing') return `<h2>🌱 ${esc(st.C.name)} growing</h2><p>${Math.round(st.f * 100)}% · ready in ${Math.ceil(st.left / 60000)} min (real time, even while you are away).</p>${st.P.compost ? '<p class="sub">Composted: grows 20% faster, +1 yield.</p>' : (this.s.inv.compost ? `<button class="recipe" data-v3="compost" data-arg="${pid}"><b>💩 Add compost</b><small>Grows 20% faster, +1 yield</small></button>` : '<p class="sub">Compost (stable / oasis) speeds it up.</p>')}`;
    const seeds = Object.entries(CROPS).filter(([, C]) => C.patch === pt.kind);
    return `<h2>🌱 ${pt.kind === 'tree' ? 'Tree' : pt.kind === 'herb' ? 'Herb' : 'Allotment'} patch <small>Farming ${L}</small></h2><div class="recipes">${seeds.map(([k, C]) => { const ok = (this.s.inv[k] || 0) > 0 && L >= C.level; return `<button class="recipe ${L >= C.level ? '' : 'locked'}" data-v3="plant" data-arg="${pid}|${k}" ${ok ? '' : 'disabled'}><b>${ic(k)} Plant ${esc(C.name)}</b><small>${this.s.inv[k] || 0} in bag · Farming ${C.level} · ${C.mins} min · +${C.xp} XP</small></button>`; }).join('')}</div><p class="sub">Seeds: the stable, the oasis bazaar, the port, and monster drops.</p>`;
  },
  plant(pid, seed) {
    const C = CROPS[seed], pt = PATCHES.find((q) => q.id === pid);
    if (!C || !pt || C.patch !== pt.kind || this.s.patches[pid]) return false;
    if (this.level('farming') < C.level) { UI.toast(`Requires Farming ${C.level}.`, 'bad'); return false; }
    if (!(this.s.inv[seed] > 0)) { UI.toast('You have no seeds of that kind.', 'bad'); return false; }
    this.spend({ [seed]: 1 }); this.s.patches[pid] = { seed, t0: Date.now(), compost: false };
    this.addXp('farming', Math.round(C.xp * 0.2)); this.audio.play('place'); UI.toast(`You plant the ${C.name}. Ready in ${C.mins} min.`, 'good'); this.save(); return true;
  },
  compost(pid) { const P = this.s.patches[pid]; if (!P || P.compost || !(this.s.inv.compost > 0)) return; this.spend({ compost: 1 }); P.compost = true; this.save(); },
  harvest(pid) {
    const st = this.patchState(pid); if (st.st !== 'ready') return false;
    const [item, lo, hi] = st.C.out, n = lo + Math.floor(this.rand() * (hi - lo + 1)) + (st.P.compost ? 1 : 0);
    if (!this.give(item, n)) return false;
    const seed = st.P.seed; delete this.s.patches[pid]; this.addXp('farming', st.C.xp); this.s.stats.harvests++; this.taskEvent('harvest');
    if (this.rand() < 0.3) this.give(seed, 1);
    this.audio.play('pickup'); this.checkAch(); this.save(); return true;
  },
  // ------------- mounts -------------
  mountsHtml() {
    const s = this.s;
    return `${this.logTabs('mounts')}<h2>🐎 Mounts</h2>${Object.entries(MOUNTS).map(([k, M]) => `<div class="task ${s.mounts[k] ? 'done' : ''}"><b>${M.icon} ${M.name}</b><small>${s.mounts[k] ? `Owned · ${M.speed}× speed` : esc(M.how)}</small>${s.mounts[k] ? `<button data-v3="mount" data-arg="${k}">${this.mounted === k ? 'Dismount' : 'Ride'}</button>` : ''}</div>`).join('')}<p class="sub">N (or 🐎) mounts / dismounts. No fighting while mounted; a hit knocks you off. Mounts wait outside dungeons and the arena.</p>`;
  },
  toggleMount(kind) {
    const s = this.s, p = this.p;
    if (this.mounted && (!kind || kind === this.mounted)) return this.dismount();
    const k = kind || (s.mountPref && s.mounts[s.mountPref] ? s.mountPref : s.mounts.horse ? 'horse' : s.mounts.wolf ? 'wolf' : null);
    if (!k || !s.mounts[k]) { UI.toast('You have no mount yet. Buy a saddle at the Oakhollow stable, or tame an ash-wolf (Hunting 20).', 'bad'); return false; }
    if (this.inDungeon || this.zoneName() === 'arena') { UI.toast('Mounts must wait outside.', 'bad'); return false; }
    if (this.pvpBusy?.(true)) { UI.toast('Not during a duel or arena round.', 'bad'); return false; }
    if (p.mode !== 'normal' && p.mode !== 'block') return false;
    if (this.buildMode) this.toggleBuild();
    if (this.mountObj) this.scene.remove(this.mountObj);
    this.mounted = k; s.mountPref = k; this.closePanel();
    this.mountObj = mount3D(k); this.scene.add(this.mountObj); this.audio.play('pet');
    UI.toast(`${MOUNTS[k].icon} Riding your ${MOUNTS[k].name}`, 'good'); return true;
  },
  dismount(why) { if (!this.mounted) return; this.mounted = null; if (this.mountObj) { this.scene.remove(this.mountObj); this.mountObj = null; } if (why) UI.toast(why, 'bad'); },
  updateMount(dt) {
    if (!this.mounted) return;
    if (this.inDungeon || this.zoneName() === 'arena' || this.p.mode === 'dead') return this.dismount();
    const o = this.mountObj, p = this.p; o.position.set(p.x, p.y, p.z); o.rotation.y = p.ry;
    const ph = (this.mountPh = (this.mountPh || 0) + dt * p.speed * 1.3);
    o.userData.legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? 1.2 : 0)) * Math.min(0.7, p.speed * 0.08)));
    o.userData.tail.rotation.y = Math.sin(this.t * 4) * 0.3;
  },
  mountSpeed() { return this.mounted ? MOUNTS[this.mounted].speed : 1; },
  // ------------- trading post (Grand Exchange style; NPC liquidity) -------------
  marketTarget(k) { const v = ITEMS[k]?.v || 10; return v >= 100 ? 8 : v >= 30 ? 20 : 50; },
  marketEnsure() {
    const s = this.s; s.market ||= { stock: {}, hist: {}, t: Date.now() };
    for (const k of MARKET_ITEMS) { if (!ITEMS[k]) continue; if (s.market.stock[k] === undefined) s.market.stock[k] = this.marketTarget(k); s.market.hist[k] ||= []; }
    return s.market;
  },
  marketPrice(k) { const M = this.marketEnsure(), T = this.marketTarget(k), st = M.stock[k] ?? T, base = ITEMS[k]?.v || 10; return Math.max(1, Math.round(base * Math.max(0.55, Math.min(1.9, 1.55 - 0.55 * st / T)))); },
  marketQuote(k) { const p = this.marketPrice(k); return { buy: Math.ceil(p * 1.05), sell: Math.max(1, Math.floor(p * 0.9)), mid: p }; },
  marketTick() {
    const M = this.marketEnsure(), now = Date.now(); if (now - M.t < 600000) return;
    const steps = Math.min(24, Math.floor((now - M.t) / 600000)); M.t += steps * 600000;
    for (const k of MARKET_ITEMS) { if (!ITEMS[k]) continue; const T = this.marketTarget(k); for (let i = 0; i < steps; i++) M.stock[k] = Math.round(M.stock[k] + (T - M.stock[k]) * 0.2); }
  },
  marketRecord(k) { const h = this.s.market.hist[k]; h.push(this.marketPrice(k)); if (h.length > 12) h.shift(); },
  marketBuy(k, n = 1) {
    const M = this.marketEnsure(); if (!MARKET_ITEMS.includes(k) || !ITEMS[k]) return 0; let got = 0;
    for (let i = 0; i < n; i++) { if (M.stock[k] <= 0) { UI.toast('Out of stock. The NPC traders restock every 10 minutes.', 'bad'); break; } const q = this.marketQuote(k); if (this.s.gold < q.buy) { if (!got) UI.toast('Not enough coins.', 'bad'); break; } if (!this.canAdd(k, 1)) { this.invFull(); break; } this.s.gold -= q.buy; this.s.inv[k] = (this.s.inv[k] || 0) + 1; M.stock[k]--; got++; }
    if (got) { this.marketRecord(k); this.s.stats.trades++; this.audio.play('coin'); UI.toast(`Bought ${got} ${nm(k)}`, 'item'); this.collItem(k); this.checkAch(); this.save(); }
    return got;
  },
  marketSell(k, n = 1) {
    const M = this.marketEnsure(); if (!MARKET_ITEMS.includes(k) || !ITEMS[k] || ITEMS[k].quest || ITEMS[k].untradeable) return 0;
    let sold = 0, coins = 0; const cap = this.marketTarget(k) * 3;
    while (sold < n && (this.s.inv[k] || 0) > 0) { if (M.stock[k] >= cap) { UI.toast('The NPC buyers have plenty of that right now.', 'bad'); break; } const q = this.marketQuote(k); this.s.inv[k]--; if (!this.s.inv[k]) delete this.s.inv[k]; this.s.gold += q.sell; coins += q.sell; M.stock[k]++; sold++; }
    if (sold) { this.marketRecord(k); this.s.stats.trades++; this.audio.play('coin'); UI.toast(`Sold ${sold} ${nm(k)} for ${coins} coins`, 'item'); this.checkAch(); this.save(); }
    return sold;
  },
  marketHtml() {
    const M = this.marketEnsure();
    const rows = MARKET_ITEMS.filter((k) => ITEMS[k]).map((k) => { const q = this.marketQuote(k), h = M.hist[k], tr = h.length > 1 ? (h[h.length - 1] > h[0] ? '<em class="up">▲</em>' : h[h.length - 1] < h[0] ? '<em class="dn">▼</em>' : '•') : '•', have = this.s.inv[k] || 0;
      return `<tr><td>${ic(k)} ${esc(nm(k))}</td><td>${M.stock[k]}</td><td>${tr}</td><td>${q.buy}</td><td>${q.sell}</td><td><button data-v3="mbuy" data-arg="${k}|1" ${M.stock[k] > 0 && this.s.gold >= q.buy ? '' : 'disabled'}>Buy</button><button data-v3="mbuy" data-arg="${k}|10" ${M.stock[k] >= 10 && this.s.gold >= q.buy * 10 ? '' : 'disabled'}>×10</button></td><td><button data-v3="msell" data-arg="${k}|1" ${have ? '' : 'disabled'}>Sell</button><button data-v3="msell" data-arg="${k}|all" ${have ? '' : 'disabled'}>All ${have || ''}</button></td></tr>`; }).join('');
    return `<h2>⚖ Trading post <small>🪙 ${fmt(this.s.gold)} · live NPC market</small></h2><p class="sub">Prices follow supply. Buying drains the NPC stock and raises the price; selling does the opposite. Stock drifts back every 10 minutes. 5% buy / 10% sell spread.${this.coop?.active ? ' To trade with a friend, use ⚔ PvP ▸ Trade.' : ''}</p>
    <div class="mtable"><table><tr><th>Item</th><th>Stock</th><th></th><th>Buy</th><th>Sell</th><th></th><th></th></tr>${rows}</table></div>`;
  },
  qmHtml() {
    const S = SHOPS.quartermaster, tok = this.s.inv.arena_token || 0;
    return `<h2>🎟 Arena Quartermaster <small>${tok} tokens</small></h2><p class="sub">Arena rounds pay tokens (win 3 · draw 2 · loss 1). Cosmetics only: they never change stats.</p><div class="recipes">${Object.entries(S.sells).map(([k, p]) => `<button class="recipe" data-v3="qbuy" data-arg="${k}" ${tok >= p && !(this.s.inv[k] > 0) ? '' : 'disabled'}><b>${ic(k)} ${esc(nm(k))}</b><small>${p} tokens${this.s.inv[k] > 0 ? ' · owned' : ''}</small></button>`).join('')}</div>`;
  },
  tokenBuy(k) {
    const p = SHOPS.quartermaster.sells[k]; if (!p || this.s.inv[k] > 0) return false;
    if ((this.s.inv.arena_token || 0) < p) { UI.toast('Not enough arena tokens.', 'bad'); return false; }
    this.spend({ arena_token: p }); this.s.inv[k] = 1; this.collItem(k); this.audio.play('coin'); UI.toast(`Unlocked ${nm(k)}. Wear it from your bag.`, 'good'); this.save(); return true;
  },
  wearCosmetic(k) {
    const C = COSMETICS[k]; if (!C || !(this.s.inv[k] > 0)) return;
    if (C.title) this.s.cosmetic.title = this.s.cosmetic.title === C.title ? null : C.title;
    if (C.color) this.s.cosmetic.cape = this.s.cosmetic.cape === k ? null : k;
    this.applyGear(); this.save(); this.openPanel('bag');
  },
  // ------------- the Drowned Belfry -------------
  updateBelfry() {
    if (this.dungeonId !== 'belfry') return;
    const p = this.p, f = this.s.flags;
    if (p.z < -66 && p.z > -77 && p.y > 2 && !f.bf_ledge) { f.bf_ledge = true; UI.toast('The north ledge! Hookshot across the gap to the loft.', 'good'); this.save(); }
    if (p.z < -116 && !f.vael_met && f.bf_boss && !this.inDialog && !this.coopGuest) {
      const v = this.bsim.enemies.get('b_vael'); if (!v || !v.alive) return;
      f.vael_met = true;
      this.runDialog('Vael the Unwriter', ['So. The little Mythbound climbs my bell tower.', 'Every tale you save, I unwrite. Every shard you gather, I scatter again.', 'Shall I write your ending? It is a short one.'], () => {
        this.bsim.damage('b_vael', 0, p.x, p.z, { force: true }); UI.banner('Vael the Unwriter', 'Dodge-roll through her ink lines!', 'boss'); this.audio.play('roar');
      }, 'vael');
    }
  },
  belfryValve(i) { // valves[]: 0 = middle (lvl 1), 1 = low (lvl 0), 2 = high (lvl 2)
    const f = this.s.flags, lvl = [1, 0, 2][i];
    if (lvl === 2 && !f.bf_key) { this.audio.play('clang'); UI.toast("The High bell's chain is padlocked. The sluice key must be somewhere below the water…", 'bad'); return false; }
    f.bf_w1 = lvl === 1; f.bf_w2 = lvl === 2; this.belfry.setState(f); this.audio.play('bell'); this.shake = 0.3;
    UI.toast(lvl === 0 ? 'The Low bell tolls… the basin drains.' : lvl === 1 ? 'The Middle bell tolls… the water settles knee-deep.' : 'The High bell tolls… water floods in and the bell-deck floats up!', 'good');
    this.save(); return true;
  },
  belfryInteracts(add, dist) {
    const B = this.belfry, f = this.s.flags;
    if (!f.hookshot) add(dist(B.hookChest), 2.0, { kind: 'bf_hook', label: 'Open the chest' });
    B.valves.forEach((v, i) => add(dist(v), 2.2, { kind: 'bf_valve', i, label: `Ring the ${['Middle', 'Low', 'High'][i]} bell` }));
    if (!f.bf_key && bstate.water === 0) add(dist(B.keyChest), 2.2, { kind: 'bf_key', label: 'Open the sunken chest' });
    if (f.bf_vael && !f.act1_done) add(dist(B.vaelChest), 2.2, { kind: 'bf_vchest', label: "Open Vael's chest" });
    add(dist(B.exitA), 2.0, { kind: 'exit', label: 'Leave the Belfry' });
    if (f.bf_vael) add(dist(B.exitV), 2.2, { kind: 'exit', label: 'Return to the surface' });
  },
  pyramidInteracts(add, dist) {
    const Y = this.pyramid, f = this.s.flags;
    if (f.py_open && !f.py_idol) add(dist(Y.idol), 2.2, { kind: 'py_idol', label: 'Take the Sun Idol' });
    add(dist(Y.exitA), 2.0, { kind: 'exit', label: 'Leave the pyramid' });
  },
  updatePyramid() {
    if (this.dungeonId !== 'pyramid') return;
    const f = this.s.flags, p = this.p; if (f.py_open) return;
    this.plateSeq ||= [];
    const on = PLATES.find((q) => Math.abs(q.x - p.x) < 1.2 && Math.abs(q.z - p.z) < 1.2);
    if (on && this.plateOn !== on.id) {
      this.plateOn = on.id; if (this.plateSeq.includes(on.id)) return;
      if (on.id === PLATE_ORDER[this.plateSeq.length]) {
        this.plateSeq.push(on.id); this.audio.play('trap');
        if (this.plateSeq.length === 4) { f.py_open = true; f.sd_enter = true; this.pyramid.setState(f); this.audio.play('door'); this.shake = 0.4; UI.banner('The sealed door grinds open', 'The Sun Idol lies beyond'); this.save(); }
      } else { this.plateSeq = []; this.audio.play('clang'); UI.toast('The plates sink back. Wrong order… read the glyph wall.', 'bad'); this.hurt(1, p.x, p.z + 1); }
      this.pyramid.lightPlates(this.plateSeq);
    } else if (!on) this.plateOn = null;
  },
  v3Interact(it) {
    const f = this.s.flags, B = this.belfry;
    switch (it.kind) {
      case 'bf_hook': f.hookshot = true; B.setState(f); this.audio.play('quest'); UI.banner('You got the Hookshot!', this.touch ? 'Tap 🪝 near a golden hook ring. It reaches further than the grapple.' : 'Press G near a golden hook ring. It reaches further than the grapple.'); UI.show('#t-grapple', true); this.save(); return true;
      case 'bf_valve': this.belfryValve(it.i); return true;
      case 'bf_key': f.bf_key = true; B.setState(f); this.audio.play('quest'); UI.banner('The sluice key!', "It fits the High bell's padlock"); this.save(); return true;
      case 'bf_vchest': f.act1_done = true; B.setState(f); this.give('vael_quill', 1); this.audio.play('cape'); this.save(); this.act1Complete(); return true;
      case 'py_idol': if (!this.give('sun_idol', 1)) return true; f.py_idol = true; this.pyramid.setState(f); this.audio.play('quest'); UI.banner('The Sun Idol', 'Bring it to Zahra at the oasis'); this.checkAch(); this.save(); return true;
      case 'enterBelfry': this.enterV3('belfry'); return true;
      case 'enterPyramid': this.enterV3('pyramid'); return true;
      case 'v3hearth': this.lightHearth(it.h); return true;
      case 'shrine':
        if (f.sf_start && !f.sf_shrine) { if (!this.has({ herb_frostbloom: 3 })) { UI.toast('The shrine wants three Frostbloom.', 'bad'); return true; } this.spend({ herb_frostbloom: 3 }); f.sf_bloom = f.sf_shrine = true; this.give('frost_relic', 1); this.audio.play('quest'); UI.banner('The shrine glows again', 'Return to Hermit Olaf'); this.save(); }
        else UI.toast('An old shrine, humming with cold light.', ''); return true;
      case 'dig': if (!this.has({ pirate_map: 1 })) return true; this.spend({ pirate_map: 1 }); f.sc_dig = true; this.giveGold(500); this.give('uncut_diamond', 1); this.give('sapling_ember', 1); this.audio.play('quest'); UI.banner('Buried treasure!', 'Tell Captain Brine'); this.save(); return true;
      case 'patch': { if (this.patchState(it.pt.id).st === 'ready') this.harvest(it.pt.id); else this.openPanel('farm:' + it.pt.id); return true; }
      case 'wolfden':
        if (this.s.mounts.wolf) return true;
        if (this.level('hunting') < 20) { UI.toast('The ash-wolf snarls. You need Hunting level 20 to tame it.', 'bad'); return true; }
        if (!(this.s.inv.wolf_treat > 0)) { UI.toast('It sniffs at you hungrily. Bring a Wolf Treat (stable or port).', 'bad'); return true; }
        this.spend({ wolf_treat: 1 }); this.s.mounts.wolf = true; this.audio.play('pet'); UI.banner('🐺 You tamed an ash-wolf!', 'Press N (🐎) to ride it'); this.checkAch(); this.save(); return true;
    }
    return false;
  },
  v3OverworldInteracts(add, dist) {
    const f = this.s.flags;
    add(dist(BELFRY_ENTRANCE) - 0.4, 3.0, { kind: 'enterBelfry', label: f.q4_start || f.act1_done ? 'Enter the Drowned Belfry' : 'The Drowned Belfry (sealed)' });
    add(dist(this.r3.pyramid), 3.0, { kind: 'enterPyramid', label: 'Enter the ruined pyramid' });
    for (const h of V3_HEARTHS) if (!f['hl_' + h.id]) add(dist(h), 3, { kind: 'v3hearth', h, label: `Light the ${h.name}` });
    add(dist(SHRINE), 3.2, { kind: 'shrine', label: 'Frostspire Shrine' });
    if (f.sc_map && !f.sc_dig && this.s.inv.pirate_map) add(dist(DIG_SPOT), 3, { kind: 'dig', label: 'Dig at the X' });
    if (!this.s.mounts.wolf) add(dist(this.denWolf.position), 3, { kind: 'wolfden', label: 'Tame the ash-wolf <small>(Hunting 20 + Wolf Treat)</small>' });
    if (!this.coopGuest) for (const o of this.patchObjs.values()) if (o.g.visible) add(dist(o), 1.6, { kind: 'patch', pt: o.pt, label: o.st === 'ready' ? '🌾 Harvest the patch' : o.st === 'growing' ? '🌱 Check the patch' : '🌱 Plant seeds' });
  },
  enterV3(which) {
    const f = this.s.flags;
    if (which === 'belfry' && !f.q4_start && !f.act1_done && !this.coopGuest) { UI.toast('The door is sealed by old ink. Elder Maren may know more (finish "Into Cinderdeep" first).', 'bad'); return; }
    this.dismount();
    this.fade(() => {
      const S = which === 'belfry' ? BELFRY_START : PYRAMID_START;
      this.debug.teleport(S.x, S.z, 0); this.p.ry = Math.PI; this.cam.yaw = 0; this.p.lock = null;
      if (which === 'belfry') { f.q4_enter = true; if (this.canResetDungeon('belfry')) this.resetV3Sim('belfry'); this.belfry.setState(this.belfryFlags()); UI.banner('The Drowned Belfry', 'Water drips. Somewhere above, a bell tolls by itself.'); }
      else { if (f.sd_start) f.sd_enter = true; if (this.canResetDungeon('pyramid')) this.resetV3Sim('pyramid'); this.pyramid.setState(f); this.plateSeq = []; this.pyramid.lightPlates([]); UI.banner('The Ruined Pyramid', 'Sand hisses through the cracks'); }
      if (this.buildMode) this.toggleBuild(); this.save();
    });
  },
  belfryFlags() { const H = this.coopGuest && this.coop?.hostPuzzle; return H ? { ...this.s.flags, bf_w1: !!H.bf_w1, bf_w2: !!H.bf_w2, bf_boss: !!H.bf_boss, bf_vael: !!H.bf_vael } : this.s.flags; },
  act1Complete() {
    const s = this.s;
    this.runDialog('Vael the Unwriter', [
      { who: 'Vael', text: 'You think a broken quill stops me? I wrote the Loom once. I can unwrite it again.' },
      { who: 'Vael', text: 'Keep your little shards, Mythbound. The Loom of Tales has more threads than you have days.' },
      { who: 'Elder Maren (through the shard)', text: `${s.name}… the bells have stopped. Whatever you did, the isle can breathe again.` },
    ], () => this.showAct1(), 'vael');
  },
  showAct1() {
    const s = this.s, el = document.getElementById('act1');
    el.innerHTML = `<div class="a1card"><h1>Act 1 complete</h1><h2>The Unwritten Bells</h2>
      <p>You silenced the Drowned Belfry and broke Vael's quill.</p>
      <div class="a1stats"><div>⭐ Total level <b>${this.totalLevel()}</b></div><div>🏅 Achievements <b>${Object.keys(s.ach).length}/${ACHIEVEMENTS.length}</b></div><div>⏱ Playtime <b>${((s.playtime || 0) / 3600).toFixed(1)} h</b></div><div>💀 Enemies defeated <b>${s.stats.kills}</b></div></div>
      <p class="tease">🧵 <b>Coming next: Act 2, The Loom of Tales.</b> Vael fled through a tear in the sky. Somewhere past the Starfall horizon, the Loom is still unravelling…</p>
      <button data-v3="close-act1" class="primary">Keep exploring</button></div>`;
    UI.show('#act1', true); this.audio.play('cape'); this.checkAch();
  },
  // ------------- quests / NPCs -------------
  v3Talk(npc) {
    const f = this.s.flags, say = (lines, after) => this.runDialog(npc.name, lines, after, '', npc);
    const menu = (text, opts) => this.runDialog(npc.name, [{ text, choices: [...opts.map((o) => o[0]), 'Goodbye'], pick: (i) => { this._pick = i; } }], () => opts[this._pick]?.[1](), '', npc);
    const done = (title) => { this.audio.play('quest'); UI.banner('Quest complete: ' + title); this.save(); };
    switch (npc.id) {
      case 'stablemaster': return menu(this.s.mounts.horse ? 'How is she running? Need anything for the road?' : "A fine horse needs a fine saddle. 1,500 coins and she's yours. Wolf treats too, if you fancy taming an ash-wolf on the ridge.", [['Trade', () => this.openPanel('shop:stable')], ['Mounts', () => this.openPanel('mounts')]]);
      case 'broker': case 'ysolde2': return say(['Welcome to the trading post. Prices move with supply and demand, and the NPC traders keep the shelves stocked.'], () => this.openPanel('market'));
      case 'amun': case 'lin': return say(['Your vault is safe with us. Every bank shares the same vault.'], () => this.openPanel('bank'));
      case 'zahra':
        if (!f.sd_start) return say(['Sand-walker! The pyramid south-east of here holds the Sun Idol of my ancestors.', 'Inside are four plates and a glyph wall. Step in the order the glyphs show, or the floor bites back.', 'Bring me the idol and the oasis will remember you.'], () => { f.sd_start = true; this.audio.play('quest'); this.save(); });
        if (f.py_idol && !f.sd_done && this.s.inv.sun_idol) return say(["The Sun Idol! You have a scholar's eye and a thief's fingers.", 'Take this: coins, cooling draughts and a pouch of rare seeds.'], () => { this.spend({ sun_idol: 1 }); f.sd_done = true; this.giveGold(400); this.give('potion_cooling', 3); this.give('seed_ranarr', 2); this.addXp('hunting', 3000); done('The Sun Idol'); });
        return menu('Water, wraps and seeds. What do you need?', [['Trade', () => this.openPanel('shop:oasis')]]);
      case 'olaf':
        if (!f.sf_start) return say(["Hrm. A traveller who isn't frozen solid. Rare.", 'The summit shrine has gone dark. Three Frostbloom laid on it would wake it. They grow wild on the slopes.', 'Keep a fur hood on, or a fire close. The cold up here kills slowly, then quickly.'], () => { f.sf_start = true; this.audio.play('quest'); this.save(); });
        if (f.sf_shrine && !f.sf_done) return say(['The shrine sings again. I heard it from here.', "Take my old fur cloak and some warmth draughts. You'll need them for the Wyrm."], () => { if (this.s.inv.frost_relic) this.spend({ frost_relic: 1 }); f.sf_done = true; this.give('warm_cloak', 1); this.give('potion_warmth', 3); this.giveGold(300); this.addXp('mining', 3000); done("The Shrine's Light"); });
        return say(['Stay warm. The Frost Wyrm roosts north-east of the summit. Mithril sleeps in the high rocks (Mining 30).']);
      case 'mag':
        if (!f.sw_start) return say(['Eh? A visitor. The bog witches stole my charm, they did.', 'Thrash them till one coughs it up. Mind the bogs: wade in and the poison gets you.'], () => { f.sw_start = true; this.audio.play('quest'); this.save(); });
        if (f.sw_charm && !f.sw_done) return say(['My charm! Bless your muddy boots.', 'Have some antipoison, and these seeds. The rare ones only grow for patient folk.'], () => { if (this.s.inv.witch_charm) this.spend({ witch_charm: 1 }); f.sw_done = true; this.give('potion_antipoison', 3); this.give('seed_ranarr', 1); this.giveGold(300); this.addXp('herblore', 3000); done("The Bog Witch's Charm"); });
        return say(['Fireflies come out at night. So do worse things.']);
      case 'brine':
        if (!f.sc_start) return say(["Arr. Pirates have been raiding my port, and one of 'em carries a map to old Redtooth's hoard.", "Thump a few and bring me the map. Dig where the X says. Keep the hoard; I just want 'em gone."], () => { f.sc_start = true; this.audio.play('quest'); this.save(); });
        if (f.sc_dig && !f.sc_done) return say(["Ha! The hoard's real! Keep it, and take some swordfish. Deep water off the pier, Fishing 35."], () => { f.sc_done = true; this.give('swordfish', 3); this.addXp('fishing', 3000); done('X Marks the Spot'); });
        return menu('Arrows, seeds and saplings. Fresh off the boat.', [['Trade', () => this.openPanel('shop:port')]]);
      case 'arenamaster': return menu('The Ashfall Arena! One-on-one or two-on-two. Three knock-outs or ninety seconds. Tokens for everyone who fights.', [['Arena & duels', () => this.openPanel('pvp')], ['Quartermaster (tokens)', () => this.openPanel('qm')], ['Season leaderboard', () => this.openPanel('leaderboard')]]);
      case 'sable': return say(["Past me lie the Fadelands. Step in and you'll be asked to raise the skull flag.", 'Flagged players can fight each other in there. Fall, and the Fade takes a few things from your bag, but never your gear and never your three most valuable stacks.', "Unflagged folk can't be touched and can't touch anyone. Leave the zone and your flag drops after ten seconds."]);
    }
    return false;
  },
  v3NpcMarker(id) {
    const f = this.s.flags, has = (k) => (this.s.inv[k] || 0) > 0;
    if (id === 'elder' && f.q3_done && !f.q4_start) return '!';
    if (id === 'zahra') { if (!f.sd_start) return '!'; if (f.py_idol && !f.sd_done && has('sun_idol')) return '?'; }
    if (id === 'olaf') { if (!f.sf_start) return '!'; if (f.sf_shrine && !f.sf_done) return '?'; }
    if (id === 'mag') { if (!f.sw_start) return '!'; if (f.sw_charm && !f.sw_done) return '?'; }
    if (id === 'brine') { if (!f.sc_start) return '!'; if (f.sc_dig && !f.sc_done) return '?'; }
    return null;
  },
  v3QuestTarget(q, st) {
    const inBF = this.dungeonId === 'belfry', B = this.belfry, here = (id) => { const n = this.npc(id); return n ? { x: n.x, z: n.z } : null; };
    if (q.id === 'q4') {
      if (st === 0) return this.inDungeon ? null : here('elder');
      if (!inBF) return this.inDungeon ? null : BELFRY_ENTRANCE;
      if (st === 2) return B.hookChest; if (st === 3) return bstate.water === 0 ? B.keyChest : B.valves[1];
      if (st === 4) return bstate.water === 2 ? { x: B.door.x, z: -71 } : B.valves[2];
      if (st === 5) return { x: B.door.x, z: -100 }; if (st === 6) return { x: B.door.x, z: -140 }; if (st === 7) return B.vaelChest;
      return null;
    }
    if (q.id === 'sq_desert') { if (this.dungeonId === 'pyramid') return st === 3 ? this.pyramid.idol : st >= 4 ? this.pyramid.exitA : { x: PLATES[0].x + 5, z: -23 }; if (this.inDungeon) return null; return st === 0 || st === 4 ? here('zahra') : this.r3.pyramid; }
    if (this.inDungeon) return null;
    if (q.id === 'sq_frost') return st === 0 || st === 3 ? here('olaf') : st === 2 ? SHRINE : null;
    if (q.id === 'sq_swamp') return st === 0 || st === 2 ? here('mag') : null;
    if (q.id === 'sq_coast') return st === 0 || st === 3 ? here('brine') : st === 2 ? DIG_SPOT : null;
    return null;
  },
  journalHtml3() {
    const L = this.questList(), sec = (title, list) => `<h3 class="jsec">${title}</h3>` + list.map((q) => `<div class="jq ${q.state}"><h4>${q.state === 'done' ? '✔' : q.state === 'active' ? '➤' : '🔒'} ${esc(q.name)}${q.region ? ` <small>${REGIONS[q.region].icon} ${REGIONS[q.region].name}</small>` : ''}</h4>
      ${q.state === 'locked' ? `<p class="sub">${esc(q.lockedText)}</p>` : `<ol>${q.steps.map((t, i) => `<li class="${i < q.stage ? 'done' : i === q.stage ? 'cur' : 'todo'}">${i <= q.stage || q.state === 'done' ? esc(t) : '…'}</li>`).join('')}</ol>`}</div>`).join('');
    const T = this.tasksEnsure(), open = [...T.daily, ...T.weekly].filter((t) => !t.claimed).length;
    return `<h2>📜 Journal <small>${L.filter((q) => q.state === 'done').length}/${L.length} quests complete</small></h2><div class="jcols"><div>${sec(this.s.flags.act1_done ? 'Main story · Act 1 complete ✔' : 'Main story · Act 1', L.filter((q) => ['q1', 'q2', 'q3', 'q4'].includes(q.id)))}</div>
      <div>${sec('Side quests', L.filter((q) => q.side || q.id === 'pet'))}<h3 class="jsec">Tasks</h3><p class="sub">${open} task${open === 1 ? '' : 's'} open · 🔥 streak ${T.streak || 0}</p><button data-v3="tab" data-arg="tasks">✅ Open tasks</button></div></div>`;
  },
  // ------------- what's new splash (one time, stored in settings) -------------
  showWhatsNew() {
    this.wnShown = true; const el = document.getElementById('whatsnew');
    el.innerHTML = `<div class="wncard"><h2>✨ What's new in Mythbound v3.0</h2><ul>${WHATS_NEW.map(([i, t, d]) => `<li><span>${i}</span><div><b>${t}</b><small>${d}</small></div></li>`).join('')}</ul><button data-v3="close-wn" class="primary">Let's go!</button></div>`;
    UI.show('#whatsnew', true);
  },
  // ------------- small v3 hooks used by game.js -------------
  pvpSafe() { const z = this.zoneName(); return z === 'oasis' || z === 'port'; },
  v3ZoneLabel(z) {
    if (z === 'dungeon') { const d = this.dungeonId; return d === 'belfry' ? '🔔 The Drowned Belfry' : d === 'pyramid' ? '🏺 The Ruined Pyramid' : null; }
    if (z === 'oasis') return '🌴 Sunscar Oasis · safe'; if (z === 'port') return '⚓ Starfall Port · safe';
    if (z === 'arena') return '🏟 Ashfall Arena'; if (z === 'fadelands') return '💀 The Fadelands · PvP (opt-in)';
    if (REGIONS[z]) return `${REGIONS[z].icon} ${REGIONS[z].name}`;
    return null;
  },
  v3Music() {
    const d = this.dungeonId;
    if (d === 'belfry') { const v = this.bsim.enemies.get('b_vael'), k = this.bsim.enemies.get('b_keeper'); const on = (e) => e && e.alive && e.state !== 'idle' && e.state !== 'return'; return on(v) || on(k) ? 'boss' : 'belfry'; }
    if (d === 'pyramid') return 'desert';
    if (this.inDungeon) return null;
    const z = this.zoneName();
    if (this.pvpMode?.()) return 'arena';
    if (z === 'arena' || z === 'fadelands') return 'arena';
    if (z === 'frost') return 'frost'; if (z === 'desert' || z === 'oasis') return 'desert'; if (z === 'swamp') return 'swamp'; if (z === 'coast' || z === 'port') return 'coast';
    if (this.isNight() && (z === 'wild' || z === 'ember')) return 'night';
    return null;
  },
  v3Kill(id, type, mine) {
    const s = this.s, f = s.flags, host = mine || !this.coopGuest;
    if (mine) { s.stats.kills = (s.stats.kills || 0) + 1; s.stats.killsBy ||= {}; s.stats.killsBy[type] = (s.stats.killsBy[type] || 0) + 1; this.taskEvent('kill', { region: REGION_OF_ZONE[this.zoneName()] || null, type }); }
    if (ENEMY_TYPES[type]?.boss && (mine || this.coop?.active)) this.collBoss(type);
    if (id === 'b_keeper' && host) { f.bf_boss = true; this.belfry.setState(f); UI.banner('The Bellkeeper falls silent', 'Climb to the loft. Something waits above.'); this.save(); }
    if (id === 'b_vael' && host) { f.bf_vael = true; this.belfry.setState(f); this.shake = 1; UI.banner('Vael is driven back!', "Her quill shatters. A chest lies where she stood."); this.save(); }
    if (type === 'bogwitch' && mine && f.sw_start && !f.sw_charm && (s.stats.killsBy.bogwitch || 0) >= 3) { f.sw_charm = true; this.give('witch_charm', 1); UI.banner('The witch drops a charm!', 'Return it to Old Mag'); this.save(); }
    if (type === 'pirate' && mine && f.sc_start && !f.sc_map && (s.stats.killsBy.pirate || 0) >= 3) { f.sc_map = true; if (!this.s.inv.pirate_map) this.give('pirate_map', 1); UI.banner('A torn pirate map!', 'Dig at the X on the beach'); this.save(); }
    this.checkAch();
  },
  // ------------- phone layout editor -------------
  layoutTargets() { return ['joy', ...[...document.querySelectorAll('#tbtns button, #tbtns2 button')].map((b) => b.id).filter(Boolean)]; },
  v3ApplyLayout() {
    const st = this.settings, sc = st.btnScale || (this.touch ? 1.15 : 1);
    document.documentElement.style.setProperty('--bs', sc);
    const L = st.layout || {};
    for (const id of this.layoutTargets()) {
      const e = document.getElementById(id); if (!e) continue; const q = L[id];
      if (q) { e.style.setProperty('position', 'fixed', 'important'); e.style.left = Math.round(q.x * innerWidth) + 'px'; e.style.top = Math.round(q.y * innerHeight) + 'px'; e.style.right = 'auto'; e.style.bottom = 'auto'; e.classList.add('placed'); }
      else if (e.classList.contains('placed')) { e.style.removeProperty('position'); e.style.left = e.style.top = e.style.right = e.style.bottom = ''; e.classList.remove('placed'); }
    }
  },
  layoutEdit(on) {
    const bar = document.getElementById('layoutbar'), root = document.getElementById('touch');
    this.layoutEditing = on; document.body.classList.toggle('layout-edit', on); UI.show('#layoutbar', on);
    if (on) {
      if (!this.touch) UI.show('#touch', true);
      bar.innerHTML = '<span>✥ Drag any button to move it</span><button data-v3="layout-reset">Reset</button><button data-v3="layout-done" class="primary">Done</button>';
      if (!this._layoutH) {
        let drag = null;
        const down = (e) => { if (!this.layoutEditing) return; const t = e.target.closest('#joy, #tbtns button, #tbtns2 button'); if (!t) return; e.preventDefault(); e.stopPropagation(); const r = t.getBoundingClientRect(); drag = { el: t, dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId }; t.classList.add('dragging'); };
        const move = (e) => { if (!drag || e.pointerId !== drag.id) return; e.preventDefault(); e.stopPropagation(); const el = drag.el, w = el.offsetWidth, h = el.offsetHeight; const x = Math.max(0, Math.min(innerWidth - w, e.clientX - drag.dx)), y = Math.max(0, Math.min(innerHeight - h, e.clientY - drag.dy)); (this.settings.layout ||= {})[el.id] = { x: +(x / innerWidth).toFixed(4), y: +(y / innerHeight).toFixed(4) }; this.v3ApplyLayout(); };
        const up = (e) => { if (!drag || e.pointerId !== drag.id) return; e.stopPropagation(); drag.el.classList.remove('dragging'); drag = null; this.saveSettings(); };
        root.addEventListener('pointerdown', down, true); addEventListener('pointermove', move, true); addEventListener('pointerup', up, true);
        this._layoutH = true;
      }
    } else { if (!this.touch) UI.show('#touch', false); this.saveSettings(); UI.toast('Button layout saved.', 'good'); }
  },
};

// ======================================================================================================
// install: add the V3 methods and wrap the v2 methods that need v3 behaviour (base versions are kept and called)
export function installV3(Game) {
  const P = Game.prototype, base = {};
  for (const k of ['load', 'stats', 'give', 'craft', 'eat', 'useQuick', 'buy', 'talk', 'npcMarker', 'questTarget', 'activeQuest', 'questHud', 'openPanel', 'startGather', 'rewardGather', 'applyGear', 'questList']) base[k] = P[k];
  Object.assign(P, V3);
  P.load = function () { base.load.call(this); migrateV3(this.s); };
  const bStart = P.start; P.start = function (...a) { migrateV3(this.s); this.tasksEnsure(); return bStart.apply(this, a); };
  P.stats = function () { const st = base.stats.call(this); if (this.buffs?.attack) st.atk += 1; if (this.buffs?.defence) st.def += 2; return st; };
  P.give = function (item, n = 1, quiet = false) { const ok = base.give.call(this, item, n, quiet); if (ok && this.s.coll) this.collItem(item); return ok; };
  P.craft = function (id) {
    const r = RECIPES.find((x) => x.id === id), before = r ? Object.fromEntries(Object.keys(r.out).map((k) => [k, this.s.inv[k] || 0])) : null;
    const ok = base.craft.call(this, id);
    if (ok && r && Object.keys(r.out).some((k) => (this.s.inv[k] || 0) > before[k])) {
      this.taskEvent('craft', { skill: r.skill });
      if (r.skill === 'herblore') { const pk = Object.keys(POTIONS).find((k) => POTIONS[k].item === Object.keys(r.out)[0]); if (pk) this.s.stats.potions[pk] = (this.s.stats.potions[pk] || 0) + 1; }
      this.checkAch();
    }
    return ok;
  };
  P.eat = function (item) { const I = ITEMS[item]; if (I && (I.potion || I.cool)) return this.drink(item); if (I?.heal && this.pvpPotionBlocked?.(item)) return false; return base.eat.call(this, item); };
  P.useQuick = function () { const q = this.s.quick; if (q && ITEMS[q]?.potion && this.s.inv[q] > 0) return this.drink(q); return base.useQuick.call(this); };
  P.buy = function (shop, item) { const ok = base.buy.call(this, shop, item); if (ok && item === 'saddle') { this.s.mounts.horse = true; UI.banner('🐎 You bought a horse!', 'Press N (🐎) to ride'); this.checkAch(); this.save(); } return ok; };
  P.talk = function (npc) {
    const f = this.s.flags, say = (lines, after) => this.runDialog(npc.name, lines, after, '', npc);
    if (npc.id === 'elder') {
      if (f.q3_done && !f.q4_start) return say(['Can you hear it, child? Bells. Tolling at night, out past the western marsh.', 'There was a bell tower there once, before the sea took it: the Drowned Belfry.', 'Vael was there. I am sure of it. Her ink is on the wind.', 'Find the Belfry and mind the water. Bells move water, the old monks said.'], () => { f.q4_start = true; this.audio.play('quest'); this.save(); });
      if (f.q4_start && !f.act1_done) return say(['The Belfry lies west of the village, out in the marsh. Ring the right bells, child.']);
      if (f.act1_done) return say(["Vael's quill… broken. You've bought us time. Rest, explore, and keep the isle safe while the shards sing."]);
    }
    if (V3_NPCS.has(npc.id)) return this.v3Talk(npc);
    return base.talk.call(this, npc);
  };
  P.npcMarker = function (id) { return this.v3NpcMarker(id) || base.npcMarker.call(this, id); };
  P.questTarget = function (q, st) { if (q.id === 'q4' || q.side) return this.v3QuestTarget(q, st); return base.questTarget.call(this, q, st); };
  P.activeQuest = function () {
    const q = base.activeQuest.call(this); if (q) return q;
    if (this.s.flags.q3_done && this.qState(QBY.q4) === 'active') return QBY.q4;
    for (const id of ['sq_frost', 'sq_desert', 'sq_swamp', 'sq_coast']) { const s = QBY[id]; if (this.s.flags[s.flags[0]] && this.qState(s) === 'active') return s; }
    return null;
  };
  P.questHud = function () { const h = base.questHud.call(this); if (!this.activeQuest() && this.s.flags.act1_done) return { title: '📖 Act 1 complete', text: 'Act 2: The Loom of Tales is coming. Meanwhile: regions, tasks, farming and the arena.', tgt: null }; return h; };
  P.openPanel = function (kind, arg) { document.getElementById('whatsnew')?.classList.add('hidden'); const r = this.v3Panel(kind); if (r) { this.panelKind = kind; UI.panel(r[0], r[1]); if (document.pointerLockElement) document.exitPointerLock(); this.afterPanel(kind); return; } base.openPanel.call(this, kind, arg); this.afterPanel(kind); };
  P.startGather = function (n) { const def = NODE_TYPES[n.type]; if (def.night && !this.isNight()) return UI.toast('Nothing bites. These fish only come up at night.', 'bad'); if (def.rain && this.weather !== 'rain') return UI.toast('Nothing bites. These fish only rise in the rain.', 'bad'); this.dismount(); return base.startGather.call(this, n); };
  P.rewardGather = function (n) { if (!n) return; const def = NODE_TYPES[n.type], had = this.s.inv[def.item] || 0; base.rewardGather.call(this, n); if ((this.s.inv[def.item] || 0) > had) this.taskEvent('gather', { skill: def.skill, n: 1 }); };
  P.applyGear = function () {
    base.applyGear.call(this);
    const c = this.s.cosmetic?.cape && COSMETICS[this.s.cosmetic.cape];
    if (c && !this.s.equip.cape) { const e = this.s.equip, col = (sl) => (e[sl] && GEAR[e[sl]] ? { color: GEAR[e[sl]].color } : null); this.player.setGear({ head: col('head'), body: col('body'), legs: col('legs'), shield: col('shield'), bow: col('ranged'), cape: { color: c.color, emblem: 0xffffff } }); }
  };
  // checkTrap success counts toward hunting tasks
  const ct = P.checkTrap; P.checkTrap = function (tr) { const before = JSON.stringify(this.s.inv); const r = ct.call(this, tr); if (JSON.stringify(this.s.inv) !== before) this.taskEvent('gather', { skill: 'hunting', n: 1 }); return r; };
}
