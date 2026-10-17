// Minecraft-style grid building, v2: stacks of pieces per 1.5 m cell, each piece with a 90° rotation.
// Entries are 'type' (v1 saves) or 'type@rot'. Pieces: blocks, floors, walls, doors (open/close), windows, roofs,
// stairs, fences, torches, chests, workbench, campfire, grapple anchors, Hearthstone and bank chest.
import * as THREE from 'three';
import { BLOCK, PIECES, cellBase, cellCenter, pieceType, pieceRot } from './shared.js';

const B = BLOCK, HB = B / 2;
const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const MATS = {}; const M = (c) => (MATS[c] ||= lam(c));
const glowM = new THREE.MeshBasicMaterial({ color: 0xffa040 });
const glassM = new THREE.MeshBasicMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.45 });
const gemM = new THREE.MeshBasicMaterial({ color: 0xffd27a });
const ringM = new THREE.MeshLambertMaterial({ color: 0xffd040, emissive: 0x664400, flatShading: true });
function bx(g, w, h, d, c, x, y, z, m) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || M(c)); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; }

// local collision boxes for a piece (rot 0), [x0,x1,z0,z1,y0,y1] relative to the cell centre / piece base
function localBoxes(type, open) {
  const P = PIECES[type];
  switch (type) {
    case 'wall': case 'window': return [[-HB, HB, -0.15, 0.15, 0, 3]];
    case 'door': return open ? [[-HB, -HB + 0.15, -0.15, 0.15, 0, 3], [HB - 0.15, HB, -0.15, 0.15, 0, 3], [-HB, HB, -0.15, 0.15, 2.5, 3]] : [[-HB, HB, -0.15, 0.15, 0, 3]];
    case 'fence': return [[-HB, HB, -0.1, 0.1, 0, 1]];
    case 'stairs': return [[-HB, HB, 0, HB, 0, 0.75], [-HB, HB, -HB, 0, 0, B]];
    case 'chest': return [[-0.55, 0.55, -0.38, 0.38, 0, 0.9]];
    case 'bankchest': return [[-0.6, 0.6, -0.42, 0.42, 0, 1.0]];
    case 'bench': return [[-0.7, 0.7, -0.4, 0.4, 0, 1.0]];
    case 'anchor': return [[-0.2, 0.2, -0.2, 0.2, 0, 3.2]];
    case 'hearth': return [[-0.45, 0.45, -0.45, 0.45, 0, 1.6]];
    default: return P.solid === false ? [] : [[-HB, HB, -HB, HB, 0, P.h]];
  }
}
function rotBox([x0, x1, z0, z1, y0, y1], r) {
  const pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => { for (let i = 0; i < r; i++) [x, z] = [z, -x]; return [x, z]; });
  return [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1])), y0, y1];
}

