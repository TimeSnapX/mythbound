import { MAX_LEVEL, XP_AT_MAX, XP_DOUBLING } from './config.js';
// Mythbound shared world data + simulation. Imported by BOTH the browser client and the Node server,
// so it must stay dependency-free (no three.js, no DOM).
export const PROTOCOL = 1;
export const ISLAND_R = 125;
export const VILLAGE = { x: 0, z: 10, r: 26 };
export const SPAWN = { x: 0, z: 20 };
export const ENTRANCE = { x: 0, z: -78 };
export const DUNGEON_X = 2000;           // dungeon interior lives far east of the island
export const DUNGEON_START = { x: DUNGEON_X, z: 6 };
export const BLOCK = 1.5;                // building grid cell size (cubes)
export const MAX_STACK = 8;
export const SAVE_VERSION = 3;
// ---- v2: Emberfall Ridge (volcanic foothills east of the isle), Cinderdeep Mine interior ----
export const RIDGE = { x: 232, z: -10, r: 88 };
export const CAMP = { x: RIDGE.x - 50, z: -6, r: 12 };              // Ashfall Camp (safe zone, Hearthstone + merchant)
export const VOLCANO = { x: RIDGE.x + 50, z: RIDGE.z - 6 };
export const MINE_ENTRANCE = { x: RIDGE.x + 24, z: RIDGE.z - 6 };
export const MINE_X = 3000;                 // Cinderdeep interior lives far east (x > 2600)
export const MINE_START = { x: MINE_X, z: 6 };
export const LAVA_POOLS = [{ x: RIDGE.x - 12, z: RIDGE.z - 32, r: 6 }, { x: RIDGE.x + 4, z: RIDGE.z + 24, r: 5 }, { x: RIDGE.x + 34, z: RIDGE.z + 34, r: 4.5 }];
// Fade fog patches: hurt over time unless near a lit Hearthstone. `hearth` = the Hearthstone that clears it when lit.
export const FADE_PATCHES = [
  { id: 'f_ridge', x: RIDGE.x - 22, z: RIDGE.z + 30, r: 15, hearth: 'h_ridge' },
  { id: 'f_ash', x: RIDGE.x + 14, z: RIDGE.z - 42, r: 11 },
  { id: 'f_isle', x: -72, z: -50, r: 9 },
];
export const HEARTHSTONES = [
  { id: 'h_camp', x: CAMP.x + 3, z: CAMP.z - 2, r: 11, lit: true },
  { id: 'h_ridge', x: RIDGE.x - 22, z: RIDGE.z + 30, r: 13, lit: false, flag: 'q2_lit' },
];
export const FADE_ECHO = { x: RIDGE.x - 26, z: RIDGE.z + 35 };
// bomb-able cracked walls in the overworld hiding treasure
export const SECRETS = [
  { id: 's_isle', x: 55, z: -46, ry: Math.PI * 0.75 },
  { id: 's_ridge', x: RIDGE.x + 30, z: RIDGE.z + 16, ry: -Math.PI / 2 },
];

// ---------- deterministic helpers ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  const u = smooth(fx), v = smooth(fz);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) { return vnoise(x, z) * 0.6 + vnoise(x * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, z * 4.3) * 0.1; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- terrain ----------
function rawHeight(x, z) {
  const d = Math.hypot(x, z * 1.1) / ISLAND_R;
  let h = (1 - Math.pow(Math.min(d, 1.6), 2.2)) * 9 - 2;
  h += (fbm(x * 0.03 + 10, z * 0.03 - 5) - 0.5) * 9 * Math.min(1, d * 1.5);
  h += Math.exp(-((x * x) / 1800 + ((z + 98) ** 2) / 500)) * 12;     // northern barrow hills
  h += Math.exp(-(((x - 72) ** 2) / 500 + ((z + 8) ** 2) / 800)) * 6; // eastern mining hills
  if (d > 1.12) h = Math.min(h, -2 - (d - 1.12) * 25);
  return h;
}
const ENTRANCE_H = rawHeight(ENTRANCE.x, ENTRANCE.z);
function isleHeight(x, z) {
  let h = rawHeight(x, z);
  const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
  if (dv < VILLAGE.r + 14) { const t = smooth(clamp((dv - VILLAGE.r + 2) / 16, 0, 1)); h = 4 + (h - 4) * t; }
  const de = Math.hypot(x - ENTRANCE.x, z - ENTRANCE.z);
  if (de < 14) { const t = smooth(clamp((de - 6) / 8, 0, 1)); h = ENTRANCE_H + (h - ENTRANCE_H) * t; }
  return h;
}
// Emberfall Ridge: ashy plateau with a volcano to the east, lava pools and basalt.
function ridgeRaw(x, z) {
  const d = Math.hypot(x - RIDGE.x, (z - RIDGE.z) * 1.15) / RIDGE.r;
  let h = (1 - Math.pow(Math.min(d, 1.8), 2)) * 8 - 2;
  h += (fbm(x * 0.035 - 40, z * 0.035 + 7) - 0.5) * 8 * Math.min(1, d * 1.6);
  h += Math.exp(-(((x - VOLCANO.x) ** 2) + ((z - VOLCANO.z) ** 2)) / 520) * 30;   // the volcano
  h -= Math.exp(-(((x - VOLCANO.x) ** 2) + ((z - VOLCANO.z) ** 2)) / 40) * 8;     // crater
  if (d > 1.0) h = Math.min(h, -2 - (d - 1.0) * 25);
  return h;
}
const MINE_EH = ridgeRaw(MINE_ENTRANCE.x - 3, MINE_ENTRANCE.z);
function ridgeHeight(x, z) {
  let h = ridgeRaw(x, z);
  const dc = Math.hypot(x - CAMP.x, z - CAMP.z);
  if (dc < CAMP.r + 12) { const t = smooth(clamp((dc - CAMP.r + 2) / 14, 0, 1)); h = 3 + (h - 3) * t; }
  const dm = Math.hypot(x - MINE_ENTRANCE.x, z - MINE_ENTRANCE.z);
  if (dm < 14) { const t = smooth(clamp((dm - 6) / 8, 0, 1)); h = MINE_EH + (h - MINE_EH) * t; }
  for (const p of LAVA_POOLS) { const dp = Math.hypot(x - p.x, z - p.z); if (dp < p.r + 3) { const t = smooth(clamp((dp - p.r + 1) / 4, 0, 1)); h = Math.min(h, 0.2 + (h - 0.2) * t); } }
  return h;
}
// terrain without the bridge deck (used for the terrain meshes)
export function terrainHeight(x, z) {
  const hi = x < 150 ? isleHeight(x, z) : -30;
  const rg = regionHeight(x, z);
  if (x < 140) return Math.max(hi, rg);
  return Math.max(hi, v3Flatten(x, z, ridgeHeight(x, z)), rg);
}
// ---------- v3 regions (Frostspire Peaks, Sunscar Desert, Mirewood Swamp, Starfall Coast) ----------
export const REGIONS = {
  frost: { x: 0, z: -248, r: 84, name: 'Frostspire Peaks', icon: '🏔', sub: 'Snow, blizzards and the Frost Wyrm' },
  desert: { x: 10, z: 248, r: 88, name: 'Sunscar Desert', icon: '🏜', sub: 'Dunes, sandstorms and a buried pyramid' },
  swamp: { x: -236, z: 8, r: 78, name: 'Mirewood Swamp', icon: '🌿', sub: 'Poison bogs and bog witches' },
  coast: { x: 252, z: 168, r: 66, name: 'Starfall Coast', icon: '⚓', sub: 'Beaches, pirates and deep-sea fishing' },
};
const RG = REGIONS;
export const SHRINE = { x: RG.frost.x, z: RG.frost.z - 18 };                 // Frostspire summit shrine
export const WYRM_LAIR = { x: RG.frost.x + 30, z: RG.frost.z - 30 };
export const OASIS = { x: RG.desert.x - 2, z: RG.desert.z - 36, r: 13 };    // Sunscar oasis town (safe: merchant + bank)
export const PYRAMID = { x: RG.desert.x + 38, z: RG.desert.z + 26 };       // ruined pyramid entrance
export const SANDWORM_PIT = { x: RG.desert.x - 42, z: RG.desert.z + 28 };
export const PORT = { x: RG.coast.x, z: RG.coast.z - 30, r: 12 };          // Starfall port town (safe)
export const FADELANDS = { x: 226, z: -70, r: 20 };       // opt-in PvP zone on Emberfall Ridge
export const ARENA = { x: 206, z: 40, r: 13 };            // the Ashfall Arena (PvP hub)
export const V3_HEARTHS = [
  { id: 'h_frost', x: RG.frost.x - 14, z: RG.frost.z + 58, flag: 'disc_frost', region: 'frost', name: 'Frostspire Hearthstone' },
  { id: 'h_oasis', x: OASIS.x + 6, z: OASIS.z - 6, flag: 'disc_desert', region: 'desert', name: 'Oasis Hearthstone' },
  { id: 'h_swamp', x: RG.swamp.x + 52, z: RG.swamp.z + 4, flag: 'disc_swamp', region: 'swamp', name: 'Mirewood Hearthstone' },
  { id: 'h_port', x: PORT.x - 8, z: PORT.z - 4, flag: 'disc_coast', region: 'coast', name: 'Starfall Hearthstone' },
];
const PADS = [{ ...OASIS, h: 3 }, { ...PORT, h: 2.6 }, { x: SHRINE.x, z: SHRINE.z, r: 7, h: null }, { x: PYRAMID.x, z: PYRAMID.z + 6, r: 8, h: 3 }, { ...ARENA, r: ARENA.r + 3, h: null }, ...V3_HEARTHS.map((q) => ({ x: q.x, z: q.z, r: 3, h: null }))];
function regionRaw(k, x, z) {
  const R = REGIONS[k], dx = x - R.x, dz = z - R.z, d = Math.hypot(dx, dz) / R.r;
  if (d > 1.6) return -30;
  let h;
  if (k === 'frost') {
    h = (1 - Math.pow(Math.min(d, 1.6), 2)) * 10 - 2 + (fbm(x * 0.04 + 3, z * 0.04) - 0.5) * 9 * Math.min(1, d * 1.6);
    h += Math.exp(-((x - SHRINE.x) ** 2 + (z - SHRINE.z) ** 2) / 900) * 30;
  } else if (k === 'desert') {
    h = (1 - Math.pow(Math.min(d, 1.6), 2)) * 6 - 1.5 + Math.sin(x * 0.11 + Math.sin(z * 0.045) * 2.2) * 1.4 * Math.min(1, d * 2) + (fbm(x * 0.03, z * 0.03) - 0.5) * 3;
    h -= Math.exp(-((x - OASIS.x - 16) ** 2 + (z - OASIS.z) ** 2) / 30) * 5; // the oasis pool
    h -= Math.exp(-((x - SANDWORM_PIT.x) ** 2 + (z - SANDWORM_PIT.z) ** 2) / 260) * 3;
  } else if (k === 'swamp') {
    h = (1 - Math.pow(Math.min(d, 1.6), 2)) * 3.4 + 0.5 + (fbm(x * 0.05 - 9, z * 0.05 + 4) - 0.5) * 3.2;
  } else {
    h = (1 - Math.pow(Math.min(d, 1.6), 2.4)) * 7 - 1.6 + (fbm(x * 0.04 + 11, z * 0.04) - 0.5) * 4 * Math.min(1, d * 1.5);
  }
  if (d > 1) h = Math.min(h, -2 - (d - 1) * 25);
  return h;
}
function v3Flatten(x, z, h) {
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z); if (d > p.r + 8) continue;
    const t = smooth(clamp((d - p.r + 1) / 9, 0, 1)), H = p.h ?? p._h ?? (p._h = (p === PADS[2] ? regionRaw('frost', p.x, p.z) : p === PADS[4] ? ridgeHeight(p.x, p.z) : regionRaw(p.region || nearestRegion(p.x, p.z), p.x, p.z)));
    h = H + (h - H) * t;
  }
  return h;
}
function nearestRegion(x, z) { let b = 'frost', bd = 1e9; for (const [k, R] of Object.entries(REGIONS)) { const d = Math.hypot(x - R.x, z - R.z) / R.r; if (d < bd) { bd = d; b = k; } } return b; }
export function regionHeight(x, z) {
  let h = -30;
  for (const k in REGIONS) { const R = REGIONS[k]; if (Math.abs(x - R.x) > R.r * 1.6 || Math.abs(z - R.z) > R.r * 1.6) continue; h = Math.max(h, regionRaw(k, x, z)); }
  return h > -30 ? v3Flatten(x, z, h) : h;
}
export function regionAt(x, z) {
  for (const k in REGIONS) { const R = REGIONS[k]; if (Math.hypot(x - R.x, z - R.z) < R.r * 1.04) return k; }
  return null;
}
// the Ember Bridge spans the strait between the isle's east shore and Ashfall Camp
export const BRIDGE = (() => {
  const z = -8; let x0 = 110, x1 = 200;
  for (let x = 100; x < 150; x += 0.5) if (isleHeight(x, z) >= 1.6) x0 = x;
  for (let x = 205; x > 140; x -= 0.5) if (ridgeHeight(x, z) >= 1.6) x1 = x;
  return { x0: x0 - 1, x1: x1 + 1, z, hw: 1.9, h0: isleHeight(x0 - 1, z), h1: ridgeHeight(x1 + 1, z) };
})();
export function bridgeDeck(x, z) {
  if (Math.abs(z - BRIDGE.z) > BRIDGE.hw || x < BRIDGE.x0 || x > BRIDGE.x1) return null;
  const t = (x - BRIDGE.x0) / (BRIDGE.x1 - BRIDGE.x0);
  return BRIDGE.h0 + (BRIDGE.h1 - BRIDGE.h0) * t + Math.sin(t * Math.PI) * 1.6;
}
// v3 causeways: plank bridges from the isle / ridge to each new region (axis 'z' = runs north-south at fixed x)
export const BRIDGES3 = (() => {
  const mk = (id, axis, c, from, dir, landA, landB) => {
    let a = from; while (landA(axis === 'z' ? c : a, axis === 'z' ? a : c) >= 1.4 && Math.abs(a - from) < 120) a += dir;
    let b = a; while (landB(axis === 'z' ? c : b, axis === 'z' ? b : c) < 1.4 && Math.abs(b - a) < 160) b += dir;
    const s0 = Math.min(a - dir, b + dir), s1 = Math.max(a - dir, b + dir);
    const p = (t) => (axis === 'z' ? [c, t] : [t, c]);
    return { id, axis, c, s0, s1, hw: 1.9, h0: Math.max(1.4, terrainHeight(...p(s0))), h1: Math.max(1.4, terrainHeight(...p(s1))) };
  };
  const isle = (x, z) => isleHeight(x, z), reg = (x, z) => regionHeight(x, z), rid = (x, z) => ridgeHeight(x, z);
  return [
    mk('north', 'z', -18, -100, -0.5, isle, reg),
    mk('south', 'z', 10, 60, 0.5, isle, reg),
    mk('west', 'x', 12, -60, -0.5, isle, reg),
    mk('coast', 'z', 248, 40, 0.5, rid, reg),
  ];
})();
export function bridge3Deck(x, z) {
  for (const B of BRIDGES3) {
    const [u, v] = B.axis === 'z' ? [z, x] : [x, z];
    if (Math.abs(v - B.c) > B.hw || u < B.s0 || u > B.s1) continue;
    const t = (u - B.s0) / (B.s1 - B.s0); return B.h0 + (B.h1 - B.h0) * t + Math.sin(t * Math.PI) * 1.2;
  }
  return null;
}
export function islandHeight(x, z) {
  const h = terrainHeight(x, z);
  if (x > BRIDGE.x0 - 1 && x < BRIDGE.x1 + 1) { const d = bridgeDeck(x, z); if (d !== null && d > h) return d; }
  const d3 = bridge3Deck(x, z); if (d3 !== null && d3 > h) return d3;
  return h;
}
export function lavaAt(x, z) {
  for (const p of LAVA_POOLS) if (Math.hypot(x - p.x, z - p.z) < p.r - 0.5) return true;
  return false;
}
export function zoneAt(x, z) {
  if (x > DUNGEON_X - 300) return 'dungeon';
  if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r) return 'village';
  if (Math.abs(z) > 140 || x < -140 || (x > 160 && z > 95)) {
    if (Math.hypot(x - OASIS.x, z - OASIS.z) < OASIS.r) return 'oasis';
    if (Math.hypot(x - PORT.x, z - PORT.z) < PORT.r) return 'port';
    const r = regionAt(x, z); if (r) return r;
  }
  if (Math.hypot(x - FADELANDS.x, z - FADELANDS.z) < FADELANDS.r) return 'fadelands';
  if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r) return 'arena';
  if (x > 150) return Math.hypot(x - CAMP.x, z - CAMP.z) < CAMP.r ? 'camp' : 'ember';
  return 'wild';
}
export const isSafeZone = (z) => z === 'village' || z === 'camp' || z === 'oasis' || z === 'port';
export const BELFRY_X = 4000, BELFRY_START = { x: 4000, z: 6 }, PYRAMID_X = 5000, PYRAMID_START = { x: 5000, z: 6 };
export const BELFRY_ENTRANCE = { x: -72, z: 68 };
export const dungeonAt = (x) => (x > PYRAMID_X - 400 ? 'pyramid' : x > BELFRY_X - 400 ? 'belfry' : x > MINE_X - 400 ? 'mine' : 'barrow');
export function inWorldBounds(x, z) {
  if (zoneAt(x, z) === 'dungeon') { const d = dungeonAt(x); return d === 'mine' ? Math.abs(x - MINE_X) < 60 && z > -170 && z < 40 : d === 'belfry' ? Math.abs(x - BELFRY_X) < 60 && z > -170 && z < 40 : d === 'pyramid' ? Math.abs(x - PYRAMID_X) < 50 && z > -90 && z < 40 : Math.abs(x - DUNGEON_X) < 60 && z > -140 && z < 40; }
  if (Math.hypot(x, z) < 165 || Math.hypot(x - RIDGE.x, z - RIDGE.z) < 125 || bridgeDeck(x, z) !== null || bridge3Deck(x, z) !== null) return true;
  for (const k in REGIONS) { const R = REGIONS[k]; if (Math.hypot(x - R.x, z - R.z) < R.r * 1.25) return true; }
  return false;
}
export function fadePatchAt(x, z, cleared) {
  for (const f of FADE_PATCHES) if (!(cleared && cleared(f)) && Math.hypot(x - f.x, z - f.z) < f.r) return f;
  return null;
}

