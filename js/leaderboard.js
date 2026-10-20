// Mythbound v3 season leaderboard (Firestore). Design ("verified by both sides"):
//  1. Only the co-op session HOST creates the match record:  seasons/{season}/matches/{matchId}
//       { hostUid, players[uid], winners[uid], mode, kos[2], durationS, createdAt, acks[] }  (rules: hostUid == auth.uid,
//       sane sizes / KO counts / duration, created at request.time, immutable except for players adding their own ack)
//  2. Every player in the match signs it off by adding their own uid to acks (rules: only your own uid, only once).
//  3. Each player then updates ONLY their own row  seasons/{season}/players/{uid}  in a batch that also creates the
//     one-time claim seasons/{season}/claims/{matchId}_{uid}. Rules: the claim must not exist before and must exist
//     after the batch, every player must have acked the match, you must be in it, wins/matches go up by exactly
//     0/1 and 1, and the rating moves by at most 32 points.
//  So a single client can't invent results (the host writes the match, everyone acks it), can't replay a match
//  (one claim each) and can't touch anyone else's row. A host and a friend colluding can still farm wins between
//  themselves; the board is labelled "co-op verified, friendly" for that reason.
import { SEASON, eloDelta, matchSanity } from './pvp.js';

export const RATING0 = 1000;
export function claimUpdate(prev, match, uid) {
  const p = prev || { uid, wins: 0, losses: 0, matches: 0, rating: RATING0 };
  const won = match.winners.includes(uid), draw = !match.winners.length;
  const opp = match.oppRating ?? RATING0;
  const d = Math.max(-32, Math.min(32, eloDelta(p.rating, opp, draw ? 0.5 : won ? 1 : 0)));
  return { uid, name: String(match.names?.[uid] || p.name || 'Player').slice(0, 16), wins: p.wins + (won ? 1 : 0), losses: p.losses + (!won && !draw ? 1 : 0), matches: p.matches + 1, rating: p.rating + d, lastMatch: match.id };
}
// Mirror of the firestore.rules checks, used by the in-memory adapter (tests) and as a client-side pre-check.
export const RULES = {
  createMatch(auth, m) { const tA = m.players.slice(0, m.players.length / 2), tB = m.players.slice(m.players.length / 2), w = !m.winners.length ? -1 : m.winners.every((u) => tA.includes(u)) ? 0 : m.winners.every((u) => tB.includes(u)) ? 1 : 9; return !!auth && m.hostUid === auth && matchSanity({ ...m, teamA: tA, teamB: tB, winner: w }).length === 0 && m.winners.every((w) => m.players.includes(w)) && (m.acks || []).length === 0; },
  ack(auth, m, newAcks) { return !!auth && m.players.includes(auth) && !m.acks.includes(auth) && newAcks.length === m.acks.length + 1 && newAcks.includes(auth) && m.acks.every((a) => newAcks.includes(a)); },
  claim(auth, uid, m, claimExistedBefore, prev, next) {
    if (!auth || auth !== uid || !m || claimExistedBefore) return false;
    if (!m.players.includes(uid) || !m.players.every((p) => m.acks.includes(p))) return false;
    const P = prev || { wins: 0, losses: 0, matches: 0, rating: RATING0 };
    const won = m.winners.includes(uid);
    return next.matches === P.matches + 1 && next.wins === P.wins + (won ? 1 : 0) && next.losses >= P.losses && next.losses <= P.losses + 1 && Math.abs(next.rating - P.rating) <= 32 && next.lastMatch === m.id;
  },
};
// In-memory "Firestore" with the same rules: used by e2e-v3 (window.MB_LEADERBOARD) and ?debug=1&lb=mock.
export function createMockLeaderboard() {
  const db = { matches: new Map(), players: new Map(), claims: new Set(), denied: [] };
  const deny = (op, why) => { db.denied.push({ op, why }); throw Object.assign(new Error('permission-denied: ' + why), { code: 'permission-denied' }); };
  return {
    kind: 'mock', db,
    async createMatch(auth, m) { if (db.matches.has(m.id) || !RULES.createMatch(auth, m)) deny('createMatch', 'rules'); db.matches.set(m.id, { ...m, acks: [] }); },
    async ack(auth, id) { const m = db.matches.get(id); if (!m) deny('ack', 'no-match'); const acks = [...m.acks, auth]; if (!RULES.ack(auth, m, acks)) deny('ack', 'rules'); m.acks = acks; },
    async getMatch(id) { const m = db.matches.get(id); return m ? { ...m, acks: [...m.acks] } : null; },
    async getPlayer(uid) { return db.players.get(uid) || null; },
    async claim(auth, uid, id, next) { const m = db.matches.get(id), key = id + '_' + uid; if (!RULES.claim(auth, uid, m, db.claims.has(key), db.players.get(uid), next)) deny('claim', 'rules'); db.claims.add(key); db.players.set(uid, next); },
    async top(n = 20) { return [...db.players.values()].sort((a, b) => b.rating - a.rating || b.wins - a.wins).slice(0, n); },
  };
}
export async function createFirestoreLeaderboard(config) {
  const BASE = new URL('../vendor/firebase/', import.meta.url).href;
  const [app, F] = await Promise.all([import(BASE + 'firebase-app.js'), import(BASE + 'firebase-firestore.js')]);
  const fb = app.getApps().length ? app.getApp() : app.initializeApp(config);
  const db = F.getFirestore(fb);
  const mRef = (id) => F.doc(db, 'seasons', SEASON, 'matches', id), pRef = (uid) => F.doc(db, 'seasons', SEASON, 'players', uid), cRef = (id, uid) => F.doc(db, 'seasons', SEASON, 'claims', id + '_' + uid);
  return {
    kind: 'firestore',
    async createMatch(auth, m) { await F.setDoc(mRef(m.id), { hostUid: m.hostUid, players: m.players, winners: m.winners, names: m.names || {}, mode: m.mode, kos: m.kos, durationS: m.durationS, createdAt: F.serverTimestamp(), acks: [] }); },
    async ack(auth, id) { await F.updateDoc(mRef(id), { acks: F.arrayUnion(auth) }); },
    async getMatch(id) { const s = await F.getDoc(mRef(id)); return s.exists() ? { id, ...s.data() } : null; },
    async getPlayer(uid) { const s = await F.getDoc(pRef(uid)); return s.exists() ? s.data() : null; },
    async claim(auth, uid, id, next) { const b = F.writeBatch(db); b.set(cRef(id, uid), { at: F.serverTimestamp() }); b.set(pRef(uid), { ...next, updatedAt: F.serverTimestamp() }); await b.commit(); },
    async top(n = 20) { const q = F.query(F.collection(db, 'seasons', SEASON, 'players'), F.orderBy('rating', 'desc'), F.limit(n)); return (await F.getDocs(q)).docs.map((d) => d.data()); },
  };
}
// Client flow. Host: recordMatch (after its own sanity check). Everyone in it: ackAndClaim.
export async function recordMatch(lb, hostUid, res) {
  const players = [...res.teamA, ...res.teamB], winners = res.winner === -1 ? [] : res.winner === 0 ? res.teamA : res.teamB;
  const errs = matchSanity({ ...res, hostUid }); if (errs.length) return { ok: false, errs };
  const m = { id: res.id, hostUid, players, winners, names: res.names || {}, mode: res.mode, kos: res.kos, durationS: Math.round(res.durationS) };
  await lb.createMatch(hostUid, m); return { ok: true, match: m };
}
export async function ackAndClaim(lb, uid, matchId, { waitMs = 8000 } = {}) {
  await lb.ack(uid, matchId);
  const t0 = Date.now(); let m;
  for (;;) { m = await lb.getMatch(matchId); if (m && m.players.every((p) => m.acks.includes(p))) break; if (Date.now() - t0 > waitMs) return { ok: false, why: 'not-all-acked' }; await new Promise((r) => setTimeout(r, 300)); }
  const next = claimUpdate(await lb.getPlayer(uid), { ...m, id: matchId }, uid);
  await lb.claim(uid, uid, matchId, next); return { ok: true, row: next };
}
// Test double shared between browser contexts: the same RULES as the mock, stored in the co-op test hub
// (ws:// test server, or the in-browser "bridge"). Used with ?debug=1&coop=mock&coophub=…&lb=hub.
export async function createHubLeaderboard(url) {
  const { hubFor } = await import('./coop-mock.js');
  const H = hubFor(url), get = async (p) => (await H.req({ op: 'get', path: p })).val, set = (p, val) => H.req({ op: 'set', path: p, val });
  const base = `lb/${SEASON}`, denied = [];
  const deny = (op, why) => { denied.push({ op, why }); throw Object.assign(new Error('permission-denied: ' + why), { code: 'permission-denied' }); };
  return {
    kind: 'hub', denied,
    async createMatch(auth, m) { if ((await get(`${base}/matches/${m.id}`)) || !RULES.createMatch(auth, m)) deny('createMatch', 'rules'); await set(`${base}/matches/${m.id}`, { ...m, acks: [] }); },
    async ack(auth, id) { const m = await get(`${base}/matches/${id}`); if (!m) deny('ack', 'no-match'); const acks = [...m.acks, auth]; if (!RULES.ack(auth, m, acks)) deny('ack', 'rules'); await H.req({ op: 'merge', path: `${base}/matches/${id}`, val: { acks: [...new Set([...((await get(`${base}/matches/${id}`))?.acks || []), auth])] } }); },
    async getMatch(id) { return (await get(`${base}/matches/${id}`)) || null; },
    async getPlayer(uid) { return (await get(`${base}/players/${uid}`)) || null; },
    async claim(auth, uid, id, next) { const m = await get(`${base}/matches/${id}`), key = id + '_' + uid; if (!RULES.claim(auth, uid, m, !!(await get(`${base}/claims/${key}`)), await get(`${base}/players/${uid}`), next)) deny('claim', 'rules'); await set(`${base}/claims/${key}`, { at: Date.now() }); await set(`${base}/players/${uid}`, next); },
    async top(n = 20) { const { list } = await new Promise((res) => { const off = H.sub(`${base}/players`, 'col', (m) => { off?.(); res(m); }); }); return list.map((x) => x.val).sort((a, b) => b.rating - a.rating || b.wins - a.wins).slice(0, n); },
  };
}
