// Enemy visuals. State comes from an EnemySim (local) or server snapshots; this only renders + telegraphs.
import * as THREE from 'three';
import { ENEMY_TYPES } from './shared.js';

const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const part = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; return o; };

function buildMossling(mats) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const blob = part(new THREE.IcosahedronGeometry(0.75, 1), mats.add(0x5aa040), 0, 0.6, 0); blob.scale.set(1, 0.8, 1); body.add(blob);
  const em = mats.add(0x101010);
  body.add(part(new THREE.BoxGeometry(0.14, 0.2, 0.05), em, -0.22, 0.75, 0.68), part(new THREE.BoxGeometry(0.14, 0.2, 0.05), em, 0.22, 0.75, 0.68));
  const leaf = part(new THREE.ConeGeometry(0.2, 0.6, 4), mats.add(0x2f7a2a), 0, 1.35, 0); leaf.rotation.z = 0.4; body.add(leaf);
  return { g, body, anim(s, st, T, t) {
    let sy = 1 + Math.sin(t * 6) * 0.06, sz = 1, y = 0;
    if (s === 'tell') { const p = Math.min(1, st / T.tell); sy = 1 - p * 0.4; sz = 1 + p * 0.25; }
    else if (s === 'attack') { sy = 0.8; sz = 1.5; y = Math.sin(Math.min(1, st / 0.35) * Math.PI) * 0.6; }
    else if (s === 'chase' || s === 'idle' || s === 'return') y = Math.abs(Math.sin(t * 7)) * 0.25;
    body.scale.set(1 / Math.sqrt(sy), sy, sz); body.position.y = y;
  } };
}
function buildGrubkin(mats) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const skin = mats.add(0x7a9a3a), cloth = mats.add(0x6a4a2a);
  body.add(part(new THREE.BoxGeometry(0.7, 0.7, 0.5), cloth, 0, 0.85, 0));
  const head = new THREE.Group(); head.position.y = 1.45; body.add(head);
  head.add(part(new THREE.BoxGeometry(0.55, 0.5, 0.5), skin, 0, 0, 0));
  head.add(part(new THREE.BoxGeometry(0.12, 0.25, 0.25), skin, 0, -0.05, 0.3));
  for (const sx of [-1, 1]) { const ear = part(new THREE.ConeGeometry(0.12, 0.5, 4), skin, sx * 0.4, 0.1, 0); ear.rotation.z = -sx * 1.2; head.add(ear); }
  const eyeM = mats.add(0xffe040); head.add(part(new THREE.BoxGeometry(0.1, 0.08, 0.04), eyeM, -0.13, 0.08, 0.26), part(new THREE.BoxGeometry(0.1, 0.08, 0.04), eyeM, 0.13, 0.08, 0.26));
  for (const sx of [-1, 1]) body.add(part(new THREE.BoxGeometry(0.22, 0.5, 0.24), skin, sx * 0.17, 0.25, 0));
  const arm = new THREE.Group(); arm.position.set(-0.45, 1.1, 0); body.add(arm);
  arm.add(part(new THREE.BoxGeometry(0.18, 0.55, 0.18), skin, 0, -0.25, 0));
  const club = part(new THREE.CylinderGeometry(0.16, 0.08, 1.1, 5), mats.add(0x5a3a1a), 0, -0.5, 0.5); club.rotation.x = Math.PI / 2; arm.add(club);
  return { g, body, anim(s, st, T, t) {
    let ax = -0.3, lean = 0;
    if (s === 'tell') { const p = Math.min(1, st / (T.tell * 0.6)); ax = -0.3 - p * 2.6; lean = -0.25 * p; }
    else if (s === 'attack') { const p = Math.min(1, st / 0.18); ax = -2.9 + p * 3.6; lean = 0.3 * p; }
    else if (s === 'chase') { body.position.y = Math.abs(Math.sin(t * 9)) * 0.1; }
    arm.rotation.x += (ax - arm.rotation.x) * 0.4; body.rotation.x += (lean - body.rotation.x) * 0.3;
  } };
}
function buildBoar(mats) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const fur = mats.add(0x5a3a26);
  body.add(part(new THREE.BoxGeometry(1.1, 0.9, 1.8), fur, 0, 0.95, 0));
  const head = new THREE.Group(); head.position.set(0, 1.0, 1.0); body.add(head);
  head.add(part(new THREE.BoxGeometry(0.8, 0.7, 0.7), fur, 0, 0, 0.2));
  head.add(part(new THREE.BoxGeometry(0.45, 0.35, 0.2), mats.add(0xc08a7a), 0, -0.1, 0.6));
  const tusk = mats.add(0xf0ead8);
  for (const sx of [-1, 1]) { const t = part(new THREE.ConeGeometry(0.07, 0.4, 4), tusk, sx * 0.28, -0.15, 0.6); t.rotation.x = -1; head.add(t); }
  const eyes = mats.add(0x200000, true); head.add(part(new THREE.BoxGeometry(0.1, 0.1, 0.05), eyes, -0.22, 0.15, 0.56), part(new THREE.BoxGeometry(0.1, 0.1, 0.05), eyes, 0.22, 0.15, 0.56));
  const spine = mats.add(0x2a1a10); for (let i = 0; i < 4; i++) { const sp = part(new THREE.ConeGeometry(0.12, 0.4, 4), spine, 0, 1.55, 0.6 - i * 0.4); body.add(sp); }
  const legs = []; for (const [x, z] of [[-0.4, 0.6], [0.4, 0.6], [-0.4, -0.6], [0.4, -0.6]]) { const l = new THREE.Group(); l.position.set(x, 0.6, z); l.add(part(new THREE.BoxGeometry(0.25, 0.6, 0.25), fur, 0, -0.3, 0)); body.add(l); legs.push(l); }
  return { g, body, eyes, anim(s, st, T, t) {
    let hx = 0, sp = 0;
    if (s === 'tell') { hx = 0.5; legs[0].rotation.x = Math.sin(st * 20) * 0.7; eyes.emissive.setHex(0xff2000); }
    else { eyes.emissive.setHex(0x000000); }
    if (s === 'attack') sp = 18; else if (s === 'chase' || s === 'return') sp = 9; else if (s === 'idle') sp = 4;
    if (s !== 'tell') legs.forEach((l, i) => (l.rotation.x = sp ? Math.sin(t * sp + i * Math.PI / 2 * (i % 2 ? 1 : -1)) * 0.6 : 0));
    if (s === 'stuck') { hx = -0.3; body.rotation.z = Math.sin(t * 20) * 0.08; } else body.rotation.z = 0;
    head.rotation.x += (hx - head.rotation.x) * 0.3;
    body.rotation.x = s === 'attack' ? 0.12 : 0;
  } };
}
function buildWarden(mats) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const st = mats.add(0x7d7a74), dk = mats.add(0x4f4c48);
  body.add(part(new THREE.BoxGeometry(2.0, 1.8, 1.2), st, 0, 2.6, 0));
  body.add(part(new THREE.BoxGeometry(1.4, 0.6, 1.0), dk, 0, 1.5, 0));
  const head = part(new THREE.BoxGeometry(0.9, 0.8, 0.9), st, 0, 3.9, 0.1); body.add(head);
  const visor = mats.add(0x40e0ff, true); visor.emissive.setHex(0x20a0c0);
  body.add(part(new THREE.BoxGeometry(0.7, 0.12, 0.05), visor, 0, 3.95, 0.57));
  const core = mats.add(0xffd040, true); core.emissive.setHex(0x000000);
  body.add(part(new THREE.BoxGeometry(0.6, 0.6, 0.1), core, 0, 2.7, -0.62)); // weak spot on the back
  for (const sx of [-1, 1]) body.add(part(new THREE.BoxGeometry(0.6, 1.4, 0.7), dk, sx * 0.5, 0.7, 0));
  const arms = [];
  for (const sx of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(sx * 1.25, 3.2, 0); body.add(a);
    a.add(part(new THREE.BoxGeometry(0.6, 1.6, 0.6), st, 0, -0.7, 0));
    a.add(part(new THREE.BoxGeometry(0.85, 0.75, 0.85), dk, 0, -1.7, 0));
    arms.push(a);
  }
  return { g, body, core, visor, anim(s, stt, T, t, e) {
    let ax = 0, az = 0, bx = 0, y = 0;
    if (s === 'tell') { const p = Math.min(1, stt / 0.6); if (e.kind === 'sweep') { az = 1.4 * p; } else { ax = -2.8 * p; bx = -0.15 * p; } }
    else if (s === 'attack') { if (e.kind === 'sweep') { az = 1.4; body.rotation.y = Math.min(1, stt / 0.4) * Math.PI * 2; } else { ax = -0.4; bx = 0.35; } }
    else if (s === 'stuck') { ax = -0.4; bx = 0.45; y = -0.4; }
    else if (s === 'chase') y = Math.abs(Math.sin(t * 4)) * 0.08;
    if (!(s === 'attack' && e.kind === 'sweep')) body.rotation.y = 0;
    arms.forEach((a, i) => { a.rotation.x += (ax - a.rotation.x) * 0.25; a.rotation.z += ((i ? -az : az) - a.rotation.z) * 0.25; });
    body.rotation.x += (bx - body.rotation.x) * 0.25; body.position.y += (y - body.position.y) * 0.2;
    core.emissive.setHex(s === 'stuck' ? (Math.sin(t * 16) > 0 ? 0xffaa00 : 0x804000) : 0x201000);
    visor.emissive.setHex(s === 'tell' ? 0xff3010 : 0x20a0c0);
  } };
}
const BUILDERS = { mossling: buildMossling, grubkin: buildGrubkin, boar: buildBoar, warden: buildWarden };