// ---------- skills / items ----------
export const SKILLS = ['combat', 'archery', 'magic', 'woodcutting', 'mining', 'fishing', 'hunting', 'smithing', 'cooking', 'crafting', 'fletching', 'runemaking', 'farming', 'herblore'];
export const SKILL_NAMES = { combat: 'Combat', archery: 'Archery', magic: 'Magic', woodcutting: 'Woodcutting', mining: 'Mining', fishing: 'Fishing', hunting: 'Hunting', smithing: 'Smithing', cooking: 'Cooking', crafting: 'Crafting', fletching: 'Fletching', runemaking: 'Runemaking', farming: 'Farming', herblore: 'Herblore' };
export const SKILL_ICONS = { combat: '⚔', archery: '🏹', magic: '✨', woodcutting: '🪓', mining: '⛏', fishing: '🎣', hunting: '🪤', smithing: '🔨', cooking: '🍳', crafting: '🧵', fletching: '🪶', runemaking: '🔮', farming: '🌱', herblore: '⚗' };
export { MAX_LEVEL };
const XP_DEN = 2 ** ((MAX_LEVEL - 1) / XP_DOUBLING) - 1;
export function xpForLevel(L) { L = Math.max(1, Math.min(MAX_LEVEL, L)); return Math.round(XP_AT_MAX * (2 ** ((L - 1) / XP_DOUBLING) - 1) / XP_DEN); }
export function levelForXp(xp) { let L = 1; while (L < MAX_LEVEL && xp >= xpForLevel(L + 1)) L++; return L; }
// v1 curve, kept only for save migration
export function v1LevelForXp(xp) { let L = 1; while (L < 99 && xp >= Math.round(40 * L ** 2 + 30 * L)) L++; return L; }

