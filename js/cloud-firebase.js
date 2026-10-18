// Firebase adapter for CloudSync (see cloud.js for the adapter contract). Loaded only when js/firebase-config.js has a
// real config, so the placeholder build never downloads the Firebase SDK. SDK: Firebase JS v12 modular, vendored
// unmodified in vendor/firebase/ (only the firebase-app import path was made relative).
const BASE = new URL('../vendor/firebase/', import.meta.url).href;
const FLAG_REDIRECT = 'mythbound_auth_redirect', FLAG_POPUP = 'mythbound_auth_popup_only';

export function isMobileOrStandalone() {
  const standalone = (typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone === true;
  const mobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return standalone || mobile;
}

export function createFirebaseAdapter(config, { flow = 'auto', storage = localStorage } = {}) {
  let A, F, auth, db, provider, cb = () => {};
  const ad = {
    kind: 'firebase', notice: '',
    async init() {
      const [app, a, f] = await Promise.all([import(BASE + 'firebase-app.js'), import(BASE + 'firebase-auth.js'), import(BASE + 'firebase-firestore.js')]);
      A = a; F = f;
      const fb = app.initializeApp(config);
      auth = A.getAuth(fb); auth.useDeviceLanguage();
      db = F.getFirestore(fb);
      provider = new A.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
      A.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, name: u.displayName || u.email || 'Player', photo: u.photoURL || '', email: u.email || '' } : null));
      // Coming back from signInWithRedirect: finish it (errors are shown as a notice, never thrown).
      try { await A.getRedirectResult(auth); } catch (e) { ad.notice = friendly(e); }
      await auth.authStateReady?.();
      const t = +storage.getItem(FLAG_REDIRECT) || 0;
      if (t) {
        storage.removeItem(FLAG_REDIRECT);
        // Redirect came back but nobody is signed in: this browser blocks the storage the redirect flow needs.
        if (!auth.currentUser && Date.now() - t < 10 * 60 * 1000) { storage.setItem(FLAG_POPUP, '1'); ad.notice ||= 'Google sign-in did not finish in this browser. Tap Sign in again; it will use a pop-up this time.'; }
      }
    },
    onAuth(fn) { cb = fn; },
    get ready() { return !!auth; },
    // Must be called straight from the click handler (no awaits before signInWithPopup) so the pop-up is not blocked.
    signIn() {
      if (!auth) return Promise.reject(new Error('Cloud saves are still loading'));
      const redirectFirst = flow === 'redirect' || (flow === 'auto' && isMobileOrStandalone() && storage.getItem(FLAG_POPUP) !== '1');
      const redirect = () => { storage.setItem(FLAG_REDIRECT, String(Date.now())); return A.signInWithRedirect(auth, provider); };
      if (redirectFirst) return redirect();
      return A.signInWithPopup(auth, provider).catch((e) => {
        const c = e?.code || '';
        if (flow !== 'popup' && (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment' || c === 'auth/web-storage-unsupported')) return redirect();
        if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' || c === 'auth/user-cancelled') return null;
        throw Object.assign(new Error(friendly(e)), { code: c });
      });
    },
    signOut() { return auth ? A.signOut(auth) : Promise.resolve(); },
    async get(uid, slot = 'main') {
      const snap = await F.getDoc(F.doc(db, 'users', uid, 'saves', slot));
      if (!snap.exists()) return null;
      const d = snap.data();
      return { ...d, updatedAt: d.updatedAt?.toMillis ? d.updatedAt.toMillis() : null };
    },
    put(uid, doc, slot = 'main') {
      const out = {
        data: String(doc.data), version: +doc.version || 2, updatedAt: F.serverTimestamp(), clientUpdatedAt: +doc.clientUpdatedAt || Date.now(),
        device: doc.device === 'phone' ? 'phone' : 'pc', playtime: Math.round(+doc.playtime || 0), totalLevel: +doc.totalLevel || 0,
        characterName: String(doc.characterName || '').slice(0, 32),
      };
      return F.setDoc(F.doc(db, 'users', uid, 'saves', slot), out);
    },
  };
  return ad;
}
function friendly(e) {
  const c = e?.code || '';
  if (c === 'auth/unauthorized-domain') return 'Sign-in is not enabled for this site yet (add the domain under Firebase Authentication → Settings → Authorised domains).';
  if (c === 'auth/network-request-failed') return 'Network error during sign-in. Check your connection and try again.';
  if (c === 'auth/operation-not-allowed') return 'Google sign-in is not enabled in the Firebase project yet.';
  return 'Sign-in failed' + (c ? ` (${c})` : '') + '.';
}
