// v3 dungeons: the Drowned Belfry (Act 1 finale) and the Sunscar pyramid (pressure-plate mini-dungeon).
// Belfry rooms (south -> north, x = BELFRY_X):  A flooded nave  ->  B Hookshot chamber (chasm + hook ring)
//   ->  C the Bell Cistern (water-level puzzle: three bell valves set the water low / mid / high)
//   ->  D the Bellkeeper's loft (mini-boss)  ->  E Vael's Scriptorium (Act 1 finale).
// Water: low = the basin is dry (the sluice key lies at the bottom); mid = knee-deep; high = the floating bell-deck
// rises to the north ledge (the only way up). State lives in flags bf_w1 / bf_w2 / bf_key (host-authoritative in co-op).
import * as THREE from 'three';
import { BELFRY_X, PYRAMID_X } from './shared.js';
import { mat, makeLabel, mergeStatic } from './world.js';

const BX = BELFRY_X, PX = PYRAMID_X;
export const BELFRY_CP = { hook: { x: BX, z: -12 }, cistern: { x: BX, z: -34 }, ledge: { x: BX, z: -72 }, loft: { x: BX, z: -92 }, vael: { x: BX, z: -120 } };
export const BASIN = { minx: BX - 8, maxx: BX + 8, minz: -66, maxz: -40 };
export const HOOK_GAP = { minx: BX - 7, maxx: BX + 7, minz: -24, maxz: -18 };
export const LOFT_GAP = { minx: BX - 7, maxx: BX + 7, minz: -82, maxz: -76 };
export const LEDGE = { minx: BX - 8, maxx: BX + 8, minz: -76, maxz: -66 };
export const WATER_Y = [-2.8, -0.4, 2.15];
export const bstate = { water: 0 };
export const waterLevel = (f) => (f.bf_w2 ? 2 : f.bf_w1 ? 1 : 0);
export const BELFRY_SPAWNS = [
  { id: 'b_drown0', type: 'drowned', x: BX - 4, z: -2 }, { id: 'b_drown1', type: 'drowned', x: BX + 4, z: -4 },
  { id: 'b_wisp0', type: 'inkwisp', x: BX + 3, z: -30 }, { id: 'b_drown2', type: 'drowned', x: BX - 6, z: -36 },
  { id: 'b_wisp1', type: 'inkwisp', x: BX - 5, z: -88 },
  { id: 'b_keeper', type: 'bellkeeper', x: BX, z: -100 },
  { id: 'b_vael', type: 'vael', x: BX, z: -146 },
];
const inBox = (b, x, z) => x > b.minx && x < b.maxx && z > b.minz && z < b.maxz;
export function belfryHeight(x, z) {
  if (inBox(HOOK_GAP, x, z) || inBox(LOFT_GAP, x, z)) return -30;
  if (inBox(BASIN, x, z)) return bstate.water === 2 ? 2.2 : bstate.water === 1 ? -0.3 : -2.6;
  if (inBox(LEDGE, x, z)) return 2.4;
  if (z < -82 && z > -114) return 2.4;  // the loft
  if (z <= -114) return 2.4;            // scriptorium
  return 0;
}
function builder(group, colliders, DXX) {
  const stone = mat(0x5a6670), dark = mat(0x3a444c), add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.receiveShadow = true; group.add(o); return o; };
  const wall = (x0, z0, x1, z1, y0 = 0, hgt = 5) => { const minx = Math.min(x0, x1) - 0.5, maxx = Math.max(x0, x1) + 0.5, minz = Math.min(z0, z1) - 0.5, maxz = Math.max(z0, z1) + 0.5; add(new THREE.BoxGeometry(maxx - minx, hgt, maxz - minz), stone, DXX + (minx + maxx) / 2, y0 + hgt / 2 - 1, (minz + maxz) / 2); colliders.push({ minx: DXX + minx, maxx: DXX + maxx, minz, maxz, cam: 1, top: y0 + hgt }); };
  const floor = (cx, cz, w, d, y, m = dark) => add(new THREE.BoxGeometry(w, 0.4, d), m, DXX + cx, y - 0.2, cz);
  return { stone, dark, add, wall, floor };
}
export function buildBelfry(scene) {
  const group = new THREE.Group(); scene.add(group); group.visible = false;
  const colliders = []; const { add, wall, floor, dark } = builder(group, colliders, BX);
  const floorM = mat(0x4a5a5a), mossM = mat(0x3a6a5a);
  // A nave z 8..-12
  floor(0, -2, 18, 20, 0, floorM); wall(-9, 8, 9, 8); wall(-9, 8, -9, -12); wall(9, 8, 9, -12);
  // B hook chamber z -12..-30 (gap z -24..-18)
  floor(0, -15, 14, 6, 0, floorM); floor(0, -27, 14, 6, 0, floorM); wall(-7, -12, -7, -30); wall(7, -12, 7, -30);
  add(new THREE.BoxGeometry(14, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0x020406 }), BX, -9, -21);
  // C cistern z -30..-76 : walkways along the walls at y 0, basin in the middle, ledge north at 2.4
  floor(-9, -48, 2, 36, 0); floor(9, -48, 2, 36, 0); floor(0, -33, 18, 6, 0, floorM);
  wall(-10.5, -30, -10.5, -76, 0, 8); wall(10.5, -30, 10.5, -76, 0, 8);
  const basinFloor = add(new THREE.BoxGeometry(16, 0.4, 26), mossM, BX, -2.8, -53);
  const ledge = add(new THREE.BoxGeometry(16, 2.6, 10), dark, BX, 1.1, -71);
  // D loft z -82..-114 (gap -82..-76 crossed by hookshot)
  add(new THREE.BoxGeometry(14, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0x020406 }), BX, -6, -79);
  floor(0, -98, 18, 32, 2.4, floorM); wall(-9, -76, -9, -114, 2.4, 6); wall(9, -76, 9, -114, 2.4, 6);
  // E scriptorium z -114..-152 (big round-ish room)
  floor(0, -133, 26, 38, 2.4, mat(0x3a2a4a)); wall(-13, -114, -13, -152, 2.4, 8); wall(13, -114, 13, -152, 2.4, 8); wall(-13, -152, 13, -152, 2.4, 8);
  wall(-9, -114, -3, -114, 2.4, 6); wall(3, -114, 9, -114, 2.4, 6);
  // bells hanging in the loft + scriptorium shelves
  const bellM = mat(0xb08a3a);
  for (const [x, z, y] of [[-5, -95, 8], [5, -104, 8], [0, -140, 10]]) { add(new THREE.CylinderGeometry(0.4, 1.6, 2.2, 8), bellM, BX + x, y, z); add(new THREE.CylinderGeometry(0.05, 0.05, 4, 4), dark, BX + x, y + 3, z); }
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.6, 4, 3), mat(0x5a3a2a), BX + (i % 2 ? 12.2 : -12.2), 4.4, -122 - Math.floor(i / 2) * 9);
  mergeStatic(group);
  // dynamic objects
  const water = add(new THREE.BoxGeometry(16, 0.2, 26), new THREE.MeshPhongMaterial({ color: 0x2a7a90, transparent: true, opacity: 0.7, shininess: 60 }), BX, WATER_Y[0], -53);
  const deck = add(new THREE.BoxGeometry(6, 0.3, 8), mat(0x8a6038), BX, 0, -58); // floating bell-deck (rides the water)

  const portalM = new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.6 });
  const exitA = add(new THREE.TorusGeometry(1.1, 0.15, 6, 12), portalM, BX, 1.3, 7.3);
  const chestG = (x, z, y = 0, c = 0x8a5a2a) => { const g = new THREE.Group(); g.position.set(BX + x, y, z); group.add(g); const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), mat(c)); b.position.y = 0.4; g.add(b); const lid = new THREE.Group(); lid.position.set(0, 0.8, -0.45); g.add(lid); const l = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.3, 0.95), mat(0xa06a30)); l.position.set(0, 0.15, 0.45); lid.add(l); colliders.push({ c: 1, x: BX + x, z, r: 0.7 }); return { g, lid }; };
  const hookChest = chestG(0, -10.5), keyChest = chestG(5, -62, -2.6, 0x4a6a6a), vaelChest = chestG(0, -146, 2.4, 0x6a3a8a); vaelChest.g.visible = false;
  const ring = (z, y) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.12, 6, 10), new THREE.MeshLambertMaterial({ color: 0xffd040, emissive: 0x664400, flatShading: true })); r.position.set(BX, y, z); group.add(r); const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, y, 0.5), mat(0x6b4a2e)); p.position.set(BX, y / 2 - (z < -60 ? -2.4 : 0) * 0, z - 0.6); group.add(p); return r; };
  const r1 = ring(-25.6, 3.1), r2 = ring(-83.4, 5.5);
  const lbl = makeLabel('⛓ Hookshot ring', '#ffd040', 0.7); lbl.position.set(BX, 4.4, -25.6); group.add(lbl);
  const valves = [-1, 0, 1].map((i) => { const v = new THREE.Group(); v.position.set(BX + (i === 0 ? 0 : i * 9), 0, i === 0 ? -31 : -40); group.add(v); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.2, 6), mat(0xb08a3a)); b.position.y = 1.2; v.add(b); const w = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 4, 10), mat(0x3a3a40)); w.position.y = 2; w.rotation.x = Math.PI / 2; v.add(w); colliders.push({ c: 1, x: v.position.x, z: v.position.z, r: 0.6 }); return { obj: v, wheel: w, x: v.position.x, z: v.position.z }; });
  const vl = [makeLabel('🔔 Low bell', '#bfe4ff', 0.6), makeLabel('🔔 Middle bell', '#bfe4ff', 0.6), makeLabel('🔔 High bell', '#bfe4ff', 0.6)];
  vl.forEach((l, i) => { const v = valves[[1, 0, 2][i]]; l.position.set(v.x, 3, v.z); group.add(l); });
  const door = new THREE.Mesh(new THREE.BoxGeometry(4, 3.4, 0.4), mat(0x3a3a40)); door.position.set(BX, 4.1, -113.8); group.add(door);
  const doorCol = { minx: BX - 2.2, maxx: BX + 2.2, minz: -114.4, maxz: -113.4 }; colliders.push(doorCol);
  const exitV = add(new THREE.TorusGeometry(1.1, 0.15, 6, 12), portalM, BX, 3.7, -150); exitV.visible = false;
  const light = new THREE.PointLight(0x80c0ff, 26, 40, 1.4); light.position.set(BX, 6, -50); group.add(light);
  const D = {
    group, colliders, height: belfryHeight, water, deck,
    grapplePoints: [{ id: 'bf_hook1', x: BX, y: 3.1, z: -25.6, land: { x: BX, z: -27 }, hook: 1 }, { id: 'bf_hook2', x: BX, y: 5.5, z: -83.4, land: { x: BX, z: -84.5 }, landY: 2.4, hook: 1 }],
    hookChest: { x: BX, z: -9.6, ...hookChest, opened: false }, keyChest: { x: BX + 5, z: -61, ...keyChest, opened: false }, vaelChest: { x: BX, z: -145, ...vaelChest, opened: false },
    valves, door: { x: BX, z: -112.5 }, exitA: { x: BX, z: 6.6 }, exitV: { x: BX, z: -149.3, obj: exitV },
    setState(f) {
      bstate.water = waterLevel(f);
      D.hookChest.opened = !!f.hookshot; hookChest.lid.rotation.x = f.hookshot ? -1.9 : 0;
      D.keyChest.opened = !!f.bf_key; keyChest.lid.rotation.x = f.bf_key ? -1.9 : 0;
      doorCol.disabled = !!f.bf_boss; door.visible = !f.bf_boss;
      vaelChest.g.visible = !!f.bf_vael; exitV.visible = !!f.bf_vael; D.vaelChest.opened = !!f.act1_done; vaelChest.lid.rotation.x = f.act1_done ? -1.9 : 0;
      valves.forEach((v, i) => (v.wheel.rotation.z = [1, 0, 2][i] === bstate.water ? 1.2 : 0));
    },
    update(t, dt) {
      const wy = WATER_Y[bstate.water]; water.position.y += (wy - water.position.y) * Math.min(1, dt * 2); deck.position.y = Math.max(-2.4, water.position.y + 0.1);
      r1.rotation.z = r2.rotation.z = t * 1.5; exitA.rotation.z = exitV.rotation.z = t;
    },
    blocked(x, z) { for (const c of colliders) { if (c.disabled) continue; if (c.c) { if (Math.hypot(x - c.x, z - c.z) < c.r + 0.6) return true; } else if (x > c.minx - 0.6 && x < c.maxx + 0.6 && z > c.minz - 0.6 && z < c.maxz + 0.6) return true; } return false; },
  };
  return D;
}

