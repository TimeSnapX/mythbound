// Mythbound v3 PvP rules (pure logic, no DOM / three.js): duels, the Ashfall Arena, the opt-in Fadelands zone,
// host-side hit validation, stun diminishing returns, death drops and season rating maths.
// Everything here is consensual: duels must be accepted, the arena is opt-in, and in the Fadelands only players who
// confirmed the skull flag can hit (or be hit by) each other. Duel / arena HP is a separate pool, so nobody loses
// items or real hearts there; only the Fadelands has a (small) death penalty.
import { ITEMS, GEAR, ARENA, FADELANDS, zoneAt } from './shared.js';

export const PVP = {
  MELEE_REACH: 3.4,          // attacker -> target centre distance a melee hit may land from (host check, includes lag slack)
  SPIN_REACH: 4.6,
  MELEE_CD: 0.24,            // seconds between accepted melee hits from one attacker
  SPIN_CD: 0.9,
  MAX_ATK: 7, MAX_DEF: 40,   // clamps for what a client may claim (best gear + attack potion)
  NORMALIZED: { hp: 20, atk: 2, def: 0 },
  DR_WINDOW: 4,              // seconds; stuns inside this window get shorter: 100% -> 50% -> 25% -> immune
  DR_STEPS: [1, 0.5, 0.25, 0],
  BASE_STUN: 0.35,
  ROLL_IFRAMES: [0.03, 0.42],
  POTION_CD: 8, POTION_MAX: 3, POTION_HEAL: 6,
  ARENA_KOS: 3, ARENA_TIME: 90, ARENA_COUNTDOWN: 3, ARENA_RESPAWN: 3,
  DUEL_COUNTDOWN: 3, DUEL_INVITE_TTL: 30,
  FADE_KEEP: 3, FADE_DROP: 3, FLAG_COOLDOWN: 10,
};
export const ATTACK_MULT = { attack1: 1, attack2: 1, attack3: 1.5, spin: 2 };

// --- stats ---
export function clampStats(s = {}) {
  const n = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return { hp: Math.max(4, Math.min(40, n(s.hp, 6) | 0)), atk: Math.max(1, Math.min(PVP.MAX_ATK, n(s.atk, 1) | 0)), def: Math.max(0, Math.min(PVP.MAX_DEF, n(s.def, 0) | 0)) };
}
export function pvpStats(claimed, rules = {}) {
  if (rules.normalized) return { ...PVP.NORMALIZED };
  const c = clampStats(claimed);
  if (rules.noGear) return { hp: c.hp, atk: 1, def: 0 };
  return c;
}
// host-side damage: never trusts a client damage number. Defence shaves off up to 40% (min 1).
export function computeDamage(att, def, kind) {
  const mult = ATTACK_MULT[kind] || 1;
  const raw = Math.ceil(att.atk * mult);
  return Math.max(1, Math.round(raw * (1 - Math.min(0.4, (def.def || 0) * 0.02))));
}

// --- stun diminishing returns ---
export class StunDR {
  constructor() { this.hits = []; }
  next(now) { this.hits = this.hits.filter((t) => now - t < PVP.DR_WINDOW); const k = PVP.DR_STEPS[Math.min(this.hits.length, PVP.DR_STEPS.length - 1)]; this.hits.push(now); return +(PVP.BASE_STUN * k).toFixed(3); }
}

// --- who may hit whom ---
export const inFadelands = (x, z) => zoneAt(x, z) === 'fadelands';
export const inArena = (x, z, slack = 0) => Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + slack;
// ctx: { duel, arena } ; a/b: { id, x, z, flagged }
export function relation(a, b, ctx = {}) {
  if (!a || !b || a.id === b.id) return null;
  const d = ctx.duel;
  if (d && d.state === 'fight' && d.players.includes(a.id) && d.players.includes(b.id)) return 'duel';
  const ar = ctx.arena;
  if (ar && ar.state === 'fight' && ar.teamOf(a.id) !== null && ar.teamOf(b.id) !== null && ar.teamOf(a.id) !== ar.teamOf(b.id)) return 'arena';
  if (a.flagged && b.flagged && inFadelands(a.x, a.z) && inFadelands(b.x, b.z)) return 'fadelands';
  return null;
}
// Host validation of one melee hit. att/tgt: host-tracked state { id, x, z, dead, mounted, rolling, rollT, lastHit:{t,kind}, a }.
export function validateHit(att, tgt, kind, now, ctx = {}) {
  if (!ATTACK_MULT[kind]) return { ok: false, reason: 'bad-kind' };
  if (!att || !tgt) return { ok: false, reason: 'no-target' };
  if (att.dead || tgt.dead) return { ok: false, reason: 'dead' };
  if (att.mounted) return { ok: false, reason: 'mounted' };
  const rel = relation(att, tgt, ctx); if (!rel) return { ok: false, reason: 'not-allowed' };
  if (ctx.countdown) return { ok: false, reason: 'countdown' };
  const reach = kind === 'spin' ? PVP.SPIN_REACH : PVP.MELEE_REACH;
  if (![att.x, att.z, tgt.x, tgt.z].every(Number.isFinite) || Math.hypot(att.x - tgt.x, att.z - tgt.z) > reach) return { ok: false, reason: 'reach' };
  const last = att.lastHit;
  if (last && now - last.t < (kind === 'spin' ? PVP.SPIN_CD : PVP.MELEE_CD)) return { ok: false, reason: 'cooldown' };
  if (tgt.rolling) return { ok: false, reason: 'dodged', rel };
  if (tgt.spawnShield && now < tgt.spawnShield) return { ok: false, reason: 'spawn-shield', rel };
  return { ok: true, rel };
}

