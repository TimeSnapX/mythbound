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
export function islandHeight(x, z) {
  let h = rawHeight(x, z);
  const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
  if (dv < VILLAGE.r + 14) { const t = smooth(clamp((dv - VILLAGE.r + 2) / 16, 0, 1)); h = 4 + (h - 4) * t; }
  const de = Math.hypot(x - ENTRANCE.x, z - ENTRANCE.z);
  if (de < 14) { const t = smooth(clamp((de - 6) / 8, 0, 1)); h = ENTRANCE_H + (h - ENTRANCE_H) * t; }
  return h;
}
export function zoneAt(x, z) {
  if (x > DUNGEON_X - 300) return 'dungeon';
  if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r) return 'village';
  return 'wild';
}

// ---------- skills / items ----------
export const SKILLS = ['combat', 'woodcutting', 'mining', 'smithing'];
export const SKILL_NAMES = { combat: 'Combat', woodcutting: 'Woodcutting', mining: 'Mining', smithing: 'Smithing' };
export function xpForLevel(L) { return L <= 1 ? 0 : Math.round(40 * (L - 1) ** 2 + 30 * (L - 1)); }
export function levelForXp(xp) { let L = 1; while (L < 99 && xp >= xpForLevel(L + 1)) L++; return L; }

export const ITEMS = {
  log: { name: 'Logs', icon: '🪵' },
  stone: { name: 'Stone', icon: '🪨' },
  copper_ore: { name: 'Copper Ore', icon: '🟠' },
  tin_ore: { name: 'Tin Ore', icon: '⚪' },
  iron_ore: { name: 'Iron Ore', icon: '⚫' },
  bronze_bar: { name: 'Bronze Bar', icon: '🟫' },
  iron_bar: { name: 'Iron Bar', icon: '⬛' },
  mythstone: { name: 'Mythstone Shard', icon: '💎' },
};
export const SWORDS = {
  wood: { name: 'Wooden Sword', dmg: 1, color: 0x9b6b3a },
  bronze: { name: 'Bronze Sword', dmg: 2, color: 0xd08a3c },
  iron: { name: 'Iron Sword', dmg: 3, color: 0xd0d4dc },
};
export const RECIPES = [
  { id: 'bronze_bar', station: 'furnace', name: 'Smelt Bronze Bar', input: { copper_ore: 1, tin_ore: 1 }, out: { bronze_bar: 1 }, level: 1, xp: 15 },
  { id: 'iron_bar', station: 'furnace', name: 'Smelt Iron Bar', input: { iron_ore: 1 }, out: { iron_bar: 1 }, level: 3, xp: 30 },
  { id: 'bronze_sword', station: 'anvil', name: 'Forge Bronze Sword', input: { bronze_bar: 2 }, sword: 'bronze', level: 1, xp: 40 },
  { id: 'iron_sword', station: 'anvil', name: 'Forge Iron Sword', input: { iron_bar: 2 }, sword: 'iron', level: 3, xp: 80 },
];
export const PIECES = {
  wood: { name: 'Wood Block', cost: { log: 1 }, h: BLOCK, color: 0x9a6a3c },
  stone: { name: 'Stone Block', cost: { stone: 1 }, h: BLOCK, color: 0x8d8f94 },
  floor: { name: 'Plank Floor', cost: { log: 1 }, h: 0.3, color: 0xc49a62 },
};

