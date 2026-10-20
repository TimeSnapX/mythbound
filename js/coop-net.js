// Mythbound co-op networking primitives (v2.2): join codes, profanity filter, rate limits, message validation helpers and
// the two transports a co-op link can run on. No game or DOM code here, and no Firebase code: signaling and the relay are
// adapters (see coop-firebase.js for the real ones and coop-mock.js for the test ones).
//
// Signaling adapter contract (host = the player whose browser runs the world):
//   createLobby({ code, hostUid, hostName }) -> Promise<lobby>   lobby = { code, hostUid, hostName, expiresAt(ms), max }
//   getLobby(code) -> Promise<lobby | null>          closeLobby(code) -> Promise
//   joinLobby(code, { uid, name }) -> Promise        leaveLobby(code, uid) -> Promise
//   onPeers(code, cb([{ uid, name }])) -> unsubscribe                       (host)
//   setOffer(code, uid, desc) / onOffer(code, uid, cb(desc)) -> unsubscribe  (host writes, guest reads)
//   setAnswer(code, uid, desc) / onAnswer(code, uid, cb(desc)) -> unsubscribe (guest writes, host reads)
//   addCandidate(code, uid, side 'host'|'guest', cand) / onCandidates(code, uid, side, cb(cand)) -> unsubscribe
// Relay adapter contract (fallback when a direct WebRTC link can't be made; low rate, batched):
//   available: boolean (false = no Realtime Database configured -> "Couldn't connect directly, try another network")
//   listen(code, myUid, cb(fromUid, msgs[])) -> unsubscribe   (reads and deletes the messages queued for me)
//   send(code, toUid, fromUid, msgs[]) -> Promise              clear(code, myUid) -> Promise
export const MAX_PLAYERS = 4;
export const LOBBY_TTL_MS = 2 * 60 * 60 * 1000;     // lobbies expire after 2 hours (expiresAt, checked by the client)
export const P2P_TIMEOUT_MS = 12000;                // no open data channel by then -> try the relay
export const RELAY_FLUSH_MS = 250;                  // relay: at most 4 batched writes per second per link
export const SNAP_HZ = { p2p: 12, relay: 4 };       // host -> guest snapshots
export const STATE_HZ = { p2p: 12, relay: 4 };      // guest -> host player state
export const STALE_MS = { p2p: 9000, relay: 16000 }; // no message for this long -> the link is treated as gone
export const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] }];
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const MAX_MSG_CHARS = 16000;

export function makeCode(rand = Math.random) { let s = ''; for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length]; return s; }
// accepts "abc-123", "ABC123" or a whole invite link (...?join=ABC123)
export function normCode(s) {
  s = String(s || '').trim(); const m = s.match(/[?&]join=([A-Za-z0-9-]+)/); if (m) s = m[1];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
export const validCode = (c) => CODE_RE.test(c);
export function inviteLink(code, loc = (typeof location !== 'undefined' ? location : null)) {
  const base = loc ? loc.origin + loc.pathname : 'https://timesnapx.github.io/mythbound/';
  return base + '?join=' + code;
}

// ---- light profanity filter (whole-word or word-start matches only, replaced with ***) ----
const PREFIX = ['fuck', 'fuk', 'shit', 'cunt', 'bitch', 'wank', 'twat', 'nigg', 'fagg', 'whore', 'slut', 'bastard', 'asshole', 'arsehole', 'motherf', 'dickhead', 'bollock'];
const EXACT = ['dick', 'dicks', 'piss', 'pissed', 'fag', 'fags', 'ass', 'arse', 'cock', 'cocks', 'prick', 'pricks', 'retard', 'retards'];
const PROF_RE = new RegExp(`\\b(?:(?:${PREFIX.join('|')})[a-z]*|(?:${EXACT.join('|')}))\\b`, 'gi');
export function filterProfanity(text) {
  return String(text).replace(PROF_RE, (w) => w[0] + '*'.repeat(Math.max(2, w.length - 1)));
}
export const cleanText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// token bucket: rate per second, burst capacity
export class RateLimiter {
  constructor(rate, burst, now = () => performance.now()) { this.rate = rate; this.burst = burst; this.tokens = burst; this.now = now; this.t = now(); this.dropped = 0; }
  take(n = 1) {
    const t = this.now(); this.tokens = Math.min(this.burst, this.tokens + ((t - this.t) / 1000) * this.rate); this.t = t;
    if (this.tokens >= n) { this.tokens -= n; return true; }
    this.dropped++; return false;
  }
}
// per-message-type limits for guest -> host traffic (anything else is dropped)
export const GUEST_LIMITS = {
  hello: [0.2, 2], state: [30, 40], attack: [8, 12], chat: [1.2, 6], emote: [1, 3], gather: [3, 5], build: [4, 6], act: [2, 4],
  revive: [2, 4], ping: [2, 4], pong: [2, 4], bye: [1, 2], pvp: [12, 16], trade: [4, 8],
};
export function makeLimiters(now) { const o = { all: new RateLimiter(70, 90, now) }; for (const [k, [r, b]] of Object.entries(GUEST_LIMITS)) o[k] = new RateLimiter(r, b, now); return o; }
export function parseMsg(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MSG_CHARS) return null;
  let m; try { m = JSON.parse(raw); } catch { return null; }
  return m && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string' ? m : null;
}

