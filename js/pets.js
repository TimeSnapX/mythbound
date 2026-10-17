// Pet companions: Dog, Cat or Bird. Chunky low-poly models with follow + idle animation.
import * as THREE from 'three';
const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const part = (g, w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };

export function buildPet(type) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const P = { root, body, type, legs: [], t: 0 };
  if (type === 'dog' || type === 'cat') {
    const dog = type === 'dog';
    const fur = lam(dog ? 0xb07a40 : 0x5a5a62), dark = lam(dog ? 0x6a4420 : 0x2a2a30), eye = lam(0x111111);
    const s = dog ? 1 : 0.75;
    part(body, 0.42 * s, 0.36 * s, 0.8 * s, fur, 0, 0.42 * s, 0);
    const head = new THREE.Group(); head.position.set(0, 0.62 * s, 0.45 * s); body.add(head); P.head = head;
    part(head, 0.34 * s, 0.32 * s, 0.32 * s, fur, 0, 0, 0);
    part(head, 0.18 * s, 0.14 * s, 0.18 * s, dark, 0, -0.06 * s, 0.2 * s);
    for (const sx of [-1, 1]) {
      part(head, 0.05, 0.05, 0.02, eye, sx * 0.08 * s, 0.05 * s, 0.17 * s);
      if (dog) { const e = part(head, 0.08, 0.2, 0.1, dark, sx * 0.17, 0.06, -0.04); e.rotation.z = sx * 0.3; }
      else { const e = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 4), fur); e.position.set(sx * 0.09, 0.18, 0); head.add(e); }
    }
    const tail = new THREE.Group(); tail.position.set(0, 0.52 * s, -0.4 * s); body.add(tail); P.tail = tail;
    const tm = part(tail, 0.07, 0.07, dog ? 0.32 : 0.45, dark, 0, 0, -0.15); tm.rotation.x = dog ? -0.6 : -1.0;
    for (const [x, z] of [[-0.13, 0.27], [0.13, 0.27], [-0.13, -0.27], [0.13, -0.27]]) { const l = new THREE.Group(); l.position.set(x * s, 0.3 * s, z * s); part(l, 0.1 * s, 0.3 * s, 0.1 * s, dark, 0, -0.15 * s, 0); body.add(l); P.legs.push(l); }
  } else {
    const feath = lam(0x3aa0d8), belly = lam(0xffe080), beak = lam(0xffa020);
    part(body, 0.26, 0.26, 0.36, feath, 0, 0, 0); part(body, 0.2, 0.16, 0.2, belly, 0, -0.06, 0.08);
    const head = new THREE.Group(); head.position.set(0, 0.18, 0.16); body.add(head); P.head = head;
    part(head, 0.2, 0.2, 0.2, feath, 0, 0, 0); const bk = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), beak); bk.rotation.x = Math.PI / 2; bk.position.set(0, -0.02, 0.15); head.add(bk);
    P.wings = [-1, 1].map((sx) => { const w = new THREE.Group(); w.position.set(sx * 0.13, 0.05, 0); body.add(w); part(w, 0.3, 0.04, 0.24, feath, sx * 0.15, 0, 0); return w; });
    part(body, 0.12, 0.04, 0.24, feath, 0, 0.02, -0.26);
  }
  return P;
}
// move toward a point near the owner; idle when close
export function updatePet(P, owner, dt, heightAt, t) {
  P.t += dt;
  const fly = P.type === 'bird';
  const want = { x: owner.x - Math.sin(owner.ry + 0.9) * 1.6, z: owner.z - Math.cos(owner.ry + 0.9) * 1.6 };
  if (P.x === undefined) { P.x = want.x; P.z = want.z; P.ry = 0; P.y = heightAt(want.x, want.z); }
  const dx = want.x - P.x, dz = want.z - P.z, d = Math.hypot(dx, dz);
  if (d > 30) { P.x = want.x; P.z = want.z; }
  const sp = d > 0.4 ? Math.min(d * 3, 10) : 0;
  if (sp) { P.x += (dx / d) * sp * dt; P.z += (dz / d) * sp * dt; P.ry += (Math.atan2(Math.sin(Math.atan2(dx, dz) - P.ry), Math.cos(Math.atan2(dx, dz) - P.ry))) * Math.min(1, dt * 8); }
  P.moving = sp > 0.3;
  const g = heightAt(P.x, P.z);
  P.y += ((fly ? Math.max(g, owner.y) + 2.2 + Math.sin(t * 2.5) * 0.25 : g) - P.y) * Math.min(1, dt * 10);
  P.root.position.set(P.x, P.y, P.z); P.root.rotation.y = P.ry;
  if (fly) { const f = Math.sin(t * (P.moving ? 26 : 10)) * 0.8; P.wings[0].rotation.z = f; P.wings[1].rotation.z = -f; }
  else {
    P.legs.forEach((l, i) => (l.rotation.x = P.moving ? Math.sin(t * 14 + (i % 2 ? 0 : Math.PI) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 : 0));
    if (P.tail) P.tail.rotation.y = Math.sin(t * (P.type === 'dog' ? 12 : 2)) * (P.type === 'dog' ? 0.6 : 0.3);
    P.body.position.y = P.moving ? Math.abs(Math.sin(t * 14)) * 0.04 : 0;
  }
  if (P.head) P.head.rotation.y = P.moving ? 0 : Math.sin(t * 0.8) * 0.5; // idle: looks around
}
