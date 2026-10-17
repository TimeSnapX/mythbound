// v2 overworld additions: Emberfall Ridge (ash, basalt, lava glow), the Ember Bridge, Ashfall Camp, Hearthstones,
// Fade fog patches, the Fade-echo, Cinderdeep Mine entrance and bomb-able secret caches (isle + ridge).
import * as THREE from 'three';
import { terrainHeight, islandHeight, fbm, RIDGE, CAMP, VOLCANO, MINE_ENTRANCE, LAVA_POOLS, FADE_PATCHES, HEARTHSTONES, FADE_ECHO, SECRETS, BRIDGE, bridgeDeck } from './shared.js';
import { mat, makeLabel, mergeStatic } from './world.js';

const MATS = {};
const M = (c) => (MATS[c] ||= mat(c));
function mesh(geo, color, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? M(color) : color);
  m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; return m;
}
const H = (x, z) => terrainHeight(x, z);

export function buildRidge(scene, W, { shadows = true } = {}) {
  const colliders = W.colliders;
  const R = { lava: [], fog: new Map(), hearths: new Map(), secrets: new Map(), flames: [], embers: null };
  // ---------- terrain ----------
  const SX = 200, SZ = 220, cx = 260, cz = -10;
  const geo = new THREE.PlaneGeometry(SX, SZ, 80, 88).rotateX(-Math.PI / 2).translate(cx, 0, cz).toNonIndexed();
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) pos.setY(i, H(pos.getX(i), pos.getZ(i)));
  const col = new THREE.Color();
  const segD = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)], h = (ys[0] + ys[1] + ys[2]) / 3, slope = Math.max(...ys) - Math.min(...ys);
    const n = fbm(x * 0.06, z * 0.06), j = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * 0.04;
    let lavaNear = 99; for (const p of LAVA_POOLS) lavaNear = Math.min(lavaNear, Math.hypot(x - p.x, z - p.z) - p.r);
    const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    const path = Math.min(segD(x, z, BRIDGE.x1, BRIDGE.z, CAMP.x, CAMP.z), segD(x, z, CAMP.x, CAMP.z, MINE_ENTRANCE.x - 4, MINE_ENTRANCE.z));
    if (h < -0.6) col.setHex(0x4a4440);
    else if (h < 1.0 && lavaNear > 3) col.setHex(0x7a7068);
    else if (lavaNear < 1.2) col.setHex(0xd8561e);
    else if (lavaNear < 3) col.setHex(0x7a2e1a);
    else if (dv < 9) col.setHex(0x8a2a18);
    else if (path < 2.2 && dv > 18) col.setHex(0x8a7a64);
    else if (slope > 2.4 || (h > 13 && dv > 12)) col.setHex(n > 0.5 ? 0x2c2828 : 0x3a3432);
    else if (dv < 26) col.setHex(0x4a3530);
    else if (n > 0.58) col.setHex(0x6a6a44);
    else col.setHex(0x625c56).lerp(new THREE.Color(0x76706a), Math.max(0, 0.55 - n));
    col.offsetHSL(0, 0, j);
    for (let k = 0; k < 3; k++) colors.set([col.r, col.g, col.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true; scene.add(terrain); R.terrain = terrain;

  const stat = new THREE.Group(); scene.add(stat);
  // ---------- the Ember Bridge ----------
  const plank = new THREE.BoxGeometry(1.0, 0.22, BRIDGE.hw * 2 + 0.4);
  for (let x = BRIDGE.x0; x <= BRIDGE.x1; x += 1.05) {
    const y = bridgeDeck(x, BRIDGE.z); if (y === null) continue;
    const p = mesh(plank, (Math.round(x) % 3) ? 0x8a6038 : 0x7a5230, x, y - 0.11, BRIDGE.z);
    const y2 = bridgeDeck(Math.min(BRIDGE.x1, x + 0.5), BRIDGE.z); p.rotation.z = Math.atan2(y2 - y, 0.5); stat.add(p);
  }
  const span = BRIDGE.x1 - BRIDGE.x0;
  for (let i = 0; i <= 12; i++) {
    const x = BRIDGE.x0 + (span * i) / 12, y = bridgeDeck(x, BRIDGE.z);
    for (const s of [-1, 1]) {
      stat.add(mesh(new THREE.BoxGeometry(0.22, 1.3, 0.22), 0x5a3a20, x, y + 0.55, BRIDGE.z + s * (BRIDGE.hw + 0.1)));
      if (i % 3 === 0 && i > 0 && i < 12) { // stilts down into the water
        const st = mesh(new THREE.BoxGeometry(0.45, y + 6, 0.45), 0x4a3020, x, (y - 6) / 2, BRIDGE.z + s * (BRIDGE.hw - 0.2)); stat.add(st);
      }
    }
    if (i < 12) {
      const xn = BRIDGE.x0 + (span * (i + 1)) / 12, yn = bridgeDeck(xn, BRIDGE.z), len = Math.hypot(xn - x, yn - y);
      for (const s of [-1, 1]) { const r = mesh(new THREE.BoxGeometry(len, 0.1, 0.1), 0x9a7048, (x + xn) / 2, (y + yn) / 2 + 1.1, BRIDGE.z + s * (BRIDGE.hw + 0.1)); r.rotation.z = Math.atan2(yn - y, xn - x); stat.add(r); }
    }
  }
  // the bridge's side rails block walking off; the deck itself is part of islandHeight()
  colliders.push({ minx: BRIDGE.x0 + 3, maxx: BRIDGE.x1 - 3, minz: BRIDGE.z + BRIDGE.hw, maxz: BRIDGE.z + BRIDGE.hw + 0.4 });
  colliders.push({ minx: BRIDGE.x0 + 3, maxx: BRIDGE.x1 - 3, minz: BRIDGE.z - BRIDGE.hw - 0.4, maxz: BRIDGE.z - BRIDGE.hw });
  const bl = makeLabel('The Ember Bridge', '#ffb070', 0.9); bl.position.set(BRIDGE.x0 + 2, bridgeDeck(BRIDGE.x0 + 2, BRIDGE.z) + 3, BRIDGE.z); scene.add(bl);

  // ---------- Ashfall Camp ----------
  const camp = new THREE.Group(); camp.position.set(CAMP.x, 3, CAMP.z); stat.add(camp);
  const tent = (x, z, ry, c) => { const t = mesh(new THREE.ConeGeometry(2.2, 2.6, 4), c, x, 1.3, z); t.rotation.y = ry + Math.PI / 4; camp.add(t); camp.add(mesh(new THREE.BoxGeometry(0.8, 1.2, 0.1), 0x2a1a10, x + Math.sin(ry) * 1.45, 0.6, z + Math.cos(ry) * 1.45)); colliders.push({ c: 1, x: CAMP.x + x, z: CAMP.z + z, r: 1.7 }); };
  tent(-5, -6, 0.3, 0xa8754a); tent(6, -7, -0.4, 0x7a5a8a); tent(-7, 5, 2.4, 0x6a8a5a);
  for (const [x, z] of [[4, 6], [5, 5], [4.6, 4.2]]) { camp.add(mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), 0x8a6a3a, x, 0.45, z)); }
  colliders.push({ c: 1, x: CAMP.x + 4.5, z: CAMP.z + 5, r: 1.2 });
  // campfire (cooking station)
  const fire = new THREE.Group(); fire.position.set(-1.5, 0, 1.5); camp.add(fire);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; fire.add(mesh(new THREE.DodecahedronGeometry(0.22, 0), 0x6a6a6a, Math.cos(a) * 0.6, 0.12, Math.sin(a) * 0.6)); }
  for (let i = 0; i < 3; i++) { const l = mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 5), 0x4a3020, 0, 0.15, 0); l.rotation.set(Math.PI / 2, i * 1.05, 0); fire.add(l); }
  const flameM = new THREE.MeshBasicMaterial({ color: 0xff8a20 });
  const fl = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), flameM); fl.position.y = 0.5; fire.add(fl); R.flames.push(fl);
  W.stations.push({ kind: 'range', x: CAMP.x - 1.5, z: CAMP.z + 1.5, label: 'Cook at the Campfire', obj: { position: new THREE.Vector3(CAMP.x - 1.5, 3, CAMP.z + 1.5) } });
  colliders.push({ c: 1, x: CAMP.x - 1.5, z: CAMP.z + 1.5, r: 0.6 });
  const fireLight = new THREE.PointLight(0xff8a30, 14, 18, 1.6); fireLight.position.set(CAMP.x - 1.5, 4.2, CAMP.z + 1.5); scene.add(fireLight);
  const cl = makeLabel('Ashfall Camp', '#ffcf7a', 1); cl.position.set(CAMP.x, 9, CAMP.z); scene.add(cl);

  // ---------- Hearthstones ----------
  for (const hs of HEARTHSTONES) {
    const g = new THREE.Group(); const y = H(hs.x, hs.z); g.position.set(hs.x, y, hs.z); scene.add(g);
    g.add(mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.4, 6), 0x5a5a60, 0, 0.2, 0));
    const pillar = mesh(new THREE.CylinderGeometry(0.4, 0.6, 2.4, 5), 0x7a8aa0, 0, 1.6, 0); g.add(pillar);
    const gemM = new THREE.MeshBasicMaterial({ color: 0x606870 });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), gemM); gem.position.y = 3.2; g.add(gem);
    const halo = new THREE.Mesh(new THREE.RingGeometry(hs.r - 0.3, hs.r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.18, depthWrite: false }));
    halo.position.y = 0.15; g.add(halo);
    const light = new THREE.PointLight(0xffd27a, 0, 16, 1.6); light.position.y = 3.4; g.add(light);
    colliders.push({ c: 1, x: hs.x, z: hs.z, r: 0.8 });
    R.hearths.set(hs.id, { ...hs, g, gem, halo, light, lit: false });
  }
  R.setHearthLit = (id, lit) => { const h = R.hearths.get(id); if (!h) return; h.lit = lit; h.gem.material.color.setHex(lit ? 0xffd27a : 0x606870); h.halo.visible = lit; h.light.intensity = lit ? 10 : 0; };
  for (const hs of HEARTHSTONES) R.setHearthLit(hs.id, hs.lit);

  // ---------- Fade fog patches ----------
  const fogMat = new THREE.MeshBasicMaterial({ color: 0xc8ccd2, transparent: true, opacity: 0.22, depthWrite: false, fog: false });
  const puff = new THREE.IcosahedronGeometry(1, 0);
  for (const f of FADE_PATCHES) {
    const g = new THREE.Group(); g.position.set(f.x, islandHeight(f.x, f.z), f.z); scene.add(g);
    const n = Math.round(f.r * 1.4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + i, r = (0.2 + ((i * 0.618) % 1) * 0.8) * f.r;
      const p = new THREE.Mesh(puff, fogMat); const s = 2.2 + ((i * 0.37) % 1) * 2.4;
      p.position.set(Math.cos(a) * r, 0.6 + ((i * 0.29) % 1) * 1.6, Math.sin(a) * r); p.scale.set(s * 1.6, s * 0.55, s * 1.6);
      p.userData = { a, r, s: 0.1 + ((i * 0.53) % 1) * 0.2 }; g.add(p);
    }
    const ring = new THREE.Mesh(new THREE.CircleGeometry(f.r, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.25, depthWrite: false }));
    ring.position.y = 0.25; g.add(ring);
    R.fog.set(f.id, { ...f, g, cleared: false });
  }
  R.setFogCleared = (id, c) => { const f = R.fog.get(id); if (f) { f.cleared = c; f.g.visible = !c; } };
  // the Fade-echo (quest 2): a pale wisp of a forgotten memory
  const echo = new THREE.Group(); echo.position.set(FADE_ECHO.x, H(FADE_ECHO.x, FADE_ECHO.z) + 1.4, FADE_ECHO.z); scene.add(echo);
  const echoCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 1), new THREE.MeshBasicMaterial({ color: 0xeaf4ff }));
  const echoRing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 4, 16), new THREE.MeshBasicMaterial({ color: 0xb8d8ff, transparent: true, opacity: 0.7 }));
  echo.add(echoCore, echoRing); R.echo = echo;

  // ---------- lava pools ----------
  const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff5a10 });
  for (const p of LAVA_POOLS) {
    const lm = new THREE.Mesh(new THREE.CircleGeometry(p.r + 0.6, 18).rotateX(-Math.PI / 2), lavaMat); lm.position.set(p.x, 0.75, p.z); scene.add(lm);
    const crust = new THREE.Group(); crust.position.set(p.x, 0.8, p.z); scene.add(crust);
    for (let i = 0; i < 5; i++) { const a = i * 1.3; const c = mesh(new THREE.DodecahedronGeometry(0.5 + (i % 2) * 0.3, 0), 0x2a2020, Math.cos(a) * p.r * 0.5, 0, Math.sin(a) * p.r * 0.5, false); c.scale.y = 0.3; crust.add(c); }
    const pl = new THREE.PointLight(0xff5a10, 8, 14, 1.6); pl.position.set(p.x, 2.2, p.z); scene.add(pl);
    R.lava.push({ ...p, lm, crust });
  }
  // ---------- basalt columns + charred stumps ----------
  const decor = new THREE.Group(); scene.add(decor);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = 20 + rnd() * 62, x = RIDGE.x + Math.cos(a) * r, z = RIDGE.z + Math.sin(a) * r * 0.9;
    const h = H(x, z); if (h < 1.5 || Math.hypot(x - CAMP.x, z - CAMP.z) < CAMP.r + 6 || Math.hypot(x - MINE_ENTRANCE.x, z - MINE_ENTRANCE.z) < 12 || Math.abs(z - BRIDGE.z) < 5) continue;
    if (LAVA_POOLS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2) || SECRETS.some((s) => Math.hypot(x - s.x, z - s.z) < 7) || Math.hypot(x - FADE_ECHO.x, z - FADE_ECHO.z) < 6) continue;
    const n = 3 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const ox = (rnd() - 0.5) * 2.4, oz = (rnd() - 0.5) * 2.4, ch = 1 + rnd() * 3.5;
      decor.add(mesh(new THREE.CylinderGeometry(0.45, 0.5, ch, 6), rnd() > 0.5 ? 0x2e2a2a : 0x3c3634, x + ox, h + ch / 2 - 0.2, z + oz));
    }
    colliders.push({ c: 1, x, z, r: 1.6, cam: 1.6, top: h + 3 });
  }
  for (let i = 0; i < 70; i++) { // ash drifts + small embers in cracks
    const a = rnd() * Math.PI * 2, r = 10 + rnd() * 75, x = RIDGE.x + Math.cos(a) * r, z = RIDGE.z + Math.sin(a) * r;
    const h = H(x, z); if (h < 1.2) continue;
    if (i % 4 === 0) decor.add(mesh(new THREE.BoxGeometry(0.16, 0.08, 0.16), new THREE.MeshBasicMaterial({ color: 0xff7030 }), x, h + 0.05, z, false));
    else { const b = mesh(new THREE.DodecahedronGeometry(0.35 + rnd() * 0.4, 0), 0x3a3432, x, h + 0.1, z, false); b.scale.y = 0.5; decor.add(b); }
  }
  mergeStatic(decor, { shadow: false });

  // ---------- Cinderdeep Mine entrance ----------
  const mx = MINE_ENTRANCE.x, mz = MINE_ENTRANCE.z, my = H(mx, mz);
  const mine = new THREE.Group(); mine.position.set(mx, my, mz); mine.rotation.y = -Math.PI / 2; stat.add(mine); // faces west
  for (const sx of [-1, 1]) { mine.add(mesh(new THREE.BoxGeometry(0.5, 4, 0.5), 0x5a3a20, sx * 1.9, 2, 0)); }
  mine.add(mesh(new THREE.BoxGeometry(4.6, 0.5, 0.6), 0x5a3a20, 0, 4.1, 0));
  mine.add(mesh(new THREE.BoxGeometry(3.3, 3.8, 0.2), new THREE.MeshBasicMaterial({ color: 0x080404 }), 0, 1.9, -0.25, false));
  const rocksL = mesh(new THREE.DodecahedronGeometry(3.2, 0), 0x3a3230, -4.5, 1.5, -2); rocksL.scale.set(1, 1.2, 1); mine.add(rocksL);
  const rocksR = mesh(new THREE.DodecahedronGeometry(3.2, 0), 0x3a3230, 4.5, 1.5, -2); rocksR.scale.set(1, 1.3, 1); mine.add(rocksR);
  mine.add(mesh(new THREE.DodecahedronGeometry(4.5, 0), 0x2e2828, 0, 4, -5));
  for (let i = 0; i < 6; i++) mine.add(mesh(new THREE.BoxGeometry(0.15, 0.1, 1.2), 0x6a6a70, (i % 2 ? 0.5 : -0.5), 0.05, 1 + i * 0.9));
  const cart = new THREE.Group(); cart.position.set(2.8, 0, 2.4); mine.add(cart);
  cart.add(mesh(new THREE.BoxGeometry(1.2, 0.7, 0.9), 0x6a5040, 0, 0.6, 0));
  for (const [px, pz] of [[-0.45, -0.35], [0.45, -0.35], [-0.45, 0.35], [0.45, 0.35]]) { const w = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 8), 0x2a2a2a, px, 0.2, pz); w.rotation.x = Math.PI / 2; cart.add(w); }
  // colliders: the rock body to the east of the door (door faces -x)
  colliders.push({ minx: mx + 0.4, maxx: mx + 9, minz: mz - 7, maxz: mz + 7, cam: 1, top: my + 6 });
  colliders.push({ c: 1, x: mx - 2.4, z: mz + 2.8, r: 0.9 });
  const ml = makeLabel('Cinderdeep Mine', '#ff9a50', 1); ml.position.set(mx, my + 6, mz); scene.add(ml);
  R.mineEntrance = { x: mx - 1.2, z: mz, y: my };
  const torchM = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  for (const s of [-1, 1]) { const tf = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), torchM); tf.position.set(mx - 0.8, my + 3.1, mz + s * 2.4); scene.add(tf); R.flames.push(tf); }

  // ---------- secret caches behind cracked walls (bombs!) ----------
  for (const sdef of SECRETS) {
    const y = islandHeight(sdef.x, sdef.z);
    const g = new THREE.Group(); g.position.set(sdef.x, y, sdef.z); g.rotation.y = sdef.ry; scene.add(g);
    const rc = sdef.x > 150 ? 0x3a3230 : 0x7d7f84;
    // horseshoe of boulders around an alcove that opens toward +z (local)
    for (const [bx, bz, s] of [[-2.3, -0.4, 1.6], [2.3, -0.4, 1.6], [0, -2.3, 1.9], [-1.6, -1.9, 1.3], [1.6, -1.9, 1.3]]) { const b = mesh(new THREE.DodecahedronGeometry(s, 0), rc, bx, s * 0.7, bz); b.scale.y = 1.25; g.add(b); }
    const roof = mesh(new THREE.DodecahedronGeometry(2.4, 0), rc, 0, 3.2, -1); roof.scale.y = 0.6; g.add(roof);
    const chest = new THREE.Group(); chest.position.set(0, 0, -0.6); g.add(chest);
    chest.add(mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), 0x8a5a2a, 0, 0.3, 0));
    const lid = new THREE.Group(); lid.position.set(0, 0.6, -0.35); chest.add(lid);
    lid.add(mesh(new THREE.BoxGeometry(1.15, 0.24, 0.75), 0xa06a30, 0, 0.12, 0.35));
    chest.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.08), 0xe0c040, 0, 0.5, 0.37));
    // the cracked wall that seals it
    const wall = new THREE.Group(); wall.position.set(0, 0, 1.4); g.add(wall);
    const wm = mesh(new THREE.BoxGeometry(3.4, 3, 0.9), sdef.x > 150 ? 0x4a3e3a : 0x8d8f94, 0, 1.5, 0); wall.add(wm);
    const crackM = new THREE.MeshBasicMaterial({ color: 0x1a1210 });
    for (const [cx2, cy, rz, l] of [[0, 1.6, 0.3, 1.8], [-0.4, 1.0, -0.9, 1.0], [0.5, 2.1, 1.1, 0.9], [0.2, 0.6, 0.5, 0.8]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(l, 0.08, 0.05), crackM); c.position.set(cx2, cy, 0.47); c.rotation.z = rz; wall.add(c); }
    const sign = makeLabel('cracked wall', '#c8b8a8', 0.6); sign.position.set(0, 3.4, 1.6); g.add(sign);
    g.updateMatrixWorld(true);
    const wp = new THREE.Vector3(); wall.getWorldPosition(wp);
    const cp = new THREE.Vector3(); chest.getWorldPosition(cp);
    const wcol = { c: 1, x: wp.x, z: wp.z, r: 1.6, cam: 1.6, top: y + 3 };
    colliders.push(wcol);
    for (const [bx, bz, s] of [[-2.3, -0.4, 1.4], [2.3, -0.4, 1.4], [0, -2.3, 1.7]]) { const v = new THREE.Vector3(bx, 0, bz).applyEuler(new THREE.Euler(0, sdef.ry, 0)); colliders.push({ c: 1, x: sdef.x + v.x, z: sdef.z + v.z, r: s }); }
    R.secrets.set(sdef.id, { ...sdef, g, wall, wcol, lid, sign, wx: wp.x, wz: wp.z, cx: cp.x, cz: cp.z, broken: false, opened: false });
  }
  R.setSecret = (id, broken, opened) => { const s = R.secrets.get(id); if (!s) return; s.broken = broken; s.opened = opened; s.wall.visible = !broken; s.wcol.disabled = broken; s.sign.visible = !broken; s.lid.rotation.x = opened ? -1.9 : 0; };

  mergeStatic(stat, { shadow: shadows });
  // ---------- ambient embers (follow the player around the ridge) ----------
  const eg = new THREE.BufferGeometry(), ep = new Float32Array(90 * 3);
  for (let i = 0; i < 90; i++) { ep[i * 3] = (rnd() - 0.5) * 40; ep[i * 3 + 1] = rnd() * 10; ep[i * 3 + 2] = (rnd() - 0.5) * 40; }
  eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  R.embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xff8a30, size: 0.18, transparent: true, opacity: 0.85 }));
  R.embers.frustumCulled = false; scene.add(R.embers);
  // volcano smoke plume
  R.smoke = [];
  const smokeM = new THREE.MeshLambertMaterial({ color: 0x3a3634, transparent: true, opacity: 0.55, flatShading: true });
  for (let i = 0; i < 8; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 0), smokeM); s.userData.k = i / 8; scene.add(s); R.smoke.push(s); }

  R.update = (t, dt, focus, zone) => {
    const inRidge = focus.x > 150 && focus.x < 1700;
    for (const f of R.flames) { f.scale.setScalar(0.85 + Math.sin(t * 13 + f.id) * 0.2); f.rotation.y = t * 3; }
    for (const l of R.lava) { l.crust.rotation.y = t * 0.05; }
    lavaMat.color.setHSL(0.04 + Math.sin(t * 1.5) * 0.012, 1, 0.5 + Math.sin(t * 2.3) * 0.05);
    echo.rotation.y = t * 1.2; echoRing.rotation.x = t * 2; echo.position.y = H(FADE_ECHO.x, FADE_ECHO.z) + 1.4 + Math.sin(t * 2) * 0.2;
    for (const f of R.fog.values()) if (!f.cleared && Math.abs(f.x - focus.x) < 90) f.g.children.forEach((p, i) => { if (!p.userData.a && p.userData.a !== 0) return; const a = p.userData.a + t * p.userData.s; p.position.x = Math.cos(a) * p.userData.r; p.position.z = Math.sin(a) * p.userData.r; });
    for (const h of R.hearths.values()) if (h.lit) { h.gem.rotation.y = t; h.gem.position.y = 3.2 + Math.sin(t * 2) * 0.12; h.halo.material.opacity = 0.14 + Math.sin(t * 3) * 0.05; }
    R.embers.visible = inRidge;
    if (inRidge) {
      R.embers.position.set(focus.x, H(focus.x, focus.z), focus.z);
      const a = eg.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) { a[i + 1] += dt * (0.6 + (i % 7) * 0.1); a[i] += Math.sin(t + i) * dt * 0.3; if (a[i + 1] > 10) a[i + 1] = 0; }
      eg.attributes.position.needsUpdate = true;
    }
    for (const s of R.smoke) { const k = (s.userData.k + t * 0.03) % 1; s.position.set(VOLCANO.x + Math.sin(k * 6 + s.userData.k * 9) * 3 * k, H(VOLCANO.x, VOLCANO.z) + 4 + k * 40, VOLCANO.z + k * 10); s.scale.setScalar(0.6 + k * 2.2); s.material.opacity = 0.5 * (1 - k); s.visible = Math.abs(focus.x - VOLCANO.x) < 250 && focus.x < 1700; }
  };
  R.setVisible = (v) => { terrain.visible = v; };
  return R;
}
