// In-memory stand-in for the Firebase adapter, used by tests and by ?debug=1&cloud=mock.
// Inject your own adapter instead with window.MB_CLOUD_ADAPTER (object or factory function) together with ?debug=1.
export class MockCloudAdapter {
  constructor({ user = { uid: 'mock-uid', name: 'Test Player', photo: '', email: 'test@example.com' }, latency = 20 } = {}) {
    this.kind = 'mock'; this.notice = ''; this.mockUser = user; this.latency = latency;
    this.docs = new Map(); this.calls = []; this.offline = false; this.failNext = 0; this.user = null; this.cb = () => {};
  }
  wait() { return new Promise((r) => setTimeout(r, this.latency)); }
  async init() { await this.wait(); this.ready = true; this.cb(this.user); }
  onAuth(cb) { this.cb = cb; }
  async signIn() { this.calls.push(['signIn']); await this.wait(); this.user = { ...this.mockUser }; this.cb(this.user); return this.user; }
  async signOut() { this.calls.push(['signOut']); this.user = null; this.cb(null); }
  key(uid, slot) { return `users/${uid}/saves/${slot}`; }
  async get(uid, slot = 'main') {
    this.calls.push(['get', slot]); await this.wait();
    if (this.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
    const d = this.docs.get(this.key(uid, slot)); return d ? { ...d } : null;
  }
  async put(uid, doc, slot = 'main') {
    this.calls.push(['put', slot]); await this.wait();
    if (this.offline) return new Promise(() => {}); // like Firestore offline: the write never resolves
    if (this.failNext > 0) { this.failNext--; throw Object.assign(new Error('mock failure'), { code: 'unavailable' }); }
    const { data, version, clientUpdatedAt, device, playtime, totalLevel, characterName } = doc;
    this.docs.set(this.key(uid, slot), { data, version, clientUpdatedAt, device, playtime, totalLevel, characterName, updatedAt: Date.now() });
  }
  // test helper: put a cloud save in place before signing in
  seed(uid, doc, slot = 'main') { this.docs.set(this.key(uid, slot), { version: 2, updatedAt: Date.now(), ...doc }); }
  puts(slot = 'main') { return this.calls.filter((c) => c[0] === 'put' && c[1] === slot).length; }
}
