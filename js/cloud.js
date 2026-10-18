// Mythbound cloud save sync: pure logic, no Firebase or DOM code. The cloud lives behind an adapter so it can be mocked:
//   adapter.init()                      -> Promise (load SDKs; resolve once the first auth state is known)
//   adapter.onAuth(cb)                  -> cb(user | null), user = { uid, name, photo, email }
//   adapter.signIn() / adapter.signOut()
//   adapter.get(uid, slot='main')       -> Promise<doc | null>, doc = { data, version, updatedAt(ms|null), clientUpdatedAt, device, playtime, totalLevel, characterName }
//   adapter.put(uid, doc, slot='main')  -> Promise (the adapter adds updatedAt = serverTimestamp())
// Firestore layout: users/{uid}/saves/main (live save) and users/{uid}/saves/backup (cloud copy kept when you overwrite it).

export const META_KEY = 'mythbound_cloud_meta';
export const DEBOUNCE_MS = 30000;   // autosave pushes at most once per 30 s (manual save / pagehide / tab hidden push at once)
export const MAX_DATA_CHARS = 900000; // keep well inside Firestore's 1 MiB document limit (matches firestore.rules)

export function hashStr(s) { // FNV-1a 32-bit + length: cheap "has this save changed since the last sync?" check
  let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + s.length;
}

// Decide what to do when a signed-in user's cloud save and this device's save are compared.
// local / cloud: { data: string, ... } or null. meta: { uid, base } = hash of the save both sides last agreed on.
//   'none'     neither side has a save
//   'upload'   cloud is empty, or only this device changed since the last sync
//   'download' this device has no save, or only the cloud changed since the last sync (this device is unchanged)
//   'same'     identical
//   'conflict' both exist, differ, and there is no shared base that proves one side is just older -> ask the player
export function decide(local, cloud, meta, uid) {
  const L = local && local.data, C = cloud && cloud.data;
  if (!L && !C) return 'none';
  if (L && !C) return 'upload';
  if (!L && C) return 'download';
  if (L === C) return 'same';
  if (meta && meta.uid === uid && meta.base) {
    const hl = hashStr(L), hc = hashStr(C);
    if (hc === meta.base && hl !== meta.base) return 'upload';
    if (hl === meta.base && hc !== meta.base) return 'download';
  }
  return 'conflict';
}
export function newerSide(local, cloud) {
  const l = +local?.clientUpdatedAt || 0, c = +(cloud?.clientUpdatedAt || cloud?.updatedAt) || 0;
  return c > l ? 'cloud' : 'local';
}

const withTimeout = (p, ms, what) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(Object.assign(new Error(what + ' timed out'), { code: 'timeout' })), ms);
  Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