// ---- the Sunscar pyramid: glyph wall shows the order, step on the four pressure plates in that order ----
export const PLATES = [{ id: 'sun', x: PX - 5, z: -18, icon: '☀' }, { id: 'moon', x: PX + 5, z: -18, icon: '☾' }, { id: 'star', x: PX - 5, z: -28, icon: '★' }, { id: 'eye', x: PX + 5, z: -28, icon: '👁' }];
export const PLATE_ORDER = ['moon', 'sun', 'eye', 'star'];
export const PYRAMID_SPAWNS = [{ id: 'y_mummy0', type: 'mummy', x: PX - 4, z: -6 }, { id: 'y_mummy1', type: 'mummy', x: PX + 4, z: -10 }, { id: 'y_mummy2', type: 'mummy', x: PX, z: -44 }];
export function pyramidHeight() { return 0; }
export function buildPyramid(scene) {
  const group = new THREE.Group(); scene.add(group); group.visible = false;
  const colliders = []; const { add, wall, floor } = builder(group, colliders, PX);
  const sand = mat(0xc8a868);
  floor(0, -20, 20, 56, 0, sand); wall(-10, 8, 10, 8, 0, 6); wall(-10, 8, -10, -52, 0, 6); wall(10, 8, 10, -52, 0, 6); wall(-10, -52, 10, -52, 0, 6);
  wall(-10, -34, -3, -34, 0, 6); wall(3, -34, 10, -34, 0, 6);
  add(new THREE.BoxGeometry(6, 3, 0.3), mat(0x9a7a48), PX, 2.2, -33.4);
  mergeStatic(group);
  const glyph = makeLabel(PLATE_ORDER.map((k) => PLATES.find((p) => p.id === k).icon).join('  '), '#ffd890', 1.2); glyph.position.set(PX, 3.6, -33.2); group.add(glyph);
  const hint = makeLabel('Step on the plates in the order of the glyphs', '#e8d8b0', 0.6); hint.position.set(PX, 4.6, -33.2); group.add(hint);
  const plates = PLATES.map((p) => { const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 2.2), new THREE.MeshLambertMaterial({ color: 0x8a7048 })); m.position.set(p.x, 0.08, p.z); group.add(m); const l = makeLabel(p.icon, '#ffe0a0', 1); l.position.set(p.x, 1.2, p.z); group.add(l); return { ...p, m }; });
  const gate = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 0.4), mat(0x6a5030)); gate.position.set(PX, 2, -34); group.add(gate);
  const gateCol = { minx: PX - 3, maxx: PX + 3, minz: -34.5, maxz: -33.5 }; colliders.push(gateCol);
  const idol = new THREE.Group(); idol.position.set(PX, 0, -46); group.add(idol); const ib = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), mat(0x8a7048)); ib.position.y = 0.5; idol.add(ib); const it = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), new THREE.MeshBasicMaterial({ color: 0xffd040 })); it.position.y = 1.5; idol.add(it); colliders.push({ c: 1, x: PX, z: -46, r: 0.8 });
  const portalM = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.6 });
  const exitA = add(new THREE.TorusGeometry(1.1, 0.15, 6, 12), portalM, PX, 1.3, 7.3);
  const light = new THREE.PointLight(0xffc070, 24, 40, 1.4); light.position.set(PX, 5, -22); group.add(light);
  const D = {
    group, colliders, height: pyramidHeight, plates, idol: { x: PX, z: -44.6, taken: false }, exitA: { x: PX, z: 6.6 }, grapplePoints: [],
    setState(f) { gateCol.disabled = !!f.py_open; gate.visible = !f.py_open; D.idol.taken = !!f.py_idol; it.visible = !f.py_idol; },
    lightPlates(seq) { plates.forEach((p) => p.m.material.color.setHex(seq.includes(p.id) ? 0xffd040 : 0x8a7048)); },
    update(t) { it.rotation.y = t * 2; exitA.rotation.z = t; },
    blocked(x, z) { for (const c of colliders) { if (c.disabled) continue; if (c.c) { if (Math.hypot(x - c.x, z - c.z) < c.r + 0.6) return true; } else if (x > c.minx - 0.6 && x < c.maxx + 0.6 && z > c.minz - 0.6 && z < c.maxz + 0.6) return true; } return false; },
  };
  return D;
}
