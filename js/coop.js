// Mythbound co-op session (v2.2): 2-4 players, host-authoritative, WebRTC peer-to-peer with a Realtime Database relay
// fallback. The host's browser runs the world (enemies, bosses, nodes, doors, dungeon puzzles); guests send their own
// player state and actions and render the host's snapshots. Every player keeps their own character, skills, inventory
// and save: XP and loot are worked out on each player's own device and only ever saved to that player's own save.
import {
  ENEMY_TYPES, PIECES, TELEPORTS, HEARTHSTONES, CAMP, SPAWN, DUNGEON_START, MINE_START, ENTRANCE,
  zoneAt, dungeonAt, inWorldBounds, pieceType, cellCenter, NODE_TYPES,
} from './shared.js';
import { MINE_CP } from './mine.js';
import { CHECKPOINT } from './dungeon.js';
import { makeLabel } from './world.js';
import * as UI from './ui.js';
import * as N from './coop-net.js';

export const XP_RANGE = 30;          // kill XP goes to every player within this distance of the enemy
export const REVIVE_TIME = 3;        // hold interact this long next to a downed friend
export const DOWN_TIME = 20;         // downed players respawn at a Hearthstone after this long
export const BOSS_HP_PER_PLAYER = 0.75;
export const bossScale = (n) => 1 + BOSS_HP_PER_PLAYER * (Math.max(1, Math.min(N.MAX_PLAYERS, n)) - 1);
export const EMOTES = { wave: '👋', cheer: '🎉', thumbs: '👍', help: '❗', laugh: '😄' };
export const PUZZLE_KEYS = ['lever', 'boss', 'm_switch', 'q3_cart', 'q3_bridge', 'q3_boss'];
const MAX_SPEED = 28, MAX_DMG = 30, SNAP_RADIUS = 115;
const now = () => performance.now();
const r2 = (v) => Math.round(v * 100) / 100;
const lookOf = (l = {}) => { const i = (v, n) => N.clamp(N.num(v) | 0, 0, n); return { skin: i(l.skin, 15), hair: i(l.hair, 15), hairColor: i(l.hairColor, 15), tunic: i(l.tunic, 15), sword: /^[a-z]{2,10}$/.test(l.sword) ? l.sword : 'wood' }; };
export const zoneKey = (x, z) => (zoneAt(x, z) === 'dungeon' ? dungeonAt(x) : 'ow');

export class Coop {
  constructor(game, getAdapters) {
    this.g = game; this.getAdapters = getAdapters;
    this.role = null; this.code = null; this.me = null; this.peers = new Map(); this.status = ''; this.error = '';
    this.allowBuild = false; this.hostPuzzle = null; this.hostPlot = null; this.roster = []; this.via = null;
    this.reviving = null; this.emoteLabels = new Map(); this.timers = {}; this.log = [];
    this.onChange = () => {};
  }
  note(ev, x) { this.log.push({ t: Date.now(), ev, ...(x || {}) }); if (this.log.length > 300) this.log.shift(); }
  user() { return this.g.cloud?.state?.status === 'signedIn' ? this.g.cloud.state.user : null; }
  get active() { return this.role === 'host' || (this.role === 'guest' && this.joined); }
  get isHost() { return this.role === 'host'; }
  get isGuest() { return this.role === 'guest' && this.joined; }
  get joinedPeers() { return [...this.peers.values()].filter((p) => p.joined); }
  get partySize() { return this.isHost ? 1 + this.joinedPeers.length : this.isGuest ? Math.max(2, this.roster.length) : 1; }
  setStatus(s, err = '') { this.status = s; this.error = err; this.note('status', { s, err }); this.onChange(); }
  async adapters() { if (!this.ad) this.ad = await this.getAdapters(); if (!this.ad) throw new Error('Co-op needs cloud sign-in, which is not set up on this build.'); return this.ad; }
  opt(k, d) { return this.g.coopOpts?.[k] ?? d; }