export class CloudSync {
  // opts: adapter, storage (localStorage-like, for sync metadata), getLocal() -> local doc | null,
  // applyCloud(dataString) -> apply a cloud save on this device, onChange(state), device 'phone'|'pc',
  // now(), isOnline(), debounceMs, timeoutMs, win (for 'online' events; optional)
  constructor(opts) {
    this.o = opts; this.adapter = opts.adapter;
    this.now = opts.now || (() => Date.now());
    this.isOnline = opts.isOnline || (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS; this.timeoutMs = opts.timeoutMs ?? 20000;
    this.storage = opts.storage;
    this.state = { status: opts.adapter ? 'loading' : 'disabled', user: null, sync: 'idle', message: '', conflict: null, lastSyncAt: 0 };
    this.reconciled = false; this.timer = null; this.pushing = null; this.pushes = 0; this.log = [];
    let meta = {}; try { meta = JSON.parse(this.storage?.getItem(META_KEY)) || {}; } catch {}
    this.meta = meta; this.state.lastSyncAt = meta.lastSyncAt || 0;
    this.lastPushAt = 0;
    if (opts.win) opts.win.addEventListener('online', () => this.onOnline());
  }
  saveMeta() { try { this.storage?.setItem(META_KEY, JSON.stringify(this.meta)); } catch {} }
  set(patch) { Object.assign(this.state, patch); this.o.onChange?.(this.state, this); }
  note(ev, x) { this.log.push({ t: this.now(), ev, ...(x || {}) }); if (this.log.length > 200) this.log.shift(); }

  async start() {
    if (!this.adapter) return this.set({ status: 'disabled' });
    this.adapter.onAuth((u) => this.onUser(u));
    try { await this.adapter.init(); }
    catch (e) { this.note('init-fail', { e: String(e?.message || e) }); this.set({ status: 'error', message: this.isOnline() ? 'Cloud saves are unavailable right now.' : 'Offline: cloud saves will connect when you are back online.' }); return; }
    if (this.state.status === 'loading') this.set({ status: this.state.user ? 'signedIn' : 'signedOut' });
  }
  onUser(u) {
    const prev = this.state.user?.uid;
    if (!u) { this.reconciled = false; clearTimeout(this.timer); this.timer = null; this.set({ status: this.state.status === 'loading' ? 'loading' : 'signedOut', user: null, sync: 'idle', conflict: null }); return; }
    this.set({ status: 'signedIn', user: u });
    if (prev !== u.uid) { this.reconciled = false; this.reconcile(); }
  }
  signIn() { return this.adapter?.signIn(); }
  async signOut() {
    if (this.state.user && this.reconciled && this.meta.dirty) await this.push(true).catch(() => {});
    await this.adapter?.signOut();
  }

  // ---- compare cloud vs this device ----
  async reconcile() {
    const u = this.state.user; if (!u) return;
    if (!this.isOnline()) { this.pendingReconcile = true; this.set({ sync: 'offline', message: 'Offline: will check your cloud save when you are back online.' }); return; }
    this.pendingReconcile = false; this.set({ sync: 'checking', message: '' });
    const local0 = this.o.getLocal(); // snapshot before the network round-trip
    let cloud;
    try { cloud = await withTimeout(this.adapter.get(u.uid, 'main'), this.timeoutMs, 'cloud read'); }
    catch (e) { this.note('get-fail', { e: String(e?.message || e) }); this.pendingReconcile = true; this.set({ sync: this.isOnline() ? 'error' : 'offline', message: 'Could not reach your cloud save. Will retry.' }); this.retryLater(); return; }
    if (this.state.user?.uid !== u.uid) return;
    // decide on what this device had before the round-trip (the player may have pressed Continue and autosaved meanwhile)
    const before = local0 || this.o.getLocal(), local = this.o.getLocal() || before;
    const d = decide(before, cloud, this.meta, u.uid);
    this.note('decide', { d });
    this.lastDecision = d;
    if (d === 'none') return this.markSynced(null, u);
    if (d === 'same') return this.markSynced(before.data, u);
    if (d === 'upload') { this.reconciled = true; this.meta.dirty = true; this.saveMeta(); return this.push(true); }
    if (d === 'download') return this.useCloud(cloud, u);
    this.set({ sync: 'conflict', conflict: { cloud, local, newer: newerSide(local, cloud) } });
  }
  // player picked a side in the chooser
  async resolve(choice) {
    const c = this.state.conflict, u = this.state.user; if (!c || !u) return;
    this.note('resolve', { choice });
    this.set({ conflict: null });
    if (choice === 'cloud') return this.useCloud(c.cloud, u);
    // keep this device: park the old cloud save in saves/backup first, then overwrite main
    try { await withTimeout(this.adapter.put(u.uid, c.cloud, 'backup'), this.timeoutMs, 'backup'); } catch (e) { this.note('backup-fail', { e: String(e?.message || e) }); }
    this.reconciled = true; this.meta.dirty = true; this.saveMeta();
    return this.push(true);
  }
  useCloud(cloud, u) {
    const ok = this.o.applyCloud(cloud.data, cloud);
    if (ok === false) { this.set({ sync: 'error', message: 'The cloud save could not be read, so this device was kept.' }); this.reconciled = true; return; }
    this.markSynced(this.o.getLocal()?.data ?? cloud.data, u);
  }
  markSynced(data, u) {
    this.reconciled = true;
    this.meta = { ...this.meta, uid: u.uid, base: data ? hashStr(data) : null, dirty: false, lastSyncAt: this.now() }; this.saveMeta();
    this.set({ sync: 'saved', lastSyncAt: this.meta.lastSyncAt, message: '' });
  }

  // ---- autosave pushes ----
  // Called after every local save. Pushes are throttled to one per debounceMs.
  markDirty() {
    this.meta.dirty = true; this.saveMeta();
    if (!this.state.user || !this.reconciled) return;
    if (!this.isOnline()) { if (this.state.sync !== 'offline') this.set({ sync: 'offline', message: 'Offline: saving on this device, will sync when back online.' }); return; }
    if (this.timer) return;
    const wait = Math.max(0, this.lastPushAt + this.debounceMs - this.now());
    this.timer = setTimeout(() => { this.timer = null; this.push(false); }, wait);
  }
  // Push now (manual save, pagehide, tab hidden). Ignores the throttle.
  flush() { clearTimeout(this.timer); this.timer = null; if (this.state.user && this.reconciled && this.meta.dirty) return this.push(true); return Promise.resolve(false); }
  async push(force) {
    const u = this.state.user; if (!u || !this.reconciled) return false;
    if (this.pushing) { this.again = true; return this.pushing; }
    if (!this.isOnline()) { this.set({ sync: 'offline', message: 'Offline: saving on this device, will sync when back online.' }); return false; }
    const local = this.o.getLocal(); if (!local) return false;
    const h = hashStr(local.data);
    if (h === this.meta.base && this.meta.uid === u.uid) { this.meta.dirty = false; this.saveMeta(); return false; } // nothing new
    if (local.data.length > MAX_DATA_CHARS) { this.set({ sync: 'error', message: 'Save too large for the cloud (kept on this device).' }); return false; }
    this.lastPushAt = this.now(); this.set({ sync: 'saving' });
    this.pushing = (async () => {
      try {
        await withTimeout(this.adapter.put(u.uid, local, 'main'), this.timeoutMs, 'cloud write');
        this.pushes++; this.note('push', { force: !!force, len: local.data.length });
        const cur = this.o.getLocal();
        this.meta = { ...this.meta, uid: u.uid, base: h, dirty: !!(cur && hashStr(cur.data) !== h), lastSyncAt: this.now() }; this.saveMeta();
        this.set({ sync: 'saved', lastSyncAt: this.meta.lastSyncAt, message: '' });
        return true;
      } catch (e) {
        this.note('push-fail', { e: String(e?.message || e) });
        this.set({ sync: this.isOnline() ? 'error' : 'offline', message: this.isOnline() ? 'Cloud save failed, will retry.' : 'Offline: saving on this device, will sync when back online.' });
        this.retryLater();
        return false;
      } finally {
        this.pushing = null;
        if (this.again) { this.again = false; if (this.meta.dirty) this.markDirty(); }
      }
    })();
    return this.pushing;
  }
  retryLater() { clearTimeout(this.retryT); this.retryT = setTimeout(() => this.onOnline(), Math.max(this.debounceMs, 5000)); }
  onOnline() {
    if (!this.state.user) return;
    if (!this.reconciled) { if (this.pendingReconcile || this.state.sync === 'offline' || this.state.sync === 'error') this.reconcile(); return; }
    if (this.meta.dirty) this.push(true);
  }
}
