// Mythbound v3 PvP + trade sessions over co-op (host-authoritative).
// The host runs every duel / arena match / Fadelands hit check; guests only *ask* (op messages over the 'pvp' and
// 'trade' channels) and render what the host tells them. The host plays through the same code path as a guest
// (its own requests are handled locally), so the rules apply to everyone equally.
//   guest -> host  {t:'pvp', op:'stats'|'invite'|'accept'|'decline'|'hit'|'forfeit'|'queue'|'unqueue'|'flag'|'potion'|'fdeath'}
//   host  -> guest {t:'pvp', op:'invite'|'duel'|'arena'|'hurt'|'ko'|'tp'|'result'|'reject'|'flags'|'msg'}
//   trade: two-phase escrow, see tradeHostRx.
import * as THREE from 'three';
import * as UI from './ui.js';
import { ITEMS, GEAR, ARENA, FADELANDS, CAMP, isSafeZone, zoneAt } from './shared.js';
import { PVP, pvpStats, clampStats, computeDamage, StunDR, validateHit, relation, cleanRules, Duel, ArenaMatch, ARENA_SPAWNS, inFadelands, inArena, fadelandsDeathDrop, SEASON, matchSanity, DUEL_FORMATS } from './pvp.js';
import { createMockLeaderboard, createFirestoreLeaderboard, createHubLeaderboard, recordMatch, ackAndClaim } from './leaderboard.js';
import { makeLabel } from './world.js';
import { effectiveConfig, cloudConfigured } from './firebase-config.js';

const esc = UI.esc;
const nowS = () => performance.now() / 1000;
const rid = () => Math.random().toString(36).slice(2, 10);
const TRADE_MAX_STACKS = 8, TRADE_TTL = 120;
export const tradeable = (k) => !!ITEMS[k] && !ITEMS[k].quest && !ITEMS[k].untradeable && !ITEMS[k].cosmetic;