// ---------- resource nodes ----------
export const NODE_TYPES = {
  tree: { skill: 'woodcutting', level: 1, xp: 25, item: 'log', qty: 1, respawn: 20, time: 1.5, label: 'Chop Tree' },
  oak: { skill: 'woodcutting', level: 3, xp: 45, item: 'log', qty: 2, respawn: 30, time: 2.0, label: 'Chop Oak' },
  rock: { skill: 'mining', level: 1, xp: 15, item: 'stone', qty: 1, respawn: 15, time: 1.4, label: 'Mine Rock' },
  copper: { skill: 'mining', level: 1, xp: 20, item: 'copper_ore', qty: 1, respawn: 20, time: 1.6, label: 'Mine Copper' },
  tin: { skill: 'mining', level: 1, xp: 20, item: 'tin_ore', qty: 1, respawn: 20, time: 1.6, label: 'Mine Tin' },
  iron: { skill: 'mining', level: 3, xp: 40, item: 'iron_ore', qty: 1, respawn: 35, time: 2.0, label: 'Mine Iron' },
};
function validWild(x, z, minH = 1.2) {
  if (islandHeight(x, z) < minH) return false;
  if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r + 4) return false;
  if (Math.hypot(x - ENTRANCE.x, z - ENTRANCE.z) < 13) return false;
  return true;
}
let _nodes = null;
export function generateNodes() {
  if (_nodes) return _nodes;
  const rnd = mulberry32(1337), nodes = [];
  const far = (x, z, m) => nodes.every((o) => Math.hypot(o.x - x, o.z - z) > m);
  const place = (type, count, gen, spacing = 3.5) => {
    let n = 0, tries = 0;
    while (n < count && tries++ < 30000) {
      const p = gen();
      if (!validWild(p.x, p.z) || !far(p.x, p.z, spacing)) continue;
      nodes.push({ id: `${type}_${n}`, type, x: +p.x.toFixed(2), z: +p.z.toFixed(2), r: rnd() * 6.28 });
      n++;
    }
  };
  const disc = (cx, cz, R) => () => { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R; return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r }; };
  // a few starter trees/rocks just outside the village gate
  place('tree', 6, disc(-8, 48, 9));
  place('rock', 3, disc(14, 44, 6));
  // forest (west + north), denser where noise is high
  const forest = () => { for (;;) { const p = disc(-30, -20, 85)(); if (fbm(p.x * 0.04, p.z * 0.04) > 0.47 || rnd() < 0.15) return p; } };
  place('tree', 70, forest);
  place('oak', 14, disc(-55, -35, 35), 5);
  // eastern mining hills
  place('rock', 10, disc(70, -8, 30));
  place('copper', 8, disc(62, -2, 24));
  place('tin', 8, disc(78, -14, 24));
  place('iron', 6, disc(80, -30, 18));
  return (_nodes = nodes);
}

// ---------- enemies ----------
export const ENEMY_TYPES = {
  mossling: { name: 'Mossling', hp: 3, speed: 2.4, aggro: 9, range: 2.4, tell: 0.75, dmg: 1, cool: 1.6, xp: 10, radius: 0.7, respawn: 25, leash: 22 },
  grubkin: { name: 'Grubkin', hp: 6, speed: 3.0, aggro: 12, range: 2.3, tell: 0.85, dmg: 1, cool: 1.8, xp: 20, radius: 0.8, respawn: 30, leash: 28 },
  boar: { name: 'Bristleboar', hp: 8, speed: 2.2, aggro: 14, range: 9, tell: 1.0, dmg: 2, cool: 2.6, xp: 30, radius: 1.0, respawn: 35, leash: 34 },
  warden: { name: 'Barrow Warden', hp: 20, speed: 2.3, aggro: 30, range: 3.6, tell: 1.1, dmg: 2, cool: 1.4, xp: 200, radius: 1.6, respawn: 0, leash: 60, boss: true },
};
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
  return (_spawns = out);
}

