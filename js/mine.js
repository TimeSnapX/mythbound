// Dungeon 2 — Cinderdeep Mine (7 rooms): Lift Hall, Cart Junction (rail-switch puzzle), Bomb Vault (Blastcap Bombs),
// the Fault Line (cracked walls + secret cache), the Lava Crossing (bomb the pillar to bridge the lava),
// and Magmaw's Crucible (boss: lava lake with a central platform).
import * as THREE from 'three';
import { MINE_X } from './shared.js';
import { mat, makeLabel, mergeStatic } from './world.js';

const MX = MINE_X;
export const MINE_CP = { lava: { x: MX, z: -87 }, lavaN: { x: MX, z: -104.5 }, arena: { x: MX, z: -112 } };
export const ARENA = { x: MX, z: -129, r: 8.5 };
const LAVA_F = { minx: MX - 10, maxx: MX + 10, minz: -101, maxz: -91 };
export const MINE_SPAWNS = [
  { id: 'm_imp0', type: 'imp', x: MX + 5, z: -2 }, { id: 'm_imp1', type: 'imp', x: MX - 5, z: -3 },
  { id: 'm_hol0', type: 'hollowed', x: MX + 6, z: -26 }, { id: 'm_imp2', type: 'imp', x: MX - 7, z: -29 },
  { id: 'm_shell0', type: 'shellback', x: MX + 4, z: -46 }, { id: 'm_imp3', type: 'imp', x: MX - 4, z: -51 },
  { id: 'm_hol1', type: 'hollowed', x: MX - 5, z: -68 }, { id: 'm_hound0', type: 'hound', x: MX + 5, z: -73 },
  { id: 'm_magmaw', type: 'magmaw', x: MX, z: -141, cx: ARENA.x, cz: ARENA.z,
    spots: [[-12, 0], [12, 0], [0, -12], [-8.6, -8.6], [8.6, -8.6]].map(([dx, dz]) => ({ x: ARENA.x + dx, z: ARENA.z + dz })) },
];
let bridged = false;
export function mineLava(x, z) {
  if (x > LAVA_F.minx && x < LAVA_F.maxx && z > LAVA_F.minz && z < LAVA_F.maxz) return !(bridged && Math.abs(x - MX) < 1.3);
  if (z < -114 && z > -144 && Math.abs(x - MX) < 15) {
    if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r) return false;
    if (Math.abs(x - MX) < 2 && z > -121.5) return false;
    return true;
  }
  return false;
}
export function mineHeight(x, z) {
  if (mineLava(x, z)) return -0.6;
  if (bridged && x > LAVA_F.minx && x < LAVA_F.maxx && z > LAVA_F.minz - 0.5 && z < LAVA_F.maxz + 0.5) return 0.45; // walking on the toppled pillar
  return 0;
}