  // ============================== HOST ==============================
  async host() {
    const u = this.user(); if (!u) throw new Error('Sign in with Google to host a co-op world.');
    if (this.role) throw new Error('You are already in a co-op session.');
    if (this.g.phase !== 'play') throw new Error('Load your character first.');
    const { signal, relay } = await this.adapters();
    this.role = 'host'; this.me = u.uid; this.setStatus('Opening your world…');
    let lobby = null, code = null;
    for (let i = 0; i < 6 && !lobby; i++) {
      code = this.opt('code', null) && i === 0 ? this.opt('code') : N.makeCode();
      try { const ex = await signal.getLobby(code); if (ex && ex.expiresAt > Date.now() && ex.hostUid !== u.uid) continue; lobby = await signal.createLobby({ code, hostUid: u.uid, hostName: this.g.s.name }); }
      catch (e) { this.note('create-fail', { e: String(e?.message || e) }); }
    }
    if (!lobby) { this.role = null; this.setStatus('', 'Could not open a co-op lobby. Check your connection and try again.'); throw new Error(this.error); }
    this.code = code; this.lobby = lobby; this.seen = new Map();
    this.unsubPeers = signal.onPeers(code, (list) => this.onPeerList(list));
    if (relay.available) this.unsubRelay = relay.listen(code, u.uid, (from, msgs) => this.onRelay(from, msgs));
    this.lastPuzzle = ''; this.lastNodes = new Set(); this.lastBlocks = new Map(this.g.building.serialize().map(([k, s]) => [k, JSON.stringify(s)])); this.lastDoors = '';
    this.timers.ping = setInterval(() => this.tick(), 1000);
    this.g.onCoopChange?.(); this.setStatus('Hosting · share the code with up to 3 friends');
    UI.netBadge(`Co-op host · ${code}`, 'online');
    UI.chatLine(null, `Your world is open for co-op. Code: ${code}`, 'sys');
    return code;
  }
  onPeerList(list) {
    if (!this.isHost) return;
    for (const { uid, name, joinedAt } of list) {
      if (uid === this.me) continue;
      const key = String(joinedAt || 0), seen = this.seen.get(uid);
      if (seen === key) continue; // already handled this join attempt
      this.seen.set(uid, key);
      const old = this.peers.get(uid); if (old?.joined) continue; // still connected: ignore doc rewrites
      old?.pending?.cancel?.(); old?.link?.close('replaced');
      const peer = { uid, name: N.cleanText(name, 16) || 'Guest', joined: false, link: null, lim: N.makeLimiters(), x: 0, y: 0, z: 0, ry: 0, a: 'idle', dead: false, hp: 6, mhp: 6, ping: 0, has: false, dropped: 0 };
      this.peers.set(uid, peer);
      this.note('peer-doc', { uid });
      peer.pending = N.hostDirect(this.ad.signal, this.code, uid, { timeoutMs: this.opt('p2pTimeout', N.P2P_TIMEOUT_MS) });
      peer.pending.then((link) => { if (this.peers.get(uid) !== peer || !this.isHost) return link.close('stale'); if (peer.link?.kind === 'relay') return link.close('relay in use'); this.attach(peer, link); })
        .catch((e) => { this.note('direct-fail', { uid, e: String(e?.message || e) }); peer.directFailed = true; });
    }
  }
  onRelay(from, msgs) {
    if (!this.isHost) return;
    const peer = this.peers.get(from); if (!peer) return; // only players who joined the lobby (their uid is enforced by the database rules)
    if (!peer.link || peer.link.kind !== 'relay') {
      peer.pending?.cancel?.(); if (peer.link) { const l = peer.link; l.onclose = null; l.close('switching to relay'); }
      this.attach(peer, new N.RelayLink(this.ad.relay, this.code, this.me, from));
    }
    for (const m of msgs.slice(0, 40)) if (m && typeof m === 'object' && typeof m.t === 'string') peer.link.deliver(m);
  }
  attach(peer, link) {
    peer.link = link; this.note('link', { uid: peer.uid, kind: link.kind });
    link.onmessage = (m) => this.hostRx(peer, m);
    link.onclose = (why) => { if (peer.link === link) this.peerGone(peer, why); };
  }
  sendTo(peer, m) { peer.link?.send(m); }
  broadcast(m, except = null) { for (const p of this.joinedPeers) if (p !== except) p.link?.send(m); }
  hostRx(peer, m) {
    const L = peer.lim;
    if (!N.GUEST_LIMITS[m.t] || !L.all.take() || !L[m.t].take()) { peer.dropped++; this.note('drop', { uid: peer.uid, t: String(m.t).slice(0, 12) }); return; }
    if (!peer.joined && m.t !== 'hello' && m.t !== 'ping' && m.t !== 'bye') return;
    const g = this.g;
    switch (m.t) {
      case 'hello': return this.onHello(peer, m);
      case 'state': return this.onGuestState(peer, m);
      case 'attack': return this.onGuestAttack(peer, m);
      case 'chat': {
        const text = N.filterProfanity(N.cleanText(m.text, 200)); if (!text) return;
        const out = { t: 'chat', id: peer.uid, name: peer.name, text };
        UI.chatLine(peer.name, text, ''); g.messages.push(out); this.broadcast(out); return;
      }
      case 'emote': { const e = EMOTES[m.e] ? m.e : null; if (!e) return; this.showEmote(peer.uid, e); this.broadcast({ t: 'emote', id: peer.uid, e }, peer); return; }
      case 'gather': {
        const n = g.world.nodes.get(String(m.id || '').slice(0, 24));
        if (!n || n.depleted || peer.dead || Math.hypot(n.x - peer.x, n.z - peer.z) > 4.5) return this.sendTo(peer, { t: 'gatherFail', id: m.id });
        g.world.setNodeDepleted(n.id, true, now() + NODE_TYPES[n.type].respawn * 1000); this.lastNodes.add(n.id);
        this.sendTo(peer, { t: 'gatherOk', id: n.id }); this.broadcast({ t: 'node', id: n.id, dep: 1 }, peer); return;
      }
      case 'build': return this.onGuestBuild(peer, m);
      case 'act': return this.onGuestAct(peer, m);
      case 'revive': return this.onGuestRevive(peer, m);
      case 'ping': return this.sendTo(peer, { t: 'pong', c: N.num(m.c) });
      case 'pong': peer.ping = Math.max(0, Math.round(now() - N.num(m.c, now()))); return;
      case 'bye': return peer.link?.close('left');
    }
  }
  onHello(peer, m) {
    if (peer.joined) return;
    if (this.joinedPeers.length >= N.MAX_PLAYERS - 1) { this.sendTo(peer, { t: 'full' }); setTimeout(() => peer.link?.close('full'), 400); return; }
    const g = this.g, p = g.p;
    peer.name = N.cleanText(m.name, 16) || peer.name; peer.look = lookOf(m.look);
    peer.mhp = N.clamp(N.num(m.mhp, 6) | 0, 2, 40); peer.hp = N.clamp(N.num(m.hp, peer.mhp) | 0, 0, peer.mhp);
    const h = m.hearth; peer.hearth = h && Number.isFinite(h.x) && Number.isFinite(h.z) && inWorldBounds(h.x, h.z) ? { x: h.x, z: h.z } : null;
    // guests arrive next to the host
    const a = Math.random() * 6.28, sx = p.x + Math.sin(a) * 2.2, sz = p.z + Math.cos(a) * 2.2;
    const ok = zoneAt(sx, sz) === zoneAt(p.x, p.z) && inWorldBounds(sx, sz);
    peer.x = ok ? sx : p.x; peer.z = ok ? sz : p.z; peer.y = g.groundAt(peer.x, peer.z, 999); peer.has = true; peer.lastStateT = now(); peer.joinPos = { x: peer.x, z: peer.z };
    peer.joined = true; peer.joinedAt = Date.now();
    g.addRemote({ id: peer.uid, name: peer.name, look: peer.look, x: peer.x, y: peer.y, z: peer.z, ry: 0 });
    this.sendTo(peer, {
      t: 'welcome', id: peer.uid, host: this.me, code: this.code, you: { x: r2(peer.x), y: r2(peer.y), z: r2(peer.z) },
      players: [this.pubHost(), ...this.joinedPeers.filter((q) => q !== peer).map((q) => this.pub(q))],
      nodes: [...g.world.nodes.values()].filter((n) => n.depleted).map((n) => n.id),
      blocks: g.building.serialize(), doors: [...g.building.open], e: this.enemyRows(peer.x, peer.z), puzzle: this.puzzle(), perms: { build: this.allowBuild }, plot: g.s.home?.plot || null, max: N.MAX_PLAYERS,
    });
    this.broadcast({ t: 'join', p: this.pub(peer) }, peer);
    const sys = { t: 'chat', sys: 1, text: `${peer.name} joined your world.` }; UI.chatLine(null, sys.text, 'sys'); this.broadcast(sys, peer);
    this.applyBossScale(); this.sendRoster(); this.onChange(); g.audio.play('quest');
  }
  pub(q) { return { id: q.uid, name: q.name, look: q.look, x: r2(q.x), y: r2(q.y), z: r2(q.z), ry: r2(q.ry), a: q.a }; }
  pubHost() { const g = this.g, p = g.p; return { id: this.me, name: g.s.name, look: { ...g.s.look, sword: g.s.sword }, x: r2(p.x), y: r2(p.y), z: r2(p.z), ry: r2(p.ry), a: g.animName(), host: 1 }; }
  tpPoints(peer) {
    const g = this.g, me = g.ridge?.mineEntrance;
    const pts = [...TELEPORTS, ...HEARTHSTONES, CAMP, { x: CAMP.x + 1, z: CAMP.z + 2 }, { x: CAMP.x + 4.5, z: CAMP.z + 2.5 }, SPAWN, DUNGEON_START, MINE_START, CHECKPOINT, ...Object.values(MINE_CP), { x: ENTRANCE.x, z: ENTRANCE.z + 5 }];
    if (me) pts.push({ x: me.x - 4, z: me.z });
    if (peer.hearth) pts.push({ x: peer.hearth.x + 1.5, z: peer.hearth.z + 1.5 });
    if (peer.joinPos) pts.push(peer.joinPos);
    pts.push({ x: g.p.x, z: g.p.z }); for (const q of this.joinedPeers) if (q !== peer) pts.push({ x: q.x, z: q.z });
    return pts;
  }
  onGuestState(peer, m) {
    const x = N.num(m.x, NaN), y = N.num(m.y, NaN), z = N.num(m.z, NaN), t = now();
    const dt = Math.max(0.05, (t - (peer.lastStateT || t)) / 1000);
    let ok = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Math.abs(y) < 200 && inWorldBounds(x, z);
    const dist = ok ? Math.hypot(x - peer.x, z - peer.z) : 0;
    if (ok && peer.has && dist > MAX_SPEED * dt + 3) {
      ok = !!m.tp && this.tpPoints(peer).some((q) => Math.hypot(q.x - x, q.z - z) < 7) && (!peer.tpT || t - peer.tpT > 1500);
      if (ok) peer.tpT = t;
    }
    if (!ok) {
      peer.rejects = (peer.rejects || 0) + 1; this.note('reject-pos', { uid: peer.uid, x, z });
      if (!peer.corrT || t - peer.corrT > 500) { peer.corrT = t; this.sendTo(peer, { t: 'correct', x: peer.x, y: peer.y, z: peer.z }); }
      peer.lastStateT = t; return;
    }
    peer.x = x; peer.y = y; peer.z = z; peer.ry = N.num(m.ry); peer.a = N.cleanText(m.a, 12) || 'idle'; peer.dead = !!m.dead; peer.lastStateT = t; peer.has = true;
    peer.mhp = N.clamp(N.num(m.mhp, peer.mhp) | 0, 2, 40); peer.hp = N.clamp(N.num(m.hp, peer.hp) | 0, 0, peer.mhp);
    if (typeof m.sword === 'string' && /^[a-z]{2,10}$/.test(m.sword) && peer.look && m.sword !== peer.look.sword) { peer.look.sword = m.sword; const r = this.g.remotes.get(peer.uid); r?.av.setSword?.(m.sword); this.broadcast({ t: 'look', id: peer.uid, look: peer.look }, peer); }
    this.g.remoteSample(peer.uid, x, y, z, peer.ry, peer.a, peer.dead);
  }
  onGuestAttack(peer, m) {
    const g = this.g, id = typeof m.id === 'string' ? m.id.slice(0, 24) : '';
    const sim = g.simFor(id), e = sim?.enemies.get(id);
    if (!e || !e.alive || peer.dead) return;
    const T = ENEMY_TYPES[e.type], skill = ['combat', 'archery', 'magic'].includes(m.kind) ? m.kind : 'combat', bomb = !!m.bomb;
    if (zoneKey(peer.x, peer.z) !== zoneKey(e.x, e.z)) return;
    const reach = bomb ? 16 : skill === 'combat' ? 3.8 + T.radius + 2.2 : 32;
    if (Math.hypot(e.x - peer.x, e.z - peer.z) > reach) { this.note('reject-attack', { uid: peer.uid, id }); return; }
    const dmg = N.clamp(Math.round(N.num(m.dmg, 1)), 1, bomb ? 3 : MAX_DMG);
    const r = sim.damage(id, dmg, peer.x, peer.z, { bomb, mouth: bomb && !!m.mouth });
    if (!r.ok) return;
    g.onEnemyDamaged(id, r, !!r.killed && this.nearMe(e), 'combat', peer.uid);
  }
  nearMe(e) { const p = this.g.p; return zoneKey(p.x, p.z) === zoneKey(e.x, e.z) && Math.hypot(e.x - p.x, e.z - p.z) < XP_RANGE; }
  // called by game.onEnemyDamaged on the host for every result (host hits and guest hits)
  hostEnemyResult(id, r, by, e) {
    if (!this.isHost || !this.joinedPeers.length) return;
    const ex = e?.x ?? 0, ez = e?.z ?? 0;
    this.broadcast({ t: 'ehit', id, hp: r.hp, max: e?.max, blocked: r.blocked ? 1 : 0, killed: r.killed ? 1 : 0, flipped: r.flipped ? 1 : 0, stunned: r.stunned ? 1 : 0, by, x: r2(ex), z: r2(ez), type: e?.type });
  }
  onGuestBuild(peer, m) {
    const g = this.g, fail = (reason) => this.sendTo(peer, { t: 'buildFail', reason });
    if (!this.allowBuild) return fail('The host has not allowed building in this world.');
    if (!g.s.home?.plot) return fail('The host has no home plot to build on.');
    const gx = N.num(m.gx, NaN), gz = N.num(m.gz, NaN); if (!Number.isInteger(gx) || !Number.isInteger(gz)) return;
    const type = pieceType(String(m.m || '')), rot = N.clamp(N.num(+String(m.m || '').split('@')[1] || 0) | 0, 0, 3);
    if (!PIECES[type]) return fail('Unknown piece.');
    if (!g.inPlot(gx, gz)) return fail("You can only build on the host's home plot.");
    const [cx, cz] = cellCenter(gx, gz); if (Math.hypot(cx - peer.x, cz - peer.z) > 8.5) return fail('Too far away.');
    const reason = g.pieceRefusal(gx, gz, type); if (reason) return fail(reason);
    if (type === 'hearth') return fail("Only the host can place a Hearthstone on their plot.");
    const k = gx + ',' + gz, entry = rot ? `${type}@${rot}` : type, s = [...(g.building.stacks.get(k) || []), entry];
    g.building.setStack(k, s); this.lastBlocks.set(k, JSON.stringify(s));
    const msg = { t: 'blocks', k, s, by: peer.uid }; this.sendTo(peer, msg); this.broadcast(msg, peer);
  }
  onGuestAct(peer, m) {
    const g = this.g, d = (o) => (o ? Math.hypot(o.x - peer.x, o.z - peer.z) : 99);
    if (peer.dead) return;
    const zk = zoneKey(peer.x, peer.z);
    if (m.k === 'lever' && zk === 'barrow' && !g.dungeon.lever.pulled && d(g.dungeon.lever) < 3) { g.interact({ kind: 'lever' }); UI.toast(`${peer.name} pulled the lever.`, ''); }
    else if (m.k === 'mswitch' && zk === 'mine' && d(g.mine.sw) < 3) g.mineInteract({ kind: 'mswitch' });
    else if (m.k === 'mcart' && zk === 'mine' && d(g.mine.cart) < 3.4 && !g.mine.cart.moving && !g.mine.cart.done) g.mineInteract({ kind: 'mcart' });
    else if (m.k === 'door' && zk === 'ow') {
      const k = String(m.key || '').slice(0, 16), i = N.num(m.i, -1) | 0, st = g.building.stacks.get(k);
      if (!st || pieceType(st[i] || '') !== 'door') return;
      const [gx, gz] = k.split(',').map(Number), [cx, cz] = cellCenter(gx, gz); if (Math.hypot(cx - peer.x, cz - peer.z) > 3.5) return;
      g.building.toggleDoor(k, i); g.audio.play('door');
    } else this.note('reject-act', { uid: peer.uid, k: String(m.k).slice(0, 12) });
    this.tick(true);
  }
  onCartPushed() { if (this.isHost) this.broadcast({ t: 'cart' }); }
  onGuestRevive(peer, m) {
    const target = String(m.id || ''), t = now();
    const tp = target === this.me ? { x: this.g.p.x, z: this.g.p.z, dead: this.g.p.mode === 'dead' } : this.peers.get(target);
    if (!tp || !tp.dead || peer.dead || Math.hypot(tp.x - peer.x, tp.z - peer.z) > 3.6) { peer.revive = null; return; }
    if (m.ph === 'start') { peer.revive = { target, t }; return; }
    if (m.ph !== 'done' || !peer.revive || peer.revive.target !== target || t - peer.revive.t < REVIVE_TIME * 900) { this.note('reject-revive', { uid: peer.uid }); return; }
    peer.revive = null;
    if (target === this.me) this.g.coopRevived(peer.name);
    else { this.sendTo(tp, { t: 'revived', by: peer.name }); tp.dead = false; }
    this.broadcast({ t: 'chat', sys: 1, text: `${peer.name} revived ${target === this.me ? this.g.s.name : tp.name}!` });
  }
  peerGone(peer, why) {
    if (this.peers.get(peer.uid) !== peer) return;
    this.peers.delete(peer.uid); peer.pending?.cancel?.();
    this.note('peer-gone', { uid: peer.uid, why });
    if (!peer.joined) return;
    this.g.removeRemote(peer.uid); this.clearEmote(peer.uid);
    this.broadcast({ t: 'leave', id: peer.uid });
    const sys = { t: 'chat', sys: 1, text: `${peer.name} left your world.` }; UI.chatLine(null, sys.text, 'sys'); this.broadcast(sys);
    if (this.reviving?.id === peer.uid) this.reviving = null;
    this.applyBossScale(); this.sendRoster(); this.onChange();
  }
  setAllowBuild(on) { this.allowBuild = !!on; if (this.isHost) { this.broadcast({ t: 'perms', build: this.allowBuild }); UI.toast(on ? 'Friends can now build on your home plot.' : 'Building by friends is off.', ''); } this.onChange(); }
  puzzle() { const f = this.g.s.flags, o = {}; for (const k of PUZZLE_KEYS) o[k] = !!f[k]; return o; }
  applyBossScale() {
    const k = this.isHost ? bossScale(this.partySize) : 1, g = this.g;
    for (const sim of [g.localSim, g.dsim, g.msim]) {
      if (!sim) continue; sim.bossScale = k;
      for (const e of sim.enemies.values()) {
        const T = ENEMY_TYPES[e.type]; if (!T.boss) continue;
        const max = Math.round(T.hp * k); if (max === e.max) continue;
        if (e.alive) e.hp = Math.max(1, Math.round(e.hp * max / e.max)); e.max = max;
      }
    }
  }
  enemyRows(x, z) {
    const g = this.g, zk = zoneKey(x, z), sim = zk === 'barrow' ? g.dsim : zk === 'mine' ? g.msim : g.localSim, out = [];
    for (const e of sim.enemies.values()) if (Math.abs(e.x - x) + Math.abs(e.z - z) < SNAP_RADIUS * 1.4 && Math.hypot(e.x - x, e.z - z) < SNAP_RADIUS) out.push([e.id, r2(e.x), r2(e.z), r2(e.ry), e.state, r2(e.st), e.hp, e.alive ? 1 : 0, e.kind, e.atk, e.max, e.type]);
    return out;
  }
  projRows(x, z) { const g = this.g, zk = zoneKey(x, z), sim = zk === 'mine' ? g.msim : zk === 'ow' ? g.localSim : null; return sim ? sim.proj.filter((q) => Math.hypot(q.x - x, q.z - z) < 60).map((q) => [q.n + ':' + q.id, r2(q.x), r2(q.z)]) : []; }
  // enemy events from the host's sims, tagged with the zone they happened in
  hostEvents(list) {
    if (!this.isHost || !list.length) return;
    for (const peer of this.joinedPeers) {
      const zk = zoneKey(peer.x, peer.z), ev = list.filter((e) => e.zn === zk && (e.t !== 'hit' || Math.hypot(e.x - peer.x, e.z - peer.z) < 30));
      if (ev.length) this.sendTo(peer, { t: 'ev', ev });
    }
  }
  sendRoster() {
    if (!this.isHost) return;
    const list = [{ id: this.me, name: this.g.s.name, host: 1, ping: 0, hp: this.g.p.hp, mhp: this.g.maxHp, dead: this.g.p.mode === 'dead' ? 1 : 0, via: 'host' }, ...this.joinedPeers.map((q) => ({ id: q.uid, name: q.name, ping: q.ping, hp: q.hp, mhp: q.mhp, dead: q.dead ? 1 : 0, via: q.link?.kind }))];
    this.roster = list; this.broadcast({ t: 'roster', list, build: this.allowBuild });
  }
  // host: snapshots at 12 Hz (direct) / 4 Hz (relay); guest: player state at the same rates
  update(dt) {
    const g = this.g;
    if (this.isHost && this.joinedPeers.length) {
      const t = now();
      for (const peer of this.joinedPeers) {
        const iv = 1000 / N.SNAP_HZ[peer.link?.kind === 'relay' ? 'relay' : 'p2p'];
        if (t - (peer.snapT || 0) < iv) continue; peer.snapT = t;
        const p = g.p, rows = [[this.me, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), g.animName(), p.mode === 'dead' ? 1 : 0, p.hp, g.maxHp]];
        for (const q of this.joinedPeers) if (q !== peer) rows.push([q.uid, r2(q.x), r2(q.y), r2(q.z), r2(q.ry), q.a, q.dead ? 1 : 0, q.hp, q.mhp]);
        this.sendTo(peer, { t: 'snap', p: rows, e: this.enemyRows(peer.x, peer.z), pr: this.projRows(peer.x, peer.z) });
      }
    }
    this.updateRevive(dt); this.updateEmotes(dt);
  }
  // 1 Hz housekeeping: pings, roster, world diffs (puzzle flags, nodes, blocks, doors), stale links
  tick(fast = false) {
    const g = this.g, t = now();
    if (this.isHost) {
      const pz = JSON.stringify(this.puzzle()); if (pz !== this.lastPuzzle) { this.lastPuzzle = pz; this.broadcast({ t: 'puzzle', f: JSON.parse(pz) }); }
      const dep = new Set([...g.world.nodes.values()].filter((n) => n.depleted).map((n) => n.id));
      for (const id of dep) if (!this.lastNodes.has(id)) this.broadcast({ t: 'node', id, dep: 1 });
      for (const id of this.lastNodes) if (!dep.has(id)) this.broadcast({ t: 'node', id, dep: 0 });
      this.lastNodes = dep;
      const cur = new Map(g.building.serialize().map(([k, s]) => [k, JSON.stringify(s)]));
      for (const [k, s] of cur) if (this.lastBlocks.get(k) !== s) this.broadcast({ t: 'blocks', k, s: JSON.parse(s), by: this.me });
      for (const k of this.lastBlocks.keys()) if (!cur.has(k)) this.broadcast({ t: 'blocks', k, s: [], by: this.me });
      this.lastBlocks = cur;
      const doors = JSON.stringify([...g.building.open].sort()); if (doors !== this.lastDoors) { this.lastDoors = doors; this.broadcast({ t: 'doors', open: JSON.parse(doors) }); }
      if (fast) return;
      for (const peer of [...this.peers.values()]) {
        if (!peer.link) continue;
        if (t - peer.link.lastRx > N.STALE_MS[peer.link.kind]) { peer.link.close('timeout'); continue; }
        if (peer.joined) this.sendTo(peer, { t: 'ping', c: t });
      }
      if (this.lobby && Date.now() > this.lobby.expiresAt && !this.expiredNoted) { this.expiredNoted = true; UI.chatLine(null, 'Your co-op invite code has expired (2 hours). Friends already here can stay; host again for a new code.', 'sys'); }
      this.sendRoster(); this.onChange();
    } else if (this.role === 'guest' && this.link) {
      if (fast) return;
      if (t - this.link.lastRx > N.STALE_MS[this.link.kind]) { this.link.close('timeout'); return; }
      this.toHost({ t: 'ping', c: t }); this.onChange();
    }
  }

  // ============================== GUEST ==============================
  async join(raw) {
    const u = this.user(); if (!u) throw new Error('Sign in with Google to join a co-op world.');
    if (this.role) throw new Error('You are already in a co-op session.');
    if (this.g.phase !== 'play') throw new Error('Load your character first.');
    const code = N.normCode(raw); if (!N.validCode(code)) throw new Error('Codes are 6 letters and numbers, like K7Q2MX.');
    const { signal, relay } = await this.adapters();
    this.role = 'guest'; this.joined = false; this.me = u.uid; this.code = code; this.setStatus('Looking for that world…');
    let lobby;
    try { lobby = await signal.getLobby(code); } catch (e) { this.note('lobby-read-fail', { e: String(e?.message || e) }); }
    const fail = (msg) => { this.role = null; this.code = null; this.setStatus('', msg); throw new Error(msg); };
    if (!lobby) return fail('No world found with that code.');
    if (!(lobby.expiresAt > Date.now())) return fail('That invite has expired. Ask your friend to host again.');
    if (lobby.hostUid === u.uid) return fail('That is your own world (you are signed in as the host).');
    this.lobby = lobby; this.hostUid = lobby.hostUid;
    try { await signal.joinLobby(code, { uid: u.uid, name: this.g.s.name }); } catch (e) { return fail('Could not join that world (' + (e?.code || e?.message || 'error') + ').'); }
    this.setStatus(`Connecting to ${lobby.hostName || 'the host'}…`);
    let link = null;
    this.pending = N.guestDirect(signal, code, u.uid, { timeoutMs: this.opt('p2pTimeout', N.P2P_TIMEOUT_MS) });
    try { link = await this.pending; }
    catch (e) {
      this.note('direct-fail', { e: String(e?.message || e) });
      if (this.role !== 'guest') return;
      if (!relay.available) { signal.leaveLobby(code, u.uid).catch(() => {}); return fail("Couldn't connect directly, try another network."); }
      this.setStatus('A direct link is blocked on this network. Connecting through the relay…');
      link = new N.RelayLink(relay, code, u.uid, lobby.hostUid);
      this.unsubRelay = relay.listen(code, u.uid, (from, msgs) => { if (from === lobby.hostUid) for (const m of msgs.slice(0, 60)) if (m && typeof m.t === 'string') link.deliver(m); });
    }
    if (this.role !== 'guest') { link.close('cancelled'); return; }
    this.link = link; this.via = link.kind;
    link.onmessage = (m) => this.guestRx(m);
    link.onclose = (why) => { if (this.link === link) this.hostGone(why === 'left' ? 'You left the co-op world.' : 'Lost connection to the host.'); };
    const hello = () => link.send({ t: 'hello', name: this.g.s.name, look: { ...this.g.s.look, sword: this.g.s.sword }, hp: this.g.p.hp, mhp: this.g.maxHp, hearth: this.g.s.home?.hearth || null });
    hello(); let tries = 0;
    await new Promise((res) => {
      this.helloDone = res;
      this.timers.hello = setInterval(() => {
        if (this.joined || this.role !== 'guest') { clearInterval(this.timers.hello); return res(); }
        if (++tries > 7) { clearInterval(this.timers.hello); this.leave(true); this.setStatus('', 'The host did not answer. Check the code and try again.'); return res(); }
        hello();
      }, 2000);
    });
    if (!this.joined) throw new Error(this.error || 'Could not join.');
    return code;
  }
  toHost(m) { this.link?.send(m); }
  guestRx(m) {
    const g = this.g;
    switch (m.t) {
      case 'welcome': if (this.joined) return; this.joined = true; clearInterval(this.timers.hello); this.helloDone?.(); this.timers.ping = setInterval(() => this.tick(), 1000); g.coopEnterHost(m, this); this.setStatus(`Playing in ${this.lobby.hostName || 'a friend'}'s world · ${this.via === 'relay' ? 'via relay' : 'direct link'}`); return;
      case 'full': this.setStatus('', `That world is full (${N.MAX_PLAYERS} players).`); return this.leave(true);
      case 'pong': this.ping = Math.max(0, Math.round(now() - N.num(m.c, now()))); return;
      case 'ping': return this.toHost({ t: 'pong', c: N.num(m.c) });
      case 'end': return this.hostGone(`${this.lobby?.hostName || 'The host'} closed their world.`);
    }
    if (!this.joined) return;
    switch (m.t) {
      case 'snap': {
        for (const row of m.p || []) { const [id, x, y, z, ry, a, dead, hp, mhp] = row; if (id === this.me) continue; g.remoteSample(id, x, y, z, ry, a, !!dead); const r = this.roster.find((q) => q.id === id); if (r) { r.hp = hp; r.mhp = mhp; r.dead = dead; } }
        g.applyEnemySnap(m.e || []); g.netProj = m.pr || []; return;
      }
      case 'join': if (m.p?.id !== this.me) g.addRemote({ ...m.p, look: lookOf(m.p.look), name: N.cleanText(m.p.name, 16) }); return;
      case 'leave': g.removeRemote(m.id); this.clearEmote(m.id); return;
      case 'look': { const r = g.remotes.get(m.id); r?.av.setSword?.(lookOf(m.look).sword); return; }
      case 'ev': { const zk = zoneKey(g.p.x, g.p.z); for (const e of m.ev || []) if (e.zn === zk) g.handleEnemyEvent(e); return; }
      case 'ehit': return g.coopEnemyHit(m);
      case 'node': { const n = g.world.nodes.get(m.id); if (n) g.world.setNodeDepleted(m.id, !!m.dep); return; }
      case 'gatherOk': return g.rewardGather(g.world.nodes.get(m.id));
      case 'gatherFail': return UI.toast('Someone got there first.', 'bad');
      case 'blocks': if (typeof m.k === 'string' && Array.isArray(m.s)) g.onBlocks(m); return;
      case 'buildFail': UI.toast(N.cleanText(m.reason, 120), 'bad'); g.lastBuild = { ok: false, reason: m.reason }; return;
      case 'doors': { const want = new Set((m.open || []).map(String)); for (const key of [...g.building.open]) if (!want.has(key)) { const [k, i] = key.split('#'); g.building.toggleDoor(k, +i); } for (const key of want) if (!g.building.open.has(key)) { const [k, i] = key.split('#'); if (g.building.stacks.get(k)) g.building.toggleDoor(k, +i); } return; }
      case 'puzzle': this.hostPuzzle = m.f || {}; g.applyWorldState(); return;
      case 'cart': if (g.mine && !g.mine.cart.moving) g.mine.pushCart(); return;
      case 'chat': { const text = N.filterProfanity(N.cleanText(m.text, 200)); UI.chatLine(m.sys ? null : N.cleanText(m.name, 16), text, m.sys ? 'sys' : m.id === this.me ? 'me' : ''); g.messages.push({ ...m, text }); return; }
      case 'emote': if (EMOTES[m.e]) this.showEmote(m.id, m.e); return;
      case 'correct': g.p.x = N.num(m.x, g.p.x); g.p.y = N.num(m.y, g.p.y); g.p.z = N.num(m.z, g.p.z); g.p.vy = 0; return;
      case 'revived': return g.coopRevived(N.cleanText(m.by, 16));
      case 'roster': {
        const prev = new Map(this.roster.map((r) => [r.id, r]));
        this.roster = (m.list || []).slice(0, N.MAX_PLAYERS).map((r) => ({ ...prev.get(r.id), ...r, name: N.cleanText(r.name, 16) }));
        if (!!m.build !== this.allowBuild) { this.allowBuild = !!m.build; } this.onChange(); return;
      }
      case 'perms': this.allowBuild = !!m.build; UI.toast(this.allowBuild ? 'The host lets you build on their home plot.' : 'The host turned off building for friends.', ''); if (!this.allowBuild && g.buildMode) g.toggleBuild(); this.onChange(); return;
    }
  }
  // guest: the host left / the link dropped -> back to your own world, progress saved
  hostGone(msg) {
    if (this.role !== 'guest') return;
    const wasJoined = this.joined;
    this.cleanupGuest();
    if (wasJoined) this.g.coopReturnHome(msg);
    this.setStatus('', wasJoined ? '' : msg);
  }
  cleanupGuest() {
    clearInterval(this.timers.hello); clearInterval(this.timers.ping); const hd = this.helloDone; this.helloDone = null; setTimeout(() => hd?.(), 0);
    this.pending?.cancel?.(); try { this.unsubRelay?.(); } catch {}
    const link = this.link; this.link = null; if (link) { link.onclose = null; link.close('left'); }
    const code = this.code, me = this.me;
    if (code && this.ad) { this.ad.signal.leaveLobby(code, me).catch(() => {}); if (this.ad.relay.available) this.ad.relay.clear(code, me).catch(() => {}); }
    for (const id of [...this.emoteLabels.keys()]) this.clearEmote(id);
    this.role = null; this.joined = false; this.code = null; this.roster = []; this.hostPuzzle = null; this.hostPlot = null; this.allowBuild = false; this.reviving = null; this.via = null;
  }
  // leave (guest) or end (host) the session
  leave(silent = false) {
    if (this.role === 'guest') {
      const wasJoined = this.joined;
      try { this.link?.send({ t: 'bye' }); if (this.link?.kind === 'relay') this.link.flush(); } catch {}
      this.cleanupGuest();
      if (wasJoined) this.g.coopReturnHome('You left the co-op world. Back in your own world.');
      if (!silent) this.setStatus(''); else this.onChange();
    } else if (this.role === 'host') this.end();
  }
  end() {
    if (this.role !== 'host') return;
    this.broadcast({ t: 'end' });
    for (const p of this.peers.values()) { if (p.link?.kind === 'relay') p.link.flush(); }
    const peers = [...this.peers.values()]; this.peers.clear();
    setTimeout(() => { for (const p of peers) { p.pending?.cancel?.(); if (p.link) { p.link.onclose = null; p.link.close('host ended'); } } }, 300);
    for (const p of peers) if (p.joined) this.g.removeRemote(p.uid);
    try { this.unsubPeers?.(); } catch {} try { this.unsubRelay?.(); } catch {}
    clearInterval(this.timers.ping);
    const code = this.code;
    if (this.ad) { this.ad.signal.closeLobby(code).catch(() => {}); if (this.ad.relay.available) this.ad.relay.clear(code, this.me).catch(() => {}); }
    for (const id of [...this.emoteLabels.keys()]) this.clearEmote(id);
    this.role = null; this.code = null; this.lobby = null; this.roster = []; this.reviving = null;
    this.applyBossScale();
    UI.netBadge('Solo · offline', 'offline'); UI.chatLine(null, 'Co-op ended. Your world is private again.', 'sys');
    this.setStatus('');
    this.g.onCoopChange?.();
  }

  // ============================== shared: chat, emotes, revive ==============================
  chat(text) {
    const g = this.g, t = N.cleanText(text, 200); if (!t) return;
    const em = t.match(/^\/(wave|cheer|thumbs|help|laugh)\b/i); if (em) return this.emote(em[1].toLowerCase());
    if (this.isHost) { const out = { t: 'chat', id: this.me, name: g.s.name, text: N.filterProfanity(t) }; UI.chatLine(g.s.name, out.text, 'me'); g.messages.push(out); this.broadcast(out); }
    else if (this.isGuest) { if (!this.chatLim) this.chatLim = new N.RateLimiter(1, 5); if (!this.chatLim.take()) return UI.chatLine(null, 'You are sending messages too quickly.', 'sys'); this.toHost({ t: 'chat', text: t }); }
  }
  emote(e) {
    if (!EMOTES[e] || !this.active) return;
    if (this.emoteT && now() - this.emoteT < 900) return; this.emoteT = now();
    this.showEmote(this.me, e); this.g.animOverride = { name: e === 'wave' || e === 'help' ? 'wave' : 'cheer', t: 1.4 };
    if (this.isHost) this.broadcast({ t: 'emote', id: this.me, e }); else this.toHost({ t: 'emote', e });
  }
  showEmote(id, e) {
    const g = this.g; this.clearEmote(id);
    const who = id === this.me ? g.s.name : g.remotes.get(id)?.name || 'Someone';
    const s = makeLabel(EMOTES[e], '#fff', 1.4); g.scene.add(s); this.emoteLabels.set(id, { s, t: 2.6 });
    const r = g.remotes.get(id); if (r) r.emote = { name: e === 'wave' || e === 'help' ? 'wave' : 'cheer', t: 1.4 };
    UI.chatLine(null, `${who} ${{ wave: 'waves', cheer: 'cheers', thumbs: 'gives a thumbs up', help: 'calls for help!', laugh: 'laughs' }[e]} ${EMOTES[e]}`, 'sys emote');
    g.messages.push({ t: 'emote', id, e });
  }
  clearEmote(id) { const l = this.emoteLabels.get(id); if (l) { this.g.scene.remove(l.s); l.s.material.map?.dispose(); l.s.material.dispose(); this.emoteLabels.delete(id); } }
  updateEmotes(dt) {
    for (const [id, l] of this.emoteLabels) {
      l.t -= dt; if (l.t <= 0) { this.clearEmote(id); continue; }
      const o = id === this.me ? this.g.p : this.g.remotes.get(id); if (!o) { this.clearEmote(id); continue; }
      l.s.position.set(o.x, o.y + 3.2 + Math.sin(l.t * 4) * 0.08, o.z);
    }
  }
  startRevive(id) {
    const r = this.g.remotes.get(id); if (!r || !r.dead) return;
    this.reviving = { id, t: 0 }; if (this.isGuest) this.toHost({ t: 'revive', id, ph: 'start' });
  }
  updateRevive(dt) {
    const R = this.reviving; if (!R) return;
    const g = this.g, r = g.remotes.get(R.id), p = g.p;
    if (!r || !r.dead || p.mode === 'dead' || !g.input.isDown('interact') || Math.hypot(r.x - p.x, r.z - p.z) > 3.2) { this.reviving = null; return; }
    R.t += dt; g.reviveProgress = R.t / REVIVE_TIME;
    if (R.t < REVIVE_TIME) return;
    this.reviving = null; g.reviveProgress = 0;
    if (this.isHost) { const peer = this.peers.get(R.id); if (peer?.dead) { this.sendTo(peer, { t: 'revived', by: g.s.name }); peer.dead = false; r.dead = false; const sys = { t: 'chat', sys: 1, text: `${g.s.name} revived ${peer.name}!` }; UI.chatLine(null, sys.text, 'sys'); this.broadcast(sys); } }
    else this.toHost({ t: 'revive', id: R.id, ph: 'done' });
    g.audio.play('heal');
  }
}
