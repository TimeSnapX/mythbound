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
const hubs = new Map();
const hubFor = (url) => { if (!hubs.has(url)) hubs.set(url, new Hub(url)); return hubs.get(url); };

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