// v: gold value (merchants buy at half). heal: half-hearts restored when eaten. gear: equipment item.
export const ITEMS = {
  log: { name: 'Logs', icon: '🪵', v: 2 },
  plank: { name: 'Planks', icon: '🟫', v: 4 },
  stone: { name: 'Stone', icon: '🪨', v: 1 },
  copper_ore: { name: 'Copper Ore', icon: '🟠', v: 4 },
  tin_ore: { name: 'Tin Ore', icon: '⚪', v: 4 },
  iron_ore: { name: 'Iron Ore', icon: '⚫', v: 8 },
  coal: { name: 'Coal', icon: '◼️', v: 10 },
  rune_essence: { name: 'Rune Essence', icon: '🔹', v: 3 },
  bronze_bar: { name: 'Bronze Bar', icon: '🟧', v: 12 },
  iron_bar: { name: 'Iron Bar', icon: '⬛', v: 20 },
  steel_bar: { name: 'Steel Bar', icon: '⬜', v: 40 },
  uncut_emerald: { name: 'Uncut Emerald', icon: '🟩', v: 60 },
  uncut_diamond: { name: 'Uncut Diamond', icon: '🔳', v: 120 },
  emerald: { name: 'Emerald', icon: '💚', v: 150 },
  diamond: { name: 'Diamond', icon: '💠', v: 300 },
  mythstone: { name: 'Mythstone Shard', icon: '💎', v: 0, quest: 1 },
  cinder_shard: { name: 'Cinder Mythshard', icon: '🔥', v: 0, quest: 1 },
  hook_cast: { name: 'Hook Cast (mould)', icon: '🪝', v: 0, quest: 1 },
  raw_shrimp: { name: 'Raw Shrimp', icon: '🦐', v: 3 },
  raw_trout: { name: 'Raw Trout', icon: '🐟', v: 6 },
  raw_eel: { name: 'Raw Ember Eel', icon: '🐍', v: 12 },
  raw_meat: { name: 'Raw Meat', icon: '🥩', v: 3 },
  shrimp: { name: 'Cooked Shrimp', icon: '🍤', v: 6, heal: 2 },
  trout: { name: 'Cooked Trout', icon: '🐠', v: 12, heal: 4 },
  eel: { name: 'Smoked Ember Eel', icon: '🍢', v: 25, heal: 6 },
  cooked_meat: { name: 'Cooked Meat', icon: '🍖', v: 8, heal: 3 },
  burnt_food: { name: 'Burnt Food', icon: '🥓', v: 0 },
  hide: { name: 'Hide', icon: '🟤', v: 5 },
  leather: { name: 'Leather', icon: '🧶', v: 10 },
  feather: { name: 'Feathers', icon: '🪶', v: 1 },
  fire_shard: { name: 'Fire Shard', icon: '🔸', v: 15 },
  beetle_plate: { name: 'Beetle Plate', icon: '🛡', v: 20 },
  lantern_oil: { name: 'Lantern Oil', icon: '🏮', v: 10 },
  bomb: { name: 'Blastcap Bomb', icon: '💣', v: 15 },
  snare: { name: 'Snare', icon: '🪢', v: 6 },
  box_trap: { name: 'Box Trap', icon: '🪤', v: 20 },
  arrow_shaft: { name: 'Arrow Shafts', icon: '➖', v: 1 },
  bronze_tips: { name: 'Bronze Arrowtips', icon: '🔺', v: 2 },
  iron_tips: { name: 'Iron Arrowtips', icon: '🔻', v: 4 },
  steel_tips: { name: 'Steel Arrowtips', icon: '🔷', v: 8 },
  bronze_arrow: { name: 'Bronze Arrows', icon: '➶', v: 3, arrow: 0 },
  iron_arrow: { name: 'Iron Arrows', icon: '➵', v: 6, arrow: 1 },
  steel_arrow: { name: 'Steel Arrows', icon: '➳', v: 12, arrow: 2 },
  air_rune: { name: 'Air Rune', icon: '🌀', v: 4, rune: 1 },
  water_rune: { name: 'Water Rune', icon: '💧', v: 5, rune: 1 },
  earth_rune: { name: 'Earth Rune', icon: '🟤', v: 5, rune: 1 },
  fire_rune: { name: 'Fire Rune', icon: '🔥', v: 6, rune: 1 },
  mind_rune: { name: 'Mind Rune', icon: '🧠', v: 10, rune: 1 },
  fade_rune: { name: 'Fade Rune', icon: '🌫', v: 25, rune: 1 },
  grapple_anchor: { name: 'Iron Grapple Anchor', icon: '⚓', v: 40 },
  steel_anchor: { name: 'Steel Grapple Anchor', icon: '⚓', v: 80 },
};
// equipment. req = Combat (melee/armour) or Archery (bows) level needed to equip
export const GEAR = {
  wood_sword: { slot: 'weapon', name: 'Wooden Sword', atk: 1, sword: 'wood', icon: '🗡', v: 1, req: 1 },
  bronze_sword: { slot: 'weapon', name: 'Bronze Sword', atk: 2, sword: 'bronze', icon: '🗡', v: 30, req: 1 },
  iron_sword: { slot: 'weapon', name: 'Iron Sword', atk: 3, sword: 'iron', icon: '🗡', v: 60, req: 8 },
  steel_sword: { slot: 'weapon', name: 'Steel Sword', atk: 4, sword: 'steel', icon: '⚔', v: 120, req: 18 },
  emerald_sword: { slot: 'weapon', name: 'Emerald Blade', atk: 5, sword: 'emerald', icon: '⚔', v: 400, req: 40, ench: 'emerald' },
  diamond_sword: { slot: 'weapon', name: 'Diamond Blade', atk: 6, sword: 'diamond', icon: '⚔', v: 800, req: 50, ench: 'diamond' },
  driftwood_shield: { slot: 'shield', name: 'Driftwood Shield', def: 0, color: 0x7a5a3a, icon: '🛡', v: 1, req: 1 },
  bronze_shield: { slot: 'shield', name: 'Bronze Shield', def: 1, color: 0xd08a3c, icon: '🛡', v: 30, req: 1 },
  iron_shield: { slot: 'shield', name: 'Iron Shield', def: 2, color: 0xa0a4ac, icon: '🛡', v: 50, req: 8 },
  steel_shield: { slot: 'shield', name: 'Steel Shield', def: 3, color: 0xd8dde6, icon: '🛡', v: 110, req: 18 },
  leather_cap: { slot: 'head', name: 'Leather Cap', def: 1, color: 0x8a5a30, icon: '🧢', v: 15, req: 1 },
  leather_body: { slot: 'body', name: 'Leather Body', def: 2, color: 0x8a5a30, icon: '🦺', v: 35, req: 1 },
  leather_chaps: { slot: 'legs', name: 'Leather Chaps', def: 1, color: 0x7a4a28, icon: '👖', v: 25, req: 1 },
  bronze_helm: { slot: 'head', name: 'Bronze Helm', def: 1, color: 0xd08a3c, icon: '⛑', v: 20, req: 1 },
  bronze_body: { slot: 'body', name: 'Bronze Platebody', def: 3, color: 0xd08a3c, icon: '🥋', v: 50, req: 1 },
  bronze_legs: { slot: 'legs', name: 'Bronze Platelegs', def: 2, color: 0xc07a30, icon: '👖', v: 35, req: 1 },
  iron_helm: { slot: 'head', name: 'Iron Helm', def: 2, color: 0xa0a4ac, icon: '⛑', v: 40, req: 8 },
  iron_body: { slot: 'body', name: 'Iron Platebody', def: 4, color: 0xa0a4ac, icon: '🥋', v: 90, req: 8 },
  iron_legs: { slot: 'legs', name: 'Iron Platelegs', def: 3, color: 0x90949c, icon: '👖', v: 60, req: 8 },
  steel_helm: { slot: 'head', name: 'Steel Helm', def: 3, color: 0xd8dde6, icon: '⛑', v: 80, req: 18 },
  steel_body: { slot: 'body', name: 'Steel Platebody', def: 6, color: 0xd8dde6, icon: '🥋', v: 180, req: 18 },
  steel_legs: { slot: 'legs', name: 'Steel Platelegs', def: 4, color: 0xc8cdd6, icon: '👖', v: 120, req: 18 },
  shortbow: { slot: 'ranged', name: 'Shortbow', rng: 2, color: 0x9a6a3a, icon: '🏹', v: 20, req: 1, skill: 'archery' },
  longbow: { slot: 'ranged', name: 'Longbow', rng: 3, color: 0x7a4a24, icon: '🏹', v: 60, req: 10, skill: 'archery' },
  ember_bow: { slot: 'ranged', name: 'Emberwood Bow', rng: 4, color: 0xc04a1a, icon: '🏹', v: 160, req: 25, skill: 'archery' },
};
for (const [k, g] of Object.entries(GEAR)) ITEMS[k] = { name: g.name, icon: g.icon, v: g.v, gear: 1 };
export const SLOTS = ['weapon', 'shield', 'ranged', 'head', 'body', 'legs'];
export const SLOT_NAMES = { weapon: 'Weapon', shield: 'Shield', ranged: 'Bow', head: 'Head', body: 'Body', legs: 'Legs' };
export const ENCHANTS = { emerald: { name: 'Lifesteal', desc: '25% chance to heal ½ heart on hit' }, diamond: { name: 'Crit', desc: '20% chance to deal double damage, ignores armour' } };
export const SWORDS = {
  wood: { name: 'Wooden Sword', dmg: 1, color: 0x9b6b3a },
  bronze: { name: 'Bronze Sword', dmg: 2, color: 0xd08a3c },
  iron: { name: 'Iron Sword', dmg: 3, color: 0xd0d4dc },
  steel: { name: 'Steel Sword', dmg: 4, color: 0xeef3ff },
  emerald: { name: 'Emerald Blade', dmg: 5, color: 0x30d070 },
  diamond: { name: 'Diamond Blade', dmg: 6, color: 0xc8f4ff },
};
export const STATION_SKILL = { furnace: 'smithing', anvil: 'smithing', range: 'cooking', workbench: 'crafting', fletch: 'fletching' };
export const STATION_NAMES = { furnace: 'Furnace — Smelting', anvil: 'Anvil — Forging', range: 'Cooking Fire', workbench: 'Workbench — Crafting & Fletching' };
const R = (id, station, name, input, out, level, xp, extra = {}) => ({ id, station, name, input, out, level, xp, skill: extra.skill || STATION_SKILL[station], ...extra });
export const RECIPES = [
  R('bronze_bar', 'furnace', 'Smelt Bronze Bar', { copper_ore: 1, tin_ore: 1 }, { bronze_bar: 1 }, 1, 120),
  R('iron_bar', 'furnace', 'Smelt Iron Bar', { iron_ore: 1 }, { iron_bar: 1 }, 8, 260),
  R('steel_bar', 'furnace', 'Smelt Steel Bar', { iron_ore: 1, coal: 2 }, { steel_bar: 1 }, 18, 520),
  R('bronze_sword', 'anvil', 'Forge Bronze Sword', { bronze_bar: 2 }, { bronze_sword: 1 }, 1, 300, { sword: 'bronze' }),
  R('bronze_helm', 'anvil', 'Forge Bronze Helm', { bronze_bar: 1 }, { bronze_helm: 1 }, 2, 160),
  R('bronze_tips', 'anvil', 'Forge Bronze Arrowtips ×10', { bronze_bar: 1 }, { bronze_tips: 10 }, 2, 140),
  R('bronze_shield', 'anvil', 'Forge Bronze Shield', { bronze_bar: 2 }, { bronze_shield: 1 }, 3, 300),
  R('bronze_legs', 'anvil', 'Forge Bronze Platelegs', { bronze_bar: 2 }, { bronze_legs: 1 }, 4, 320),
  R('bronze_body', 'anvil', 'Forge Bronze Platebody', { bronze_bar: 3 }, { bronze_body: 1 }, 5, 480),
  R('iron_sword', 'anvil', 'Forge Iron Sword', { iron_bar: 2 }, { iron_sword: 1 }, 9, 600, { sword: 'iron' }),
  R('iron_tips', 'anvil', 'Forge Iron Arrowtips ×10', { iron_bar: 1 }, { iron_tips: 10 }, 9, 300),
  R('iron_helm', 'anvil', 'Forge Iron Helm', { iron_bar: 1 }, { iron_helm: 1 }, 10, 320),
  R('grapple_anchor', 'anvil', 'Forge Iron Grapple Anchor', { iron_bar: 2 }, { grapple_anchor: 1 }, 10, 600, { needs: 'hook_cast' }),
  R('iron_shield', 'anvil', 'Forge Iron Shield', { iron_bar: 2 }, { iron_shield: 1 }, 11, 620),
  R('iron_legs', 'anvil', 'Forge Iron Platelegs', { iron_bar: 2 }, { iron_legs: 1 }, 12, 650),
  R('iron_body', 'anvil', 'Forge Iron Platebody', { iron_bar: 3 }, { iron_body: 1 }, 14, 980),
  R('steel_sword', 'anvil', 'Forge Steel Sword', { steel_bar: 2, fire_shard: 1 }, { steel_sword: 1 }, 19, 1200, { sword: 'steel' }),
  R('steel_tips', 'anvil', 'Forge Steel Arrowtips ×10', { steel_bar: 1 }, { steel_tips: 10 }, 19, 600),
  R('steel_helm', 'anvil', 'Forge Steel Helm', { steel_bar: 1 }, { steel_helm: 1 }, 20, 640),
  R('steel_anchor', 'anvil', 'Forge Steel Grapple Anchor', { steel_bar: 2 }, { steel_anchor: 1 }, 20, 1200, { needs: 'hook_cast' }),
  R('steel_shield', 'anvil', 'Forge Steel Shield', { steel_bar: 2, beetle_plate: 1 }, { steel_shield: 1 }, 21, 1250),
  R('steel_legs', 'anvil', 'Forge Steel Platelegs', { steel_bar: 2 }, { steel_legs: 1 }, 23, 1300),
  R('steel_body', 'anvil', 'Forge Steel Platebody', { steel_bar: 3 }, { steel_body: 1 }, 25, 1950),
  R('emerald_sword', 'anvil', 'Forge Emerald Blade', { steel_bar: 2, emerald: 1 }, { emerald_sword: 1 }, 40, 6000, { sword: 'emerald' }),
  R('diamond_sword', 'anvil', 'Forge Diamond Blade', { steel_bar: 3, diamond: 1 }, { diamond_sword: 1 }, 50, 12000, { sword: 'diamond' }),
  R('cook_shrimp', 'range', 'Cook Shrimp', { raw_shrimp: 1 }, { shrimp: 1 }, 1, 120, { burn: 0.35 }),
  R('cook_meat', 'range', 'Cook Meat', { raw_meat: 1 }, { cooked_meat: 1 }, 1, 160, { burn: 0.35 }),
  R('cook_trout', 'range', 'Cook Trout', { raw_trout: 1 }, { trout: 1 }, 8, 300, { burn: 0.4 }),
  R('cook_eel', 'range', 'Smoke Ember Eel', { raw_eel: 1 }, { eel: 1 }, 15, 520, { burn: 0.45 }),
  R('plank', 'workbench', 'Saw Planks ×2', { log: 1 }, { plank: 2 }, 1, 60),
  R('leather', 'workbench', 'Tan Leather', { hide: 1 }, { leather: 1 }, 1, 100),
  R('snare', 'workbench', 'Twist a Snare', { log: 1 }, { snare: 1 }, 1, 60),
  R('leather_cap', 'workbench', 'Stitch Leather Cap', { leather: 1 }, { leather_cap: 1 }, 3, 160),
  R('leather_chaps', 'workbench', 'Stitch Leather Chaps', { leather: 2 }, { leather_chaps: 1 }, 6, 320),
  R('box_trap', 'workbench', 'Build a Box Trap', { plank: 2, iron_bar: 1 }, { box_trap: 1 }, 8, 300),
  R('leather_body', 'workbench', 'Stitch Leather Body', { leather: 3 }, { leather_body: 1 }, 9, 520),
  R('cut_emerald', 'workbench', 'Cut Emerald', { uncut_emerald: 1 }, { emerald: 1 }, 30, 3000),
  R('cut_diamond', 'workbench', 'Cut Diamond', { uncut_diamond: 1 }, { diamond: 1 }, 35, 4500),
  R('arrow_shaft', 'workbench', 'Fletch Arrow Shafts ×10', { log: 1 }, { arrow_shaft: 10 }, 1, 50, { skill: 'fletching' }),
  R('shortbow', 'workbench', 'Fletch Shortbow', { log: 2 }, { shortbow: 1 }, 1, 160, { skill: 'fletching' }),
  R('bronze_arrow', 'workbench', 'Fletch Bronze Arrows ×5', { arrow_shaft: 5, feather: 5, bronze_tips: 5 }, { bronze_arrow: 5 }, 1, 120, { skill: 'fletching' }),
  R('iron_arrow', 'workbench', 'Fletch Iron Arrows ×5', { arrow_shaft: 5, feather: 5, iron_tips: 5 }, { iron_arrow: 5 }, 9, 260, { skill: 'fletching' }),
  R('longbow', 'workbench', 'Fletch Longbow', { log: 4, leather: 1 }, { longbow: 1 }, 10, 640, { skill: 'fletching' }),
  R('steel_arrow', 'workbench', 'Fletch Steel Arrows ×5', { arrow_shaft: 5, feather: 5, steel_tips: 5 }, { steel_arrow: 5 }, 19, 520, { skill: 'fletching' }),
  R('ember_bow', 'workbench', 'Fletch Emberwood Bow', { log: 3, fire_shard: 2 }, { ember_bow: 1 }, 25, 1600, { skill: 'fletching' }),
];
// burn chance falls 4% per level above the recipe level
export const burnChance = (r, lvl) => (r.burn ? Math.max(0, r.burn - (lvl - r.level) * 0.04) : 0);
// rune altars: bind rune essence into runes. Extra rune per essence every 11 levels above the requirement.
export const ALTARS = [
  { id: 'air', rune: 'air_rune', name: 'Air Altar', level: 1, xp: 50, x: -30.8, z: 67, color: 0xdfefff },
  { id: 'water', rune: 'water_rune', name: 'Water Altar', level: 5, xp: 70, x: -96, z: -6, color: 0x4aa0ff },
  { id: 'earth', rune: 'earth_rune', name: 'Earth Altar', level: 9, xp: 90, x: 92, z: 28, color: 0x8a6a3a },
  { id: 'fire', rune: 'fire_rune', name: 'Fire Altar', level: 14, xp: 120, x: RIDGE.x - 2, z: RIDGE.z - 36, color: 0xff5a20 },
  { id: 'mind', rune: 'mind_rune', name: 'Mind Altar', level: 25, xp: 200, x: RIDGE.x - 30, z: RIDGE.z - 18, color: 0xd080ff },
  { id: 'fade', rune: 'fade_rune', name: 'Fade Altar', level: 40, xp: 400, x: RIDGE.x + 14, z: RIDGE.z - 42, color: 0xc8ccd2 },
];
// spells: cost in runes. kind: bolt (projectile), heal, teleport, enchant
export const SPELLS = [
  { id: 'wind_bolt', name: 'Wind Bolt', level: 1, cost: { air_rune: 2 }, kind: 'bolt', dmg: 2, xp: 90, color: 0xdfefff, icon: '🌀' },
  { id: 'water_bolt', name: 'Water Bolt', level: 5, cost: { air_rune: 2, water_rune: 1 }, kind: 'bolt', dmg: 3, xp: 140, color: 0x4aa0ff, icon: '💧' },
  { id: 'heal', name: 'Heal', level: 8, cost: { water_rune: 2, earth_rune: 1 }, kind: 'heal', heal: 4, xp: 160, color: 0x8cff9a, icon: '💚' },
  { id: 'earth_bolt', name: 'Earth Bolt', level: 10, cost: { air_rune: 2, earth_rune: 2 }, kind: 'bolt', dmg: 4, xp: 200, color: 0x9a7a4a, icon: '🪨' },
  { id: 'fire_bolt', name: 'Fire Bolt', level: 15, cost: { air_rune: 3, fire_rune: 2 }, kind: 'bolt', dmg: 5, xp: 280, color: 0xff6a20, icon: '🔥' },
  { id: 'teleport', name: 'Teleport to Hearthstone', level: 20, cost: { air_rune: 3, earth_rune: 1, mind_rune: 1 }, kind: 'teleport', xp: 400, color: 0xffd27a, icon: '🏠' },
  { id: 'mind_blast', name: 'Mind Blast', level: 30, cost: { mind_rune: 2, fire_rune: 2 }, kind: 'bolt', dmg: 7, xp: 600, color: 0xd080ff, icon: '🧠' },
  { id: 'ench_emerald', name: 'Enchant Emerald (Lifesteal)', level: 40, cost: { emerald: 1, earth_rune: 5, water_rune: 5 }, kind: 'enchant', ench: 'emerald', xp: 3000, color: 0x30d070, icon: '💚' },
  { id: 'ench_diamond', name: 'Enchant Diamond (Crit)', level: 45, cost: { diamond: 1, fire_rune: 5, mind_rune: 5 }, kind: 'enchant', ench: 'diamond', xp: 5000, color: 0xc8f4ff, icon: '💠' },
  { id: 'fade_ward', name: 'Fade Ward', level: 42, cost: { fade_rune: 1, air_rune: 3 }, kind: 'ward', xp: 800, color: 0xc8ccd2, icon: '🌫' },
];
// unlock tables (shown as tooltips in the Skills panel). Generic perks every few levels make gathering faster.
export const UNLOCKS = {
  combat: [[1, 'Bronze gear'], [4, '+1 heart'], [8, 'Iron gear'], [12, 'Spin attack costs less stamina'], [18, 'Steel gear'], [25, '+1 heart'], [30, 'Faster combo'], [40, 'Emerald Blade'], [50, 'Diamond Blade']],
  archery: [[1, 'Shortbow, bronze arrows'], [5, 'Longer range'], [9, 'Iron arrows'], [10, 'Longbow'], [15, 'Faster draw'], [19, 'Steel arrows'], [25, 'Emberwood Bow'], [35, 'Double-shot chance'], [50, 'Master archer']],
  magic: SPELLS.map((s) => [s.level, s.name]),
  woodcutting: [[1, 'Trees'], [4, 'Chop 5% faster'], [8, 'Oak trees'], [12, 'Chop 10% faster'], [15, 'Ashwood (Emberfall)'], [20, 'Chop 15% faster'], [30, 'Double log chance'], [40, 'Chop 25% faster'], [50, 'Woodsman']],
  mining: [[1, 'Copper, tin, stone'], [5, 'Rune essence'], [8, 'Iron'], [12, 'Mine 10% faster'], [15, 'Coal'], [20, 'Better gem odds'], [30, 'Gem odds ×2'], [40, 'Mine 25% faster'], [50, 'Prospector']],
  fishing: [[1, 'Shrimp'], [4, 'Fish 5% faster'], [8, 'Trout'], [12, 'Fish 10% faster'], [15, 'Ember Eel (Emberfall)'], [25, 'Double catch chance'], [40, 'Fish 25% faster'], [50, 'Angler']],
  hunting: [[1, 'Rabbit burrows (snare)'], [5, 'Traps catch faster'], [8, 'Ash fowl nests (feathers)'], [12, 'Extra hide chance'], [15, 'Boar trails (box trap)'], [25, 'Traps catch twice as fast'], [50, 'Master tracker']],
  smithing: RECIPES.filter((r) => r.skill === 'smithing').map((r) => [r.level, r.name]),
  cooking: RECIPES.filter((r) => r.skill === 'cooking').map((r) => [r.level, r.name]).concat([[20, 'Rarely burn shrimp/meat'], [30, 'Never burn trout']]),
  crafting: RECIPES.filter((r) => r.skill === 'crafting').map((r) => [r.level, r.name]),
  fletching: RECIPES.filter((r) => r.skill === 'fletching').map((r) => [r.level, r.name]),
  runemaking: ALTARS.map((a) => [a.level, a.name]).concat([[12, '2 air runes per essence'], [16, '2 water runes per essence']]),
};
for (const k in UNLOCKS) UNLOCKS[k].sort((a, b) => a[0] - b[0]);
// generic gathering speed perk: up to 30% faster at level 50
export const gatherSpeed = (lvl) => 1 - Math.min(0.3, (lvl - 1) * 0.006);

// building pieces. h = height in the stack; solid=false => no collision; top=false => nothing can sit on it; plot => home plot only
export const PIECES = {
  wood: { name: 'Wood Block', icon: '🟫', cost: { log: 1 }, h: BLOCK, color: 0x9a6a3c },
  stone: { name: 'Stone Block', icon: '⬜', cost: { stone: 1 }, h: BLOCK, color: 0x8d8f94 },
  floor: { name: 'Plank Floor', icon: '▭', cost: { log: 1 }, h: 0.3, color: 0xc49a62 },
  wall: { name: 'Wall', icon: '▮', cost: { plank: 2 }, h: 3, color: 0xd8c7a0 },
  door: { name: 'Door', icon: '🚪', cost: { plank: 3 }, h: 3, color: 0x7a4e2a, top: false },
  window: { name: 'Window Wall', icon: '🪟', cost: { plank: 2 }, h: 3, color: 0xd8c7a0 },
  roof: { name: 'Roof Slope', icon: '◢', cost: { plank: 2 }, h: 0.75, color: 0xa8452e },
  stairs: { name: 'Stairs', icon: '⊿', cost: { plank: 2 }, h: BLOCK, color: 0xb08050 },
  fence: { name: 'Fence', icon: '⧧', cost: { plank: 1 }, h: 1.0, color: 0x8a6442, top: false },
  torch: { name: 'Torch', icon: '🔥', cost: { log: 1 }, h: 1.4, color: 0x5a3a20, solid: false, top: false },
  chest: { name: 'Storage Chest', icon: '📦', cost: { plank: 4 }, h: 0.9, color: 0x8a5a2a, top: false },
  bench: { name: 'Workbench', icon: '🪚', cost: { plank: 3, stone: 2 }, h: 1.0, color: 0xa07040, top: false },
  campfire: { name: 'Campfire', icon: '🍳', cost: { log: 2, stone: 1 }, h: 0.5, color: 0x6a6a6a, top: false, solid: false },
  anchor: { name: 'Grapple Anchor', icon: '⚓', cost: { grapple_anchor: 1 }, alt: { steel_anchor: 1 }, h: 3.2, color: 0x6b4a2e, top: false },
  hearth: { name: 'Hearthstone', icon: '💠', cost: { stone: 5, lantern_oil: 1 }, h: 1.6, color: 0x7a8aa0, top: false, plot: 1 },
  bankchest: { name: 'Bank Chest', icon: '🏦', cost: { plank: 6, iron_bar: 2 }, h: 1.0, color: 0x5a4a8a, top: false, plot: 1 },
};
export const PIECE_ORDER = Object.keys(PIECES);
export const pieceType = (entry) => String(entry).split('@')[0];
export const pieceRot = (entry) => +(String(entry).split('@')[1] || 0) & 3;
export const PLOT_CELLS = 8;               // home plot = 8x8 cells (12 m)
export const PLOT_COST = 100;              // gold coins

