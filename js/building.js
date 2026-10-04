// Minecraft-style grid building: stacks of pieces per grid cell.
import * as THREE from 'three';
import { BLOCK, PIECES, cellBase, cellCenter } from './shared.js';

export class Building {
  constructor(scene) {
    this.scene = scene; this.stacks = new Map(); this.meshes = new Map(); this.baseCache = new Map();
    this.geo = { wood: new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK), stone: new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK), floor: new THREE.BoxGeometry(BLOCK, PIECES.floor.h, BLOCK) };
    this.mat = {
      wood: new THREE.MeshLambertMaterial({ color: PIECES.wood.color, flatShading: true }),
      stone: new THREE.MeshLambertMaterial({ color: PIECES.stone.color, flatShading: true }),
      floor: new THREE.MeshLambertMaterial({ color: PIECES.floor.color, flatShading: true }),
    };
    this.edges = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
    this.edgeGeo = {}; for (const k in this.geo) this.edgeGeo[k] = new THREE.EdgesGeometry(this.geo[k]);
    this.ghost = new THREE.Mesh(this.geo.wood, new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.4, depthWrite: false }));
    this.ghost.visible = false; scene.add(this.ghost);
  }
  base(gx, gz) { const k = gx + ',' + gz; let b = this.baseCache.get(k); if (b === undefined) { b = cellBase(gx, gz); this.baseCache.set(k, b); } return b; }
  top(gx, gz) { let y = this.base(gx, gz); for (const p of this.stacks.get(gx + ',' + gz) || []) y += PIECES[p].h; return y; }
  get count() { let n = 0; for (const s of this.stacks.values()) n += s.length; return n; }
  setStack(k, arr) {
    for (const m of this.meshes.get(k) || []) this.scene.remove(m);
    this.meshes.delete(k);
    if (!arr || !arr.length) { this.stacks.delete(k); return; }
    this.stacks.set(k, [...arr]);
    const [gx, gz] = k.split(',').map(Number), [cx, cz] = cellCenter(gx, gz);
    let y = this.base(gx, gz); const list = [];
    for (const p of arr) {
      const h = PIECES[p].h, m = new THREE.Mesh(this.geo[p], this.mat[p]);
      m.position.set(cx, y + h / 2, cz); m.castShadow = true; m.receiveShadow = true;
      m.add(new THREE.LineSegments(this.edgeGeo[p], this.edges));
      this.scene.add(m); list.push(m); y += h;
    }
    this.meshes.set(k, list);
  }
  clear() { for (const k of [...this.stacks.keys()]) this.setStack(k, null); }
  // columns overlapping a circle at x,z (for collision)
  columnsAround(x, z, r = 0.4) {
    const out = [], gx0 = Math.floor((x - r) / BLOCK), gx1 = Math.floor((x + r) / BLOCK), gz0 = Math.floor((z - r) / BLOCK), gz1 = Math.floor((z + r) / BLOCK);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const s = this.stacks.get(gx + ',' + gz); if (!s || !s.length) continue;
      out.push({ minx: gx * BLOCK, maxx: gx * BLOCK + BLOCK, minz: gz * BLOCK, maxz: gz * BLOCK + BLOCK, base: this.base(gx, gz), top: this.top(gx, gz) });
    }
    return out;
  }
  serialize() { return [...this.stacks.entries()]; }
}
