// Test doubles for the co-op signaling + relay adapters (see coop-net.js for the contracts). They talk to a tiny
// in-memory "database" hub over a WebSocket (the test runner hosts it, see mythbound-v22-tests/e2e-coop.cjs), so separate
// browser contexts can find each other without Firebase. Used only with ?debug=1&coop=mock (or window.MB_COOP_ADAPTERS).
//   opts.blockDirect: drop ICE candidates (simulates a strict network where no direct WebRTC link can be made)
//   opts.relay: false -> relay unavailable (as when firebaseConfig.databaseURL is missing)
import { LOBBY_TTL_MS, MAX_PLAYERS } from './coop-net.js';

class Hub {
  constructor(url) {
    this.url = url; this.rid = 0; this.sid = 0; this.wait = new Map(); this.subs = new Map(); this.q = [];
    this.ws = new WebSocket(url); this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('mock hub unreachable')); });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.rid !== undefined) { const w = this.wait.get(m.rid); this.wait.delete(m.rid); w?.(m); return; }
      if (m.sid !== undefined) this.subs.get(m.sid)?.(m);
    };
  }
  async req(o) { await this.ready; const rid = ++this.rid; return new Promise((res) => { this.wait.set(rid, res); this.ws.send(JSON.stringify({ ...o, rid })); }); }
  sub(path, mode, cb) {
    const sid = ++this.sid; this.subs.set(sid, cb);
    this.ready.then(() => this.ws.send(JSON.stringify({ op: 'sub', path, mode, sid })));
    return () => { this.subs.delete(sid); this.ready.then(() => this.ws.readyState === 1 && this.ws.send(JSON.stringify({ op: 'unsub', sid }))).catch(() => {}); };
  }
}
// "bridge" hub (?coop=mock&coophub=bridge): the same in-memory database, but shared between tabs of ONE browser
// through a BroadcastChannel instead of a ws:// test server, so the mock also works on an https:// page (where a
// plain ws:// socket would be blocked as mixed content). Every tab keeps a replica; writes are broadcast in order.
class BridgeHub {
  constructor(name = 'mythbound-coop-bridge') {
    this.store = new Map(); this.subs = new Map(); this.sid = 0; this.tab = Math.random().toString(36).slice(2, 8); this.n = 0;
    this.ch = new BroadcastChannel(name);
    this.ch.onmessage = (e) => { const m = e.data; if (m.k === 'op') this.apply(m.o); else if (m.k === 'sync?') this.ch.postMessage({ k: 'sync', to: m.from, entries: [...this.store] }); else if (m.k === 'sync' && m.to === this.tab && !this.synced) { for (const [k, v] of m.entries) if (!this.store.has(k)) this.store.set(k, v); this.synced = true; } };
    this.ready = new Promise((res) => { this.ch.postMessage({ k: 'sync?', from: this.tab }); setTimeout(() => { this.synced = true; res(); }, 150); });
  }
  parent(p) { return p.slice(0, p.lastIndexOf('/')); }
  children(p) { return [...this.store.entries()].filter(([k]) => this.parent(k) === p).map(([k, val]) => ({ id: k.slice(p.length + 1), val })); }
  notify(path, added) {
    for (const s of this.subs.values()) {
      if (s.mode === 'doc' && s.path === path) s.cb({ val: this.store.get(path) ?? null });
      if (s.mode === 'col' && this.parent(path) === s.path) s.cb({ list: this.children(s.path) });
      if (s.mode === 'added' && added && this.parent(path) === s.path && this.store.has(path)) s.cb({ id: path.slice(s.path.length + 1), val: this.store.get(path) });
    }
  }
  apply(o) {
    const isNew = !this.store.has(o.path);
    if (o.op === 'set') { this.store.set(o.path, o.val); this.notify(o.path, isNew); }
    else if (o.op === 'merge') { this.store.set(o.path, { ...(this.store.get(o.path) || {}), ...o.val }); this.notify(o.path, isNew); }
    else if (o.op === 'del') { const gone = [...this.store.keys()].filter((k) => k === o.path || k.startsWith(o.path + '/')); for (const k of gone) this.store.delete(k); for (const k of gone) this.notify(k, false); }
  }
  write(o) { this.apply(o); this.ch.postMessage({ k: 'op', o }); }
  async req(o) {
    await this.ready;
    switch (o.op) {
      case 'get': return { val: this.store.get(o.path) ?? null };
      case 'set': case 'merge': case 'del': this.write(o); return {};
      case 'add': { const id = 'k' + Date.now().toString(36) + this.tab + (this.n++).toString(36); this.write({ op: 'set', path: o.path + '/' + id, val: o.val }); return { id }; }
    }
    return {};
  }
  sub(path, mode, cb) {
    const sid = ++this.sid; this.subs.set(sid, { path, mode, cb: (m) => setTimeout(() => this.subs.has(sid) && cb(m), 0) });
    this.ready.then(() => { const s = this.subs.get(sid); if (!s) return; if (mode === 'doc') s.cb({ val: this.store.get(path) ?? null }); else if (mode === 'col') s.cb({ list: this.children(path) }); else for (const c of this.children(path)) s.cb({ id: c.id, val: c.val }); });
    return () => this.subs.delete(sid);
  }
}
const hubs = new Map();
export const hubFor = (url) => { if (!hubs.has(url)) hubs.set(url, url === 'bridge' ? new BridgeHub() : new Hub(url)); return hubs.get(url); };