// enemy loot: coins [min,max] plus independent item rolls [item, chance, qty]
export const LOOT = {
  mossling: { gold: [1, 3], items: [['log', 0.2, 1]] },
  grubkin: { gold: [2, 5], items: [['copper_ore', 0.25, 1], ['tin_ore', 0.25, 1]] },
  boar: { gold: [3, 6], items: [['hide', 0.8, 1], ['raw_meat', 0.8, 1]] },
  hound: { gold: [3, 7], items: [['hide', 0.6, 1], ['raw_meat', 0.6, 1]] },
  imp: { gold: [4, 9], items: [['fire_shard', 0.5, 1], ['fire_rune', 0.3, 3]] },
  hollowed: { gold: [5, 10], items: [['coal', 0.5, 1], ['iron_ore', 0.3, 1], ['uncut_emerald', 0.03, 1]] },
  shellback: { gold: [6, 12], items: [['beetle_plate', 0.9, 1]] },
  warden: { gold: [30, 30], items: [] },
  magmaw: { gold: [150, 150], items: [['fire_shard', 1, 3], ['uncut_diamond', 1, 1]] },
};
// merchants: what they sell and for how much; they buy anything with value at half price
export const SHOPS = {
  bram: { name: "Bram's Forge & Goods", sells: { plank: 6, lantern_oil: 12, copper_ore: 8, tin_ore: 8, bronze_bar: 20, raw_shrimp: 5, feather: 2, snare: 10, rune_essence: 6 } },
  tamsin: { name: 'Ashfall Supplies', sells: { cooked_meat: 12, trout: 20, coal: 18, lantern_oil: 12, leather: 18, bomb: 15, bronze_arrow: 5, air_rune: 8 } },
};
export const sellPrice = (item) => Math.floor((ITEMS[item]?.v || 0) / 2);
// gems: rare mining drops (better odds in Emberfall + Cinderdeep)
export function gemChance(x, mineLvl) { const base = x > 150 ? 1 / 25 : 1 / 70; return base * (mineLvl >= 30 ? 2 : mineLvl >= 20 ? 1.4 : 1); }
// pets
export const PETS = {
  dog: { name: 'Dog', icon: '🐕', perk: 'Sniffs out loot (+25% coins, bigger pickup range) and tracks game (traps catch 2× faster).' },
  cat: { name: 'Cat', icon: '🐈', perk: 'Lucky: ×1.5 odds on rare gems and loot drops.' },
  bird: { name: 'Bird', icon: '🐦', perk: 'Scouts ahead: marks nearby enemies and resources.' },
};

// ---------- resource nodes ----------
export const NODE_TYPES = {
  tree: { skill: 'woodcutting', level: 1, xp: 200, item: 'log', qty: 1, respawn: 20, time: 1.5, label: 'Chop Tree' },
  oak: { skill: 'woodcutting', level: 8, xp: 400, item: 'log', qty: 2, respawn: 30, time: 2.0, label: 'Chop Oak' },
  rock: { skill: 'mining', level: 1, xp: 120, item: 'stone', qty: 1, respawn: 15, time: 1.4, label: 'Mine Rock', gems: 1 },
  copper: { skill: 'mining', level: 1, xp: 160, item: 'copper_ore', qty: 1, respawn: 20, time: 1.6, label: 'Mine Copper', gems: 1 },
  tin: { skill: 'mining', level: 1, xp: 160, item: 'tin_ore', qty: 1, respawn: 20, time: 1.6, label: 'Mine Tin', gems: 1 },
  iron: { skill: 'mining', level: 8, xp: 350, item: 'iron_ore', qty: 1, respawn: 35, time: 2.0, label: 'Mine Iron', gems: 1 },
  ashtree: { skill: 'woodcutting', level: 15, xp: 600, item: 'log', qty: 2, respawn: 25, time: 1.8, label: 'Chop Ashwood' },
  coal: { skill: 'mining', level: 15, xp: 550, item: 'coal', qty: 1, respawn: 30, time: 1.8, label: 'Mine Coal', gems: 1 },
  essence: { skill: 'mining', level: 5, xp: 100, item: 'rune_essence', qty: 2, respawn: 12, time: 1.4, label: 'Mine Rune Essence' },
  shrimp: { skill: 'fishing', level: 1, xp: 160, item: 'raw_shrimp', qty: 1, respawn: 18, time: 2.2, label: 'Net Shrimp', fish: 1 },
  trout: { skill: 'fishing', level: 8, xp: 380, item: 'raw_trout', qty: 1, respawn: 25, time: 2.6, label: 'Fish Trout', fish: 1 },
  eel: { skill: 'fishing', level: 15, xp: 650, item: 'raw_eel', qty: 1, respawn: 30, time: 3.0, label: 'Fish Ember Eel', fish: 1 },
  // hunting: set a trap, wait for the catch, then check it
  burrow: { skill: 'hunting', level: 1, xp: 180, trap: 'snare', catch: 6, loot: [['hide', 1, 1], ['raw_meat', 1, 1]], respawn: 20, time: 1.0, label: 'Set Snare (rabbit burrow)' },
  nest: { skill: 'hunting', level: 8, xp: 360, trap: 'snare', catch: 7, loot: [['feather', 1, 6], ['raw_meat', 0.6, 1]], respawn: 25, time: 1.0, label: 'Set Snare (ash fowl nest)' },
  trail: { skill: 'hunting', level: 15, xp: 700, trap: 'box_trap', catch: 9, loot: [['hide', 1, 2], ['raw_meat', 1, 2], ['feather', 0.5, 3]], respawn: 30, time: 1.4, label: 'Set Box Trap (boar trail)' },
  // ---- v3 ----
  pine: { skill: 'woodcutting', level: 20, xp: 700, item: 'log', qty: 2, respawn: 25, time: 1.8, label: 'Chop Frostpine' },
  palm: { skill: 'woodcutting', level: 10, xp: 450, item: 'log', qty: 2, respawn: 25, time: 1.6, label: 'Chop Palm' },
  mangrove: { skill: 'woodcutting', level: 25, xp: 800, item: 'log', qty: 2, respawn: 25, time: 1.9, label: 'Chop Mangrove' },
  mithril: { skill: 'mining', level: 30, xp: 900, item: 'mithril_ore', qty: 1, respawn: 45, time: 2.4, label: 'Mine Mithril', gems: 1 },
  adamant: { skill: 'mining', level: 40, xp: 1300, item: 'adamant_ore', qty: 1, respawn: 60, time: 2.8, label: 'Mine Adamantite', gems: 1 },
  icefish: { skill: 'fishing', level: 20, xp: 750, item: 'raw_icefish', qty: 1, respawn: 30, time: 3.0, label: 'Ice-fish (hole)', fish: 1 },
  nightfish: { skill: 'fishing', level: 18, xp: 800, item: 'raw_moonfish', qty: 1, respawn: 30, time: 3.0, label: 'Fish Moonfish <small>(night)</small>', fish: 1, night: 1 },
  rainfish: { skill: 'fishing', level: 12, xp: 600, item: 'raw_rainbow', qty: 1, respawn: 30, time: 2.8, label: 'Fish Rainbow Trout <small>(rain)</small>', fish: 1, rain: 1 },
  deepsea: { skill: 'fishing', level: 30, xp: 1100, item: 'raw_swordfish', qty: 1, respawn: 40, time: 3.4, label: 'Deep-sea fish (pier)', fish: 1 },
  cactus: { skill: 'farming', level: 1, xp: 120, item: 'cactus_water', qty: 1, respawn: 30, time: 1.4, label: 'Tap Cactus', herb: 1 },
  wildherb: { skill: 'herblore', level: 1, xp: 150, item: 'herb_guam', qty: 1, respawn: 30, time: 1.4, label: 'Pick Wild Guam', herb: 1 },
  desertherb: { skill: 'herblore', level: 12, xp: 300, item: 'herb_sunleaf', qty: 1, respawn: 35, time: 1.6, label: 'Pick Sunleaf', herb: 1 },
  bogherb: { skill: 'herblore', level: 25, xp: 600, item: 'herb_bloodmoss', qty: 1, respawn: 45, time: 1.8, label: 'Pick Bloodmoss <small>(rare)</small>', herb: 1 },
  snowherb: { skill: 'herblore', level: 18, xp: 450, item: 'herb_frostbloom', qty: 1, respawn: 40, time: 1.6, label: 'Pick Frostbloom', herb: 1 },
};
function validWild(x, z, minH = 1.2) {
  if (islandHeight(x, z) < minH) return false;
  if (_v2 && (SECRETS.some((s) => Math.hypot(x - s.x, z - s.z) < 7) || ALTARS.some((a) => Math.hypot(x - a.x, z - a.z) < 5) || Math.abs(z - BRIDGE.z) < 4 && x > 90)) return false;
  if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r + 4) return false;
  if (Math.hypot(x - ENTRANCE.x, z - ENTRANCE.z) < 13) return false;
  return true;
}
function validRidge(x, z, minH = 1.5) {
  if (zoneAt(x, z) !== 'ember' || terrainHeight(x, z) < minH || terrainHeight(x, z) > 14) return false;
  if (Math.hypot(x - CAMP.x, z - CAMP.z) < CAMP.r + 6) return false;
  if (Math.hypot(x - MINE_ENTRANCE.x, z - MINE_ENTRANCE.z) < 12) return false;
  if (Math.abs(z - BRIDGE.z) < 5 && x < CAMP.x) return false;
  for (const p of LAVA_POOLS) if (Math.hypot(x - p.x, z - p.z) < p.r + 2.5) return false;
  for (const s of SECRETS) if (Math.hypot(x - s.x, z - s.z) < 7) return false;
  for (const a of ALTARS) if (Math.hypot(x - a.x, z - a.z) < 5) return false;
  if (Math.hypot(x - FADE_ECHO.x, z - FADE_ECHO.z) < 5) return false;
  return true;
}
// shoreline fishing spots: walk outward along rays until the water is wading-deep
function shoreSpots(cx, cz, angles, hfn, r0, r1) {
  const out = [];
  for (const a of angles) {
    for (let r = r0; r < r1; r += 0.5) {
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (hfn(x, z) < -0.7) { out.push({ x: +x.toFixed(2), z: +z.toFixed(2) }); break; }
    }
  }
  return out;
}
let _nodes = null, _v2 = false;
export function generateNodes() {
  if (_nodes) return _nodes;
  const rnd = mulberry32(1337), nodes = [];
  const far = (x, z, m) => nodes.every((o) => Math.hypot(o.x - x, o.z - z) > m);
  const place = (type, count, gen, spacing = 3.5, prefix = type, valid = validWild) => {
    let n = 0, tries = 0;
    while (n < count && tries++ < 30000) {
      const p = gen();
      if (!valid(p.x, p.z) || !far(p.x, p.z, spacing)) continue;
      nodes.push({ id: `${prefix}_${n}`, type, x: +p.x.toFixed(2), z: +p.z.toFixed(2), r: rnd() * 6.28 });
      n++;
    }
  };
  const disc = (cx, cz, R) => () => { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R; return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }; };
  // (v1 order + seeds kept so node ids/positions are unchanged for old saves and the server)
  place('tree', 6, disc(-8, 48, 9));
  place('rock', 3, disc(14, 44, 6));
  const forest = () => { for (;;) { const p = disc(-30, -20, 85)(); if (fbm(p.x * 0.04, p.z * 0.04) > 0.47 || rnd() < 0.15) return p; } };
  place('tree', 70, forest);
  place('oak', 14, disc(-55, -35, 35), 5);
  place('rock', 10, disc(70, -8, 30));
  place('copper', 8, disc(62, -2, 24));
  place('tin', 8, disc(78, -14, 24));
  place('iron', 6, disc(80, -30, 18));
  // ---- v2 additions (appended, separate generator) ----
  _v2 = true;
  const rnd2 = mulberry32(2026);
  const disc2 = (cx, cz, R) => () => { const a = rnd2() * Math.PI * 2, r = Math.sqrt(rnd2()) * R; return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }; };
  place('ashtree', 22, disc2(RIDGE.x - 10, RIDGE.z, 70), 4, 'ash', validRidge);
  place('coal', 8, disc2(RIDGE.x + 12, RIDGE.z + 4, 30), 4, 'coal', validRidge);
  place('iron', 5, disc2(RIDGE.x + 10, RIDGE.z - 20, 26), 4, 'riron', validRidge);
  place('rock', 5, disc2(RIDGE.x - 20, RIDGE.z - 10, 30), 4, 'rrock', validRidge);
  const isleFish = shoreSpots(0, 0, [0.6, 1.1, 1.75, 2.3, 2.75, 3.3, 3.9, 4.4, 5.3, 5.8], (x, z) => isleHeight(x, z), 90, 150)
    .filter((p) => Math.abs(p.z - BRIDGE.z) > 12 || p.x < 60);
  isleFish.forEach((p, i) => nodes.push({ id: `${i % 2 ? 'trout' : 'shrimp'}_${i >> 1}`, type: i % 2 ? 'trout' : 'shrimp', x: p.x, z: p.z, r: 0 }));
  shoreSpots(RIDGE.x, RIDGE.z, [0.9, 1.6, 2.4, 4.0, 4.8, 5.5], (x, z) => ridgeRaw(x, z), 50, 120)
    .forEach((p, i) => nodes.push({ id: `eel_${i}`, type: 'eel', x: p.x, z: p.z, r: 0 }));
  // rune essence by the altars, hunting grounds
  place('essence', 4, disc2(-24, 60, 8), 3.5, 'ess', validWild);
  place('essence', 4, disc2(RIDGE.x - 6, RIDGE.z - 30, 10), 3.5, 'ress', validRidge);
  place('burrow', 6, disc2(-20, 70, 30), 6, 'burrow', validWild);
  place('trail', 4, disc2(60, 30, 28), 7, 'trail', validWild);
  place('nest', 5, disc2(RIDGE.x - 20, RIDGE.z + 10, 40), 7, 'nest', validRidge);
  // ---- v3 regions (own generator; v1/v2 ids unchanged) ----
  const rnd3 = mulberry32(3333);
  const disc3 = (cx, cz, R) => () => { const a = rnd3() * Math.PI * 2, r = Math.sqrt(rnd3()) * R; return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }; };
  const inReg = (k, minH = 0.8, maxH = 30) => (x, z) => regionAt(x, z) === k && islandHeight(x, z) > minH && islandHeight(x, z) < maxH && !isSafeZone(zoneAt(x, z)) && !V3_HEARTHS.some((q) => Math.hypot(q.x - x, q.z - z) < 6) && Math.hypot(x - SHRINE.x, z - SHRINE.z) > 8 && Math.hypot(x - PYRAMID.x, z - PYRAMID.z) > 10;
  const F = REGIONS.frost, D = REGIONS.desert, S = REGIONS.swamp, C = REGIONS.coast;
  place('pine', 26, disc3(F.x, F.z + 15, 70), 4.5, 'pine', inReg('frost', 1, 20));
  place('mithril', 6, disc3(F.x + 20, F.z - 5, 35), 4, 'mith', inReg('frost', 2, 26));
  place('snowherb', 4, disc3(F.x - 25, F.z, 40), 5, 'fbloom', inReg('frost', 1, 20));
  place('adamant', 5, disc3(D.x + 35, D.z + 5, 30), 4, 'adam', inReg('desert'));
  place('cactus', 12, disc3(D.x, D.z, 75), 5, 'cactus', inReg('desert'));
  place('desertherb', 5, disc3(D.x - 20, D.z + 10, 50), 5, 'sunleaf', inReg('desert'));
  place('palm', 8, disc3(OASIS.x + 14, OASIS.z + 6, 18), 3.5, 'opalm', inReg('desert', 0.4));
  place('mangrove', 16, disc3(S.x, S.z, 65), 5, 'mang', inReg('swamp', 0.6));
  place('bogherb', 4, disc3(S.x - 20, S.z + 10, 45), 6, 'bmoss', inReg('swamp', 0.6));
  place('wildherb', 6, disc3(S.x + 20, S.z - 10, 40), 5, 'guam', inReg('swamp', 0.6));
  place('wildherb', 5, disc(-40, 40, 40), 6, 'iguam', validWild);
  place('palm', 12, disc3(C.x, C.z + 10, 55), 4, 'palm', inReg('coast', 0.6));
  place('nightfish', 0, disc3(0, 0, 1));
  const edge = (k, angles, prefix, type) => shoreSpots(REGIONS[k].x, REGIONS[k].z, angles, (x, z) => terrainHeight(x, z), REGIONS[k].r * 0.6, REGIONS[k].r * 1.3).forEach((p, i) => nodes.push({ id: `${prefix}_${i}`, type, x: p.x, z: p.z, r: 0 }));
  edge('frost', [0.4, 2.6, 3.6], 'icefish', 'icefish');
  edge('coast', [0.3, 0.9, 1.5, 2.2], 'deepsea', 'deepsea');
  edge('swamp', [2.2, 3.2, 4.1], 'rainfish', 'rainfish');
  [[-0.7, 'nightfish', 'moon'], [5.0, 'nightfish', 'moon2']].forEach(([a, t, id]) => { const p = shoreSpots(0, 0, [a], (x, z) => isleHeight(x, z), 90, 150)[0]; if (p) nodes.push({ id, type: t, x: p.x, z: p.z, r: 0 }); });
  return (_nodes = nodes);
}

