// The Hollow Barrow: a short 4-room dungeon (entry hall, grapple chest, chasm puzzle, Warden arena).
import * as THREE from 'three';
import { DUNGEON_X } from './shared.js';
import { mat, makeLabel, mergeStatic } from './world.js';

const DX = DUNGEON_X;
export const PIT = { minx: DX - 9, maxx: DX + 9, minz: -54, maxz: -44 };
export const CHECKPOINT = { x: DX, z: -39 };
export const DUNGEON_SPAWNS = [
  { id: 'd_moss0', type: 'mossling', x: DX - 4, z: -2 },
  { id: 'd_moss1', type: 'mossling', x: DX + 4, z: -4 },
  { id: 'd_grub0', type: 'grubkin', x: DX + 3, z: -20 },
  { id: 'd_grub1', type: 'grubkin', x: DX - 5, z: -57 },
  { id: 'd_warden', type: 'warden', x: DX, z: -82 },
];

export function dungeonHeight(x, z) {
  if (x > PIT.minx && x < PIT.maxx && z > PIT.minz && z < PIT.maxz) return -30;
  return 0;
}

export function buildDungeon(scene) {
  const group = new THREE.Group(); scene.add(group);
  const colliders = [];
  const stone = mat(0x6d6a66), stoneDark = mat(0x4f4c49), floorM = mat(0x5a5048), mossM = mat(0x4f6a3a);
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; group.add(o); return o; };
  const WALL_H = 3.4;
  const wall = (x0, z0, x1, z1) => {
    const minx = Math.min(x0, x1) - 0.5, maxx = Math.max(x0, x1) + 0.5, minz = Math.min(z0, z1) - 0.5, maxz = Math.max(z0, z1) + 0.5;
    add(new THREE.BoxGeometry(maxx - minx, WALL_H, maxz - minz), stone, DX + (minx + maxx) / 2, WALL_H / 2, (minz + maxz) / 2);
    colliders.push({ minx: DX + minx, maxx: DX + maxx, minz, maxz, cam: 1, top: WALL_H });
  };
  // room: half sizes, door gaps (width 4) on north/south
  const room = (cz, hw, hd, doorN, doorS) => {
    add(new THREE.BoxGeometry(hw * 2, 0.4, hd * 2), floorM, DX, -0.2, cz).receiveShadow = true;
    const n = cz - hd, s = cz + hd;
    if (doorN) { wall(-hw, n, -2, n); wall(2, n, hw, n); } else wall(-hw, n, hw, n);
    if (doorS) { wall(-hw, s, -2, s); wall(2, s, hw, s); } else wall(-hw, s, hw, s);
    wall(-hw, n, -hw, s); wall(hw, n, hw, s);
  };
  const corridor = (z0, z1) => {
    add(new THREE.BoxGeometry(4, 0.4, Math.abs(z1 - z0)), floorM, DX, -0.2, (z0 + z1) / 2);
    wall(-2.5, z0, -2.5, z1); wall(2.5, z0, 2.5, z1);
  };
  room(0, 9, 8, true, false);        // A: entry hall z -8..8
  corridor(-8, -14);
  room(-22, 7, 8, true, true);       // B: chest room z -30..-14
  corridor(-30, -36);
  // C: chasm room z -60..-36 (floor split around pit)
  add(new THREE.BoxGeometry(18, 0.4, 8), floorM, DX, -0.2, -40);
  add(new THREE.BoxGeometry(18, 0.4, 6), floorM, DX, -0.2, -57);
  wall(-9, -36, -2, -36); wall(2, -36, 9, -36); wall(-9, -60, -2, -60); wall(2, -60, 9, -60);
  wall(-9, -60, -9, -36); wall(9, -60, 9, -36);
  // pit visuals
  add(new THREE.BoxGeometry(18, 0.3, 10), new THREE.MeshBasicMaterial({ color: 0x020202 }), DX, -9, -49);
  for (const z of [PIT.minz, PIT.maxz]) add(new THREE.BoxGeometry(18, 9, 0.3), stoneDark, DX, -4.6, z);
  for (const x of [-9, 9]) add(new THREE.BoxGeometry(0.3, 9, 10), stoneDark, DX + x, -4.6, -49);
  corridor(-60, -66);
  room(-79, 12, 13, false, true);    // D: arena z -92..-66
  // pillars + moss + rubble decoration
  for (const [x, z] of [[-6, -4], [6, -4], [-5, -18], [5, -26], [-9, -72], [9, -72], [-9, -86], [9, -86]]) {
    add(new THREE.CylinderGeometry(0.7, 0.8, WALL_H, 6), stoneDark, DX + x, WALL_H / 2, z);
    colliders.push({ c: 1, x: DX + x, z, r: 0.85, cam: 0.85, top: WALL_H });
  }
  for (let i = 0; i < 30; i++) { const m = add(new THREE.BoxGeometry(0.6 + Math.random(), 0.06, 0.6 + Math.random()), mossM, DX + (Math.random() - 0.5) * 16, 0.03, -Math.random() * 90 + 6); if (m.position.z < -43 && m.position.z > -55) m.visible = false; }
  // torches
  const flames = [];
  for (const [x, z] of [[-8.3, 0], [8.3, 0], [-6.3, -22], [6.3, -22], [-8.3, -40], [8.3, -40], [-11.3, -76], [11.3, -76], [-11.3, -88], [11.3, -88]]) {
    add(new THREE.BoxGeometry(0.15, 0.6, 0.15), mat(0x5a3a20), DX + x, 2, z);
    const f = add(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: 0xffa040 }), DX + x, 2.45, z);
    flames.push(f);
  }
  const torchLights = [];
  for (const z of [0, -22, -48, -79]) { const l = new THREE.PointLight(0xffa050, 30, 30, 1.5); l.position.set(DX, 3, z); group.add(l); torchLights.push(l); }

  mergeStatic(group);
  // exit portal in room A (south)
  const portalM = new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.6 });
  const exitA = add(new THREE.TorusGeometry(1.1, 0.15, 6, 12), portalM, DX, 1.3, 7.3);
  // chest with the grapple hook (room B)
  const chest = new THREE.Group(); chest.position.set(DX, 0, -27); group.add(chest);
  const cbase = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), mat(0x8a5a2a)); cbase.position.y = 0.4; cbase.castShadow = true; chest.add(cbase);
  const lid = new THREE.Group(); lid.position.set(0, 0.8, -0.45); chest.add(lid);
  const lidM = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.3, 0.95), mat(0xa06a30)); lidM.position.set(0, 0.15, 0.45); lid.add(lidM);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.1), mat(0xe0c040)); lock.position.set(0, 0.7, 0.47); chest.add(lock);
  colliders.push({ minx: DX - 0.75, maxx: DX + 0.75, minz: -27.5, maxz: -26.5 });
  // grapple target post across the chasm
  const post = new THREE.Group(); post.position.set(DX, 0, -56.5); group.add(post);
  const pm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3, 0.5), mat(0x6b4a2e)); pm.position.y = 1.5; post.add(pm);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.12, 6, 10), new THREE.MeshLambertMaterial({ color: 0xffd040, emissive: 0x664400, flatShading: true })); ring.position.set(0, 3.1, 0.1); post.add(ring);
  colliders.push({ c: 1, x: DX, z: -56.5, r: 0.4 });
  const grappleLbl = makeLabel('◎ Grapple target', '#ffd040', 0.8); grappleLbl.position.set(DX, 4.2, -56.5); group.add(grappleLbl);
  // lever + gate (C -> D)
  const lever = new THREE.Group(); lever.position.set(DX + 5, 0, -58.5); group.add(lever);
  const lbase = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), stoneDark); lbase.position.y = 0.2; lever.add(lbase);
  const handle = new THREE.Group(); handle.position.y = 0.4; lever.add(handle);
  const hm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), mat(0x9a9aa0)); hm.position.y = 0.5; handle.add(hm);
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat(0xc03030)); knob.position.y = 1; handle.add(knob);
  handle.rotation.x = -0.6;
  const gate = new THREE.Group(); gate.position.set(DX, 0, -61); group.add(gate);
  for (let i = -3; i <= 3; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.15), mat(0x3a3a40)); bar.position.set(i * 0.6, 1.6, 0); bar.castShadow = true; gate.add(bar); }
  const gateCol = { minx: DX - 2, maxx: DX + 2, minz: -61.4, maxz: -60.6, gate: true };
  colliders.push(gateCol);
  // boss reward chest + exit portal (hidden until the Warden falls)
  const bchest = chest.clone(true); bchest.position.set(DX, 0, -88); bchest.visible = false; group.add(bchest);
  const exitD = add(new THREE.TorusGeometry(1.1, 0.15, 6, 12), portalM, DX, 1.3, -91.3); exitD.visible = false;

  const D = {
    group, colliders, flames, torchLights, gateCol, height: dungeonHeight,
    grapplePoints: [{ id: 'post', x: DX, y: 3.1, z: -56.5, land: { x: DX, z: -55.3 } }],
    chest: { x: DX, z: -26, obj: chest, lid, opened: false },
    bossChest: { x: DX, z: -87, obj: bchest, opened: false },
    lever: { x: DX + 5, z: -57.6, handle, pulled: false },
    gate, exitA: { x: DX, z: 6.6 }, exitD: { x: DX, z: -90.5, obj: exitD },
    gateOpenT: 0,
    setState(st) {
      D.chest.opened = !!st.chest; lid.rotation.x = st.chest ? -1.9 : 0;
      D.lever.pulled = !!st.lever; handle.rotation.x = st.lever ? 0.6 : -0.6;
      gateCol.disabled = !!st.lever; gate.position.y = st.lever ? 3.1 : 0;
      bchest.visible = !!st.boss; exitD.visible = !!st.boss;
      D.bossChest.opened = !!st.bossChest;
      bchest.children[1].rotation.x = st.bossChest ? -1.9 : 0;
    },
    update(t, dt) {
      flames.forEach((f, i) => { f.scale.setScalar(0.85 + Math.sin(t * 13 + i) * 0.2); f.rotation.y = t * 3 + i; });
      ring.rotation.z = t * 1.5; exitA.rotation.z = t; exitD.rotation.z = t;
      if (D.lever.pulled && gate.position.y < 3.1) gate.position.y = Math.min(3.1, gate.position.y + dt * 2);
    },
    blocked(x, z) {
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