export function createMockCoopAdapters({ hub: url, blockDirect = false, relay: relayOn = true, latency = 0 } = {}) {
  const H = hubFor(url);
  const strip = (desc) => (blockDirect ? { type: desc.type, sdp: desc.sdp.split(/\r?\n/).filter((l) => !/^a=(candidate|end-of-candidates)/.test(l)).join('\r\n') } : desc);
  const delay = () => (latency ? new Promise((r) => setTimeout(r, latency)) : null);
  const signal = {
    kind: 'mock', calls: [],
    async createLobby({ code, hostUid, hostName }) {
      this.calls.push(['createLobby', code]);
      const ex = (await H.req({ op: 'get', path: `lobbies/${code}` })).val;
      if (ex && ex.hostUid !== hostUid) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
      const lobby = { code, hostUid, hostName, max: MAX_PLAYERS, expiresAt: Date.now() + LOBBY_TTL_MS };
      await H.req({ op: 'set', path: `lobbies/${code}`, val: lobby }); return lobby;
    },
    async getLobby(code) { await delay(); return (await H.req({ op: 'get', path: `lobbies/${code}` })).val || null; },
    async closeLobby(code) { this.calls.push(['closeLobby', code]); await H.req({ op: 'del', path: `lobbies/${code}` }); },
    async joinLobby(code, { uid, name }) { this.calls.push(['joinLobby', code, uid]); await H.req({ op: 'set', path: `lobbies/${code}/peers/${uid}`, val: { uid, name, joinedAt: Date.now() } }); },
    async leaveLobby(code, uid) { this.calls.push(['leaveLobby', code, uid]); await H.req({ op: 'del', path: `lobbies/${code}/peers/${uid}` }); },
    onPeers(code, cb) { return H.sub(`lobbies/${code}/peers`, 'col', (m) => cb(m.list.map((x) => ({ uid: x.id, name: x.val?.name || 'Guest', joinedAt: x.val?.joinedAt || 0 })))); },
    async setOffer(code, uid, desc) { this.calls.push(['setOffer', code, uid]); await H.req({ op: 'merge', path: `lobbies/${code}/peers/${uid}`, val: { offer: strip(desc) } }); },
    async setAnswer(code, uid, desc) { this.calls.push(['setAnswer', code, uid]); await H.req({ op: 'merge', path: `lobbies/${code}/peers/${uid}`, val: { answer: strip(desc) } }); },
    onOffer(code, uid, cb) { return H.sub(`lobbies/${code}/peers/${uid}`, 'doc', (m) => m.val?.offer && cb(m.val.offer)); },
    onAnswer(code, uid, cb) { return H.sub(`lobbies/${code}/peers/${uid}`, 'doc', (m) => m.val?.answer && cb(m.val.answer)); },
    async addCandidate(code, uid, side, cand) { if (blockDirect) return; await H.req({ op: 'add', path: `lobbies/${code}/peers/${uid}/${side}Candidates`, val: { cand: JSON.stringify(cand) } }); },
    onCandidates(code, uid, side, cb) { return H.sub(`lobbies/${code}/peers/${uid}/${side}Candidates`, 'added', (m) => { try { cb(JSON.parse(m.val.cand)); } catch {} }); },
  };
  const relay = {
    kind: 'mock-relay', available: !!relayOn, writes: 0,
    listen(code, me, cb) {
      return H.sub(`relay/${code}/${me}`, 'added', (m) => {
        H.req({ op: 'del', path: `relay/${code}/${me}/${m.id}` });
        let msgs; try { msgs = JSON.parse(m.val.d); } catch { return; }
        if (typeof m.val.f === 'string' && Array.isArray(msgs)) cb(m.val.f, msgs);
      });
    },
    async send(code, to, from, msgs) { if (!relayOn) throw new Error('relay unavailable'); this.writes++; await H.req({ op: 'add', path: `relay/${code}/${to}`, val: { f: from, d: JSON.stringify(msgs) } }); },
    async clear(code, me) { await H.req({ op: 'del', path: `relay/${code}/${me}` }); },
  };
  return { signal, relay };
}