// --- duels ---
export const DUEL_FORMATS = { ko: 'First to 0', bo3: 'Best of 3' };
export function cleanRules(r = {}) { return { noPotions: !!r.noPotions, noGear: !!r.noGear, normalized: !!r.normalized, format: r.format === 'bo3' ? 'bo3' : 'ko' }; }
export class Duel {
  constructor(id, a, b, rules, now) { this.id = id; this.players = [a, b]; this.rules = cleanRules(rules); this.state = 'invite'; this.t0 = now; this.wins = { [a]: 0, [b]: 0 }; this.round = 0; this.hp = {}; this.max = {}; this.potions = {}; this.log = []; }
  accept(now) { if (this.state !== 'invite') return false; this.startRound(now); return true; }
  startRound(now) { this.round++; this.state = 'countdown'; this.cd = now + PVP.DUEL_COUNTDOWN; for (const p of this.players) { this.potions[p] = 0; } }
  setStats(id, st) { this.max[id] = st.hp; this.hp[id] = st.hp; }
  tick(now) { if (this.state === 'countdown' && now >= this.cd) { this.state = 'fight'; return 'fight'; } return null; }
  damage(target, dmg) {
    if (this.state !== 'fight') return null;
    this.hp[target] = Math.max(0, (this.hp[target] ?? 0) - dmg);
    if (this.hp[target] > 0) return null;
    const winner = this.players.find((p) => p !== target); this.wins[winner]++;
    const need = this.rules.format === 'bo3' ? 2 : 1;
    if (this.wins[winner] >= need) { this.state = 'done'; this.winner = winner; return { roundWinner: winner, done: true }; }
    this.state = 'between'; return { roundWinner: winner, done: false };
  }
  forfeit(loser) { if (this.state === 'done') return; this.state = 'done'; this.winner = this.players.find((p) => p !== loser); this.forfeited = loser; }
  potion(id, now) {
    if (this.rules.noPotions) return { ok: false, reason: 'no-potions' };
    if (this.state !== 'fight') return { ok: false, reason: 'not-fighting' };
    if ((this.potions[id] || 0) >= PVP.POTION_MAX) return { ok: false, reason: 'potion-limit' };
    if (this.potT?.[id] && now - this.potT[id] < PVP.POTION_CD) return { ok: false, reason: 'potion-cooldown' };
    (this.potT ||= {})[id] = now; this.potions[id] = (this.potions[id] || 0) + 1;
    this.hp[id] = Math.min(this.max[id], this.hp[id] + PVP.POTION_HEAL); return { ok: true, hp: this.hp[id] };
  }
}