// ---------- enemies ----------
export const ENEMY_TYPES = {
  mossling: { name: 'Mossling', hp: 3, speed: 2.4, aggro: 9, range: 2.4, tell: 0.75, dmg: 1, cool: 1.6, xp: 80, radius: 0.7, respawn: 25, leash: 22 },
  grubkin: { name: 'Grubkin', hp: 6, speed: 3.0, aggro: 12, range: 2.3, tell: 0.85, dmg: 1, cool: 1.8, xp: 160, radius: 0.8, respawn: 30, leash: 28 },
  boar: { name: 'Bristleboar', hp: 8, speed: 2.2, aggro: 14, range: 9, tell: 1.0, dmg: 2, cool: 2.6, xp: 240, radius: 1.0, respawn: 35, leash: 34 },
  warden: { name: 'Barrow Warden', hp: 20, speed: 2.3, aggro: 30, range: 3.6, tell: 1.1, dmg: 2, cool: 1.4, xp: 1600, radius: 1.6, respawn: 0, leash: 60, boss: true },
  // v2 — Emberfall Ridge + Cinderdeep Mine
  hound: { name: 'Ash Hound', hp: 5, speed: 4.2, aggro: 13, range: 3.0, tell: 0.6, dmg: 2, cool: 1.5, xp: 300, radius: 0.8, respawn: 30, leash: 30 },
  imp: { name: 'Cinder Imp', hp: 4, speed: 2.8, aggro: 15, range: 10, tell: 0.75, dmg: 2, cool: 2.2, xp: 340, radius: 0.6, respawn: 30, leash: 26, ranged: 1 },
  hollowed: { name: 'Hollowed Miner', hp: 7, speed: 1.8, aggro: 10, range: 2.7, tell: 1.0, dmg: 2, cool: 1.9, xp: 380, radius: 0.8, respawn: 40, leash: 24 },
  shellback: { name: 'Shellback Beetle', hp: 8, speed: 2.0, aggro: 12, range: 8, tell: 1.0, dmg: 2, cool: 2.8, xp: 600, radius: 1.1, respawn: 0, leash: 30, armoured: 1 },
  magmaw: { name: 'Magmaw, the Furnace Worm', hp: 24, speed: 0, aggro: 18, range: 12, tell: 0.9, dmg: 2, cool: 1, xp: 4000, radius: 2.0, respawn: 0, leash: 99, boss: true },
  // ---- v3: new regions (ai = behaviour borrowed from a v2 enemy, look/tint/scale = visuals) ----
  icewolf: { name: 'Ice Wolf', hp: 7, speed: 4.4, aggro: 14, range: 3.0, tell: 0.55, dmg: 2, cool: 1.4, xp: 520, radius: 0.8, respawn: 30, leash: 30, ai: 'hound', tint: 0xd8ecff, slow: 1 },
  frosttroll: { name: 'Frost Troll (elite)', hp: 22, speed: 2.0, aggro: 12, range: 3.2, tell: 1.0, dmg: 3, cool: 2.0, xp: 1400, radius: 1.3, respawn: 60, leash: 26, ai: 'grubkin', tint: 0x9ac0d8, scale: 1.8, elite: 1 },
  yeti: { name: 'Night Yeti', hp: 12, speed: 3.0, aggro: 13, range: 2.8, tell: 0.8, dmg: 3, cool: 1.7, xp: 900, radius: 1.1, respawn: 40, leash: 28, ai: 'grubkin', tint: 0xf4f8ff, scale: 1.45, night: 1 },
  frostwyrm: { name: 'The Frost Wyrm', hp: 60, speed: 2.2, aggro: 22, range: 9, tell: 1.1, dmg: 3, cool: 1.2, xp: 9000, radius: 2.2, respawn: 300, leash: 40, ai: 'phased', look: 'serpent', tint: 0xa8d8ff, boss: true, world: 1,
    moves: [['slam', 'volley'], ['slam', 'nova', 'volley'], ['burrow', 'nova', 'volley', 'slam']], proj: 0x9ad8ff, slow: 1 },
  scorpion: { name: 'Dune Scorpion', hp: 8, speed: 2.6, aggro: 13, range: 8, tell: 0.9, dmg: 2, cool: 2.4, xp: 640, radius: 1.0, respawn: 30, leash: 30, ai: 'boar', tint: 0xc89a50, scale: 0.85, poison: 1 },
  sandwraith: { name: 'Sand Wraith', hp: 7, speed: 2.8, aggro: 15, range: 10, tell: 0.75, dmg: 2, cool: 2.0, xp: 700, radius: 0.6, respawn: 30, leash: 26, ai: 'imp', tint: 0xe8d090 },
  sandworm: { name: 'Sunscar Sandworm', hp: 64, speed: 3.0, aggro: 22, range: 10, tell: 1.1, dmg: 3, cool: 1.2, xp: 10000, radius: 2.2, respawn: 300, leash: 40, ai: 'phased', look: 'serpent', tint: 0xd8b070, boss: true, world: 1,
    moves: [['burrow', 'slam'], ['burrow', 'volley', 'slam'], ['burrow', 'nova', 'volley']], proj: 0xe8c070 },
  mummy: { name: 'Pyramid Mummy', hp: 9, speed: 1.9, aggro: 10, range: 2.7, tell: 0.9, dmg: 2, cool: 1.8, xp: 600, radius: 0.8, respawn: 0, leash: 24, ai: 'hollowed', tint: 0xe8dcb0 },
  bogwitch: { name: 'Bog Witch', hp: 9, speed: 2.4, aggro: 15, range: 10, tell: 0.8, dmg: 2, cool: 2.2, xp: 760, radius: 0.7, respawn: 35, leash: 26, ai: 'imp', tint: 0x7a50a0, poison: 1 },
  frog: { name: 'Mire Frog', hp: 5, speed: 3.2, aggro: 10, range: 2.6, tell: 0.6, dmg: 1, cool: 1.4, xp: 300, radius: 0.7, respawn: 25, leash: 22, ai: 'mossling', tint: 0x90c040, poison: 1 },
  pirate: { name: 'Starfall Pirate', hp: 10, speed: 2.8, aggro: 13, range: 2.6, tell: 0.8, dmg: 2, cool: 1.6, xp: 700, radius: 0.8, respawn: 35, leash: 26, ai: 'grubkin', tint: 0xa05040 },
  crab: { name: 'Shore Crab', hp: 6, speed: 2.4, aggro: 9, range: 7, tell: 0.9, dmg: 1, cool: 2.4, xp: 340, radius: 0.8, respawn: 25, leash: 22, ai: 'boar', tint: 0xe06030, scale: 0.7 },
  shade: { name: 'Night Shade', hp: 6, speed: 4.0, aggro: 14, range: 3.0, tell: 0.6, dmg: 2, cool: 1.5, xp: 450, radius: 0.7, respawn: 40, leash: 30, ai: 'hound', tint: 0x403060, night: 1 },
  // ---- v3: the Drowned Belfry ----
  drowned: { name: 'Drowned Bellringer', hp: 8, speed: 2.0, aggro: 11, range: 2.7, tell: 0.9, dmg: 2, cool: 1.7, xp: 650, radius: 0.8, respawn: 0, leash: 24, ai: 'hollowed', tint: 0x5aa0a0 },
  inkwisp: { name: 'Ink Wisp', hp: 5, speed: 3.0, aggro: 14, range: 10, tell: 0.7, dmg: 2, cool: 1.9, xp: 600, radius: 0.6, respawn: 0, leash: 24, ai: 'imp', tint: 0x303050 },
  bellkeeper: { name: 'The Bellkeeper', hp: 30, speed: 2.0, aggro: 18, range: 4, tell: 1.0, dmg: 2, cool: 1.3, xp: 3000, radius: 1.5, respawn: 0, leash: 40, ai: 'phased', look: 'warden', tint: 0x6ab0b0, boss: true,
    moves: [['slam', 'nova'], ['slam', 'nova', 'volley'], ['nova', 'volley', 'slam']], proj: 0x80e0e0 },
  vael: { name: 'Vael the Unwriter', hp: 48, speed: 2.6, aggro: 24, range: 9, tell: 1.2, dmg: 3, cool: 1.1, xp: 12000, radius: 1.2, respawn: 0, leash: 60, ai: 'phased', look: 'vael', boss: true, finale: 1,
    moves: [['volley', 'lines'], ['lines', 'nova', 'summon', 'volley'], ['lines', 'nova', 'volley', 'summon', 'lines']], proj: 0xc080ff, minion: 'inkwisp', unblockLines: 1 },
};
ENEMY_TYPES.player = { name: 'Player', hp: 20, speed: 0, aggro: 0, range: 0, tell: 0, dmg: 0, cool: 1, xp: 0, radius: 0.5, respawn: 0, leash: 0, pvp: 1 };
let _spawns = null;
export function generateEnemySpawns() {
  if (_spawns) return _spawns;
  const rnd = mulberry32(4242), out = [];
  const ring = (type, count, r0, r1, a0 = 0, a1 = Math.PI * 2) => {
    let n = 0, tries = 0;
    while (n < count && tries++ < 5000) {
      const a = a0 + rnd() * (a1 - a0), r = r0 + rnd() * (r1 - r0);
      const x = VILLAGE.x + Math.cos(a) * r, z = VILLAGE.z + Math.sin(a) * r;
      if (!validWild(x, z, 1.5)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 8)) continue;
      out.push({ id: `${type}_${n}`, type, x: +x.toFixed(2), z: +z.toFixed(2) }); n++;
    }
  };
  ring('mossling', 6, 36, 55);
  ring('grubkin', 5, 55, 90, Math.PI * 0.6, Math.PI * 1.6);
  ring('boar', 3, 50, 85, -Math.PI * 0.4, Math.PI * 0.4);
  // v2: Emberfall Ridge
  const rnd2 = mulberry32(777);
  const ridge = (type, count, cx, cz, R) => {
    let n = 0, tries = 0;
    while (n < count && tries++ < 5000) {
      const a = rnd2() * Math.PI * 2, r = Math.sqrt(rnd2()) * R, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!validRidge(x, z, 1.8) || lavaAt(x, z)) continue;
      if (Math.hypot(x - CAMP.x, z - CAMP.z) < CAMP.r + 16) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 8)) continue;
      out.push({ id: `${type}_${n}`, type, x: +x.toFixed(2), z: +z.toFixed(2) }); n++;
    }
  };
  _v2 = true;
  ridge('hound', 5, RIDGE.x, RIDGE.z, 55);
  ridge('imp', 4, RIDGE.x + 10, RIDGE.z, 40);
  ridge('hollowed', 4, FADE_PATCHES[0].x + 4, FADE_PATCHES[0].z - 4, 20);
  // v3: new regions (separate seed, appended so v2 ids are unchanged)
  const rnd3 = mulberry32(3003);
  const reg = (type, count, k, cx, cz, R, minH = 0.6, maxH = 40) => {
    let n = 0, tries = 0;
    while (n < count && tries++ < 6000) {
      const a = rnd3() * Math.PI * 2, r = Math.sqrt(rnd3()) * R, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const h = islandHeight(x, z); if (regionAt(x, z) !== k || h < minH || h > maxH || isSafeZone(zoneAt(x, z))) continue;
      if (V3_HEARTHS.some((q) => Math.hypot(q.x - x, q.z - z) < 14)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 7)) continue;
      out.push({ id: `${type}_${n}`, type, x: +x.toFixed(2), z: +z.toFixed(2) }); n++;
    }
  };
  const F = REGIONS.frost, D = REGIONS.desert, S = REGIONS.swamp, C = REGIONS.coast;
  reg('icewolf', 5, 'frost', F.x - 10, F.z + 20, 55, 1, 22); reg('frosttroll', 2, 'frost', F.x + 30, F.z + 10, 25, 1, 22); reg('yeti', 3, 'frost', F.x - 30, F.z - 10, 35, 1, 22);
  out.push({ id: 'frostwyrm_0', type: 'frostwyrm', x: WYRM_LAIR.x, z: WYRM_LAIR.z });
  reg('scorpion', 5, 'desert', D.x, D.z + 10, 70); reg('sandwraith', 4, 'desert', D.x + 20, D.z + 30, 50);
  out.push({ id: 'sandworm_0', type: 'sandworm', x: SANDWORM_PIT.x, z: SANDWORM_PIT.z });
  reg('bogwitch', 4, 'swamp', S.x - 10, S.z, 55, 0.3); reg('frog', 6, 'swamp', S.x, S.z, 60, 0.2);
  reg('pirate', 4, 'coast', C.x + 10, C.z + 25, 45); reg('crab', 5, 'coast', C.x, C.z + 10, 60, 0.4, 3);
  ring('shade', 4, 40, 80);
  return (_spawns = out);
}