export function makePieceMesh(type, rot = 0, opts = {}) {
  const g = new THREE.Group(), P = PIECES[type], c = P.color;
  switch (type) {
    case 'wood': case 'stone': bx(g, B, B, B, c, 0, HB, 0); break;
    case 'floor': bx(g, B, P.h, B, c, 0, P.h / 2, 0); break;
    case 'wall': bx(g, B, 3, 0.3, c, 0, 1.5, 0); bx(g, B + 0.02, 0.16, 0.34, 0x6b4a2e, 0, 2.92, 0); bx(g, 0.16, 3, 0.34, 0x6b4a2e, -HB + 0.08, 1.5, 0); break;
    case 'window':
      bx(g, B, 1.0, 0.3, c, 0, 0.5, 0); bx(g, B, 0.8, 0.3, c, 0, 2.6, 0); bx(g, 0.3, 1.2, 0.3, c, -0.6, 1.6, 0); bx(g, 0.3, 1.2, 0.3, c, 0.6, 1.6, 0);
      bx(g, 0.9, 1.2, 0.04, 0, 0, 1.6, 0, glassM).castShadow = false; bx(g, 0.06, 1.2, 0.08, 0x6b4a2e, 0, 1.6, 0); bx(g, 0.9, 0.06, 0.08, 0x6b4a2e, 0, 1.6, 0); break;
    case 'door': {
      bx(g, 0.15, 3, 0.32, 0x5a3a20, -HB + 0.075, 1.5, 0); bx(g, 0.15, 3, 0.32, 0x5a3a20, HB - 0.075, 1.5, 0); bx(g, B, 0.5, 0.32, 0x5a3a20, 0, 2.75, 0);
      const pivot = new THREE.Group(); pivot.position.set(-HB + 0.15, 0, 0); g.add(pivot);
      bx(pivot, 1.2, 2.5, 0.12, c, 0.6, 1.25, 0); bx(pivot, 0.12, 0.12, 0.16, 0xe0c040, 1.05, 1.25, 0.06);
      for (const y of [0.5, 2.0]) bx(pivot, 1.2, 0.1, 0.14, 0x3a2a1a, 0.6, y, 0);
      g.userData.pivot = pivot; break;
    }
    case 'roof': {
      const a = Math.atan2(0.75, B), len = Math.hypot(0.75, B) + 0.1;
      const slab = bx(g, B + 0.1, 0.14, len, c, 0, 0.42, 0); slab.rotation.x = a;
      bx(g, B + 0.12, 0.12, 0.12, 0x6b4a2e, 0, 0.8, -HB); break;
    }
    case 'stairs': bx(g, B, 0.75, HB, c, 0, 0.375, B / 4); bx(g, B, B, HB, c, 0, HB, -B / 4); break;
    case 'fence': for (const x of [-0.65, 0.65]) bx(g, 0.16, 1.0, 0.16, c, x, 0.5, 0); for (const y of [0.4, 0.8]) bx(g, B, 0.1, 0.08, 0x9a7048, 0, y, 0); break;
    case 'torch': bx(g, 0.12, 1.2, 0.12, c, 0, 0.6, 0); bx(g, 0.22, 0.2, 0.22, 0x3a2a1a, 0, 1.25, 0); { const f = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), glowM); f.position.y = 1.48; g.add(f); g.userData.flame = f; } break;
    case 'chest': case 'bankchest': {
      const big = type === 'bankchest', w = big ? 1.2 : 1.1, d = big ? 0.84 : 0.76;
      bx(g, w, 0.6, d, c, 0, 0.3, 0);
      const lid = new THREE.Group(); lid.position.set(0, 0.6, -d / 2); g.add(lid); bx(lid, w + 0.04, 0.25, d + 0.04, big ? 0x7a6ab0 : 0xa06a30, 0, 0.12, d / 2);
      bx(g, 0.16, 0.2, 0.08, 0xe0c040, 0, 0.55, d / 2 + 0.02); if (big) for (const x of [-0.5, 0.5]) bx(g, 0.08, 0.62, d + 0.06, 0xe0c040, x, 0.31, 0);
      g.userData.lid = lid; break;
    }
    case 'bench': bx(g, 1.4, 0.14, 0.8, c, 0, 0.93, 0); for (const [x, z] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) bx(g, 0.12, 0.86, 0.12, 0x6b4a2e, x, 0.43, z); bx(g, 0.4, 0.08, 0.2, 0x9aa0a8, 0.3, 1.04, 0.1); break;
    case 'campfire': for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; bx(g, 0.25, 0.2, 0.25, c, Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5); } bx(g, 0.9, 0.12, 0.12, 0x4a3020, 0, 0.15, 0).rotation.y = 0.6; bx(g, 0.9, 0.12, 0.12, 0x4a3020, 0, 0.18, 0).rotation.y = -0.6; { const f = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), glowM); f.position.y = 0.45; g.add(f); g.userData.flame = f; } break;
    case 'anchor': { bx(g, 0.3, 3.0, 0.3, c, 0, 1.5, 0); bx(g, 0.6, 0.2, 0.6, 0x5a5a60, 0, 0.1, 0); const r = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.1, 6, 10), ringM); r.position.set(0, 3.15, 0); g.add(r); g.userData.ring = r; break; }
    case 'hearth': { bx(g, 0.9, 0.3, 0.9, 0x5a5a60, 0, 0.15, 0); const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1.1, 5), M(c)); p.position.y = 0.85; p.castShadow = true; g.add(p); const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), gemM); gem.position.y = 1.65; g.add(gem); g.userData.gem = gem; break; }
  }
  g.rotation.y = rot * Math.PI / 2;
  return g;
}