export function buildMine(scene) {
  const group = new THREE.Group(); scene.add(group);
  const colliders = [];
  const rock = mat(0x4a3a34), rockDark = mat(0x2e2522), floorM = mat(0x4a3e36), woodM = mat(0x6a4a2a), railM = mat(0x8a8a90);
  const add = (geo, m, x, y, z, g = group) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  const WALL_H = 3.6;
  const wall = (x0, z0, x1, z1) => {
    const minx = Math.min(x0, x1) - 0.5, maxx = Math.max(x0, x1) + 0.5, minz = Math.min(z0, z1) - 0.5, maxz = Math.max(z0, z1) + 0.5;
    add(new THREE.BoxGeometry(maxx - minx, WALL_H, maxz - minz), rock, MX + (minx + maxx) / 2, WALL_H / 2, (minz + maxz) / 2);
    colliders.push({ minx: MX + minx, maxx: MX + maxx, minz, maxz, cam: 1, top: WALL_H });
  };
  // room with door gaps (width 4) north/south and optional east gap [z0,z1]
  const room = (cz, hw, hd, doorN, doorS, eastGap, floor = true) => {
    if (floor) add(new THREE.BoxGeometry(hw * 2, 0.4, hd * 2), floorM, MX, -0.2, cz);
    const n = cz - hd, s = cz + hd;
    if (doorN) { wall(-hw, n, -2, n); wall(2, n, hw, n); } else wall(-hw, n, hw, n);
    if (doorS) { wall(-hw, s, -2, s); wall(2, s, hw, s); } else wall(-hw, s, hw, s);
    wall(-hw, n, -hw, s);
    if (eastGap) { wall(hw, n, hw, eastGap[0]); wall(hw, eastGap[1], hw, s); } else wall(hw, n, hw, s);
  };
  const corridor = (z0, z1) => { add(new THREE.BoxGeometry(4, 0.4, Math.abs(z1 - z0)), floorM, MX, -0.2, (z0 + z1) / 2); wall(-2.5, z0, -2.5, z1); wall(2.5, z0, 2.5, z1); };
  room(0, 9, 8, true, false);            // A: Lift Hall      z -8..8
  corridor(-8, -14);
  room(-24, 12, 10, true, true);         // B: Cart Junction  z -34..-14
  corridor(-34, -40);
  room(-48, 9, 8, true, true);           // C: Bomb Vault     z -56..-40
  corridor(-56, -62);
  room(-70, 10, 8, true, true, [-72, -68]); // D: Fault Line z -78..-62, east gap -> secret
  // E: secret cache (east of D)
  add(new THREE.BoxGeometry(8, 0.4, 8), floorM, MX + 14, -0.2, -70);
  wall(10, -74, 18, -74); wall(10, -66, 18, -66); wall(18, -74, 18, -66);
  corridor(-78, -84);
  // F: Lava Crossing z -108..-84 (floor split around a lava channel)
  add(new THREE.BoxGeometry(20, 0.4, 7), floorM, MX, -0.2, -87.5);
  add(new THREE.BoxGeometry(20, 0.4, 7), floorM, MX, -0.2, -104.5);
  room(-96, 10, 12, true, true, null, false);
  corridor(-108, -114);
  // G: Magmaw's Crucible z -144..-114
  room(-129, 15, 15, false, true, null, false);
  add(new THREE.CylinderGeometry(ARENA.r, ARENA.r + 0.6, 1.0, 16), floorM, ARENA.x, -0.5, ARENA.z);
  add(new THREE.BoxGeometry(4, 0.4, 7.5), floorM, MX, -0.2, -117.6);
  // lava surfaces
  const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff5a10 });
  const lavaF = new THREE.Mesh(new THREE.PlaneGeometry(20, 10).rotateX(-Math.PI / 2), lavaMat); lavaF.position.set(MX, -0.35, -96); group.add(lavaF);
  const lavaG = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), lavaMat); lavaG.position.set(MX, -0.4, -129); group.add(lavaG);
  // rails in room B: start (MX-10,-18) -> junction (MX,-18) -> buffer (MX+10,-18) | boulder (MX,-31)
  const railSeg = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0);
    for (const o of [-0.45, 0.45]) { const r = add(new THREE.BoxGeometry(0.1, 0.1, len), railM, (x0 + x1) / 2 + Math.cos(a) * o, 0.05, (z0 + z1) / 2 - Math.sin(a) * o); r.rotation.y = a; }
    for (let t = 0; t <= len; t += 1.2) { const s = add(new THREE.BoxGeometry(1.3, 0.08, 0.25), woodM, x0 + (x1 - x0) * t / len, 0.02, z0 + (z1 - z0) * t / len); s.rotation.y = a; }
  };
  railSeg(MX - 10, -18, MX, -18); railSeg(MX, -18, MX + 10, -18); railSeg(MX, -18, MX, -31.5);
  add(new THREE.BoxGeometry(0.4, 0.9, 1.4), woodM, MX + 10.6, 0.45, -18); // buffer stop
  // decoration: support beams, rubble, ore glints
  for (const z of [-4, -20, -28, -46, -66, -74, -88, -104, -118, -140]) {
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.35, WALL_H, 0.35), woodM, MX + s * (z < -113 ? 14.3 : z < -60 && z > -80 ? 9.3 : z < -38 && z > -58 ? 8.3 : z > -10 ? 8.3 : 11.3), WALL_H / 2, z);
  }
  for (let i = 0; i < 26; i++) { const z = -Math.random() * 82 + 6, m = add(new THREE.DodecahedronGeometry(0.2 + Math.random() * 0.35, 0), rockDark, MX + (Math.random() - 0.5) * 15, 0.1, z); if (z < -88) m.visible = false; }
  // lift platform (room A, south)
  add(new THREE.BoxGeometry(5, 0.3, 3), woodM, MX, 0.15, 5.2); for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.12, WALL_H, 0.12), mat(0x9a8a6a), MX + s * 2.3, WALL_H / 2, 5.2);
  // torches + lights
  const flames = [];
  const flameM = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  for (const [x, z] of [[-8.3, -2], [8.3, -2], [-11.3, -24], [11.3, -24], [-8.3, -48], [8.3, -48], [-9.3, -70], [-9.3, -87], [9.3, -87], [-14.3, -124], [14.3, -124], [-14.3, -136], [14.3, -136]]) {
    add(new THREE.BoxGeometry(0.15, 0.6, 0.15), woodM, MX + x, 2, z);
    const f = add(new THREE.OctahedronGeometry(0.22, 0), flameM, MX + x, 2.45, z); flames.push(f);
  }
  for (const [z, c] of [[0, 0xffa050], [-24, 0xffa050], [-48, 0xffa050], [-70, 0xff9040], [-96, 0xff5a10], [-129, 0xff5010]]) { const l = new THREE.PointLight(c, z < -90 ? 40 : 30, 32, 1.5); l.position.set(MX, 3.2, z); group.add(l); }
  mergeStatic(group);

  // ----- interactive pieces -----
  const exitM = new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.6 });
  const exitA = add(new THREE.TorusGeometry(1.1, 0.15, 6, 12), exitM, MX, 1.3, 7.3);
  const exitG = add(new THREE.TorusGeometry(1.1, 0.15, 6, 12), exitM, MX, 1.3, -125.5); exitG.visible = false;
  // switch lever
  const sw = new THREE.Group(); sw.position.set(MX - 3, 0, -15.6); group.add(sw);
  add(new THREE.BoxGeometry(0.6, 0.4, 0.6), rockDark, 0, 0.2, 0, sw);
  const swHandle = new THREE.Group(); swHandle.position.y = 0.4; sw.add(swHandle);
  add(new THREE.BoxGeometry(0.1, 1, 0.1), railM, 0, 0.5, 0, swHandle); add(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat(0xc03030), 0, 1, 0, swHandle);
  const swLabel = makeLabel('Rail switch: → buffer', '#ffcf7a', 0.7); swLabel.position.set(MX - 3, 2.2, -15.6); group.add(swLabel);
  // junction points (visual)
  const points = add(new THREE.BoxGeometry(1.2, 0.12, 0.3), mat(0xffd040), MX, 0.08, -18);
  // the cart
  const cart = new THREE.Group(); group.add(cart);
  add(new THREE.BoxGeometry(1.2, 0.75, 1.6), mat(0x6a5040), 0, 0.65, 0, cart);
  add(new THREE.BoxGeometry(1.0, 0.2, 1.4), mat(0x2a2a2a), 0, 1.0, 0, cart);
  for (const [px, pz] of [[-0.55, -0.5], [0.55, -0.5], [-0.55, 0.5], [0.55, 0.5]]) { const w = add(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8), mat(0x222222), px, 0.2, pz, cart); w.rotation.z = Math.PI / 2; }
  // the boulder that blocks B's north door
  const boulder = add(new THREE.DodecahedronGeometry(1.9, 0), mat(0x5a4a40), MX, 1.6, -33.2);
  const boulderCol = { c: 1, x: MX, z: -33.2, r: 2.1 }; colliders.push(boulderCol);
  // chests
  const makeChest = (x, z, color = 0x8a5a2a) => {
    const c = new THREE.Group(); c.position.set(x, 0, z); group.add(c);
    add(new THREE.BoxGeometry(1.4, 0.8, 0.9), mat(color), 0, 0.4, 0, c);
    const lid = new THREE.Group(); lid.position.set(0, 0.8, -0.45); c.add(lid);
    add(new THREE.BoxGeometry(1.45, 0.3, 0.95), mat(0xa06a30), 0, 0.15, 0.45, lid);
    add(new THREE.BoxGeometry(0.2, 0.25, 0.1), mat(0xe0c040), 0, 0.7, 0.47, c);
    colliders.push({ minx: x - 0.75, maxx: x + 0.75, minz: z - 0.5, maxz: z + 0.5, chest: 1 });
    return { obj: c, lid, x, z: z + 1.1, opened: false, col: colliders[colliders.length - 1] };
  };
  const bombChest = makeChest(MX, -53.5, 0x7a3a2a);
  const secretChest = makeChest(MX + 15, -70);
  const bossChest = makeChest(MX, -132); bossChest.obj.visible = false; bossChest.col.disabled = true;
  // cracked walls (bomb them)
  const crackM = new THREE.MeshBasicMaterial({ color: 0x140a06 });
  const cracked = [];
  const crackedWall = (id, flag, x, z, w, d, label) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); group.add(g);
    add(new THREE.BoxGeometry(w, WALL_H, d), mat(0x5e4a40), 0, WALL_H / 2, 0, g);
    const face = d < w ? [0, 0, d / 2 + 0.03] : [w / 2 + 0.03, 0, 0];
    for (const [cy, rz, l] of [[1.8, 0.4, 2], [1.1, -0.8, 1.2], [2.6, 1.0, 1], [0.6, 0.2, 0.9]]) {
      for (const sgn of [-1, 1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(d < w ? l : 0.05, 0.08, d < w ? 0.05 : l), crackM); c.position.set(face[0] * sgn, cy, face[2] * sgn); if (d < w) c.rotation.z = rz; else c.rotation.x = rz; g.add(c); }
    }
    const lb = makeLabel(label, '#c8b8a8', 0.6); lb.position.set(x, WALL_H + 0.6, z); group.add(lb);
    const col = { minx: x - w / 2, maxx: x + w / 2, minz: z - d / 2, maxz: z + d / 2, cam: 1, top: WALL_H };
    colliders.push(col);
    const c = { id, flag, x, z, r: Math.max(w, d) / 2 + 1.6, obj: g, col, label: lb, broken: false }; cracked.push(c); return c;
  };
  crackedWall('wall1', 'q3_wall', MX, -58.5, 4.2, 1.0, 'cracked wall');
  crackedWall('secret', 'm_secret', MX + 10, -70, 1.0, 4.2, 'cracked wall');
  // the cracked basalt pillar on the lava's south bank: bomb it and it topples into a bridge
  const pillar = new THREE.Group(); pillar.position.set(MX, 0, -89.6); group.add(pillar);
  const pcol = add(new THREE.CylinderGeometry(1.1, 1.3, 12, 6), mat(0x3a3030), 0, 6, 0, pillar);
  for (const [cy, rz] of [[1.2, 0.5], [2.2, -0.6], [3.4, 0.3]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.05), crackM); c.position.set(0, cy, 1.15); c.rotation.z = rz; pillar.add(c); }
  const pLabel = makeLabel('cracked pillar', '#c8b8a8', 0.6); pLabel.position.set(MX, 4.2, -88.2); group.add(pLabel);
  const pillarCol = { c: 1, x: MX, z: -89.6, r: 1.3, cam: 1.2, top: 12 }; colliders.push(pillarCol);
  cracked.push({ id: 'pillar', flag: 'q3_bridge', x: MX, z: -89.6, r: 3.4, obj: pillar, col: pillarCol, label: pLabel, broken: false, pillar: true });
  // bomb flowers (Blastcap mushrooms): pick for +3 bombs, regrow
  const flowers = [];
  for (const [id, x, z] of [['bf0', MX - 6, -43], ['bf1', MX + 6.5, -53], ['bf2', MX - 7, -86], ['bf3', MX - 4, -126], ['bf4', MX + 4, -132], ['bf5', MX + 7, -104]]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); group.add(g);
    add(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 5), mat(0xe8dcc0), 0, 0.25, 0, g);
    const cap = add(new THREE.SphereGeometry(0.42, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xd03a20), 0, 0.5, 0, g);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.1, 0.06, 0.1), mat(0xffffff), Math.cos(i * 1.6) * 0.25, 0.75, Math.sin(i * 1.6) * 0.25, g);
    flowers.push({ id, x, z, obj: g, cap, until: 0 });
  }
  // checkpoint banner + labels
  const al = makeLabel("Magmaw's Crucible", '#ff8a50', 1); al.position.set(MX, 4.5, -113); group.add(al);

  const PATH_BUF = [[MX - 10, -18], [MX, -18], [MX + 10, -18]], PATH_BOULDER = [[MX - 10, -18], [MX, -18], [MX, -31]];
  const D = {
    group, colliders, flames, cracked, flowers, height: mineHeight, lavaAt: mineLava,
    exitA: { x: MX, z: 6.6 }, exitG: { x: MX, z: -125.5, obj: exitG },
    sw: { x: MX - 3, z: -15, obj: sw, handle: swHandle, label: swLabel, on: false },
    cart: { obj: cart, x: MX - 10, z: -18, t: 0, moving: false, path: null, seg: 0, back: false, done: false },
    boulder: { obj: boulder, col: boulderCol, broken: false },
    bombChest, secretChest, bossChest, pillar: cracked[cracked.length - 1],
    setState(f) {
      D.sw.on = !!f.m_switch; swHandle.rotation.x = D.sw.on ? 0.6 : -0.6; points.rotation.y = D.sw.on ? Math.PI / 2 : 0;
      swLabel.material.map.dispose(); const nl = makeLabel(D.sw.on ? 'Rail switch: ↑ boulder' : 'Rail switch: → buffer', D.sw.on ? '#8cff9a' : '#ffcf7a', 0.7); swLabel.material.map = nl.material.map; swLabel.material.needsUpdate = true;
      D.boulder.broken = !!f.q3_cart; boulder.visible = !f.q3_cart; boulderCol.disabled = !!f.q3_cart;
      if (f.q3_cart && !D.cart.moving) { D.cart.x = MX; D.cart.z = -31; D.cart.done = true; } else if (!D.cart.moving) { D.cart.x = MX - 10; D.cart.z = -18; D.cart.done = false; }
      bombChest.opened = !!f.q3_bombs; bombChest.lid.rotation.x = f.q3_bombs ? -1.9 : 0;
      secretChest.opened = !!f.m_secret_chest; secretChest.lid.rotation.x = f.m_secret_chest ? -1.9 : 0;
      for (const c of cracked) {
        c.broken = !!f[c.flag]; c.col.disabled = c.broken; c.label.visible = !c.broken;
        if (c.pillar) { if (c.broken && !c.falling) { pillar.rotation.x = -Math.PI / 2; pillar.position.y = -0.7; pillar.position.z = -89.6; } else if (!c.broken) { pillar.rotation.x = 0; pillar.position.y = 0; } }
        else c.obj.visible = !c.broken;
      }
      bridged = !!f.q3_bridge;
      bossChest.obj.visible = !!f.q3_boss; bossChest.col.disabled = !f.q3_boss; exitG.visible = !!f.q3_boss;
      bossChest.opened = !!f.q3_shard; bossChest.lid.rotation.x = f.q3_shard ? -1.9 : 0;
      cart.position.set(D.cart.x, 0, D.cart.z); cart.rotation.y = D.cart.done ? 0 : Math.PI / 2;
    },
    // push the cart along the current route. returns the route name.
    pushCart() {
      const c = D.cart; if (c.moving || c.done) return null;
      c.path = D.sw.on ? PATH_BOULDER : PATH_BUF; c.seg = 0; c.moving = true; c.back = false; c.route = D.sw.on ? 'boulder' : 'buffer';
      return c.route;
    },
    // returns event names: 'boulder' when the cart smashes the boulder, 'buffer' when it bounces back
    update(t, dt) {
      const ev = [];
      flames.forEach((f, i) => { f.scale.setScalar(0.85 + Math.sin(t * 13 + i) * 0.2); f.rotation.y = t * 3 + i; });
      exitA.rotation.z = t; exitG.rotation.z = t;
      lavaMat.color.setHSL(0.04 + Math.sin(t * 1.3) * 0.012, 1, 0.5 + Math.sin(t * 2.1) * 0.05);
      const c = D.cart;
      if (c.moving) {
        const path = c.back ? [...c.path].reverse() : c.path, a = path[c.seg], b = path[c.seg + 1];
        const dx = b[0] - c.x, dz = b[1] - c.z, d = Math.hypot(dx, dz), sp = (c.back ? 4 : 9) * dt;
        cart.rotation.y = Math.atan2(dx, dz);
        if (d <= sp) { c.x = b[0]; c.z = b[1]; c.seg++; if (c.seg >= path.length - 1) {
          if (!c.back && c.route === 'boulder') { c.moving = false; c.done = true; ev.push('boulder'); }
          else if (!c.back) { c.back = true; c.seg = 0; ev.push('buffer'); }
          else { c.moving = false; c.back = false; ev.push('reset'); }
        } } else { c.x += (dx / d) * sp; c.z += (dz / d) * sp; }
        cart.position.set(c.x, 0, c.z);
      }
      const pl = D.pillar;
      if (pl.falling) { pl.ft = (pl.ft || 0) + dt; const k = Math.min(1, pl.ft / 0.9); pillar.rotation.x = -k * k * Math.PI / 2; pillar.position.y = -k * 0.7; if (k >= 1) { pl.falling = false; ev.push('bridge'); } }
      const now = performance.now();
      for (const f of flowers) { const on = !f.until || now > f.until; f.obj.visible = on; if (on) f.cap.scale.setScalar(1 + Math.sin(t * 4 + f.x) * 0.06); }
      return ev;
    },
    topple() { const pl = D.pillar; pl.falling = true; pl.ft = 0; bridged = true; },
    blocked(x, z) {
      if (mineLava(x, z)) return true;
      for (const c of colliders) {
        if (c.disabled) continue;
        if (c.c) { if (Math.hypot(x - c.x, z - c.z) < c.r + 0.6) return true; }
        else if (x > c.minx - 0.6 && x < c.maxx + 0.6 && z > c.minz - 0.6 && z < c.maxz + 0.6) return true;
      }
      return false;
    },
  };
  return D;
}
