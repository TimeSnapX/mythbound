// Firebase adapters for co-op (see coop-net.js for the contracts). Loaded only when co-op is opened with a real
// Firebase config and a signed-in Google account; it reuses the Firebase app that cloud saves already initialised.
//   Signaling: Cloud Firestore  lobbies/{code}                       { code, hostUid, hostName, createdAt, expiresAt, max, v }
//                               lobbies/{code}/peers/{uid}           { uid, name, joinedAt, offer?, answer? }
//                               lobbies/{code}/peers/{uid}/hostCandidates/{id} and /guestCandidates/{id}   { cand, at }
//   Relay (fallback):  Realtime Database  relay/{code}/{toUid}/{pushId}   { f: fromUid, d: JSON batch, t }
//                      Only used when firebaseConfig.databaseURL is set (create the database first, see COOP_SETUP.md).
import { LOBBY_TTL_MS, MAX_PLAYERS } from './coop-net.js';
const BASE = new URL('../vendor/firebase/', import.meta.url).href;

export async function createCoopAdapters(config) {
  const [app, F] = await Promise.all([import(BASE + 'firebase-app.js'), import(BASE + 'firebase-firestore.js')]);
  const fb = app.getApps().length ? app.getApp() : app.initializeApp(config);
  const db = F.getFirestore(fb);
  const lobbyRef = (code) => F.doc(db, 'lobbies', code);
  const peerRef = (code, uid) => F.doc(db, 'lobbies', code, 'peers', uid);
  const candCol = (code, uid, side) => F.collection(db, 'lobbies', code, 'peers', uid, side === 'host' ? 'hostCandidates' : 'guestCandidates');
  const ms = (t) => (t?.toMillis ? t.toMillis() : +t || 0);
  const lobbyOf = (snap) => { if (!snap.exists()) return null; const d = snap.data(); return { code: d.code, hostUid: d.hostUid, hostName: d.hostName, max: d.max || MAX_PLAYERS, expiresAt: ms(d.expiresAt) }; };
  const signal = {
    kind: 'firestore',
    async createLobby({ code, hostUid, hostName }) {
      const expiresAt = F.Timestamp.fromMillis(Date.now() + LOBBY_TTL_MS);
      await F.setDoc(lobbyRef(code), { code, hostUid, hostName: String(hostName || 'Host').slice(0, 16), createdAt: F.serverTimestamp(), expiresAt, max: MAX_PLAYERS, v: 1 });
      return { code, hostUid, hostName, max: MAX_PLAYERS, expiresAt: expiresAt.toMillis() };
    },
    async getLobby(code) { return lobbyOf(await F.getDoc(lobbyRef(code))); },
    async closeLobby(code) {
      try { const peers = await F.getDocs(F.collection(db, 'lobbies', code, 'peers')); for (const p of peers.docs) await removePeer(code, p.id); } catch {}
      await F.deleteDoc(lobbyRef(code)).catch(() => {});
    },
    joinLobby(code, { uid, name }) { return F.setDoc(peerRef(code, uid), { uid, name: String(name || 'Guest').slice(0, 16), joinedAt: F.serverTimestamp() }); },
    leaveLobby(code, uid) { return removePeer(code, uid); },
    onPeers(code, cb) {
      return F.onSnapshot(F.collection(db, 'lobbies', code, 'peers'), (qs) => cb(qs.docs.map((d) => ({ uid: d.id, name: d.data().name || 'Guest', joinedAt: ms(d.data().joinedAt) }))), (e) => console.warn('[coop] peers', e.code || e.message));
    },
    setOffer(code, uid, desc) { return F.updateDoc(peerRef(code, uid), { offer: { type: desc.type, sdp: desc.sdp } }); },
    setAnswer(code, uid, desc) { return F.updateDoc(peerRef(code, uid), { answer: { type: desc.type, sdp: desc.sdp } }); },
    onOffer(code, uid, cb) { return F.onSnapshot(peerRef(code, uid), (s) => { const o = s.exists() && s.data().offer; if (o) cb(o); }, (e) => console.warn('[coop] offer', e.code || e.message)); },
    onAnswer(code, uid, cb) { return F.onSnapshot(peerRef(code, uid), (s) => { const a = s.exists() && s.data().answer; if (a) cb(a); }, (e) => console.warn('[coop] answer', e.code || e.message)); },
    addCandidate(code, uid, side, cand) { return F.addDoc(candCol(code, uid, side), { cand: JSON.stringify(cand), at: F.serverTimestamp() }); },
    onCandidates(code, uid, side, cb) {
      return F.onSnapshot(candCol(code, uid, side), (qs) => { for (const ch of qs.docChanges()) if (ch.type === 'added') { try { cb(JSON.parse(ch.doc.data().cand)); } catch {} } }, (e) => console.warn('[coop] candidates', e.code || e.message));
    },
  };
  async function removePeer(code, uid) {
    for (const side of ['host', 'guest']) { try { const qs = await F.getDocs(candCol(code, uid, side)); for (const d of qs.docs) await F.deleteDoc(d.ref).catch(() => {}); } catch {} }
    await F.deleteDoc(peerRef(code, uid)).catch(() => {});
  }

  // ---- relay over the Realtime Database (free on Spark). Missing databaseURL -> unavailable, no SDK download. ----
  let relay = { kind: 'rtdb', available: false, listen: () => () => {}, send: async () => {}, clear: async () => {} };
  const url = String(config.databaseURL || '').trim();
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)\/?$/i.test(url)) {
    let R, rdb;
    const ready = async () => { if (!rdb) { R = await import(BASE + 'firebase-database.js'); rdb = R.getDatabase(fb, url); } return R; };
    relay = {
      kind: 'rtdb', available: true, url,
      listen(code, me, cb) {
        let off = null, stopped = false;
        ready().then((R) => {
          if (stopped) return;
          const q = R.ref(rdb, `relay/${code}/${me}`);
          off = R.onChildAdded(q, (snap) => {
            const v = snap.val(); R.remove(snap.ref).catch(() => {});
            if (!v || typeof v.f !== 'string' || typeof v.d !== 'string') return;
            let msgs; try { msgs = JSON.parse(v.d); } catch { return; }
            if (Array.isArray(msgs)) cb(v.f, msgs);
          }, (e) => console.warn('[coop] relay listen', e?.code || e?.message));
        }).catch((e) => console.warn('[coop] relay unavailable', e?.message || e));
        return () => { stopped = true; try { off?.(); } catch {} };
      },
      async send(code, to, from, msgs) { const R = await ready(); await R.push(R.ref(rdb, `relay/${code}/${to}`), { f: from, d: JSON.stringify(msgs), t: R.serverTimestamp() }); },
      async clear(code, me) { const R = await ready(); await R.remove(R.ref(rdb, `relay/${code}/${me}`)).catch(() => {}); },
    };
  }
  return { signal, relay };
}