// Generic enemy AI. Runs on the server (overworld, authoritative) or in the browser (solo mode + instanced dungeons).
// heightFn(x,z) -> ground height; blockedFn(x,z) -> true if an obstacle; players: [{id,x,z,dead}]
export class EnemySim {
  constructor(spawns, opts = {}) {
    this.height = opts.height || islandHeight;
    this.blocked = opts.blocked || null;
    this.respawn = opts.respawn !== false;
    this.rand = opts.rand || Math.random;
    this.enemies = new Map();
    this.proj = []; this.projN = 0;
    for (const s of spawns) this.enemies.set(s.id, this.make(s));
  }
  make(s) {
    const T = ENEMY_TYPES[s.type], hp = T.boss && this.bossScale > 1 ? Math.round(T.hp * this.bossScale) : T.hp; // co-op: bosses scale HP with party size
    return { id: s.id, type: s.type, sx: s.x, sz: s.z, x: s.x, z: s.z, ry: s.ry || 0, hp, max: hp, state: 'idle', st: 0,
      alive: true, atk: 0, kind: 'a', wx: s.x, wz: s.z, cd: 0, dx: 0, dz: 1, kx: 0, kz: 0, n: 0, spots: s.spots || null, spot: 0, phase: 1, cx: s.cx, cz: s.cz };
  }
  set(e, s) { e.state = s; e.st = 0; }
  canStand(x, z) {
    if (isSafeZone(zoneAt(x, z))) return false;
    if (this.height(x, z) < -1) return false;
    if (x > 150 && x < 1700 && lavaAt(x, z)) return false;
    if (this.blocked && this.blocked(x, z)) return false;
    return true;
  }
  move(e, dx, dz, dist) {
    const nx = e.x + dx * dist, nz = e.z + dz * dist;
    if (this.canStand(nx, nz)) { e.x = nx; e.z = nz; return true; }
    if (this.canStand(nx, e.z)) { e.x = nx; return true; }
    if (this.canStand(e.x, nz)) { e.z = nz; return true; }
    return false;
  }
  moveToward(e, tx, tz, speed, dt, face = true) {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    if (face) e.ry = Math.atan2(dx, dz);
    this.move(e, dx / d, dz / d, Math.min(d, speed * dt));
    return d;
  }
  update(dt, players) {
    const ev = [];
    // fireballs (Cinder Imps)
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i]; p.t += dt; p.x += p.dx * 9 * dt; p.z += p.dz * 9 * dt;
      ev.push({ t: 'hit', id: p.id, atk: p.n, x: +p.x.toFixed(2), z: +p.z.toFixed(2), r: 0.7, dmg: p.dmg, sx: +(p.x - p.dx * 2).toFixed(2), sz: +(p.z - p.dz * 2).toFixed(2), fire: 1 });
      if (p.t > 1.6 || (this.blocked && this.blocked(p.x, p.z))) this.proj.splice(i, 1);
    }
    for (const e of this.enemies.values()) {
      const T = ENEMY_TYPES[e.type];
      e.st += dt; e.cd -= dt;
      if (!e.alive) {
        if (this.respawn && T.respawn && e.st > T.respawn) {
          Object.assign(e, this.make({ id: e.id, type: e.type, x: e.sx, z: e.sz }));
          ev.push({ t: 'respawn', id: e.id });
        }
        continue;
      }
      let tgt = null, td = 1e9;
      for (const p of players) {
        if (p.dead || isSafeZone(zoneAt(p.x, p.z))) continue;
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < td) { td = d; tgt = p; }
      }
      if (T.night && this.isNight && !this.isNight() && e.state === 'idle') { e.hidden = true; continue; } // night-only enemies sleep by day
      e.hidden = false;
      if (e.type === 'magmaw') { this.updateMagmaw(e, T, dt, tgt, td, ev); continue; }
      if (T.ai === 'phased') { this.updatePhased(e, T, dt, tgt, td, ev); continue; }
      const AI = T.ai || e.type;
      const leash = Math.hypot(e.x - e.sx, e.z - e.sz);
      const fwd = () => { e.dx = Math.sin(e.ry); e.dz = Math.cos(e.ry); };
      switch (e.state) {
        case 'idle':
          if (tgt && td < T.aggro) { this.set(e, 'chase'); break; }
          if (e.st > 3 + this.rand() * 2) { e.wx = e.sx + (this.rand() - 0.5) * 8; e.wz = e.sz + (this.rand() - 0.5) * 8; e.st = 0; }
          this.moveToward(e, e.wx, e.wz, T.speed * 0.35, dt);
          break;
        case 'return':
          if (tgt && td < T.aggro * 0.7 && leash < T.leash * 0.5) { this.set(e, 'chase'); break; }
          if (this.moveToward(e, e.sx, e.sz, T.speed * 1.2, dt) < 1) { e.hp = e.max; this.set(e, 'idle'); }
          break;
        case 'chase': {
          if (!tgt || td > T.aggro * 1.7 || leash > T.leash) { this.set(e, 'return'); break; }
          e.ry = Math.atan2(tgt.x - e.x, tgt.z - e.z);
          if (td < T.range && e.cd <= 0) {
            e.atk++; fwd();
            e.kind = e.type === 'warden' ? (td < 2.6 && this.rand() < 0.45 ? 'sweep' : 'slam') : 'a';
            this.set(e, 'tell'); break;
          }
          if (AI === 'imp') { // keep a safe distance, sidestep
            if (td < 5) this.move(e, -Math.sin(e.ry), -Math.cos(e.ry), T.speed * dt);
            else if (td > 8) this.moveToward(e, tgt.x, tgt.z, T.speed, dt);
            else { const s = Math.sin(e.atk * 2.1 + e.st) > 0 ? 1 : -1; this.move(e, Math.cos(e.ry) * s, -Math.sin(e.ry) * s, T.speed * 0.5 * dt); }
            break;
          }
          const want = AI === 'boar' || AI === 'shellback' ? 5 : T.range * 0.7;
          if (td > want) this.moveToward(e, tgt.x, tgt.z, T.speed, dt);
          else if (AI !== 'boar' && AI !== 'shellback') { // circle-strafe a little while waiting
            const s = Math.sin(e.atk * 1.7) > 0 ? 1 : -1; this.move(e, Math.cos(e.ry) * s, -Math.sin(e.ry) * s, T.speed * 0.4 * dt);
          }
          break;
        }
        case 'tell':
          if (tgt && e.st < T.tell * 0.6) { e.ry = Math.atan2(tgt.x - e.x, tgt.z - e.z); fwd(); }
          if (e.st >= (e.kind === 'sweep' ? 0.8 : T.tell)) this.set(e, 'attack');
          break;
        case 'attack': {
          const hit = (ox, oz, r, extra = {}) => ev.push({ t: 'hit', id: e.id, atk: e.atk, x: +ox.toFixed(2), z: +oz.toFixed(2), r, dmg: T.dmg, slow: T.slow ? 1 : 0, poison: T.poison ? 1 : 0, sx: +e.x.toFixed(2), sz: +e.z.toFixed(2), ...extra });
          if (AI === 'mossling' || AI === 'hound') {
            const lunge = AI === 'hound' ? 10 : 7;
            if (e.st < 0.35) this.move(e, e.dx, e.dz, lunge * dt);
            if (e.st >= 0.12 && e.n !== e.atk) { e.n = e.atk; hit(e.x + e.dx * 0.6, e.z + e.dz * 0.6, 1.3); }
            if (e.st > 0.5) { e.cd = T.cool; this.set(e, 'recover'); }
          } else if (AI === 'grubkin' || AI === 'hollowed') {
            if (e.st < 0.15) this.move(e, e.dx, e.dz, 4 * dt);
            if (e.st >= 0.15 && e.n !== e.atk) { e.n = e.atk; hit(e.x + e.dx * 1.5, e.z + e.dz * 1.5, 1.5); }
            if (e.st > 0.55) { e.cd = T.cool; this.set(e, 'recover'); }
          } else if (AI === 'imp') {
            if (e.n !== e.atk) {
              e.n = e.atk;
              this.proj.push({ id: e.id + ':fb', n: ++this.projN, x: e.x + e.dx * 0.8, z: e.z + e.dz * 0.8, dx: e.dx, dz: e.dz, t: 0, dmg: T.dmg });
              ev.push({ t: 'fire', id: e.id });
            }
            if (e.st > 0.4) {
              e.cd = T.cool;
              if (this.rand() < 0.4) { // blink away
                for (let i = 0; i < 6; i++) { const a = this.rand() * 6.28, nx = e.sx + Math.cos(a) * 5, nz = e.sz + Math.sin(a) * 5; if (this.canStand(nx, nz)) { e.x = nx; e.z = nz; ev.push({ t: 'blink', id: e.id }); break; } }
              }
              this.set(e, 'recover');
            }
          } else if (AI === 'boar' || AI === 'shellback') {
            const moved = this.move(e, e.dx, e.dz, (AI === 'shellback' ? 10 : 12) * dt);
            hit(e.x + e.dx * 0.8, e.z + e.dz * 0.8, 1.4);
            if (e.st > 0.9 || !moved) { e.cd = T.cool; this.set(e, moved ? 'recover' : 'stuck'); }
          } else if (e.type === 'warden') {
            if (e.kind === 'slam') {
              if (e.st >= 0.12 && e.n !== e.atk) { e.n = e.atk; hit(e.x + e.dx * 2.4, e.z + e.dz * 2.4, 2.6, { slam: 1 }); }
              if (e.st > 0.4) { e.cd = T.cool; this.set(e, 'stuck'); }
            } else {
              if (e.st >= 0.2 && e.n !== e.atk) { e.n = e.atk; hit(e.x, e.z, 4.0, { sweep: 1 }); }
              if (e.st > 0.7) { e.cd = T.cool; this.set(e, 'recover'); }
            }
          }
          break;
        }
        case 'stuck': // vulnerable window (warden after slam, boar after hitting a wall)
          if (e.st > (AI === 'warden' ? 1.9 : 1.2)) this.set(e, 'recover');
          break;
        case 'flipped': // shellback knocked onto its back by a bomb
          if (e.st > 5) this.set(e, 'recover');
          break;
        case 'recover':
          if (e.st > 0.5) this.set(e, 'chase');
          break;
        case 'stagger':
          this.move(e, e.kx, e.kz, Math.max(0, 6 - e.st * 18) * dt);
          if (e.st > 0.35) this.set(e, 'chase');
          break;
      }
    }
    return ev;
  }
  // v3 generic boss: phases at 2/3 and 1/3 HP, each with a move list; every move is telegraphed ('tell' + kind),
  // followed by a short vulnerable 'stuck' window. Kinds: slam (ring in front), nova (ring around itself), volley
  // (fan of projectiles), lines (Vael: ink lines along the ground, unblockable), summon (minions), burrow (dive + erupt).
  updatePhased(e, T, dt, tgt, td, ev) {
    const ph = e.hp <= e.max / 3 ? 3 : e.hp <= e.max * 2 / 3 ? 2 : 1;
    if (ph !== e.phase) { e.phase = ph; ev.push({ t: 'phase', id: e.id, phase: ph, boss: e.type }); }
    const face = () => { if (tgt) e.ry = Math.atan2(tgt.x - e.x, tgt.z - e.z); e.dx = Math.sin(e.ry); e.dz = Math.cos(e.ry); };
    const hit = (ox, oz, r, extra = {}) => ev.push({ t: 'hit', id: e.id, atk: e.atk, x: +ox.toFixed(2), z: +oz.toFixed(2), r, dmg: T.dmg, slow: T.slow ? 1 : 0, sx: +e.x.toFixed(2), sz: +e.z.toFixed(2), ...extra });
    const leash = Math.hypot(e.x - e.sx, e.z - e.sz);
    const tellT = T.tell * (ph === 3 ? 0.8 : 1);
    switch (e.state) {
      case 'idle': if (tgt && td < T.aggro) { this.set(e, 'chase'); ev.push({ t: 'roar', id: e.id, boss: e.type }); } break;
      case 'return': if (this.moveToward(e, e.sx, e.sz, T.speed * 1.5, dt) < 1) { e.hp = e.max; e.phase = 1; this.set(e, 'idle'); } break;
      case 'chase':
        if (!tgt || leash > T.leash || td > T.aggro * 2) { this.set(e, 'return'); break; }
        face();
        if (e.cd <= 0) {
          const list = T.moves[ph - 1]; e.mi = (e.mi || 0) + 1; e.kind = list[e.mi % list.length]; e.atk++;
          if (e.kind === 'summon' && [...this.enemies.values()].filter((m) => m.alive && m.id.startsWith(e.id + '_s')).length >= 3) e.kind = 'volley';
          if (e.kind === 'burrow') { this.set(e, 'submerged'); e.bt = tgt ? { x: tgt.x, z: tgt.z } : { x: e.x, z: e.z }; ev.push({ t: 'burrow', id: e.id }); break; }
          if (e.kind === 'lines') e.lines = [0, 1, 2].map((i) => e.ry + (i - 1) * (ph === 3 ? 0.55 : 0.4));
          this.set(e, 'tell'); break;
        }
        if (td > (T.range * 0.55)) this.moveToward(e, tgt.x, tgt.z, T.speed, dt);
        break;
      case 'tell':
        if (e.st < tellT * 0.5 && e.kind !== 'lines') face();
        if (e.st >= tellT) this.set(e, 'attack');
        break;
      case 'attack':
        if (e.n !== e.atk) {
          e.n = e.atk;
          if (e.kind === 'slam') hit(e.x + e.dx * 2.6, e.z + e.dz * 2.6, 2.8, { slam: 1 });
          else if (e.kind === 'nova') hit(e.x, e.z, 5.2, { slam: 1, nova: 1 });
          else if (e.kind === 'volley') { const n = ph === 1 ? 3 : 5; for (let i = 0; i < n; i++) { const a = e.ry + (i - (n - 1) / 2) * 0.32; this.proj.push({ id: e.id + ':v' + i, n: ++this.projN, x: e.x + Math.sin(a), z: e.z + Math.cos(a), dx: Math.sin(a), dz: Math.cos(a), t: 0, dmg: T.dmg - 1 || 1 }); } ev.push({ t: 'fire', id: e.id }); }
          else if (e.kind === 'lines') { for (const a of e.lines || [e.ry]) for (let d = 2; d <= 14; d += 2) hit(e.x + Math.sin(a) * d, e.z + Math.cos(a) * d, 1.2, { unblockable: T.unblockLines ? 1 : 0, ink: 1 }); }
          else if (e.kind === 'summon') { for (let i = 0; i < 2; i++) { const a = this.rand() * 6.28, id = `${e.id}_s${++e.sn || (e.sn = 1)}`; const m = this.make({ id, type: T.minion || 'inkwisp', x: e.x + Math.cos(a) * 4, z: e.z + Math.sin(a) * 4 }); this.enemies.set(id, m); } ev.push({ t: 'summon', id: e.id }); }
        }
        if (e.st > 0.5) { e.cd = T.cool * (ph === 3 ? 0.75 : 1); this.set(e, e.kind === 'summon' ? 'chase' : 'stuck'); }
        break;
      case 'stuck': if (e.st > 1.2) this.set(e, 'chase'); break;
      case 'submerged': // burrowed: untouchable, a shadow tracks you, then it erupts
        if (tgt && e.st < 1.1) e.bt = { x: tgt.x, z: tgt.z };
        if (e.st > 1.6) { if (this.canStand(e.bt.x, e.bt.z)) { e.x = e.bt.x; e.z = e.bt.z; } hit(e.x, e.z, 3.0, { erupt: 1, unblockable: 1 }); this.set(e, 'stuck'); e.cd = T.cool; }
        break;
      case 'dead': break;
      default: this.set(e, 'chase');
    }
  }
  // Magmaw: surfaces at a lava spot, inhales (bomb its mouth!), breathes fire, sinks. Stunned = molten heart exposed.
  updateMagmaw(e, T, dt, tgt, td, ev) {
    const ph = e.hp <= e.max / 3 ? 3 : e.hp <= e.max * 2 / 3 ? 2 : 1; // thirds of max HP (8 / 16 of 24 solo)
    if (ph !== e.phase) { e.phase = ph; ev.push({ t: 'phase', id: e.id, phase: ph }); }
    const face = () => { if (tgt) e.ry = Math.atan2(tgt.x - e.x, tgt.z - e.z); e.dx = Math.sin(e.ry); e.dz = Math.cos(e.ry); };
    const hit = (ox, oz, r, extra = {}) => ev.push({ t: 'hit', id: e.id, atk: e.atk, x: +ox.toFixed(2), z: +oz.toFixed(2), r, dmg: T.dmg, sx: +e.x.toFixed(2), sz: +e.z.toFixed(2), ...extra });
    switch (e.state) {
      case 'idle': if (tgt && td < T.aggro) { this.set(e, 'submerged'); ev.push({ t: 'roar', id: e.id }); } break;
      case 'submerged':
        if (ph === 3 && tgt && !e.erupt && e.st > 0.3) { e.erupt = { x: tgt.x, z: tgt.z, t: 0 }; e.atk++; }
        if (e.erupt) { e.erupt.t += dt; if (e.erupt.t > 1.1 && !e.erupt.done) { e.erupt.done = true; ev.push({ t: 'hit', id: e.id + ':er', atk: e.atk, x: e.erupt.x, z: e.erupt.z, r: 2.0, dmg: T.dmg, sx: e.erupt.x, sz: e.erupt.z + 0.01, erupt: 1 }); } }
        if (e.st > (ph === 1 ? 1.8 : ph === 2 ? 1.4 : 1.6)) {
          e.erupt = null;
          if (e.spots && e.spots.length) { let i = Math.floor(this.rand() * e.spots.length); if (i === e.spot) i = (i + 1) % e.spots.length; e.spot = i; e.x = e.spots[i].x; e.z = e.spots[i].z; }
          face(); this.set(e, 'rise');
        }
        break;
      case 'rise': face(); if (e.st > 0.7) this.set(e, 'inhale'); break;
      case 'inhale': face(); if (e.st > (ph === 1 ? 3.6 : ph === 2 ? 3.0 : 2.4)) { e.atk++; e.kind = 'breath'; this.set(e, 'tell'); } break;
      case 'tell': if (e.st < 0.5) face(); if (e.st > T.tell) this.set(e, 'attack'); break;
      case 'attack':
        if (e.n !== e.atk && e.st > 0.1) { e.n = e.atk; for (let d = 2.5; d <= 11; d += 2.1) hit(e.x + e.dx * d, e.z + e.dz * d, 1.4 + d * 0.06, { fire: 1, unblockable: 1 }); }
        if (e.st > 0.9) this.set(e, 'submerging');
        break;
      case 'stunned': if (e.st > 5) this.set(e, 'submerging'); break;
      case 'submerging': if (e.st > 0.6) { if (e.cx !== undefined && e.spots) { e.x = e.spots[e.spot].x; e.z = e.spots[e.spot].z; } this.set(e, 'submerged'); } break;
    }
  }
  // returns {ok, blocked, killed, hp, xp, flipped, stunned}. opts.bomb = blast damage, opts.mouth = bomb went down Magmaw's throat
  damage(id, dmg, fromX, fromZ, opts = {}) {
    const e = this.enemies.get(id);
    if (!e || !e.alive) return { ok: false };
    const T = ENEMY_TYPES[e.type];
    let dx = e.x - fromX, dz = e.z - fromZ; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    if (T.ai === 'phased') {
      if (e.state === 'submerged' || e.state === 'idle' && T.finale && !opts.force) return { ok: true, blocked: true, hp: e.hp };
      if (e.state === 'stuck') dmg = Math.ceil(dmg * 1.5); // punish window
      e.hp = Math.max(0, e.hp - dmg);
      if (e.state === 'idle') this.set(e, 'chase');
      if (e.hp <= 0) { e.alive = false; this.set(e, 'dead'); for (const m of this.enemies.values()) if (m.id.startsWith(e.id + '_s')) { m.alive = false; this.set(m, 'dead'); } return { ok: true, killed: true, hp: 0, xp: T.xp }; }
      return { ok: true, hp: e.hp };
    }
    if (e.type === 'warden' && e.state !== 'stuck' && !opts.bomb) {
      // frontal armour: only hits from behind land unless he is stuck after a slam
      const fx = Math.sin(e.ry), fz = Math.cos(e.ry);
      if (-(dx * fx + dz * fz) > -0.2) return { ok: true, blocked: true, hp: e.hp };
    }
    if (e.type === 'shellback') {
      if (opts.bomb && e.state !== 'flipped') { this.set(e, 'flipped'); return { ok: true, flipped: true, hp: e.hp }; }
      if (e.state !== 'flipped') return { ok: true, blocked: true, hp: e.hp };
      dmg *= 2;
    }
    if (e.type === 'magmaw') {
      if (opts.mouth && (e.state === 'inhale' || e.state === 'rise')) {
        this.set(e, 'stunned');
        if (e.cx !== undefined) { const vx = e.cx - e.x, vz = e.cz - e.z, l = Math.hypot(vx, vz) || 1; e.x += vx / l * 3.2; e.z += vz / l * 3.2; e.ry = Math.atan2(vx, vz); }
        e.hp = Math.max(1, e.hp - 2);
        return { ok: true, stunned: true, hp: e.hp };
      }
      if (e.state !== 'stunned') return { ok: true, blocked: true, hp: e.hp };
      const before = e.phase, after = e.hp - dmg <= e.max / 3 ? 3 : e.hp - dmg <= e.max * 2 / 3 ? 2 : 1;
      e.hp = Math.max(0, e.hp - dmg);
      if (e.hp <= 0) { e.alive = false; this.set(e, 'dead'); return { ok: true, killed: true, hp: 0, xp: T.xp }; }
      if (after !== before) this.set(e, 'submerging'); // phase change: it dives early
      return { ok: true, hp: e.hp };
    }
    e.hp = Math.max(0, e.hp - dmg);
    if (e.hp <= 0) { e.alive = false; this.set(e, 'dead'); return { ok: true, killed: true, hp: 0, xp: T.xp }; }
    if (!T.boss && e.state !== 'attack' && e.state !== 'flipped') { e.kx = dx; e.kz = dz; this.set(e, 'stagger'); }
    return { ok: true, hp: e.hp };
  }
  snapshot() {
    const out = [];
    for (const e of this.enemies.values()) out.push([e.id, +e.x.toFixed(2), +e.z.toFixed(2), +e.ry.toFixed(2), e.state, +e.st.toFixed(2), e.hp, e.alive ? 1 : 0, e.kind, e.atk]);
    return out;
  }
}