export class EnemyView {
  constructor(scene, e) {
    this.scene = scene; this.id = e.id; this.type = e.type; this.T = ENEMY_TYPES[e.type];
    this.mats = []; const self = this;
    const mats = { add(c) { const m = lam(c); self.mats.push(m); return m; } };
    const b = BUILDERS[e.type](mats);
    this.root = new THREE.Group(); this.root.add(b.g); this.b = b;
    if (this.T.boss) b.g.scale.setScalar(1.0);
    scene.add(this.root);
    // health bar (sprites always face the camera)
    this.bar = new THREE.Group();
    const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x220000, depthTest: false }));
    this.fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xe03030, depthTest: false }));
    const bw = this.T.boss ? 2.4 : 1.2; this.bw = bw;
    bg.scale.set(bw + 0.06, 0.16, 1); this.fill.scale.set(bw, 0.1, 1); bg.renderOrder = 11; this.fill.renderOrder = 12;
    this.bar.add(bg, this.fill); this.bar.position.y = this.T.boss ? 5 : this.type === 'boar' ? 2.2 : 2.1; this.bar.visible = false;
    this.root.add(this.bar);
    // telegraph ring (danger zone)
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.5, depthWrite: false }));
    this.ring.visible = false; scene.add(this.ring);
    this.flashT = 0; this.deadT = 0; this.x = e.x; this.z = e.z; this.ry = e.ry || 0; this.lastHp = e.hp; this.showBarT = 0;
  }
  flash(c = 0xffffff) { this.flashT = 0.12; this.flashC = c; }
  update(e, dt, t, height, camera, locked) {
    // interpolate toward authoritative position
    const k = 1 - Math.exp(-dt * 14);
    this.x += (e.x - this.x) * k; this.z += (e.z - this.z) * k;
    let dr = e.ry - this.ry; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); this.ry += dr * k;
    this.root.position.set(this.x, height(this.x, this.z), this.z); this.root.rotation.y = this.ry;
    if (e.hp < this.lastHp) { this.flash(); this.showBarT = 4; }
    this.lastHp = e.hp;
    if (!e.alive) {
      this.deadT += dt; const s = Math.max(0.001, 1 - this.deadT * 3);
      this.root.scale.setScalar(s); this.root.visible = this.deadT < 0.4; this.ring.visible = false; return;
    }
    if (this.deadT) { this.deadT = 0; this.root.scale.setScalar(1); }
    this.root.visible = true;
    this.b.anim(e.state, e.st, this.T, t, e);
    this.flashT -= dt;
    const tell = e.state === 'tell';
    for (const m of this.mats) if (m !== this.b.core && m !== this.b.visor && m !== this.b.eyes) m.emissive.setHex(this.flashT > 0 ? 0x888888 : tell && Math.sin(t * 25) > 0 ? 0x661010 : 0x000000);
    // danger ring on tells (bigger attacks only)
    if (tell && (this.type === 'warden' || this.type === 'boar')) {
      const p = Math.min(1, e.st / (e.kind === 'sweep' ? 0.8 : this.T.tell));
      this.ring.visible = true;
      let rx = this.x, rz = this.z, r = 1.5;
      if (this.type === 'warden') { if (e.kind === 'slam') { rx += Math.sin(this.ry) * 2.4; rz += Math.cos(this.ry) * 2.4; r = 2.6; } else r = 4; }
      else { rx += Math.sin(this.ry) * 4; rz += Math.cos(this.ry) * 4; r = 1.2; }
      this.ring.position.set(rx, height(rx, rz) + 0.08, rz); this.ring.scale.setScalar(r * (0.3 + 0.7 * p));
      this.ring.material.opacity = 0.3 + p * 0.4;
    } else this.ring.visible = false;
    this.showBarT -= dt;
    this.bar.visible = !!(locked || this.showBarT > 0 || this.T.boss);
    if (this.bar.visible) { const f = Math.max(0.01, e.hp / (e.max || this.T.hp)); this.fill.scale.x = this.bw * f; this.fill.center.set(0.5 / f, 0.5); }
  }
  dispose() { this.scene.remove(this.root); this.scene.remove(this.ring); }
}