const PvP = {
  pvpInit() {
    this.pvp = { duel: null, arena: null, flagged: false, flagT: 0, prompted: false, invite: null, queued: null, lastReject: null, rejects: {}, results: [], flagList: [] };
    this.trade = null; this.skulls = new Map();
    this.pvH = null; // host state, created on demand
    this.lb = null;
  },
  // ---------- identity / transport ----------
  myUid() { return this.coop?.me || 'me'; },
  pvpOnline() { return !!(this.coop?.active && (this.coop.isHost ? this.coop.joinedPeers.length : this.coop.joined)); },
  pvpSend(m) { // everything goes through the host, including the host's own requests
    if (this.coop?.isHost || !this.coopGuest) return this.pvpHostRx(this.myUid(), m);
    this.net.send({ t: 'pvp', ...m });
  },
  tradeSend(m) { if (this.coop?.isHost || !this.coopGuest) return this.tradeHostRx(this.myUid(), m); this.net.send({ t: 'trade', ...m }); },
  // host -> one player (the host delivers to itself directly)
  pvTo(uid, m) {
    if (uid === this.myUid()) return this.pvpGuestRx(m);
    const peer = this.coop?.peers.get(uid); if (peer?.joined) this.coop.sendTo(peer, { t: 'pvp', ...m });
  },
  trTo(uid, m) {
    if (uid === this.myUid()) return this.tradeGuestRx(m);
    const peer = this.coop?.peers.get(uid); if (peer?.joined) this.coop.sendTo(peer, { t: 'trade', ...m });
  },
  pvName(uid) { if (uid === this.myUid()) return this.s.name; return this.coop?.peers.get(uid)?.name || this.remotes.get(uid)?.name || 'Player'; },
  // host-tracked state of a player, for validation
  pvSt(uid) {
    const H = this.pvH;
    if (uid === this.myUid()) { const p = this.p; return { id: uid, x: p.x, z: p.z, dead: p.mode === 'dead', mounted: !!this.mounted, rolling: p.mode === 'roll' && p.mt > PVP.ROLL_IFRAMES[0] && p.mt < PVP.ROLL_IFRAMES[1], flagged: H.flagged.has(uid), lastHit: H.last.get(uid), spawnShield: H.shield.get(uid) }; }
    const q = this.coop?.peers.get(uid); if (!q || !q.joined || !q.has) return null;
    return { id: uid, x: q.x, z: q.z, dead: !!q.dead, mounted: !!q.mounted, rolling: q.a === 'roll', flagged: H.flagged.has(uid), lastHit: H.last.get(uid), spawnShield: H.shield.get(uid) };
  },
  pvHost() {
    return (this.pvH ||= { duels: new Map(), arenas: new Map(), queue: { '1v1': [], '2v2': [] }, flagged: new Set(), stats: new Map(), dr: new Map(), last: new Map(), shield: new Map(), rejects: {}, log: [], trades: new Map(), tradeIds: new Set(), viewT: 0 });
  },
  pvReject(uid, reason, extra = {}) { const H = this.pvHost(); H.rejects[reason] = (H.rejects[reason] || 0) + 1; H.log.push({ uid, reason, ...extra, t: Date.now() }); if (H.log.length > 200) H.log.shift(); this.pvTo(uid, { op: 'reject', reason }); },
  duelOf(uid) { for (const d of this.pvHost().duels.values()) if (d.players.includes(uid) && d.state !== 'done') return d; return null; },
  arenaOf(uid) { for (const a of this.pvHost().arenas.values()) if (a.teamOf(uid) !== null && a.state !== 'done') return a; return null; },
  pvStatsFor(uid, rules) { return pvpStats(this.pvHost().stats.get(uid) || { hp: 6, atk: 1, def: 0 }, rules); },
  duelView(d) { return { id: d.id, players: d.players, names: d.players.map((u) => this.pvName(u)), state: d.state, hp: d.hp, max: d.max, wins: d.wins, rules: d.rules, cd: d.cd ? Math.max(0, d.cd - nowS()) : 0, round: d.round, winner: d.winner ?? null }; },
  arenaView(a) { return { id: a.id, mode: a.mode, teams: a.teams, names: Object.fromEntries(a.players.map((u) => [u, this.pvName(u)])), state: a.state, hp: a.hp, max: a.max, kos: a.kos, down: Object.keys(a.down), cd: a.state === 'countdown' ? Math.max(0, a.cd - nowS()) : 0, left: a.state === 'fight' ? Math.max(0, PVP.ARENA_TIME - (nowS() - a.fightT)) : 0, board: a.scoreboard().map((r) => ({ ...r, name: this.pvName(r.id) })), winner: a.winner ?? null, rules: a.rules }; },
  pvPush(d) { const v = this.duelView(d); for (const u of d.players) this.pvTo(u, { op: 'duel', v }); },
  arPush(a) { const v = this.arenaView(a); for (const u of a.players) this.pvTo(u, { op: 'arena', v }); },
  // ---------- host: requests ----------
  pvpHostRx(uid, m) {
    if (!(this.coop?.isHost || !this.coopGuest)) return;
    const H = this.pvHost(), now = nowS(), op = String(m.op || '');
    const str = (v, n = 40) => (typeof v === 'string' ? v.slice(0, n) : '');
    switch (op) {
      case 'stats': H.stats.set(uid, clampStats(m.s || {})); return;
      case 'invite': {
        const to = str(m.to), a = this.pvSt(uid), b = this.pvSt(to);
        if (!a || !b || to === uid) return this.pvReject(uid, 'no-target');
        if (this.duelOf(uid) || this.duelOf(to) || this.arenaOf(uid) || this.arenaOf(to)) return this.pvReject(uid, 'busy');
        if (Math.hypot(a.x - b.x, a.z - b.z) > 20) return this.pvReject(uid, 'too-far');
        for (const [k, d] of H.duels) if (d.state === 'invite' && d.players[0] === uid) H.duels.delete(k); // one open invite each
        const d = new Duel('d' + rid(), uid, to, cleanRules(m.rules || {}), now); H.duels.set(d.id, d);
        this.pvTo(to, { op: 'invite', id: d.id, from: uid, name: this.pvName(uid), rules: d.rules });
        this.pvTo(uid, { op: 'msg', text: `Duel invite sent to ${this.pvName(to)}.` }); return;
      }
      case 'accept': case 'decline': {
        const d = H.duels.get(str(m.id)); if (!d || d.players[1] !== uid || d.state !== 'invite') return this.pvReject(uid, 'no-invite');
        if (now - d.t0 > PVP.DUEL_INVITE_TTL) { H.duels.delete(d.id); return this.pvReject(uid, 'expired'); }
        if (op === 'decline') { H.duels.delete(d.id); this.pvTo(d.players[0], { op: 'msg', text: `${this.pvName(uid)} declined the duel.` }); return; }
        if (this.arenaOf(uid) || this.arenaOf(d.players[0])) return this.pvReject(uid, 'busy');
        d.accept(now); for (const u of d.players) d.setStats(u, this.pvStatsFor(u, d.rules));
        this.pvPush(d); return;
      }
      case 'forfeit': {
        const d = this.duelOf(uid); if (d) { d.forfeit(uid); this.duelDone(d); return; }
        const a = this.arenaOf(uid); if (a) { for (const ev of a.ko(uid, now, 'forfeit')) this.arenaEvent(a, ev); this.arPush(a); }
        H.queue['1v1'] = H.queue['1v1'].filter((q) => q.uid !== uid); H.queue['2v2'] = H.queue['2v2'].filter((q) => q.uid !== uid); return;
      }
      case 'queue': {
        const mode = m.mode === '2v2' ? '2v2' : '1v1', st = this.pvSt(uid);
        if (!st || this.duelOf(uid) || this.arenaOf(uid)) return this.pvReject(uid, 'busy');
        if (Math.hypot(st.x - ARENA.x, st.z - ARENA.z) > ARENA.r + 14) return this.pvReject(uid, 'not-at-arena');
        for (const k of ['1v1', '2v2']) H.queue[k] = H.queue[k].filter((q) => q.uid !== uid);
        H.queue[mode].push({ uid, normalized: !!m.normalized, t: now });
        this.pvTo(uid, { op: 'queued', mode, n: H.queue[mode].length, need: mode === '2v2' ? 4 : 2 });
        this.arenaMatchmake(mode); return;
      }
      case 'unqueue': for (const k of ['1v1', '2v2']) H.queue[k] = H.queue[k].filter((q) => q.uid !== uid); this.pvTo(uid, { op: 'queued', mode: null }); return;
      case 'flag': {
        const st = this.pvSt(uid); if (!st) return;
        if (m.on) { if (!inFadelands(st.x, st.z)) return this.pvReject(uid, 'not-in-fadelands'); H.flagged.add(uid); }
        else H.flagged.delete(uid);
        this.pvFlagsPush(); return;
      }
      case 'potion': {
        const d = this.duelOf(uid); if (!d) return this.pvReject(uid, 'not-fighting');
        const r = d.potion(uid, now); if (!r.ok) return this.pvReject(uid, r.reason);
        this.pvTo(uid, { op: 'potionOk' }); this.pvPush(d); return;
      }
      case 'fdeath': { const st = this.pvSt(uid); if (st && H.flagged.has(uid) && inFadelands(st.x, st.z)) { const by = H.lastFade?.get(uid); if (by && by.t > now - 10) this.pvTo(by.uid, { op: 'fkill', name: this.pvName(uid) }); this.coop?.broadcast({ t: 'chat', sys: 1, text: `💀 ${this.pvName(uid)} fell in the Fadelands.` }); } return; }
      case 'hit': return this.pvHit(uid, str(m.tgt), String(m.kind || ''), now);
    }
  },
  pvHit(uid, tgt, kind, now) {
    const H = this.pvHost(), att = this.pvSt(uid), def = this.pvSt(tgt);
    const ctx = { duel: this.duelOf(uid), arena: this.arenaOf(uid) };
    if (ctx.duel && !ctx.duel.players.includes(tgt)) ctx.duel = null;
    ctx.countdown = (ctx.duel && ctx.duel.state === 'countdown') || (ctx.arena && ctx.arena.state === 'countdown');
    if (ctx.countdown && ((ctx.duel && ctx.duel.players.includes(tgt)) || (ctx.arena && ctx.arena.teamOf(tgt) !== null && ctx.arena.teamOf(tgt) !== ctx.arena.teamOf(uid)))) return this.pvReject(uid, 'countdown');
    const v = validateHit(att, def, kind, now, ctx);
    if (!v.ok) { if (v.reason === 'dodged') this.pvTo(tgt, { op: 'msg', text: 'Dodged!', cls: 'good' }); return this.pvReject(uid, v.reason, { tgt, kind }); }
    H.last.set(uid, { t: now, kind });
    const rules = ctx.duel?.rules || ctx.arena?.rules || {};
    const A = this.pvStatsFor(uid, rules), D = this.pvStatsFor(tgt, rules), dmg = computeDamage(A, D, kind);
    const stun = (H.dr.get(tgt) || H.dr.set(tgt, new StunDR()).get(tgt)).next(now);
    if (v.rel === 'duel') {
      const d = ctx.duel, r = d.damage(tgt, dmg);
      this.pvTo(tgt, { op: 'hurt', dmg, real: 0, sx: att.x, sz: att.z, stun });
      if (r) { this.pvTo(r.roundWinner, { op: 'msg', text: r.done ? 'You win the duel!' : 'Round won!', cls: 'good' }); if (r.done) this.duelDone(d); else setTimeout(() => { if (d.state === 'between') { d.startRound(nowS()); for (const u of d.players) d.setStats(u, this.pvStatsFor(u, d.rules)); this.pvPush(d); } }, 2500); }
      this.pvPush(d);
    } else if (v.rel === 'arena') {
      const a = ctx.arena; this.pvTo(tgt, { op: 'hurt', dmg, real: 0, sx: att.x, sz: att.z, stun });
      for (const ev of a.damage(uid, tgt, dmg, now)) this.arenaEvent(a, ev);
      this.arPush(a);
    } else if (v.rel === 'fadelands') {
      (H.lastFade ||= new Map()).set(tgt, { uid, t: now });
      this.pvTo(tgt, { op: 'hurt', dmg: Math.min(dmg, 4), real: 1, sx: att.x, sz: att.z, stun, by: this.pvName(uid) });
    }
    this.pvTo(uid, { op: 'hitOk', tgt, dmg, rel: v.rel });
  },
  pvFlagsPush() { const list = [...this.pvHost().flagged]; this.pvTo(this.myUid(), { op: 'flags', list }); this.coop?.broadcast({ t: 'pvp', op: 'flags', list }); },
  arenaMatchmake(mode) {
    const H = this.pvHost(), need = mode === '2v2' ? 4 : 2, q = H.queue[mode].filter((x) => this.pvSt(x.uid));
    H.queue[mode] = q; if (q.length < need) return;
    const pick = q.splice(0, need), ids = pick.map((x) => x.uid);
    const teams = mode === '2v2' ? [[ids[0], ids[3]], [ids[1], ids[2]]] : [[ids[0]], [ids[1]]];
    const a = new ArenaMatch('a' + rid(), mode, teams, { normalized: pick.some((x) => x.normalized) }, nowS());
    for (const u of a.players) { a.setStats(u, this.pvStatsFor(u, a.rules)); const sp = a.spawnOf(u); this.pvTo(u, { op: 'tp', x: sp.x, z: sp.z, face: ARENA.x }); }
    H.arenas.set(a.id, a); this.arPush(a);
  },
  arenaEvent(a, ev) {
    const H = this.pvHost();
    if (ev.ev === 'fight') for (const u of a.players) this.pvTo(u, { op: 'go' });
    if (ev.ev === 'ko') { for (const u of a.players) this.pvTo(u, { op: 'kofeed', id: ev.id, name: this.pvName(ev.id), by: ev.by && this.pvName(ev.by), how: ev.how, me: u === ev.id }); }
    if (ev.ev === 'respawn') { H.shield.set(ev.id, ev.shield); this.pvTo(ev.id, { op: 'tp', x: ev.at.x, z: ev.at.z, face: ARENA.x, revive: 1 }); }
    if (ev.ev === 'done') this.arenaDone(a);
  },
  arenaDone(a) {
    const H = this.pvHost(), res = { id: a.id, mode: a.mode, teamA: a.teams[0], teamB: a.teams[1], winner: a.winner, kos: a.kos, durationS: Math.max(5, Math.round((a.endT || nowS()) - (a.fightT || a.t0))), names: Object.fromEntries(a.players.map((u) => [u, this.pvName(u)])) };
    const board = this.arenaView(a).board;
    for (const u of a.players) this.pvTo(u, { op: 'result', kind: 'arena', mode: a.mode, won: a.winner === a.teamOf(u), draw: a.winner === -1, tokens: a.tokensFor(u), board, why: a.why, kos: a.kos, matchId: a.id, myTeam: a.teamOf(u) });
    for (const u of a.players) { const sp = ARENA_SPAWNS[0]; this.pvTo(u, { op: 'tp', x: ARENA.x + (u === a.players[0] ? -2 : 2) * 0 + (Math.random() - 0.5) * 4, z: ARENA.z + ARENA.r + 4, face: ARENA.x, revive: 1 }); }
    setTimeout(() => H.arenas.delete(a.id), 3000);
    this.pvRecord(res, a.players);
  },
  duelDone(d) {
    const H = this.pvHost(), w = d.winner, res = { id: d.id, mode: 'duel', teamA: [d.players[0]], teamB: [d.players[1]], winner: w === d.players[0] ? 0 : w === d.players[1] ? 1 : -1, kos: [d.wins[d.players[0]] || 0, d.wins[d.players[1]] || 0], durationS: Math.max(5, Math.round(nowS() - d.t0)), names: Object.fromEntries(d.players.map((u) => [u, this.pvName(u)])) };
    if (d.forfeited) res.kos[res.winner] = Math.max(res.kos[res.winner], res.kos[1 - res.winner] || 0);
    for (const u of d.players) this.pvTo(u, { op: 'result', kind: 'duel', won: u === w, draw: !w, forfeit: d.forfeited === u ? 1 : d.forfeited ? 2 : 0, wins: d.wins, names: res.names, matchId: d.id });
    this.pvPush(d); setTimeout(() => H.duels.delete(d.id), 1000);
    this.pvRecord(res, d.players);
  },
  // season leaderboard: the host writes the match (after its own sanity check), every player acks + claims their own row
  async pvLb() {
    if (this.lb) return this.lb;
    if (window.MB_LEADERBOARD) return (this.lb = typeof window.MB_LEADERBOARD === 'function' ? await window.MB_LEADERBOARD() : window.MB_LEADERBOARD);
    const qp = new URLSearchParams(location.search);
    if (qp.has('debug') && qp.get('lb') === 'hub' && qp.get('coophub')) return (this.lb = await createHubLeaderboard(qp.get('coophub')));
    if (qp.has('debug') && qp.get('lb') === 'mock') return (this.lb = createMockLeaderboard());
    const cfg = cloudConfigured() ? effectiveConfig() : null;
    if (this.cloud?.state?.status === 'signedIn' && cfg && this.cloud.adapter?.kind !== 'mock') { try { this.lb = await createFirestoreLeaderboard(cfg); } catch (e) { this.lbErr = String(e.message || e); } }
    return this.lb;
  },
  async pvRecord(res, players) {
    const H = this.pvHost();
    const errs = matchSanity({ ...res, hostUid: this.myUid() }); if (errs.length) { H.lbLog = (H.lbLog || []).concat([{ id: res.id, errs }]); return; }
    const lb = await this.pvLb(); if (!lb || !this.coop?.active) return;
    try { const r = await recordMatch(lb, this.myUid(), res); (H.lbLog ||= []).push({ id: res.id, ok: r.ok }); if (r.ok) for (const u of players) this.pvTo(u, { op: 'lbAck', matchId: res.id }); }
    catch (e) { (H.lbLog ||= []).push({ id: res.id, err: String(e.message || e) }); }
  },
  // ---------- host: per-frame ----------
  pvpHostFrame(dt) {
    const H = this.pvH; if (!H) return;
    const now = nowS();
    for (const d of [...H.duels.values()]) {
      if (d.state === 'invite') { if (now - d.t0 > PVP.DUEL_INVITE_TTL) H.duels.delete(d.id); continue; }
      if (d.state === 'done') continue;
      const [a, b] = d.players.map((u) => this.pvSt(u));
      if (!a || !b) { d.forfeit(!a ? d.players[0] : d.players[1]); this.duelDone(d); continue; }
      if (Math.hypot(a.x - b.x, a.z - b.z) > 40) { d.forfeit(d.players[0]); d.winner = null; d.forfeited = null; d.state = 'done'; for (const u of d.players) this.pvTo(u, { op: 'msg', text: 'Duel cancelled: you moved too far apart.', cls: 'bad' }); this.pvPush(d); H.duels.delete(d.id); continue; }
      if (d.tick(now)) { for (const u of d.players) this.pvTo(u, { op: 'go' }); this.pvPush(d); }
    }
    H.viewT += dt; const push = H.viewT > 0.25; if (push) H.viewT = 0;
    for (const a of [...H.arenas.values()]) {
      if (a.state === 'done') continue;
      const pos = {}; for (const u of a.players) { const s = this.pvSt(u); if (s) pos[u] = s; else if (!a.down[u]) for (const ev of a.ko(u, now, 'left')) this.arenaEvent(a, ev); }
      for (const ev of a.tick(now, pos)) this.arenaEvent(a, ev);
      if (push) this.arPush(a);
    }
    // flags drop for players who disconnected
    for (const u of [...H.flagged]) if (!this.pvSt(u)) { H.flagged.delete(u); this.pvFlagsPush(); }
    this.tradeHostFrame?.(now);
  },
  // ---------- every client: what the host tells us ----------
  pvpGuestRx(m) {
    const P = this.pvp, p = this.p;
    switch (m.op) {
      case 'invite': P.invite = { id: m.id, from: m.from, name: UI.esc(String(m.name || 'Player').slice(0, 16)), rules: cleanRules(m.rules), t: nowS() }; this.showInvite(); this.audio.play('duel'); return;
      case 'msg': UI.toast(String(m.text || '').slice(0, 120), m.cls || ''); return;
      case 'reject': P.lastReject = m.reason; P.rejects[m.reason] = (P.rejects[m.reason] || 0) + 1; if (['busy', 'too-far', 'not-at-arena', 'not-in-fadelands', 'no-target', 'expired', 'potion-limit', 'potion-cooldown', 'no-potions'].includes(m.reason)) UI.toast({ busy: 'They (or you) are already in a fight.', 'too-far': 'Get closer to challenge them.', 'not-at-arena': 'Queue at the Ashfall Arena.', 'not-in-fadelands': 'You can only raise the skull inside the Fadelands.', 'no-target': 'Nobody to challenge.', expired: 'That invite expired.', 'potion-limit': 'No more potions this round.', 'potion-cooldown': 'Potion on cooldown.', 'no-potions': 'Potions are off in this fight.' }[m.reason], 'bad'); return;
      case 'duel': P.duel = m.v && m.v.state !== 'done' ? m.v : (P.duel && m.v ? { ...m.v } : null); if (P.duel?.state === 'countdown' && !P.cdShown) { P.cdShown = true; this.countdown(P.duel.cd); } if (P.duel?.state !== 'countdown') P.cdShown = false; if (m.v?.state === 'done') P.duel = null; this.closeInvite(); return;
      case 'arena': P.arena = m.v?.state === 'done' ? null : m.v; if (P.arena?.state === 'countdown' && !P.acdShown) { P.acdShown = true; this.countdown(P.arena.cd); } P.queued = null; if (this.mounted) this.dismount(); return;
      case 'queued': P.queued = m.mode ? { mode: m.mode, n: m.n, need: m.need } : null; if (m.mode) UI.toast(`Queued for ${m.mode} (${m.n}/${m.need}).`, ''); if (this.panelKind === 'pvp') this.openPanel('pvp'); return;
      case 'go': UI.banner('FIGHT!', '', 'boss'); this.audio.play('go'); return;
      case 'tp': this.dismount(); this.debug.teleport(+m.x, +m.z); p.ry = Math.atan2((+m.face || p.x) - p.x, 0.0001); p.mode = 'normal'; p.lock = null; if (m.revive) { p.inv = 1.5; this.pvpDown = false; } return;
      case 'hurt': {
        if (m.real) { const g = this.god; this.god = false; this.hurt(Math.max(1, Math.min(4, m.dmg | 0)), +m.sx, +m.sz, +m.stun || 0.2); this.god = g; this.pvp.lastHurtBy = m.by; }
        else { // duel / arena: separate HP pool, only knockback + a short stun
          const ax = p.x - m.sx, az = p.z - m.sz, al = Math.hypot(ax, az) || 1;
          p.kx = (ax / al) * 7; p.kz = (az / al) * 7; this.stunDur = +m.stun || 0; if (this.stunDur > 0) { p.mode = 'hurt'; p.mt = 0; }
          this.particles.burst(p.x, p.y + 1.2, p.z, 0xff8040, 8, 3, 0.3); this.audio.play('hurt'); this.shake = 0.15;
        }
        P.lastStun = +m.stun; (P.stuns ||= []).push(+m.stun); return;
      }
      case 'hitOk': P.hitsOk = (P.hitsOk || 0) + 1; return;
      case 'kofeed': (P.feed ||= []).push({ name: m.name, by: m.by, how: m.how }); UI.toast(m.how === 'ringout' ? `💨 ${m.name} was rung out!` : m.how === 'left' ? `${m.name} left the arena.` : `⚔ ${m.by || '?'} knocked out ${m.name}!`, m.me ? 'bad' : 'good'); if (m.me) { this.pvpDown = true; p.mode = 'hurt'; p.mt = 0; this.stunDur = PVP.ARENA_RESPAWN; this.audio.play('skull'); } return;
      case 'result': return this.pvpResult(m);
      case 'flags': P.flagList = (m.list || []).map(String); P.flagged = P.flagList.includes(this.myUid()); UI.show('#skullbadge', P.flagged); return;
      case 'potionOk': UI.toast('Healed in the duel.', 'good'); return;
      case 'fkill': this.s.stats.pvpKills = (this.s.stats.pvpKills || 0) + 1; UI.toast(`💀 You defeated ${m.name} in the Fadelands.`, 'good'); this.checkAch(); return;
      case 'lbAck': this.pvpAckClaim(String(m.matchId)); return;
    }
  },
  async pvpAckClaim(id) {
    const lb = await this.pvLb(); if (!lb) return;
    try { const r = await ackAndClaim(lb, this.myUid(), id); (this.pvp.lb ||= []).push({ id, ok: r.ok, row: r.row, why: r.why }); if (r.ok) UI.toast(`🏆 Season rating ${r.row.rating}`, 'good'); }
    catch (e) { (this.pvp.lb ||= []).push({ id, err: String(e.message || e) }); }
  },
  pvpResult(m) {
    const P = this.pvp, s = this.s; this.pvpDown = false;
    if (m.kind === 'duel') {
      P.duel = null; if (m.won) s.stats.duelWins = (s.stats.duelWins || 0) + 1;
      UI.banner(m.won ? '🏆 Duel won!' : m.draw ? 'Duel ended' : 'Duel lost', m.forfeit === 1 ? 'You forfeited' : m.forfeit === 2 ? 'Your opponent forfeited' : 'No items are lost in a duel', m.won ? '' : 'bad');
    } else {
      P.arena = null; P.acdShown = false; const tok = Math.max(0, Math.min(3, m.tokens | 0));
      if (tok) this.give('arena_token', tok, true); if (m.won) s.stats.arenaWins = (s.stats.arenaWins || 0) + 1;
      P.lastBoard = m; this.openPanel('scoreboard');
      UI.banner(m.won ? '🏆 Victory!' : m.draw ? 'Draw' : 'Defeat', `${m.mode} · ${m.kos?.join(' – ')} · +${tok} 🎟 tokens`);
    }
    P.results.push({ kind: m.kind, won: !!m.won, draw: !!m.draw, tokens: m.tokens | 0, matchId: m.matchId }); this.audio.play(m.won ? 'quest' : 'ui');
    this.p.hp = this.maxHp; this.checkAch(); this.save();
  },
  countdown(sec) {
    const n = Math.max(1, Math.round(sec)); let i = n;
    const tick = () => { if (i <= 0) return; UI.banner(String(i), 'Get ready', 'boss'); this.audio.play('count'); i--; if (i > 0) setTimeout(tick, 1000); };
    tick();
  },
  showInvite() {
    const I = this.pvp.invite, el = document.getElementById('invite'); if (!I) return;
    const R = I.rules, tags = [DUEL_FORMATS[R.format], R.normalized ? 'Normalized stats' : 'Own gear', R.noPotions ? 'No potions' : 'Potions ok (max 3)', R.noGear ? 'No gear' : ''].filter(Boolean);
    el.innerHTML = `<div class="invcard"><b>⚔ ${I.name} challenges you to a duel!</b><small>${tags.join(' · ')} · no items are lost</small><div><button class="primary" data-v3="duel-accept">Accept</button><button data-v3="duel-decline">Decline</button></div></div>`;
    UI.show('#invite', true);
  },
  closeInvite() { UI.show('#invite', false); },
  // ---------- every client: per frame ----------
  pvpFrame(dt) {
    const P = this.pvp, p = this.p, z = this.zoneName();
    if (this.coop?.isHost || !this.coopGuest) this.pvpHostFrame(dt);
    // tell the host our (clamped on its side) combat stats every few seconds
    P.statT = (P.statT || 0) - dt;
    if (P.statT <= 0 && (this.pvpOnline() || this.pvH)) { P.statT = 3; const st = this.stats(); this.pvpSend({ op: 'stats', s: { hp: this.maxHp, atk: st.atk, def: st.def } }); }
    // Fadelands: confirm prompt on entry; the flag drops 10 s after leaving
    if (z === 'fadelands') {
      P.flagT = 0;
      if (!P.flagged && !P.prompted && !this.inDialog && p.mode !== 'dead') {
        P.prompted = true;
        this.runDialog('The Fadelands', [{ text: 'You stand at the edge of the Fadelands. Raise the skull flag? Flagged players can fight each other here. If you fall, the Fade takes up to 3 item stacks from your bag, but never your gear or your 3 most valuable stacks. Unflagged players can\'t be hit and can\'t hit anyone.', choices: ['☠ Raise the skull (PvP on)', 'Stay unflagged'], pick: (i) => { if (i === 0) this.pvpFlag(true); } }], null);
      }
    } else {
      P.prompted = false;
      if (P.flagged) { P.flagT += dt; if (P.flagT > PVP.FLAG_COOLDOWN) { P.flagT = 0; this.pvpFlag(false); UI.toast('Your skull flag fades. PvP off.', ''); } }
    }
    UI.show('#skullbadge', !!P.flagged);
    // skulls over flagged remotes
    const fl = new Set(P.flagList || []);
    for (const [id, r] of this.remotes) {
      let sk = this.skulls.get(id);
      if (fl.has(id)) { if (!sk) { sk = makeLabel('💀', '#ffffff', 1.1); this.scene.add(sk); this.skulls.set(id, sk); } sk.visible = r.av.root.visible; sk.position.set(r.x, r.y + 3.2, r.z); }
      else if (sk) { this.scene.remove(sk); this.skulls.delete(id); }
    }
    for (const [id, sk] of this.skulls) if (!this.remotes.has(id)) { this.scene.remove(sk); this.skulls.delete(id); }
    this.pvpHud();
    if (P.invite && nowS() - P.invite.t > PVP.DUEL_INVITE_TTL) { P.invite = null; this.closeInvite(); }
  },
  pvpFlag(on) { this.pvp.flagged = !!on; if (on) { this.pvp.flagT = 0; this.audio.play('skull'); UI.banner('☠ Skull raised', 'PvP on: flagged players can fight you here', 'bad'); if (this.mounted) this.dismount(); } this.pvpSend({ op: 'flag', on: !!on }); if (!this.pvpOnline() && !this.coop?.isHost) { this.pvHost(); } },
  pvpHud() {
    const P = this.pvp, el = document.getElementById('pvphud'); if (!el) return;
    let h = '';
    const bar = (name, hp, max, me) => `<div class="pvbar ${me ? 'me' : ''}"><span>${esc(name)}</span><div><i style="width:${max ? Math.round(100 * Math.max(0, hp) / max) : 0}%"></i></div><b>${Math.max(0, hp | 0)}</b></div>`;
    if (P.duel) { const d = P.duel; h = `<div class="pvtitle">⚔ Duel${d.rules.format === 'bo3' ? ` · round ${d.round} · ${d.players.map((u) => d.wins[u] || 0).join('–')}` : ''}${d.state === 'countdown' ? ' · get ready' : ''}</div>` + d.players.map((u, i) => bar(d.names[i], d.hp[u], d.max[u], u === this.myUid())).join('') + `<button data-v3="forfeit">Forfeit</button>`; }
    else if (P.arena) { const a = P.arena; h = `<div class="pvtitle">🏟 Arena ${a.mode} · <span class="t0">${a.kos[0]}</span> – <span class="t1">${a.kos[1]}</span> · ${a.state === 'countdown' ? 'get ready' : Math.ceil(a.left) + 's'}</div>` + a.teams.map((t, ti) => t.map((u) => bar((a.down.includes(u) ? '💤 ' : '') + a.names[u], a.hp[u], a.max[u], u === this.myUid())).join('')).join('<hr>') + `<button data-v3="forfeit">Leave</button>`; }
    else if (P.queued) h = `<div class="pvtitle">🏟 In queue: ${P.queued.mode} (${P.queued.n}/${P.queued.need})</div><button data-v3="unqueue">Leave queue</button>`;
    if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; }
    UI.show('#pvphud', !!h);
  },
  // ---------- combat hooks used by game.js ----------
  pvpOpponents() {
    const P = this.pvp, me = this.myUid(), out = new Set();
    if (P.duel && P.duel.state !== 'invite') for (const u of P.duel.players) if (u !== me) out.add(u);
    if (P.arena) { const mine = P.arena.teams.findIndex((t) => t.includes(me)); for (const u of P.arena.teams[1 - mine] || []) out.add(u); }
    if (P.flagged && this.zoneName() === 'fadelands') for (const u of P.flagList || []) if (u !== me) out.add(u);
    return out;
  },
  pvpTargets() { const out = []; for (const u of this.pvpOpponents()) { const r = this.remotes.get(u); if (r && !r.dead && r.av.root.visible) out.push({ id: 'pl_' + u, x: r.x, z: r.z, player: true }); } return out; },
  pvpLockPos(id) { const r = this.remotes.get(id.slice(3)); if (!r || r.dead || !this.pvpOpponents().has(r.id)) return null; return { x: r.x, y: r.y + 1.2, z: r.z }; },
  pvpMelee(kind, reach) {
    const ops = this.pvpOpponents(); if (!ops.size) return 0;
    const p = this.p, fx = Math.sin(p.ry), fz = Math.cos(p.ry); let n = 0;
    for (const u of ops) {
      const r = this.remotes.get(u); if (!r || r.dead) continue;
      const dx = r.x - p.x, dz = r.z - p.z, d = Math.hypot(dx, dz);
      if (d > reach + 0.6) continue; if (kind !== 'spin' && (dx * fx + dz * fz) / (d || 1) < 0.2 && d > 1.2) continue;
      this.pvpSend({ op: 'hit', tgt: u, kind }); n++;
    }
    return n;
  },
  pvpMode() { return !!(this.pvp?.duel || this.pvp?.arena); },
  pvpBusy(strict) { const P = this.pvp; if (!P) return false; return !!(P.duel || P.arena || (!strict && P.flagged)); },
  pvpPotionBlocked(item) {
    const P = this.pvp; if (!P) return false;
    if (P.arena) { UI.toast('No potions or food in the arena.', 'bad'); return true; }
    if (P.duel) { if (P.duel.rules.noPotions) { UI.toast('Potions are off in this duel.', 'bad'); return true; } if (!(this.s.inv[item] > 0)) return true; this.s.inv[item]--; this.pvpSend({ op: 'potion' }); return true; }
    return false;
  },
  pvpDrank() {},
  pvpRespawned() { this.pvpDown = false; },
  pvpInteracts() {},
  pvpInteract() { return false; },
  // Fadelands death: drop is destroyed by the Fade (nobody receives it, so it can't be farmed or duplicated)
  pvpOnDeath() {
    const P = this.pvp; if (!P?.flagged || this.zoneName() !== 'fadelands') return null;
    const r = fadelandsDeathDrop(this.s.inv);
    for (const [k, n] of Object.entries(r.drop)) { this.s.inv[k] -= n; if (this.s.inv[k] <= 0) delete this.s.inv[k]; }
    P.lastDrop = r; this.pvpSend({ op: 'fdeath' }); this.audio.play('skull');
    const lost = Object.entries(r.drop).map(([k, n]) => `${n}× ${ITEMS[k].name}`).join(', ');
    UI.toast(lost ? `The Fade took: ${lost}. Kept your gear and top 3 stacks.` : 'The Fade found nothing to take.', 'bad');
    this.pvpFlag(false); this.save(); return r;
  },
  // ---------- player-to-player trade (co-op): two-phase escrow, host referee ----------
  // 1. both sides build offers (host keeps the versioned offer; any change bumps the version and clears both accepts)
  // 2. both accept the SAME version -> host asks each side to escrow (remove) exactly its offer
  // 3. both escrowed -> host sends each side the other's offer once, tagged with the trade id; clients apply an id
  //    only once (s.tradeIds), so a replayed / duplicated delivery does nothing. If either escrow fails the other is refunded.
  tradeHostRx(uid, m) {
    if (!(this.coop?.isHost || !this.coopGuest)) return;
    const H = this.pvHost(), op = String(m.op || ''), id = typeof m.id === 'string' ? m.id.slice(0, 20) : '';
    const T = H.trades.get(id), side = T ? (T.a === uid ? 'a' : T.b === uid ? 'b' : null) : null;
    const rej = (reason) => { H.rejects['trade-' + reason] = (H.rejects['trade-' + reason] || 0) + 1; H.log.push({ uid, reason: 'trade-' + reason }); this.trTo(uid, { op: 'reject', reason }); };
    const view = (t) => { for (const u of [t.a, t.b]) this.trTo(u, { op: 'view', v: { id: t.id, a: t.a, b: t.b, names: [this.pvName(t.a), this.pvName(t.b)], offers: t.offers, ver: t.ver, acc: t.acc, state: t.state } }); };
    switch (op) {
      case 'req': {
        const to = typeof m.to === 'string' ? m.to.slice(0, 40) : '', A = this.pvSt(uid), B = this.pvSt(to);
        if (!A || !B || to === uid) return rej('no-target');
        if (Math.hypot(A.x - B.x, A.z - B.z) > 8) return rej('too-far');
        for (const t of H.trades.values()) if (t.state !== 'done' && t.state !== 'cancelled' && (t.a === uid || t.b === uid || t.a === to || t.b === to)) return rej('busy');
        const t = { id: 't' + rid(), a: uid, b: to, offers: { a: {}, b: {} }, ver: 1, acc: {}, state: 'open', t0: nowS(), esc: {} };
        H.trades.set(t.id, t); view(t); return;
      }
      case 'offer': {
        if (!T || !side || T.state !== 'open') return rej('not-open');
        const items = {}; let n = 0;
        for (const [k, v] of Object.entries(m.items || {})) {
          const c = Math.floor(Number(v)); if (!(c > 0)) continue;
          if (k === 'gold') { items.gold = Math.min(c, 1e9); continue; }
          if (!tradeable(k)) return rej('untradeable');
          if (++n > TRADE_MAX_STACKS) return rej('too-many'); items[k] = Math.min(c, 1e6);
        }
        T.offers[side] = items; T.ver++; T.acc = {}; view(T); return;
      }
      case 'accept': {
        if (!T || !side || T.state !== 'open') return rej('not-open');
        if (m.ver !== T.ver) return rej('stale-version');
        T.acc[side] = T.ver; view(T);
        if (T.acc.a === T.ver && T.acc.b === T.ver) { T.state = 'escrow'; for (const s2 of ['a', 'b']) this.trTo(T[s2], { op: 'escrow', id: T.id, ver: T.ver, give: T.offers[s2] }); view(T); }
        return;
      }
      case 'escrowed': case 'escrowFail': {
        if (T && side && T.state === 'cancelled' && op === 'escrowed' && !T.esc[side]) { T.esc[side] = 'refunded'; return this.trTo(uid, { op: 'refund', id: T.id }); } // escrowed after a cancel: give it back
        if (!T || !side || T.state !== 'escrow' || T.esc[side]) return rej('not-escrow');
        if (op === 'escrowFail') { T.state = 'cancelled'; for (const s2 of ['a', 'b']) if (T.esc[s2] === 'ok') this.trTo(T[s2], { op: 'refund', id: T.id }); for (const u of [T.a, T.b]) this.trTo(u, { op: 'msg', text: 'Trade cancelled: an item was missing.' }); view(T); return; }
        T.esc[side] = 'ok';
        if (T.esc.a === 'ok' && T.esc.b === 'ok') { T.state = 'done'; this.trTo(T.a, { op: 'deliver', id: T.id, get: T.offers.b }); this.trTo(T.b, { op: 'deliver', id: T.id, get: T.offers.a }); view(T); setTimeout(() => H.trades.delete(T.id), 60000); }
        return;
      }
      case 'cancel': {
        if (!T || !side) return rej('no-trade');
        if (T.state === 'open') { T.state = 'cancelled'; view(T); return; }
        if (T.state === 'escrow') { T.state = 'cancelled'; for (const s2 of ['a', 'b']) if (T.esc[s2] === 'ok') this.trTo(T[s2], { op: 'refund', id: T.id }); view(T); return; }
        return rej('too-late');
      }
      case 'resume': { // a client that still holds escrow after a reconnect asks how it ended
        for (const tid of (Array.isArray(m.ids) ? m.ids : []).slice(0, 10)) { const t = H.trades.get(String(tid)); if (!t) continue; const sd = t.a === uid ? 'a' : t.b === uid ? 'b' : null; if (!sd) continue; if (t.state === 'done') this.trTo(uid, { op: 'deliver', id: t.id, get: t.offers[sd === 'a' ? 'b' : 'a'] }); else if (t.state === 'cancelled') this.trTo(uid, { op: 'refund', id: t.id }); }
        return;
      }
      default: return rej('bad-op');
    }
  },
  tradeHostFrame(now) {
    const H = this.pvH; if (!H) return;
    for (const t of H.trades.values()) if ((t.state === 'open' || t.state === 'escrow') && (now - t.t0 > TRADE_TTL || !this.pvSt(t.a) || !this.pvSt(t.b))) {
      const was = t.state; t.state = 'cancelled';
      if (was === 'escrow') for (const s2 of ['a', 'b']) if (t.esc[s2] === 'ok') this.trTo(t[s2], { op: 'refund', id: t.id });
      for (const u of [t.a, t.b]) this.trTo(u, { op: 'view', v: { id: t.id, state: 'cancelled', a: t.a, b: t.b, names: [], offers: t.offers, ver: t.ver, acc: {} } });
    }
  },
  tradeGuestRx(m) {
    const s = this.s; s.tradeIds ||= []; s.escrow ||= {};
    switch (m.op) {
      case 'view': {
        const v = m.v; if (!v) return;
        this.trade = v.state === 'cancelled' || v.state === 'done' ? null : v;
        if (v.state === 'cancelled') UI.toast('Trade cancelled.', '');
        if (this.trade || this.panelKind === 'trade') this.openPanel('trade');
        if (!this.trade && this.panelKind === 'trade') this.closePanel();
        return;
      }
      case 'reject': (this.pvp.tradeRejects ||= []).push(m.reason); UI.toast({ untradeable: "That item can't be traded.", 'stale-version': 'The offer changed. Check it and confirm again.', busy: 'Already trading.', 'too-far': 'Stand next to them to trade.', 'too-many': 'Max 8 stacks per trade.' }[m.reason] || 'Trade: ' + m.reason, 'bad'); return;
      case 'escrow': {
        const give = m.give || {}, id = String(m.id);
        if (s.escrow[id] || s.tradeIds.includes(id)) return; // never escrow twice for one trade
        const okAll = Object.entries(give).every(([k, n]) => (k === 'gold' ? s.gold >= n : (s.inv[k] || 0) >= n && tradeable(k)));
        if (!okAll) return this.tradeSend({ op: 'escrowFail', id });
        for (const [k, n] of Object.entries(give)) { if (k === 'gold') s.gold -= n; else { s.inv[k] -= n; if (s.inv[k] <= 0) delete s.inv[k]; } }
        s.escrow[id] = { give, t: Date.now() }; this.save();
        return this.tradeSend({ op: 'escrowed', id });
      }
      case 'deliver': {
        const id = String(m.id);
        if (s.tradeIds.includes(id)) { (this.pvp.dupBlocked ||= []).push(id); return; } // replay / duplicate delivery: ignored
        s.tradeIds.push(id); if (s.tradeIds.length > 200) s.tradeIds.shift();
        delete s.escrow[id];
        for (const [k, n] of Object.entries(m.get || {})) { const c = Math.max(0, Math.floor(n)); if (!c) continue; if (k === 'gold') s.gold += c; else if (ITEMS[k] && tradeable(k)) s.inv[k] = (s.inv[k] || 0) + c; }
        s.stats.trades = (s.stats.trades || 0) + 1; this.trade = null; if (this.panelKind === 'trade') this.closePanel();
        UI.banner('🤝 Trade complete', ''); this.audio.play('coin'); this.checkAch(); this.save(); return;
      }
      case 'refund': {
        const id = String(m.id), e = s.escrow[id]; if (!e) return; delete s.escrow[id];
        for (const [k, n] of Object.entries(e.give)) { if (k === 'gold') s.gold += n; else s.inv[k] = (s.inv[k] || 0) + n; }
        UI.toast('Trade items returned to your bag.', ''); this.save(); return;
      }
      case 'msg': UI.toast(String(m.text || '').slice(0, 120), ''); return;
    }
  },
  tradeOffer(items) { if (!this.trade) return; this.tradeSend({ op: 'offer', id: this.trade.id, items }); },
  tradeMySide() { const t = this.trade; return t ? (t.a === this.myUid() ? 'a' : 'b') : null; },
  // ---------- panels ----------
  pvpPanel(kind) {
    if (kind === 'pvp') return [this.pvpHtml(), 'wide'];
    if (kind === 'leaderboard') { this.lbRefresh(); return [this.lbHtml(), '']; }
    if (kind === 'trade') return [this.tradeHtml(), 'wide'];
    if (kind === 'scoreboard') return [this.boardHtml(), ''];
    return null;
  },
  pvpHtml() {
    const s = this.s, P = this.pvp, on = this.pvpOnline(), st = s.stats, tok = s.inv.arena_token || 0;
    const near = [...this.remotes.values()].filter((r) => r.av.root.visible).map((r) => ({ r, d: Math.hypot(r.x - this.p.x, r.z - this.p.z) })).sort((a, b) => a.d - b.d);
    const atArena = Math.hypot(this.p.x - ARENA.x, this.p.z - ARENA.z) < ARENA.r + 14;
    let h = `<h2>⚔ PvP <small>${tok} 🎟 · ${st.duelWins || 0} duel wins · ${st.arenaWins || 0} arena wins</small></h2>`;
    if (!on) h += `<p class="sub">PvP and trading need other players: host or join a co-op world (👥 Co-op in ⚙ Settings or on the title screen). Everything is opt-in: duels must be accepted, the arena is a queue, and in the Fadelands only players who raise the skull can fight.</p>`;
    h += `<div class="jcols"><div><h3 class="jsec">Duel or trade</h3>
      <div class="pvrules"><label>Format <select id="pv-format"><option value="ko">First to 0</option><option value="bo3">Best of 3</option></select></label>
      <label><input type="checkbox" id="pv-norm"> Normalized stats</label><label><input type="checkbox" id="pv-nopot"> No potions</label></div>
      ${near.length ? near.map(({ r, d }) => `<div class="task"><b>${esc(r.name)}</b><small>${d.toFixed(0)} m away</small><button data-v3="duel-invite" data-arg="${esc(r.id)}" ${d > 20 ? 'disabled' : ''}>⚔ Duel</button><button data-v3="trade-req" data-arg="${esc(r.id)}" ${d > 8 ? 'disabled' : ''}>🤝 Trade</button></div>`).join('') : '<p class="sub">Nobody nearby.</p>'}
      <p class="sub">Duels use a separate health pool. Nobody loses items or hearts. Rolls dodge hits; stuns get shorter if you're hit again quickly.</p></div>
      <div><h3 class="jsec">🏟 Ashfall Arena</h3><p class="sub">3 knock-outs or 90 s. Leave the ring and it counts as a KO. Respawn after 3 s. Tokens: win 3 · draw 2 · loss 1.</p>
      <label><input type="checkbox" id="pv-anorm"> Normalized stats</label>
      ${P.queued ? `<p>In queue for <b>${P.queued.mode}</b> (${P.queued.n}/${P.queued.need})</p><button data-v3="unqueue">Leave queue</button>` : `<button data-v3="queue" data-arg="1v1" ${on && atArena ? '' : 'disabled'}>Queue 1v1</button><button data-v3="queue" data-arg="2v2" ${on && atArena ? '' : 'disabled'}>Queue 2v2</button>${atArena ? '' : '<p class="sub">Go to the Ashfall Arena (south of Ashfall Camp) to queue.</p>'}`}
      <h3 class="jsec">💀 The Fadelands</h3><p class="sub">North-east of the camp. Raise the skull to fight other flagged players. If you fall, the Fade destroys up to 3 bag stacks (never your gear or your 3 most valuable stacks).</p>
      <div class="row"><button data-v3="tab" data-arg="leaderboard">🏆 Season leaderboard</button><button data-v3="tab" data-arg="qm">🎟 Quartermaster</button></div></div></div>`;
    return h;
  },
  async lbRefresh() {
    const lb = await this.pvLb(); this.lbRows = lb ? await lb.top(20).catch(() => null) : null;
    if (this.panelKind === 'leaderboard') { const el = document.querySelector('#panel .lbwrap'); if (el) el.innerHTML = this.lbTable(); }
  },
  lbTable() {
    if (!this.lbRows) return `<p class="sub">${this.cloud?.state?.status === 'signedIn' ? 'Loading… (needs the Firestore rules from firestore.rules to be published)' : 'Sign in with Google (☁ Cloud) to see and join the season leaderboard.'}</p>`;
    if (!this.lbRows.length) return '<p class="sub">No ranked matches yet this season.</p>';
    return `<table class="mtable"><tr><th>#</th><th>Player</th><th>Rating</th><th>W</th><th>L</th><th>Matches</th></tr>${this.lbRows.map((r, i) => `<tr class="${r.uid === this.myUid() ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name || 'Player')}</td><td>${r.rating}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.matches}</td></tr>`).join('')}</table>`;
  },
  lbHtml() { return `<h2>🏆 Season ${SEASON} <small>co-op verified, friendly</small></h2><p class="sub">The host records each arena match and duel; every player confirms it before their own row updates (rating ±32 max per match). Friends could still farm wins together, so treat it as a friendly board.</p><div class="lbwrap">${this.lbTable()}</div>`; },
  boardHtml() {
    const m = this.pvp.lastBoard; if (!m) return '<h2>Scoreboard</h2><p class="sub">No match yet.</p>';
    const me = this.myUid();
    return `<h2>🏟 ${m.won ? 'Victory!' : m.draw ? 'Draw' : 'Defeat'} <small>${m.mode} · ${m.kos.join(' – ')} · ${m.why === 'time' ? 'time up' : 'KO limit'}</small></h2><table class="mtable"><tr><th>Team</th><th>Player</th><th>KOs</th><th>Deaths</th><th>Damage</th></tr>${m.board.map((r) => `<tr class="${r.id === me ? 'me' : ''}"><td class="t${r.team}">${r.team === 0 ? 'Red' : 'Blue'}</td><td>${esc(r.name)}</td><td>${r.kos}</td><td>${r.deaths}</td><td>${r.dmg}</td></tr>`).join('')}</table><p>+${m.tokens} 🎟 arena tokens</p>`;
  },
  tradeHtml() {
    const t = this.trade; if (!t) return '<h2>🤝 Trade</h2><p class="sub">No trade open. Open ⚔ PvP next to a friend and press Trade.</p>';
    const me = this.tradeMySide(), other = me === 'a' ? 'b' : 'a', mine = t.offers[me] || {}, theirs = t.offers[other] || {};
    const list = (o) => Object.entries(o).map(([k, n]) => `<li>${k === 'gold' ? '🪙' : ITEMS[k]?.icon || ''} ${n}× ${k === 'gold' ? 'coins' : esc(ITEMS[k]?.name || k)}</li>`).join('') || '<li class="sub">nothing</li>';
    const bag = Object.entries(this.s.inv).filter(([k, n]) => n > 0 && tradeable(k)).map(([k, n]) => `<button class="slot" data-v3="trade-add" data-arg="${k}" title="${esc(ITEMS[k].name)}">${ITEMS[k].icon}<small>${n - (mine[k] || 0)}</small></button>`).join('');
    const accMe = t.acc[me] === t.ver, accThem = t.acc[other] === t.ver;
    return `<h2>🤝 Trade with ${esc(t.names[other === 'a' ? 0 : 1] || 'friend')} <small>${t.state === 'escrow' ? 'completing…' : `offer v${t.ver}`}</small></h2>
      <div class="jcols"><div><h3 class="jsec">You give ${accMe ? '✅' : ''}</h3><ul>${list(mine)}</ul><button data-v3="trade-clear">Clear</button> <button data-v3="trade-gold">+100 🪙</button></div>
      <div><h3 class="jsec">You get ${accThem ? '✅' : ''}</h3><ul>${list(theirs)}</ul></div></div>
      <p class="sub">Click items to add them. Any change resets both confirmations. Quest items, tokens and cosmetics can't be traded.</p><div class="bag tradebag">${bag}</div>
      <div class="row"><button class="primary" data-v3="trade-accept" ${accMe || t.state !== 'open' ? 'disabled' : ''}>Confirm trade</button><button data-v3="trade-cancel">Cancel</button></div>`;
  },
  pvpAction(a, arg) {
    const val = (id) => document.getElementById(id);
    switch (a) {
      case 'duel-invite': this.pvpSend({ op: 'invite', to: arg, rules: { format: val('pv-format')?.value || 'ko', normalized: !!val('pv-norm')?.checked, noPotions: !!val('pv-nopot')?.checked } }); return this.closePanel();
      case 'duel-accept': if (this.pvp.invite) { this.dismount(); this.pvpSend({ op: 'accept', id: this.pvp.invite.id }); this.pvp.invite = null; } return this.closeInvite();
      case 'duel-decline': if (this.pvp.invite) this.pvpSend({ op: 'decline', id: this.pvp.invite.id }); this.pvp.invite = null; return this.closeInvite();
      case 'forfeit': return this.pvpSend({ op: 'forfeit' });
      case 'queue': this.dismount(); return this.pvpSend({ op: 'queue', mode: arg, normalized: !!val('pv-anorm')?.checked });
      case 'unqueue': return this.pvpSend({ op: 'unqueue' });
      case 'trade-req': return this.tradeSend({ op: 'req', to: arg });
      case 'trade-add': { const t = this.trade; if (!t) return; const me = this.tradeMySide(), o = { ...(t.offers[me] || {}) }; if ((o[arg] || 0) < (this.s.inv[arg] || 0)) o[arg] = (o[arg] || 0) + 1; return this.tradeOffer(o); }
      case 'trade-gold': { const t = this.trade; if (!t) return; const me = this.tradeMySide(), o = { ...(t.offers[me] || {}) }; o.gold = Math.min(this.s.gold, (o.gold || 0) + 100); return this.tradeOffer(o); }
      case 'trade-clear': return this.tradeOffer({});
      case 'trade-accept': if (this.trade) this.tradeSend({ op: 'accept', id: this.trade.id, ver: this.trade.ver }); return;
      case 'trade-cancel': if (this.trade) this.tradeSend({ op: 'cancel', id: this.trade.id }); this.trade = null; return this.closePanel();
    }
  },
};

export function installPvP(Game) {
  const P = Game.prototype, baseDie = P.die, baseEnter = P.coopEnterHost;
  Object.assign(P, PvP);
  P.die = function () { this.pvpOnDeath?.(); return baseDie.call(this); };
  P.coopEnterHost = function (m, C) { const r = baseEnter.call(this, m, C); const ids = Object.keys(this.s.escrow || {}); if (ids.length) setTimeout(() => this.tradeSend({ op: 'resume', ids }), 1500); return r; };
}