// ---------- building grid ----------
export function cellOf(x, z) { return [Math.floor(x / BLOCK), Math.floor(z / BLOCK)]; }
export function cellCenter(gx, gz) { return [gx * BLOCK + BLOCK / 2, gz * BLOCK + BLOCK / 2]; }
export function cellBase(gx, gz) {
  const x0 = gx * BLOCK, z0 = gz * BLOCK;
  const m = Math.min(islandHeight(x0, z0), islandHeight(x0 + BLOCK, z0), islandHeight(x0, z0 + BLOCK), islandHeight(x0 + BLOCK, z0 + BLOCK));
  return Math.floor(m * 4) / 4;
}
// can a piece be placed in this cell? returns null if ok, otherwise a reason string
export function buildRefusal(gx, gz, stackLen) {
  const [cx, cz] = cellCenter(gx, gz);
  const zone = zoneAt(cx, cz);
  if (zone === 'village') return 'You cannot build inside the village — it is protected.';
  if (zone === 'camp') return 'Ashfall Camp is protected — build out on the Ridge.';
  if (zone === 'dungeon') return 'The barrow resists your building.';
  if (Math.hypot(cx - VILLAGE.x, cz - VILLAGE.z) < VILLAGE.r + 1.5) return 'Too close to the village wall.';
  if (Math.hypot(cx - ENTRANCE.x, cz - ENTRANCE.z) < 7) return 'Too close to the barrow entrance.';
  if (Math.hypot(cx - MINE_ENTRANCE.x, cz - MINE_ENTRANCE.z) < 8) return 'Too close to the mine entrance.';
  if (bridgeDeck(cx, cz) !== null || (Math.abs(cz - BRIDGE.z) < BRIDGE.hw + 1.5 && cx > BRIDGE.x0 - 2 && cx < BRIDGE.x1 + 2)) return 'Keep the bridge clear.';
  if (cx > 150 && lavaAt(cx, cz)) return 'Not in the lava!';
  if (cellBase(gx, gz) < -0.5) return 'You cannot build in deep water.';
  if (stackLen >= MAX_STACK) return 'That stack is as high as it goes.';
  return null;
}

// teleport destinations the server accepts without speed checks
export const TELEPORTS = [SPAWN, DUNGEON_START, { x: ENTRANCE.x, z: ENTRANCE.z + 5 }, { x: DUNGEON_X, z: -39 }, MINE_START, { x: MINE_ENTRANCE.x - 5, z: MINE_ENTRANCE.z }];

// skill capes (level 50): cape colour + emblem colour per skill
export const SKILL_COLORS = {
  combat: [0xb02a2a, 0xffd040], archery: [0x2f8f3a, 0xe8f0c0], magic: [0x5a2a9a, 0x80e0ff], woodcutting: [0x5a7a2a, 0xc8a060],
  mining: [0x4a5058, 0xd0d8e0], fishing: [0x2a5fb0, 0xa0e0ff], hunting: [0x6a4a2a, 0xe0c090], smithing: [0x5a5a60, 0xff8a20],
  cooking: [0xffffff, 0xb02a2a], crafting: [0x8a5a9a, 0xffe060], fletching: [0x2a7a6a, 0xffffff], runemaking: [0xd08a1c, 0x3a3f48],
  farming: [0x4a8a2a, 0xf0e070], herblore: [0x2a8a6a, 0xe060c0],
};
export const TOTAL_MILESTONE = 50;