// ---- transports: a link carries JSON messages between the host and one guest ----
class BaseLink {
  constructor(kind) { this.kind = kind; this.onmessage = null; this.onclose = null; this.closed = false; this.lastRx = performance.now(); this.rx = 0; this.tx = 0; }
  deliver(m) { if (this.closed) return; this.lastRx = performance.now(); this.rx++; this.onmessage?.(m); }
  close(why = 'closed') { if (this.closed) return; this.closed = true; this.dispose?.(); this.onclose?.(why); }
}
// direct WebRTC data channel
export class ChannelLink extends BaseLink {
  constructor(pc, dc) {
    super('p2p'); this.pc = pc; this.dc = dc;
    dc.onmessage = (e) => { const m = parseMsg(e.data); if (m) this.deliver(m); };
    dc.onclose = () => this.close('channel closed');
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close('connection ' + pc.connectionState); });
  }
  get open() { return !this.closed && this.dc.readyState === 'open'; }
  send(m) { if (!this.open) return false; try { this.dc.send(JSON.stringify(m)); this.tx++; return true; } catch { return false; } }
  dispose() { try { this.dc.close(); } catch {} try { this.pc.close(); } catch {} }
}
// Realtime Database relay: messages are batched and flushed at most every RELAY_FLUSH_MS; only the newest snapshot is kept.
export class RelayLink extends BaseLink {
  constructor(relay, code, me, peer) { super('relay'); this.relay = relay; this.code = code; this.me = me; this.peer = peer; this.q = []; this.timer = null; this.lastFlush = 0; this.sending = false; }
  get open() { return !this.closed; }
  send(m) {
    if (this.closed) return false;
    if (m.t === 'snap' || m.t === 'state') this.q = this.q.filter((x) => x.t !== m.t);
    this.q.push(m); this.tx++;
    if (!this.timer) { const wait = Math.max(0, this.lastFlush + RELAY_FLUSH_MS - performance.now()); this.timer = setTimeout(() => this.flush(), wait); }
    return true;
  }
  async flush() {
    this.timer = null; if (this.closed || !this.q.length) return;
    if (this.sending) { this.timer = setTimeout(() => this.flush(), RELAY_FLUSH_MS); return; }
    let batch = this.q; this.q = [];
    while (batch.length > 1 && JSON.stringify(batch).length > 60000) batch.shift();
    this.lastFlush = performance.now(); this.sending = true;
    try { await this.relay.send(this.code, this.peer, this.me, batch); } catch (e) { console.warn('[coop] relay send failed', e?.message || e); }
    finally { this.sending = false; }
  }
  dispose() { clearTimeout(this.timer); }
}