// Generic enemy AI. Runs on the server (overworld, authoritative) or in the browser (solo mode + instanced dungeon).
// heightFn(x,z) -> ground height; blockedFn(x,z) -> true if an obstacle; players: [{id,x,z,dead}]
export class EnemySim {
  constructor(spawns, opts = {}) {
    this.height = opts.height || islandHeight;
    this.blocked = opts.blocked || null;
    this.respawn = opts.respawn !== false;
    this.rand = opts.rand || Math.random;
    this.enemies = new Map();
    for (const s of spawns) this.enemies.set(s.id, this.make(s));
  }
  make(s) {
    const T = ENEMY_TYPES[s.type];
    return { id: s.id, type: s.type, sx: s.x, sz: s.z, x: s.x, z: s.z, ry: 0, hp: T.hp, max: T.hp, state: 'idle', st: 0,
      alive: true, atk: 0, kind: 'a', wx: s.x, wz: s.z, cd: 0, dx: 0, dz: 1, kx: 0, kz: 0, n: 0 };
  }
  set(e, s) { e.state = s; e.st = 0; }
  canStand(x, z) {
    if (zoneAt(x, z) === 'village') return false;
    if (this.height(x, z) < -1) return false;
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
        if (p.dead || zoneAt(p.x, p.z) === 'village') continue;
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < td) { td = d; tgt = p; }
      }
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
          const want = e.type === 'boar' ? 5 : T.range * 0.7;
          if (td > want) this.moveToward(e, tgt.x, tgt.z, T.speed, dt);
          else if (e.type !== 'boar') { // circle-strafe a little while waiting
            const s = Math.sin(e.atk * 1.7) > 0 ? 1 : -1; this.move(e, Math.cos(e.ry) * s, -Math.sin(e.ry) * s, T.speed * 0.4 * dt);
          }
          break;
        }
        case 'tell':
          if (tgt && e.st < T.tell * 0.6) { e.ry = Math.atan2(tgt.x - e.x, tgt.z - e.z); fwd(); }
          if (e.st >= (e.kind === 'sweep' ? 0.8 : T.tell)) this.set(e, 'attack');
          break;
        case 'attack': {
          const hit = (ox, oz, r, extra = {}) => ev.push({ t: 'hit', id: e.id, atk: e.atk, x: +ox.toFixed(2), z: +oz.toFixed(2), r, dmg: T.dmg, sx: +e.x.toFixed(2), sz: +e.z.toFixed(2), ...extra });
          if (e.type === 'mossling') {
            if (e.st < 0.35) this.move(e, e.dx, e.dz, 7 * dt);
            if (e.st >= 0.12 && e.n !== e.atk) { e.n = e.atk; hit(e.x + e.dx * 0.6, e.z + e.dz * 0.6, 1.3); }
            if (e.st > 0.5) { e.cd = T.cool; this.set(e, 'recover'); }
          } else if (e.type === 'grubkin') {
            if (e.st < 0.15) this.move(e, e.dx, e.dz, 4 * dt);
            if (e.st >= 0.15 && e.n !== e.atk) { e.n = e.atk; hit(e.x + e.dx * 1.5, e.z + e.dz * 1.5, 1.5); }
            if (e.st > 0.55) { e.cd = T.cool; this.set(e, 'recover'); }
          } else if (e.type === 'boar') {
            const moved = this.move(e, e.dx, e.dz, 12 * dt);
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
          if (e.st > (e.type === 'warden' ? 1.9 : 1.2)) this.set(e, 'recover');
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
  // returns {ok, blocked, killed, hp, xp}
  damage(id, dmg, fromX, fromZ) {
    const e = this.enemies.get(id);
    if (!e || !e.alive) return { ok: false };
    const T = ENEMY_TYPES[e.type];
    let dx = e.x - fromX, dz = e.z - fromZ; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    if (e.type === 'warden' && e.state !== 'stuck') {
      // frontal armour: only hits from behind land unless he is stuck after a slam
      const fx = Math.sin(e.ry), fz = Math.cos(e.ry);
      if (-(dx * fx + dz * fz) > -0.2) return { ok: true, blocked: true, hp: e.hp };
    }
    e.hp = Math.max(0, e.hp - dmg);
    if (e.hp <= 0) { e.alive = false; this.set(e, 'dead'); return { ok: true, killed: true, hp: 0, xp: T.xp }; }
    if (!T.boss && e.state !== 'attack') { e.kx = dx; e.kz = dz; this.set(e, 'stagger'); }
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
  if (zone === 'dungeon') return 'The barrow resists your building.';
  if (Math.hypot(cx - VILLAGE.x, cz - VILLAGE.z) < VILLAGE.r + 1.5) return 'Too close to the village wall.';
  if (Math.hypot(cx - ENTRANCE.x, cz - ENTRANCE.z) < 7) return 'Too close to the barrow entrance.';
  if (cellBase(gx, gz) < -0.5) return 'You cannot build in deep water.';
  if (stackLen >= MAX_STACK) return 'That stack is as high as it goes.';
  return null;
}

// teleport destinations the server accepts without speed checks
export const TELEPORTS = [SPAWN, DUNGEON_START, { x: ENTRANCE.x, z: ENTRANCE.z + 5 }, { x: DUNGEON_X, z: -39 }];