// ======================================================================================================
// v3.0 data: items, gear, recipes, loot, shops, potions, farming, mounts, tasks, achievements, market
// ======================================================================================================
Object.assign(SWORDS, { mithril: { name: 'Mithril Sword', dmg: 5, color: 0x7aa8ff }, adamant: { name: 'Adamant Sword', dmg: 6, color: 0x3a9a6a } });
Object.assign(ITEMS, {
  mithril_ore: { name: 'Mithril Ore', icon: '🔵', v: 30 }, adamant_ore: { name: 'Adamantite Ore', icon: '🟢', v: 50 },
  mithril_bar: { name: 'Mithril Bar', icon: '🟦', v: 80 }, adamant_bar: { name: 'Adamant Bar', icon: '🟩', v: 130 },
  raw_icefish: { name: 'Raw Icefish', icon: '🐟', v: 14 }, icefish: { name: 'Grilled Icefish', icon: '🍣', v: 30, heal: 7, warm: 1 },
  raw_moonfish: { name: 'Raw Moonfish', icon: '🌙', v: 20 }, moonfish: { name: 'Moonfish Fillet', icon: '🍥', v: 40, heal: 8 },
  raw_rainbow: { name: 'Raw Rainbow Trout', icon: '🌈', v: 16 }, rainbow: { name: 'Rainbow Trout', icon: '🐠', v: 32, heal: 6 },
  raw_swordfish: { name: 'Raw Swordfish', icon: '🗡', v: 24 }, swordfish: { name: 'Swordfish Steak', icon: '🍱', v: 50, heal: 10 },
  cactus_water: { name: 'Cactus Water', icon: '🌵', v: 4 }, waterskin: { name: 'Waterskin', icon: '💧', v: 12, cool: 1 },
  warm_cloak: { name: 'Fur Cloak (warm)', icon: '🧥', v: 60 },
  herb_guam: { name: 'Guam Leaf', icon: '🌿', v: 8 }, herb_sunleaf: { name: 'Sunleaf', icon: '🌼', v: 16 }, herb_frostbloom: { name: 'Frostbloom', icon: '❄', v: 18 }, herb_bloodmoss: { name: 'Bloodmoss', icon: '🩸', v: 40 },
  herb_marrentill: { name: 'Marrentill', icon: '🍀', v: 10 }, herb_ranarr: { name: 'Ranarr Weed', icon: '🌱', v: 30 },
  vial: { name: 'Vial of Water', icon: '🧪', v: 3 },
  seed_marrentill: { name: 'Marrentill Seed', icon: '🫘', v: 4, seed: 1 }, seed_ranarr: { name: 'Ranarr Seed', icon: '🫘', v: 15, seed: 1 }, seed_guam: { name: 'Guam Seed', icon: '🫘', v: 3, seed: 1 },
  seed_potato: { name: 'Potato Seed', icon: '🥔', v: 2, seed: 1 }, seed_pumpkin: { name: 'Pumpkin Seed', icon: '🎃', v: 6, seed: 1 }, sapling_apple: { name: 'Apple Sapling', icon: '🌳', v: 40, seed: 1 }, sapling_ember: { name: 'Emberwood Sapling', icon: '🌲', v: 90, seed: 1 },
  potato: { name: 'Potato', icon: '🥔', v: 4, heal: 1 }, pumpkin: { name: 'Pumpkin', icon: '🎃', v: 10, heal: 3 }, apple: { name: 'Apple', icon: '🍎', v: 6, heal: 2 },
  compost: { name: 'Compost', icon: '💩', v: 3 },
  potion_health: { name: 'Health Potion', icon: '❤️', v: 30, potion: 'health' }, potion_stamina: { name: 'Stamina Potion', icon: '💛', v: 30, potion: 'stamina' },
  potion_fade: { name: 'Fade-resist Potion', icon: '🌫', v: 45, potion: 'fade' }, potion_attack: { name: 'Attack Potion', icon: '⚔', v: 50, potion: 'attack' },
  potion_defence: { name: 'Defence Potion', icon: '🛡', v: 50, potion: 'defence' }, potion_antipoison: { name: 'Antipoison', icon: '💚', v: 35, potion: 'antipoison' },
  potion_warmth: { name: 'Warmth Potion', icon: '🔥', v: 35, potion: 'warmth' }, potion_cooling: { name: 'Cooling Potion', icon: '🧊', v: 35, potion: 'cooling' },
  bellrope: { name: 'Bell-rope Fibre', icon: '🪢', v: 20 }, ink_shard: { name: 'Unwritten Ink', icon: '🖋', v: 60 }, wyrm_scale: { name: 'Frost Wyrm Scale', icon: '🧊', v: 400 }, worm_tooth: { name: 'Sandworm Tooth', icon: '🦷', v: 400 },
  pirate_map: { name: 'Torn Pirate Map', icon: '🗺', v: 0, quest: 1 }, frost_relic: { name: 'Shrine Relic', icon: '🔷', v: 0, quest: 1 }, sun_idol: { name: 'Sun Idol', icon: '🏺', v: 0, quest: 1 }, witch_charm: { name: "Witch's Charm", icon: '🧿', v: 0, quest: 1 },
  vael_quill: { name: "Vael's Broken Quill", icon: '🪶', v: 0, quest: 1 }, hookshot: { name: 'Hookshot', icon: '⛓', v: 0, quest: 1 },
  arena_token: { name: 'Arena Token', icon: '🎟', v: 0, untradeable: 1 }, wolf_treat: { name: 'Wolf Treat', icon: '🍖', v: 25 }, saddle: { name: 'Saddle', icon: '🐎', v: 0, quest: 1 },
});
Object.assign(GEAR, {
  mithril_sword: { slot: 'weapon', name: 'Mithril Sword', atk: 5, sword: 'mithril', icon: '⚔', v: 300, req: 30 },
  adamant_sword: { slot: 'weapon', name: 'Adamant Sword', atk: 6, sword: 'adamant', icon: '⚔', v: 520, req: 40 },
  mithril_shield: { slot: 'shield', name: 'Mithril Shield', def: 4, color: 0x7aa8ff, icon: '🛡', v: 260, req: 30 },
  adamant_shield: { slot: 'shield', name: 'Adamant Shield', def: 5, color: 0x3a9a6a, icon: '🛡', v: 450, req: 40 },
  mithril_helm: { slot: 'head', name: 'Mithril Helm', def: 4, color: 0x7aa8ff, icon: '⛑', v: 200, req: 30 },
  mithril_body: { slot: 'body', name: 'Mithril Platebody', def: 8, color: 0x7aa8ff, icon: '🥋', v: 420, req: 30 },
  mithril_legs: { slot: 'legs', name: 'Mithril Platelegs', def: 6, color: 0x6a98ef, icon: '👖', v: 300, req: 30 },
  adamant_helm: { slot: 'head', name: 'Adamant Helm', def: 5, color: 0x3a9a6a, icon: '⛑', v: 340, req: 40 },
  adamant_body: { slot: 'body', name: 'Adamant Platebody', def: 10, color: 0x3a9a6a, icon: '🥋', v: 700, req: 40 },
  adamant_legs: { slot: 'legs', name: 'Adamant Platelegs', def: 8, color: 0x2a8a5a, icon: '👖', v: 500, req: 40 },
  fur_hood: { slot: 'head', name: 'Fur Hood (warm)', def: 1, color: 0xe8e0d0, icon: '🧣', v: 60, req: 1, warm: 1 },
  desert_wrap: { slot: 'head', name: 'Desert Wrap (cool)', def: 1, color: 0xe8d0a0, icon: '👳', v: 60, req: 1, cool: 1 },
});
for (const [k, g] of Object.entries(GEAR)) if (!ITEMS[k]) ITEMS[k] = { name: g.name, icon: g.icon, v: g.v, gear: 1 };
RECIPES.push(
  R('mithril_bar', 'furnace', 'Smelt Mithril Bar', { mithril_ore: 1, coal: 3 }, { mithril_bar: 1 }, 30, 900),
  R('adamant_bar', 'furnace', 'Smelt Adamant Bar', { adamant_ore: 1, coal: 4 }, { adamant_bar: 1 }, 40, 1400),
  R('mithril_sword', 'anvil', 'Forge Mithril Sword', { mithril_bar: 2 }, { mithril_sword: 1 }, 31, 1800, { sword: 'mithril' }),
  R('mithril_shield', 'anvil', 'Forge Mithril Shield', { mithril_bar: 2 }, { mithril_shield: 1 }, 32, 1800),
  R('mithril_helm', 'anvil', 'Forge Mithril Helm', { mithril_bar: 1 }, { mithril_helm: 1 }, 32, 900),
  R('mithril_legs', 'anvil', 'Forge Mithril Platelegs', { mithril_bar: 2 }, { mithril_legs: 1 }, 33, 1800),
  R('mithril_body', 'anvil', 'Forge Mithril Platebody', { mithril_bar: 3 }, { mithril_body: 1 }, 35, 2700),
  R('adamant_sword', 'anvil', 'Forge Adamant Sword', { adamant_bar: 2 }, { adamant_sword: 1 }, 41, 2800, { sword: 'adamant' }),
  R('adamant_shield', 'anvil', 'Forge Adamant Shield', { adamant_bar: 2 }, { adamant_shield: 1 }, 42, 2800),
  R('adamant_helm', 'anvil', 'Forge Adamant Helm', { adamant_bar: 1 }, { adamant_helm: 1 }, 42, 1400),
  R('adamant_legs', 'anvil', 'Forge Adamant Platelegs', { adamant_bar: 2 }, { adamant_legs: 1 }, 43, 2800),
  R('adamant_body', 'anvil', 'Forge Adamant Platebody', { adamant_bar: 3 }, { adamant_body: 1 }, 45, 4200),
  R('icefish', 'range', 'Grill Icefish', { raw_icefish: 1 }, { icefish: 1 }, 20, 500, { burn: 0.3 }),
  R('moonfish', 'range', 'Cook Moonfish', { raw_moonfish: 1 }, { moonfish: 1 }, 22, 560, { burn: 0.3 }),
  R('rainbow', 'range', 'Cook Rainbow Trout', { raw_rainbow: 1 }, { rainbow: 1 }, 14, 420, { burn: 0.3 }),
  R('swordfish', 'range', 'Cook Swordfish', { raw_swordfish: 1 }, { swordfish: 1 }, 30, 700, { burn: 0.35 }),
  R('fur_hood', 'workbench', 'Sew Fur Hood (warm)', { hide: 3, leather: 1 }, { fur_hood: 1 }, 8, 300),
  R('desert_wrap', 'workbench', 'Wrap Desert Headscarf (cool)', { leather: 1, cactus_water: 2 }, { desert_wrap: 1 }, 8, 300),
  R('waterskin', 'workbench', 'Fill Waterskin', { leather: 1, cactus_water: 2 }, { waterskin: 2 }, 3, 120),
  R('vial', 'workbench', 'Blow Vials of Water ×3', { stone: 1 }, { vial: 3 }, 1, 40),
);
// Herblore: mix at any workbench, campfire or the oasis/port apothecary (station 'herb')
export const POTIONS = {
  health: { item: 'potion_health', level: 1, input: { vial: 1, herb_guam: 1 }, xp: 250, desc: 'Restores 6 hearts' },
  stamina: { item: 'potion_stamina', level: 5, input: { vial: 1, herb_marrentill: 1 }, xp: 350, desc: 'Endless stamina for 60 s' },
  antipoison: { item: 'potion_antipoison', level: 10, input: { vial: 1, herb_marrentill: 1, cactus_water: 1 }, xp: 450, desc: 'Cures poison, immune 90 s' },
  attack: { item: 'potion_attack', level: 15, input: { vial: 1, herb_sunleaf: 1 }, xp: 600, desc: '+1 attack for 90 s' },
  warmth: { item: 'potion_warmth', level: 15, input: { vial: 1, herb_frostbloom: 1, coal: 1 }, xp: 600, desc: 'Keeps the Cold away for 3 min' },
  cooling: { item: 'potion_cooling', level: 15, input: { vial: 1, cactus_water: 2 }, xp: 600, desc: 'Keeps the Heat away for 3 min' },
  defence: { item: 'potion_defence', level: 20, input: { vial: 1, herb_ranarr: 1 }, xp: 800, desc: '+2 defence for 90 s' },
  fade: { item: 'potion_fade', level: 30, input: { vial: 1, herb_bloodmoss: 1, fade_rune: 1 }, xp: 1300, desc: 'Halves Fade build-up for 3 min' },
};
for (const [k, P] of Object.entries(POTIONS)) RECIPES.push(R(P.item, 'workbench', `Mix ${ITEMS[P.item].name}`, P.input, { [P.item]: 1 }, P.level, P.xp, { skill: 'herblore' }));
// Farming: patches on the home plot. Growth runs in real time (Date.now), even while offline.
export const CROPS = {
  seed_guam: { patch: 'herb', name: 'Guam', mins: 4, out: ['herb_guam', 3, 5], level: 1, xp: 200 },
  seed_marrentill: { patch: 'herb', name: 'Marrentill', mins: 6, out: ['herb_marrentill', 3, 5], level: 5, xp: 320 },
  seed_ranarr: { patch: 'herb', name: 'Ranarr', mins: 12, out: ['herb_ranarr', 2, 4], level: 20, xp: 900 },
  seed_potato: { patch: 'crop', name: 'Potatoes', mins: 3, out: ['potato', 4, 8], level: 1, xp: 150 },
  seed_pumpkin: { patch: 'crop', name: 'Pumpkins', mins: 8, out: ['pumpkin', 2, 4], level: 10, xp: 450 },
  sapling_apple: { patch: 'tree', name: 'Apple tree', mins: 20, out: ['apple', 6, 10], level: 8, xp: 1200 },
  sapling_ember: { patch: 'tree', name: 'Emberwood tree', mins: 40, out: ['log', 12, 18], level: 25, xp: 3000 },
};
export const PATCHES = [{ id: 'herb1', kind: 'herb', dx: 1, dz: 1 }, { id: 'herb2', kind: 'herb', dx: 2.5, dz: 1 }, { id: 'crop1', kind: 'crop', dx: 1, dz: 3 }, { id: 'crop2', kind: 'crop', dx: 2.5, dz: 3 }, { id: 'tree1', kind: 'tree', dx: 4.5, dz: 2 }];
// Mounts
export const MOUNTS = {
  wolf: { name: 'Ash-wolf', icon: '🐺', speed: 1.75, req: { hunting: 20 }, how: 'Tame a wild ash-wolf with a Wolf Treat (Hunting 20)' },
  horse: { name: 'Horse', icon: '🐎', speed: 1.6, cost: 1500, how: 'Buy from the Oakhollow stable (1,500 coins)' },
};
export const STABLE = { x: -16, z: 2 };
export const ASHWOLF_DEN = { x: RIDGE.x - 40, z: RIDGE.z + 40 };
export const LOOT3 = {
  icewolf: { gold: [5, 10], items: [['hide', 0.7, 1], ['raw_meat', 0.5, 1]] },
  frosttroll: { gold: [20, 40], items: [['mithril_ore', 0.6, 2], ['herb_frostbloom', 0.4, 1], ['uncut_diamond', 0.05, 1]] },
  yeti: { gold: [10, 20], items: [['hide', 1, 2], ['warm_cloak', 0.05, 1]] },
  frostwyrm: { gold: [400, 400], items: [['wyrm_scale', 1, 1], ['mithril_bar', 1, 3], ['uncut_diamond', 1, 2]], rare: ['wyrm_scale'] },
  scorpion: { gold: [6, 12], items: [['herb_sunleaf', 0.2, 1]] },
  sandwraith: { gold: [8, 14], items: [['air_rune', 0.5, 4], ['seed_ranarr', 0.05, 1]], rare: ['seed_ranarr'] },
  sandworm: { gold: [400, 400], items: [['worm_tooth', 1, 1], ['adamant_bar', 1, 2], ['uncut_diamond', 1, 2]], rare: ['worm_tooth'] },
  mummy: { gold: [8, 16], items: [['herb_sunleaf', 0.3, 1]] },
  bogwitch: { gold: [10, 18], items: [['herb_bloodmoss', 0.15, 1], ['vial', 0.5, 2], ['seed_marrentill', 0.3, 2]], rare: ['herb_bloodmoss'] },
  frog: { gold: [2, 5], items: [['seed_guam', 0.3, 1]] },
  pirate: { gold: [12, 25], items: [['seed_potato', 0.3, 3], ['steel_arrow', 0.2, 5], ['pirate_map', 0.04, 1]], rare: ['pirate_map'] },
  crab: { gold: [3, 6], items: [['raw_meat', 0.4, 1]] },
  shade: { gold: [6, 12], items: [['fade_rune', 0.2, 1]] },
  drowned: { gold: [8, 14], items: [['bellrope', 0.5, 1]] },
  inkwisp: { gold: [4, 8], items: [['ink_shard', 0.2, 1]], rare: ['ink_shard'] },
  bellkeeper: { gold: [150, 150], items: [['bellrope', 1, 3], ['potion_health', 1, 2]] },
  vael: { gold: [800, 800], items: [['vael_quill', 1, 1], ['ink_shard', 1, 3]], rare: ['vael_quill'] },
};
Object.assign(LOOT, LOOT3);
Object.assign(SHOPS, {
  oasis: { name: 'Oasis Bazaar', sells: { waterskin: 14, vial: 4, seed_potato: 3, seed_guam: 5, seed_marrentill: 8, desert_wrap: 80, potion_cooling: 45, coal: 18, compost: 4 } },
  port: { name: 'Starfall Chandlery', sells: { raw_swordfish: 30, steel_arrow: 14, vial: 4, seed_pumpkin: 9, sapling_apple: 60, wolf_treat: 40, fur_hood: 80, potion_warmth: 45 } },
  stable: { name: 'Oakhollow Stable', sells: { saddle: 1500, wolf_treat: 40, seed_potato: 3, compost: 4, sapling_apple: 60 } },
  quartermaster: { name: 'Arena Quartermaster (tokens)', tokens: 1, sells: { cos_cape_crimson: 10, cos_cape_azure: 10, cos_title_duelist: 25, cos_cape_gold: 40, cos_title_champion: 60 } },
});
export const COSMETICS = {
  cos_cape_crimson: { name: 'Crimson Arena Cape', icon: '🟥', color: 0xb02030 }, cos_cape_azure: { name: 'Azure Arena Cape', icon: '🟦', color: 0x2060c0 },
  cos_cape_gold: { name: 'Golden Champion Cape', icon: '🟨', color: 0xe0b030 }, cos_title_duelist: { name: 'Title: the Duelist', icon: '🏷', title: 'the Duelist' }, cos_title_champion: { name: 'Title: Arena Champion', icon: '👑', title: 'Arena Champion' },
};
for (const [k, c] of Object.entries(COSMETICS)) ITEMS[k] = { name: c.name, icon: c.icon, v: 0, cosmetic: 1, untradeable: 1 };
// Trading post (Grand Exchange style): NPC market with a base price, live price drift and NPC liquidity per item
export const MARKET_ITEMS = ['log', 'plank', 'coal', 'iron_ore', 'iron_bar', 'steel_bar', 'mithril_ore', 'mithril_bar', 'adamant_ore', 'adamant_bar', 'raw_trout', 'trout', 'swordfish', 'hide', 'leather', 'feather', 'fire_shard', 'air_rune', 'fire_rune', 'fade_rune', 'herb_guam', 'herb_marrentill', 'herb_ranarr', 'herb_sunleaf', 'herb_bloodmoss', 'potion_health', 'potion_stamina', 'potion_antipoison', 'uncut_emerald', 'uncut_diamond', 'bomb', 'steel_arrow'];
// Daily / weekly tasks (3 dailies + 2 weeklies drawn from these; seeded by the day / week so they're stable all day)
export const TASK_POOL = [
  { id: 'kill', kind: 'kill', n: [8, 15], name: (n) => `Defeat ${n} enemies`, xp: 'combat' },
  { id: 'chop', kind: 'gather', skill: 'woodcutting', n: [10, 20], name: (n) => `Chop ${n} logs`, xp: 'woodcutting' },
  { id: 'mine', kind: 'gather', skill: 'mining', n: [10, 18], name: (n) => `Mine ${n} ores or rocks`, xp: 'mining' },
  { id: 'fish', kind: 'gather', skill: 'fishing', n: [6, 12], name: (n) => `Catch ${n} fish`, xp: 'fishing' },
  { id: 'cook', kind: 'craft', skill: 'cooking', n: [5, 10], name: (n) => `Cook ${n} meals`, xp: 'cooking' },
  { id: 'smith', kind: 'craft', skill: 'smithing', n: [4, 8], name: (n) => `Smith ${n} items`, xp: 'smithing' },
  { id: 'herb', kind: 'craft', skill: 'herblore', n: [3, 6], name: (n) => `Mix ${n} potions`, xp: 'herblore' },
  { id: 'farm', kind: 'harvest', n: [2, 4], name: (n) => `Harvest ${n} farming patches`, xp: 'farming' },
  { id: 'hunt', kind: 'gather', skill: 'hunting', n: [3, 6], name: (n) => `Check ${n} successful traps`, xp: 'hunting' },
  { id: 'boss', kind: 'boss', n: [1, 1], name: () => 'Defeat any boss', xp: 'combat', weekly: 1 },
  { id: 'duel', kind: 'pvp', n: [1, 3], name: (n) => `Fight ${n} duels or arena rounds`, xp: 'combat', weekly: 1 },
  { id: 'explore', kind: 'region', n: [2, 3], name: (n) => `Visit ${n} different regions`, xp: 'hunting', weekly: 1 },
];
export const TASK_REWARD = { daily: { coins: 120, xp: 1500 }, weekly: { coins: 600, xp: 8000 } };
export const STREAK_BONUS = (streak) => 1 + Math.min(0.5, 0.1 * Math.max(0, streak - 1)); // +10%/day of streak, max +50%