export class Building {
  constructor(scene) {
    this.scene = scene; this.stacks = new Map(); this.meshes = new Map(); this.baseCache = new Map(); this.open = new Set();
    this.edges = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
    this.edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(B, B, B));
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.4, depthWrite: false });
    this.ghost = new THREE.Group(); this.ghost.visible = false; scene.add(this.ghost); this.ghostKey = '';
    this.animated = [];
  }
  base(gx, gz) { const k = gx + ',' + gz; let b = this.baseCache.get(k); if (b === undefined) { b = cellBase(gx, gz); this.baseCache.set(k, b); } return b; }
  top(gx, gz) { let y = this.base(gx, gz); for (const p of this.stacks.get(gx + ',' + gz) || []) y += PIECES[pieceType(p)].h; return y; }
  get count() { let n = 0; for (const s of this.stacks.values()) n += s.length; return n; }
  setStack(k, arr) {
    for (const m of this.meshes.get(k) || []) this.scene.remove(m);
    this.meshes.delete(k);
    for (const key of [...this.open]) if (key.startsWith(k + '#') && (!arr || +key.split('#')[1] >= arr.length)) this.open.delete(key);
    if (!arr || !arr.length) { this.stacks.delete(k); this.rebuildAnimated(); return; }
    arr = arr.filter((e) => PIECES[pieceType(e)]);
    this.stacks.set(k, [...arr]);
    const [gx, gz] = k.split(',').map(Number), [cx, cz] = cellCenter(gx, gz);
    let y = this.base(gx, gz); const list = [];
    arr.forEach((e, i) => {
      const t = pieceType(e), r = pieceRot(e), m = makePieceMesh(t, r);
      m.position.set(cx, y, cz); m.userData.type = t; m.userData.k = k; m.userData.i = i; m.userData.y = y;
      if (t === 'wood' || t === 'stone') { const l = new THREE.LineSegments(this.edgeGeo, this.edges); l.position.y = HB; m.add(l); }
      if (t === 'door' && this.open.has(k + '#' + i)) m.userData.pivot.rotation.y = -Math.PI / 2;
      this.scene.add(m); list.push(m); y += PIECES[t].h;
    });
    this.meshes.set(k, list); this.rebuildAnimated();
  }
  rebuildAnimated() { this.animated = []; for (const l of this.meshes.values()) for (const m of l) if (m.userData.flame || m.userData.gem || m.userData.ring) this.animated.push(m); }
  clear() { for (const k of [...this.stacks.keys()]) this.setStack(k, null); this.open.clear(); }
  // per-piece collision boxes overlapping a circle at x,z
  columnsAround(x, z, r = 0.4) {
    const out = [], gx0 = Math.floor((x - r) / B), gx1 = Math.floor((x + r) / B), gz0 = Math.floor((z - r) / B), gz1 = Math.floor((z + r) / B);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const k = gx + ',' + gz, s = this.stacks.get(k); if (!s || !s.length) continue;
      const [cx, cz] = cellCenter(gx, gz); let y = this.base(gx, gz);
      s.forEach((e, i) => {
        const t = pieceType(e), rot = pieceRot(e);
        for (const lb of localBoxes(t, this.open.has(k + '#' + i))) {
          const [x0, x1, z0, z1, y0, y1] = rotBox(lb, rot);
          out.push({ minx: cx + x0, maxx: cx + x1, minz: cz + z0, maxz: cz + z1, base: y + y0, top: y + y1 });
        }
        y += PIECES[t].h;
      });
    }
    return out;
  }
  // interactive pieces near x,z: doors, chests, benches, campfires, hearths, bank chests, anchors
  interactablesNear(x, z, R = 2.4) {
    const out = []; const g0 = Math.floor((x - R) / B), g1 = Math.floor((x + R) / B), h0 = Math.floor((z - R) / B), h1 = Math.floor((z + R) / B);
    for (let gx = g0; gx <= g1; gx++) for (let gz = h0; gz <= h1; gz++) {
      const k = gx + ',' + gz, list = this.meshes.get(k); if (!list) continue;
      const [cx, cz] = cellCenter(gx, gz);
      for (const m of list) { const t = m.userData.type; if (['door', 'chest', 'bench', 'campfire', 'hearth', 'bankchest'].includes(t)) out.push({ k, i: m.userData.i, type: t, x: cx, z: cz, y: m.userData.y, d: Math.hypot(cx - x, cz - z), mesh: m }); }
    }
    return out;
  }
  anchors() { const out = []; for (const l of this.meshes.values()) for (const m of l) if (m.userData.type === 'anchor') out.push({ id: 'anc_' + m.userData.k, x: m.position.x, y: m.userData.y + 3.15, z: m.position.z, k: m.userData.k, anchor: true }); return out; }
  find(type) { const out = []; for (const l of this.meshes.values()) for (const m of l) if (m.userData.type === type) out.push({ k: m.userData.k, i: m.userData.i, x: m.position.x, z: m.position.z, y: m.userData.y }); return out; }
  toggleDoor(k, i) {
    const key = k + '#' + i, open = !this.open.has(key);
    if (open) this.open.add(key); else this.open.delete(key);
    const m = (this.meshes.get(k) || [])[i]; if (m && m.userData.pivot) m.userData.targetOpen = open;
    if (m) this.animated.includes(m) || this.animated.push(m);
    return open;
  }
  isOpen(k, i) { return this.open.has(k + '#' + i); }
  setGhost(type, rot, x, y, z, ok) {
    const key = type + '@' + rot;
    if (key !== this.ghostKey) {
      while (this.ghost.children.length) this.ghost.remove(this.ghost.children[0]);
      const m = makePieceMesh(type, rot); m.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; } }); this.ghost.add(m); this.ghostKey = key;
    }
    this.ghost.position.set(x, y, z); this.ghostMat.color.setHex(ok ? 0x40ff60 : 0xff4040);
  }
  update(t, dt) {
    for (const m of this.animated) {
      const u = m.userData;
      if (u.flame) { u.flame.scale.setScalar(0.85 + Math.sin(t * 13 + m.id) * 0.2); u.flame.rotation.y = t * 3; }
      if (u.gem) { u.gem.rotation.y = t; u.gem.position.y = 1.65 + Math.sin(t * 2) * 0.08; }
      if (u.ring) u.ring.rotation.y = t * 1.5;
      if (u.pivot && u.targetOpen !== undefined) { const want = u.targetOpen ? -Math.PI / 2 : 0; u.pivot.rotation.y += (want - u.pivot.rotation.y) * Math.min(1, dt * 10); }
    }
  }
  serialize() { return [...this.stacks.entries()]; }
}
