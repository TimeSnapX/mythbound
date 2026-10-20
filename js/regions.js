// Mythbound v3 overworld additions: Frostspire Peaks, Sunscar Desert, Mirewood Swamp, Starfall Coast, their causeways,
// towns, Hearthstones, the Frostspire shrine, the pyramid, the Ashfall Arena, the Fadelands, the stable, plus weather
// particles (rain / snow / sand / ash) and swamp fireflies. Phone budget: one vertex-coloured terrain mesh per region
// (60x60 segments), instanced decor, merged static props, a single 700-particle weather system and no extra lights.
import * as THREE from 'three';
import { terrainHeight, islandHeight, fbm, REGIONS, BRIDGES3, bridge3Deck, OASIS, PORT, SHRINE, PYRAMID, SANDWORM_PIT, WYRM_LAIR, V3_HEARTHS, ARENA, FADELANDS, STABLE, ASHWOLF_DEN, regionAt } from './shared.js';
import { mat, makeLabel, mergeStatic } from './world.js';

const MATS = {}; const M = (c) => (MATS[c] ||= mat(c));
const mesh = (geo, color, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, typeof color === 'number' ? M(color) : color); m.position.set(x, y, z); return m; };
const H = (x, z) => islandHeight(x, z);
export const REGION_FOG = { frost: 0xdce8f4, desert: 0xf0d8a8, swamp: 0x7a8a6a, coast: 0xa8d8f0 };

function regionTerrain(k, R, scene) {
  const S = R.r * 2.6, seg = 64;
  const geo = new THREE.PlaneGeometry(S, S, seg, seg).rotateX(-Math.PI / 2).translate(R.x, 0, R.z).toNonIndexed();
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)], h = (ys[0] + ys[1] + ys[2]) / 3, slope = Math.max(...ys) - Math.min(...ys), n = fbm(x * 0.06, z * 0.06);
    if (k === 'frost') col.setHex(h < -0.6 ? 0x6a7a88 : h < 1.0 ? 0xb8c8d8 : slope > 2.6 ? 0x8a929c : h > 22 ? 0xf8fbff : n > 0.55 ? 0xe4eef6 : 0xd4e2ee);
    else if (k === 'desert') col.setHex(h < -0.6 ? 0xb89a68 : h < 0.8 ? 0x5a9a6a : slope > 2.4 ? 0xc0884a : n > 0.56 ? 0xe8c486 : 0xf0d49a);
    else if (k === 'swamp') col.setHex(h < -0.4 ? 0x3a4a2a : h < 0.6 ? 0x4a5a2a : n > 0.52 ? 0x3a5a2a : 0x56703a);
    else col.setHex(h < -0.6 ? 0xc9b77a : h < 1.6 ? 0xf0e0a8 : n > 0.55 ? 0x4f9a45 : 0x6ab052);
    col.offsetHSL(0, 0, ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * 0.03);
    for (let j = 0; j < 3; j++) colors.set([col.r, col.g, col.b], (i + j) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geo.computeVertexNormals();
  const t = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })); t.receiveShadow = true; scene.add(t); return t;
}
function instanced(geo, color, pts, scene, sc = () => 1) {
  const im = new THREE.InstancedMesh(geo, M(color), Math.max(1, pts.length)), d = new THREE.Object3D();
  pts.forEach((p, i) => { d.position.set(p.x, p.y ?? H(p.x, p.z), p.z); d.rotation.set(0, p.r || 0, 0); d.scale.setScalar(sc(p, i)); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
  im.count = pts.length; im.computeBoundingSphere(); scene.add(im); return im;
}
function scatter(k, n, seed, minH = 0.6, maxH = 40) {
  const R = REGIONS[k], out = []; let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n * 6 && out.length < n; i++) {
    const a = rnd() * 6.28, r = Math.sqrt(rnd()) * R.r, x = R.x + Math.cos(a) * r, z = R.z + Math.sin(a) * r, h = H(x, z);
    if (regionAt(x, z) !== k || h < minH || h > maxH) continue; out.push({ x, z, r: rnd() * 6.28, s: 0.6 + rnd() * 0.8 });
  }
  return out;
}
function house(g, x, z, ry, wall, roof, w = 4, d = 3.4, flat = false, W) {
  const y = H(x, z), o = new THREE.Group(); o.position.set(x, y, z); o.rotation.y = ry; g.add(o);
  o.add(mesh(new THREE.BoxGeometry(w, 2.6, d), wall, 0, 1.3, 0));
  if (flat) o.add(mesh(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4), roof, 0, 2.75, 0));
  else { const r = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.6, 4), roof, 0, 3.4, 0); r.rotation.y = Math.PI / 4; r.scale.z = d / w; o.add(r); }
  o.add(mesh(new THREE.BoxGeometry(0.9, 1.6, 0.1), 0x4a3020, 0, 0.8, d / 2 + 0.03));
  const c = Math.cos(ry), s = Math.sin(ry), hw = w / 2, hd = d / 2;
  W.colliders.push({ minx: x - (Math.abs(c) * hw + Math.abs(s) * hd), maxx: x + (Math.abs(c) * hw + Math.abs(s) * hd), minz: z - (Math.abs(s) * hw + Math.abs(c) * hd), maxz: z + (Math.abs(s) * hw + Math.abs(c) * hd), cam: 1, top: 4 });
}
function label(scene, text, color, x, z, dy = 3, s = 0.9) { const l = makeLabel(text, color, s); l.position.set(x, H(x, z) + dy, z); scene.add(l); return l; }