// --- arena ---
export const ARENA_SPAWNS = [[-1, 0], [1, 0], [-1, 0.45], [1, -0.45]].map(([s, o]) => ({ x: ARENA.x + s * (ARENA.r - 3), z: ARENA.z + o * 6 }));
export class ArenaMatch {
  constructor(id, mode, teams, rules, now) {
    this.id = id; this.mode = mode === '2v2' ? '2v2' : '1v1'; this.teams = teams; this.rules = cleanRules({ ...rules, noPotions: true });
    this.state = 'countdown'; this.cd = now + PVP.ARENA_COUNTDOWN; this.t0 = now; this.kos = [0, 0]; this.hp = {}; this.max = {}; this.down = {}; this.stats = {}; this.lastHitBy = {}; this.events = [];
  }
  get players() { return [...this.teams[0], ...this.teams[1]]; }
  teamOf(id) { return this.teams[0].includes(id) ? 0 : this.teams[1].includes(id) ? 1 : null; }
  spawnOf(id) { const t = this.teamOf(id), i = this.teams[t].indexOf(id); return ARENA_SPAWNS[t + i * 2]; }
  setStats(id, st) { this.max[id] = st.hp; this.hp[id] = st.hp; (this.stats[id] ||= { kos: 0, deaths: 0, dmg: 0 }); }
  tick(now, pos = {}) {
    const out = [];
    if (this.state === 'countdown' && now >= this.cd) { this.state = 'fight'; this.fightT = now; out.push({ ev: 'fight' }); }
    if (this.state !== 'fight') return out;
    for (const [id, t] of Object.entries(this.down)) if (now >= t) { delete this.down[id]; this.hp[id] = this.max[id]; out.push({ ev: 'respawn', id, at: this.spawnOf(id), shield: now + 1.5 }); }
    for (const id of this.players) { // ring-out: leaving the circle counts as a KO
      const p = pos[id]; if (!p || this.down[id] !== undefined) continue;
      if (!inArena(p.x, p.z, 0.5)) out.push(...this.ko(id, now, 'ringout'));
    }
    if (now - this.fightT >= PVP.ARENA_TIME) out.push(...this.finish(now, 'time'));
    return out;
  }
  damage(attacker, target, dmg, now) {
    if (this.state !== 'fight' || this.down[target] !== undefined) return [];
    this.hp[target] = Math.max(0, this.hp[target] - dmg); this.lastHitBy[target] = attacker; (this.stats[attacker] ||= { kos: 0, deaths: 0, dmg: 0 }).dmg += dmg;
    return this.hp[target] <= 0 ? this.ko(target, now, 'ko') : [];
  }
  ko(id, now, how) {
    if (this.state !== 'fight' || this.down[id] !== undefined) return [];
    const team = this.teamOf(id), other = 1 - team; this.kos[other]++;
    const by = this.lastHitBy[id]; if (by && this.teamOf(by) === other) this.stats[by].kos++;
    this.stats[id].deaths++; this.down[id] = now + PVP.ARENA_RESPAWN; this.hp[id] = 0;
    const out = [{ ev: 'ko', id, by: by || null, how }];
    if (this.kos[other] >= PVP.ARENA_KOS) out.push(...this.finish(now, 'kos'));
    return out;
  }
  finish(now, why) {
    if (this.state === 'done') return [];
    this.state = 'done'; this.endT = now; this.why = why;
    this.winner = this.kos[0] === this.kos[1] ? -1 : this.kos[0] > this.kos[1] ? 0 : 1;
    return [{ ev: 'done', winner: this.winner, kos: [...this.kos], why }];
  }
  tokensFor(id) { const t = this.teamOf(id); if (t === null) return 0; return this.winner === -1 ? 2 : this.winner === t ? 3 : 1; }
  scoreboard() { return this.players.map((id) => ({ id, team: this.teamOf(id), hp: this.hp[id], max: this.max[id], ...(this.stats[id] || {}) })); }
}

// --- Fadelands death drop: equipped gear is never dropped; the 3 most valuable stacks are always kept; up to 3 of
// the remaining tradeable stacks drop. Quest / untradeable / cosmetic items never drop. Returns { drop, keep }.
export function stackValue(k, n) { return (ITEMS[k]?.v || GEAR[k]?.v || 0) * (n || 0); }
export function fadelandsDeathDrop(inv, rand = Math.random) {
  const stacks = Object.entries(inv || {}).filter(([k, n]) => n > 0 && ITEMS[k]);
  const safe = (k) => ITEMS[k].quest || ITEMS[k].untradeable || ITEMS[k].cosmetic;
  const sorted = stacks.filter(([k]) => !safe(k)).sort((a, b) => stackValue(...b) - stackValue(...a) || a[0].localeCompare(b[0]));
  const kept = sorted.slice(0, PVP.FADE_KEEP).map(([k]) => k);
  const pool = sorted.slice(PVP.FADE_KEEP);
  const drop = {};
  for (let i = 0; i < PVP.FADE_DROP && pool.length; i++) { const j = Math.floor(rand() * pool.length); const [k, n] = pool.splice(j, 1)[0]; drop[k] = Math.ceil(n / 2); } // at most half of each picked stack
  return { drop, kept };
}

// --- season rating ---
export const SEASON = '2026-S1';
export function eloDelta(ra, rb, score, K = 24) { const ea = 1 / (1 + 10 ** ((rb - ra) / 400)); return Math.round(K * (score - ea)); }
// sanity checks the host runs before it writes a match result (and the Firestore rules mirror the important ones)
export function matchSanity(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['no-match'];
  const ids = [...(m.teamA || []), ...(m.teamB || [])];
  if (!(ids.length === 2 || ids.length === 4) || new Set(ids).size !== ids.length) errs.push('players');
  if (!['1v1', '2v2', 'duel'].includes(m.mode)) errs.push('mode');
  if (m.mode === '2v2' && ids.length !== 4) errs.push('mode-size');
  if (!(m.durationS >= 5 && m.durationS <= 1800)) errs.push('duration');
  if (!Array.isArray(m.kos) || m.kos.some((k) => !(k >= 0 && k <= 60))) errs.push('kos');
  if (![-1, 0, 1].includes(m.winner)) errs.push('winner');
  if (m.winner === 0 && !(m.kos[0] >= m.kos[1])) errs.push('winner-kos');
  if (m.winner === 1 && !(m.kos[1] >= m.kos[0])) errs.push('winner-kos');
  if (!ids.includes(m.hostUid) && m.mode !== 'duel') { /* host may referee a duel/arena it isn't in; allowed */ }
  return errs;
}