// ---- WebRTC connection setup over the signaling adapter ----
function rtcAvailable() { return typeof RTCPeerConnection === 'function'; }
// Host side: one peer connection + data channel per guest. Resolves with a ChannelLink once the channel opens.
export function hostDirect(signal, code, guestUid, { timeoutMs = P2P_TIMEOUT_MS, iceServers = ICE_SERVERS } = {}) {
  let pc, unsubs = [], done = false, timer;
  const cancel = () => { done = true; clearTimeout(timer); for (const u of unsubs) try { u(); } catch {} unsubs = []; };
  const p = new Promise((resolve, reject) => {
    if (!rtcAvailable()) return reject(new Error('WebRTC unavailable'));
    pc = new RTCPeerConnection({ iceServers });
    const dc = pc.createDataChannel('mythbound', { ordered: true });
    const pending = []; let haveRemote = false;
    pc.onicecandidate = (e) => { if (e.candidate && !done) signal.addCandidate(code, guestUid, 'host', e.candidate.toJSON()).catch(() => {}); };
    dc.onopen = () => { if (done) return; cancel(); resolve(new ChannelLink(pc, dc)); };
    pc.addEventListener('iceconnectionstatechange', () => { if (pc.iceConnectionState === 'failed' && !done) { cancel(); try { pc.close(); } catch {} reject(new Error('ice failed')); } });
    timer = setTimeout(() => { if (done) return; cancel(); try { pc.close(); } catch {} reject(new Error('direct timeout')); }, timeoutMs);
    unsubs.push(signal.onAnswer(code, guestUid, async (desc) => {
      if (done || haveRemote || !desc) return;
      try { await pc.setRemoteDescription(desc); haveRemote = true; for (const c of pending.splice(0)) await pc.addIceCandidate(c).catch(() => {}); } catch (e) { console.warn('[coop] answer', e?.message || e); }
    }));
    unsubs.push(signal.onCandidates(code, guestUid, 'guest', (c) => { if (done) return; if (haveRemote) pc.addIceCandidate(c).catch(() => {}); else pending.push(c); }));
    (async () => { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await signal.setOffer(code, guestUid, { type: offer.type, sdp: offer.sdp }); })()
      .catch((e) => { if (!done) { cancel(); try { pc.close(); } catch {} reject(e); } });
  });
  p.cancel = () => { if (!done) { cancel(); try { pc?.close(); } catch {} } };
  return p;
}
// Guest side: answers the host's offer. Resolves with a ChannelLink when the host's data channel opens.
export function guestDirect(signal, code, myUid, { timeoutMs = P2P_TIMEOUT_MS, iceServers = ICE_SERVERS } = {}) {
  let pc, unsubs = [], done = false, timer;
  const cancel = () => { done = true; clearTimeout(timer); for (const u of unsubs) try { u(); } catch {} unsubs = []; };
  const p = new Promise((resolve, reject) => {
    if (!rtcAvailable()) return reject(new Error('WebRTC unavailable'));
    pc = new RTCPeerConnection({ iceServers });
    const pending = []; let haveRemote = false, answered = false;
    pc.onicecandidate = (e) => { if (e.candidate && !done) signal.addCandidate(code, myUid, 'guest', e.candidate.toJSON()).catch(() => {}); };
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      const ready = () => { if (done) return; cancel(); resolve(new ChannelLink(pc, dc)); };
      if (dc.readyState === 'open') ready(); else dc.onopen = ready;
    };
    pc.addEventListener('iceconnectionstatechange', () => { if (pc.iceConnectionState === 'failed' && !done) { cancel(); try { pc.close(); } catch {} reject(new Error('ice failed')); } });
    timer = setTimeout(() => { if (done) return; cancel(); try { pc.close(); } catch {} reject(new Error('direct timeout')); }, timeoutMs);
    unsubs.push(signal.onOffer(code, myUid, async (desc) => {
      if (done || answered || !desc) return; answered = true;
      try {
        await pc.setRemoteDescription(desc); haveRemote = true;
        for (const c of pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        await signal.setAnswer(code, myUid, { type: ans.type, sdp: ans.sdp });
      } catch (e) { console.warn('[coop] offer', e?.message || e); }
    }));
    unsubs.push(signal.onCandidates(code, myUid, 'host', (c) => { if (done) return; if (haveRemote) pc.addIceCandidate(c).catch(() => {}); else pending.push(c); }));
  });
  p.cancel = () => { if (!done) { cancel(); try { pc?.close(); } catch {} } };
  return p;
}