export function buildRegions(scene, W, { shadows = false, quality = 'low' } = {}) {
  const R3 = { terrains: {}, hearths: new Map(), stalls: [], stations: [] };
  for (const [k, R] of Object.entries(REGIONS)) R3.terrains[k] = regionTerrain(k, R, scene);
  // bigger sea so the new coasts sit in water
  if (W.water) { W.water.scale.set(1.25, 1, 1.4); W.water.position.x = -15; }
  const stat = new THREE.Group(); scene.add(stat);
  // ---- causeways (instanced planks + posts) ----
  const planks = [], posts = [];
  for (const B of BRIDGES3) {
    for (let u = B.s0; u <= B.s1; u += 1.05) { const [x, z] = B.axis === 'z' ? [B.c, u] : [u, B.c]; planks.push({ x, z, y: bridge3Deck(x, z) - 0.11, r: B.axis === 'z' ? Math.PI / 2 : 0 }); }
    for (let i = 0; i <= 10; i++) { const u = B.s0 + (B.s1 - B.s0) * i / 10; for (const sd of [-1, 1]) { const [x, z] = B.axis === 'z' ? [B.c + sd * (B.hw + 0.1), u] : [u, B.c + sd * (B.hw + 0.1)]; posts.push({ x, z, y: bridge3Deck(B.axis === 'z' ? B.c : u, B.axis === 'z' ? u : B.c) - 1.5 }); } }
  }
  instanced(new THREE.BoxGeometry(1.0, 0.22, 4.2), 0x8a6038, planks, scene);
  instanced(new THREE.BoxGeometry(0.22, 4.2, 0.22), 0x6b4a2e, posts, scene);
  const signs = { north: ['Frostspire Peaks ↑', '#cfe8ff'], south: ['Sunscar Desert ↓', '#ffd890'], west: ['← Mirewood Swamp', '#b0e0a0'], coast: ['Starfall Coast ↓', '#a0e0ff'] };
  for (const B of BRIDGES3) { const u = B.s0 + 2, [x, z] = B.axis === 'z' ? [B.c + 3, B.axis === 'z' && B.id === 'north' ? B.s1 - 2 : u] : [B.s1 - 2, B.c + 3]; label(scene, ...signs[B.id], x, z, 2.6, 0.8); }
  // ---- decor ----
  const F = REGIONS.frost, D = REGIONS.desert, S = REGIONS.swamp, C = REGIONS.coast;
  instanced(new THREE.DodecahedronGeometry(1, 0), 0xf4f8ff, scatter('frost', 60, 11, 0.5), scene, (p) => p.s);             // snow drifts
  instanced(new THREE.DodecahedronGeometry(0.9, 0), 0x8a929c, scatter('frost', 30, 12, 0.5), scene, (p) => p.s);            // boulders
  instanced(new THREE.ConeGeometry(0.6, 1.6, 5), 0xc8a060, scatter('desert', 50, 21, 0.6), scene, (p) => p.s * 0.6);        // sandstone spires
  instanced(new THREE.BoxGeometry(0.5, 0.5, 0.5), 0xe8e0d0, scatter('desert', 18, 22, 0.6), scene, (p) => p.s * 0.6);        // bones
  instanced(new THREE.CylinderGeometry(0.05, 0.08, 1.4, 3), 0x6a7a3a, scatter('swamp', 160, 31, -0.2, 2), scene, (p) => p.s); // reeds
  instanced(new THREE.CylinderGeometry(1.4, 1.4, 0.08, 7), 0x5a7a2a, scatter('swamp', 26, 32, -2, 0.4).map((p) => ({ ...p, y: 0.02 })), scene, (p) => p.s); // lily pads / bog slick
  instanced(new THREE.ConeGeometry(0.3, 0.3, 5), 0xf0d0c0, scatter('coast', 40, 41, 0.2, 1.8), scene, (p) => p.s);          // shells
  // ---- towns ----
  const town = new THREE.Group(); stat.add(town);
  // Oasis (Sunscar): flat-roof houses, merchant stall, bank, apothecary bench, pool palms
  house(town, OASIS.x - 8, OASIS.z - 4, 0.2, 0xe0c890, 0xb89060, 4.2, 3.6, true, W); house(town, OASIS.x - 7, OASIS.z + 7, -0.3, 0xe8d0a0, 0xa07848, 3.6, 3.2, true, W); house(town, OASIS.x + 2, OASIS.z - 10, 0, 0xd8bc80, 0xa07848, 5, 3.6, true, W);
  const stall = (x, z, ry, cloth) => { const y = H(x, z), o = new THREE.Group(); o.position.set(x, y, z); o.rotation.y = ry; town.add(o); o.add(mesh(new THREE.BoxGeometry(2.4, 1, 1.2), 0x8a6038, 0, 0.5, 0)); for (const sx of [-1.1, 1.1]) o.add(mesh(new THREE.BoxGeometry(0.1, 2.4, 0.1), 0x6b4a2e, sx, 1.2, 0.5)); o.add(mesh(new THREE.BoxGeometry(2.6, 0.08, 1.6), cloth, 0, 2.4, 0.2)); W.colliders.push({ c: 1, x, z, r: 1.2 }); };
  stall(OASIS.x + 3, OASIS.z + 2, Math.PI, 0xd04040); stall(OASIS.x - 2, OASIS.z + 5, Math.PI, 0x4060d0);
  stall(PORT.x + 3, PORT.z + 3, Math.PI, 0x2a7aa0); stall(PORT.x - 4, PORT.z + 5, Math.PI, 0xa07a2a);
  // Starfall port: houses, pier and boats
  house(town, PORT.x - 7, PORT.z - 6, 0.1, 0xd8d0c0, 0x4a6a9a, 4, 3.4, false, W); house(town, PORT.x + 7, PORT.z - 5, -0.2, 0xe0d8c8, 0x9a4a3a, 4, 3.4, false, W); house(town, PORT.x + 8, PORT.z + 7, 0.3, 0xd0c8b8, 0x4a6a9a, 3.6, 3, false, W);
  const pierZ0 = PORT.z + 10; for (let i = 0; i < 14; i++) { const z = pierZ0 + i * 1.4; town.add(mesh(new THREE.BoxGeometry(2.6, 0.2, 1.3), 0x8a6038, PORT.x, 1.1, z)); }
  for (const [bx, bz, c] of [[PORT.x + 5, pierZ0 + 12, 0x7a4a2a], [PORT.x - 6, pierZ0 + 16, 0x5a3a2a]]) { const b = new THREE.Group(); b.position.set(bx, 0.1, bz); town.add(b); b.add(mesh(new THREE.BoxGeometry(2.2, 0.9, 5.5), c, 0, 0.3, 0)); b.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.5, 4), 0x5a3a2a, 0, 2.6, 0)); b.add(mesh(new THREE.BoxGeometry(0.05, 2.6, 2.2), 0xf0e8d0, 0, 3, 0.4)); }
  R3.pier = { x: PORT.x, z: pierZ0 + 18 };
  // ---- Hearthstones ----
  for (const q of V3_HEARTHS) {
    const y = H(q.x, q.z), g = new THREE.Group(); g.position.set(q.x, y, q.z); stat.add(g);
    g.add(mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.4, 8), 0x7a7a80, 0, 0.2, 0)); g.add(mesh(new THREE.BoxGeometry(0.7, 1.8, 0.5), 0x8a8a94, 0, 1.2, 0));
    const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: 0x555555 })); glow.position.set(q.x, y + 2.4, q.z); scene.add(glow);
    W.colliders.push({ c: 1, x: q.x, z: q.z, r: 0.6 });
    R3.hearths.set(q.id, { ...q, glow, lit: false });
  }
  R3.setHearth = (id, lit) => { const h = R3.hearths.get(id); if (!h) return; h.lit = lit; h.glow.material.color.setHex(lit ? 0xffd27a : 0x555555); };
  // ---- Frostspire summit shrine ----
  { const y = H(SHRINE.x, SHRINE.z), g = new THREE.Group(); g.position.set(SHRINE.x, y, SHRINE.z); stat.add(g);
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; g.add(mesh(new THREE.BoxGeometry(0.6, 3.2, 0.6), 0xc8d8e8, Math.cos(a) * 4, 1.6, Math.sin(a) * 4)); }
    g.add(mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.3, 6), 0xa8b8c8, 0, 3.3, 0)); g.add(mesh(new THREE.BoxGeometry(1.2, 1, 1.2), 0x8aa8c8, 0, 0.5, 0));
    R3.shrine = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color: 0x80d0ff })); R3.shrine.position.set(SHRINE.x, y + 1.6, SHRINE.z); scene.add(R3.shrine);
    label(scene, 'Frostspire Shrine', '#cfe8ff', SHRINE.x, SHRINE.z, 5); }
  // ---- the ruined pyramid (Sunscar) ----
  { const y = H(PYRAMID.x, PYRAMID.z), g = new THREE.Group(); g.position.set(PYRAMID.x, y - 0.5, PYRAMID.z); stat.add(g);
    for (let i = 0; i < 6; i++) g.add(mesh(new THREE.BoxGeometry(18 - i * 3, 2, 18 - i * 3), i % 2 ? 0xd8b878 : 0xc8a868, 0, 1 + i * 2, -9));
    g.add(mesh(new THREE.BoxGeometry(2.6, 3.2, 0.2), new THREE.MeshBasicMaterial({ color: 0x0a0806 }), 0, 1.6, 0.05));
    W.colliders.push({ minx: PYRAMID.x - 9, maxx: PYRAMID.x - 1.5, minz: PYRAMID.z - 18, maxz: PYRAMID.z, cam: 1, top: 12 }, { minx: PYRAMID.x + 1.5, maxx: PYRAMID.x + 9, minz: PYRAMID.z - 18, maxz: PYRAMID.z, cam: 1, top: 12 }, { minx: PYRAMID.x - 9, maxx: PYRAMID.x + 9, minz: PYRAMID.z - 18, maxz: PYRAMID.z - 2.5, cam: 1, top: 12 });
    label(scene, 'Ruined Pyramid', '#ffd890', PYRAMID.x, PYRAMID.z + 1, 5); R3.pyramid = { x: PYRAMID.x, z: PYRAMID.z + 1 }; }
  label(scene, '⚠ Sandworm Pit', '#ffb070', SANDWORM_PIT.x, SANDWORM_PIT.z, 4); label(scene, "⚠ Frost Wyrm's Roost", '#a0d8ff', WYRM_LAIR.x, WYRM_LAIR.z, 6);
  // ---- Ashfall Arena: stone ring, banners, gate ----
  { const y = H(ARENA.x, ARENA.z), g = new THREE.Group(); g.position.set(ARENA.x, y, ARENA.z); stat.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(ARENA.r - 0.4, ARENA.r + 0.4, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.8 })); ring.position.y = 0.08; g.add(ring);
    g.add(mesh(new THREE.CylinderGeometry(ARENA.r - 0.5, ARENA.r - 0.5, 0.12, 32), 0x8a7a64, 0, 0.02, 0));
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; g.add(mesh(new THREE.BoxGeometry(0.5, 3 + (i % 2), 0.5), 0x5a5048, Math.cos(a) * (ARENA.r + 2), 1.6, Math.sin(a) * (ARENA.r + 2))); if (i % 3 === 0) g.add(mesh(new THREE.BoxGeometry(0.05, 1.6, 1), i % 2 ? 0x2060c0 : 0xb02030, Math.cos(a) * (ARENA.r + 2.3), 3.0, Math.sin(a) * (ARENA.r + 2.3))); }
    label(scene, '⚔ Ashfall Arena', '#ffb040', ARENA.x, ARENA.z - ARENA.r - 3, 4.5, 1.1); }
  // ---- the Fadelands (opt-in PvP): violet haze ring + skull markers ----
  { const y = H(FADELANDS.x, FADELANDS.z); const wall = new THREE.Mesh(new THREE.CylinderGeometry(FADELANDS.r, FADELANDS.r, 6, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0x9a40ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })); wall.position.set(FADELANDS.x, y + 2, FADELANDS.z); scene.add(wall); R3.fadeWall = wall;
    for (let i = 0; i < 4; i++) { const a = i / 4 * 6.28 + 0.4; label(scene, '☠ Fadelands · PvP', '#d0a0ff', FADELANDS.x + Math.cos(a) * (FADELANDS.r + 1.5), FADELANDS.z + Math.sin(a) * (FADELANDS.r + 1.5), 2.4, 0.7); } }
  // ---- stable (village) + ash-wolf den (ridge) ----
  { const y = H(STABLE.x, STABLE.z), g = new THREE.Group(); g.position.set(STABLE.x, y, STABLE.z); stat.add(g); g.add(mesh(new THREE.BoxGeometry(4, 0.2, 3), 0x8a6038, 0, 2.6, 0)); for (const [sx, sz] of [[-1.9, -1.4], [1.9, -1.4], [-1.9, 1.4], [1.9, 1.4]]) g.add(mesh(new THREE.BoxGeometry(0.2, 2.6, 0.2), 0x6b4a2e, sx, 1.3, sz)); g.add(mesh(new THREE.BoxGeometry(1.6, 0.6, 0.6), 0xd0b060, 1, 0.3, 0.6)); label(scene, '🐎 Stable', '#ffe9a8', STABLE.x, STABLE.z, 3.6); }
  label(scene, '🐺 Ash-wolf den', '#ffb070', ASHWOLF_DEN.x, ASHWOLF_DEN.z, 2.5);
  mergeStatic(stat, { shadow: shadows });
  // region name banners on the map edges
  for (const [k, R] of Object.entries(REGIONS)) label(scene, `${R.icon} ${R.name}`, '#fff2c0', R.x, R.z + (k === 'frost' ? 70 : k === 'desert' ? -70 : 0) + (k === 'swamp' ? 0 : 0), 6, 1.1);

  // ---- weather particles: one Points cloud that follows the camera ----
  const N = quality === 'high' ? 900 : 500, wp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) wp.set([(Math.random() - 0.5) * 60, Math.random() * 30, (Math.random() - 0.5) * 60], i * 3);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
  const wm = new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false });
  const weatherPts = new THREE.Points(wg, wm); weatherPts.frustumCulled = false; weatherPts.visible = false; scene.add(weatherPts);
  // fireflies (Mirewood at night)
  const FN = 60, fp = new Float32Array(FN * 3); for (let i = 0; i < FN; i++) { const a = Math.random() * 6.28, r = Math.random() * 60; fp.set([S.x + Math.cos(a) * r, 1 + Math.random() * 2, S.z + Math.sin(a) * r], i * 3); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  const flies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xd8ff60, size: 0.35, transparent: true, opacity: 0.9, depthWrite: false })); flies.visible = false; scene.add(flies);
  const STYLE = { rain: [0x9ab8e0, 0.14, 26, 0.6], snow: [0xffffff, 0.22, 3, 0.9], blizzard: [0xffffff, 0.26, 7, 1.0], sand: [0xe8c890, 0.2, 4, 0.8], ash: [0x8a8078, 0.2, 2.5, 0.85] };
  R3.weatherPts = weatherPts;
  R3.update = (t, dt, focus, weather, night, inDungeon) => {
    const st = !inDungeon && STYLE[weather];
    weatherPts.visible = !!st;
    if (st) {
      wm.color.setHex(st[0]); wm.size = st[1]; wm.opacity = st[3];
      const a = wg.attributes.position; const side = weather === 'sand' || weather === 'blizzard' ? 8 : 0.4;
      for (let i = 0; i < N; i++) { let y = a.getY(i) - st[2] * dt, x = a.getX(i) + side * dt; if (y < 0) y += 30; if (x > 30) x -= 60; a.setY(i, y); a.setX(i, x); }
      a.needsUpdate = true; weatherPts.position.set(focus.x, focus.y - 4, focus.z);
    }
    flies.visible = !inDungeon && night > 0.5 && Math.hypot(focus.x - S.x, focus.z - S.z) < S.r + 30;
    if (flies.visible) { flies.material.opacity = 0.5 + Math.sin(t * 3) * 0.4; flies.position.y = Math.sin(t * 0.7) * 0.4; }
    for (const tr of Object.values(R3.terrains)) tr.visible = !inDungeon;
    if (R3.shrine) R3.shrine.rotation.y = t * 1.2;
    if (R3.fadeWall) R3.fadeWall.material.opacity = 0.12 + Math.sin(t * 1.5) * 0.04;
  };
  return R3;
}
