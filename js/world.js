// Overworld: terrain, water, sky + day/night, village, resource nodes, barrow entrance, colliders.
import * as THREE from 'three';
import { islandHeight, fbm, VILLAGE, ENTRANCE, generateNodes, NODE_TYPES } from './shared.js';

export const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const MATS = {};
const M = (c) => (MATS[c] ||= mat(c));
function mesh(geo, color, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? M(color) : color);
  m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; return m;
}

// Bake every Lambert mesh under `root` into ONE vertex-coloured mesh (one draw call). Non-Lambert meshes are kept.
const VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export function mergeStatic(root, { shadow = true } = {}) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const pos = [], nor = [], col = [], doomed = [];
  const m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), c = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.keep || !(o.material && o.material.isMeshLambertMaterial) || o.material.vertexColors || o.material.transparent) return;
    let vis = true; for (let q = o; q && q !== root; q = q.parent) if (!q.visible) vis = false;
    if (!vis) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    m4.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(m4); g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal; c.copy(o.material.color);
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(c.r, c.g, c.b); }
    g.dispose(); doomed.push(o);
  });
  for (const o of doomed) o.parent.remove(o);
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, VC_MAT); mesh.castShadow = shadow; mesh.receiveShadow = true;
  root.add(mesh); return mesh;
}
// geometry parts -> one vertex-coloured geometry (for instancing)
export function coloredGeometry(parts) {
  const holder = new THREE.Group();
  for (const p of parts) { const m = new THREE.Mesh(p.geo, M(p.color)); m.position.set(...(p.pos || [0, 0, 0])); if (p.rot) m.rotation.set(...p.rot); if (p.scale) m.scale.set(...p.scale); holder.add(m); }
  const merged = mergeStatic(holder); return merged.geometry;
}

export function makeLabel(text, color = '#fff', scale = 1) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(text, 128, 32); g.fillStyle = color; g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2.4 * scale, 0.6 * scale, 1); s.renderOrder = 10;
  return s;
}

// simple particle puffs
export class Particles {
  constructor(scene) {
    this.scene = scene; this.list = [];
    this.geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  }
  burst(x, y, z, color, n = 10, speed = 3, life = 0.6, size = 1) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.position.set(x, y, z); m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      const a = Math.random() * Math.PI * 2, u = Math.random();
      m.userData = { vx: Math.cos(a) * speed * u, vy: speed * (0.5 + Math.random()), vz: Math.sin(a) * speed * u, life, t: 0 };
      this.scene.add(m); this.list.push(m);
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i], d = m.userData; d.t += dt;
      d.vy -= 9 * dt; m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt;
      m.rotation.x += dt * 5; m.material.opacity = Math.max(0, 1 - d.t / d.life);
      if (d.t > d.life) { this.scene.remove(m); m.material.dispose(); this.list.splice(i, 1); }
    }
  }
}

export function buildWorld(scene, { shadows = true } = {}) {
  const colliders = []; // {c:1,x,z,r} circles or {minx,maxx,minz,maxz} boxes; optional top
  const W = { colliders, nodes: new Map(), npcs: [], stations: [], lamps: [], interact: [] };

  // ---------- terrain ----------
  const SIZE = 320, SEG = 128;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2).toNonIndexed();
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) pos.setY(i, islandHeight(pos.getX(i), pos.getZ(i)));
  const col = new THREE.Color();
  const pathDist = (x, z) => {
    // dirt paths: village cross + road to the barrow
    const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    let d = Math.min(Math.abs(x - VILLAGE.x), Math.abs(z - VILLAGE.z));
    if (dv > VILLAGE.r + 22) d = 99;
    if (z < VILLAGE.z && z > ENTRANCE.z) d = Math.min(d, Math.abs(x - Math.sin(z * 0.05) * 6));
    if (dv < 7) d = Math.min(d, Math.abs(dv - 5));
    return d;
  };
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const h = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const slope = Math.max(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)) - Math.min(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2));
    const n = fbm(x * 0.05, z * 0.05), j = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 * 0.04;
    if (h < -0.6) col.setHex(0xc9b77a);
    else if (h < 1.3) col.setHex(0xe3d293);
    else if (slope > 2.2 || h > 13) col.setHex(0x8a8a86);
    else if (pathDist(x, z) < 1.6 && h > 1.3) col.setHex(0xb89a68);
    else if (n > 0.52) col.setHex(0x3f7d35);
    else col.setHex(0x67a84a).lerp(new THREE.Color(0x86b856), Math.max(0, 0.5 - n));
    col.offsetHSL(0, 0, j);
    for (let k = 0; k < 3; k++) colors.set([col.r, col.g, col.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true; scene.add(terrain); W.terrain = terrain;

  // ---------- water ----------
  const wgeo = new THREE.PlaneGeometry(700, 700, 70, 70).rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wgeo, new THREE.MeshPhongMaterial({ color: 0x2f86c4, transparent: true, opacity: 0.82, flatShading: true, shininess: 80, specular: 0x88bbff }));
  water.position.y = -0.15; scene.add(water); W.water = water;
  const wbase = Float32Array.from(wgeo.attributes.position.array);
  W.updateWater = (t) => {
    const a = wgeo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) a[i + 1] = Math.sin(wbase[i] * 0.15 + t * 1.3) * 0.18 + Math.cos(wbase[i + 2] * 0.13 + t * 1.1) * 0.18;
    wgeo.attributes.position.needsUpdate = true; wgeo.computeVertexNormals();
  };

  // ---------- sky, lights, day/night ----------
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a5a30, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d0, 1.6);
  sun.castShadow = shadows; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
  sun.shadow.bias = -0.0008; scene.add(sun, sun.target);
  scene.fog = new THREE.Fog(0x9fd0f0, 40, 190);
  scene.background = new THREE.Color(0x9fd0f0);
  const sunBall = new THREE.Mesh(new THREE.IcosahedronGeometry(8, 0), new THREE.MeshBasicMaterial({ color: 0xfff0a0, fog: false }));
  const moonBall = new THREE.Mesh(new THREE.IcosahedronGeometry(5, 0), new THREE.MeshBasicMaterial({ color: 0xe0e8ff, fog: false }));
  scene.add(sunBall, moonBall);
  const starGeo = new THREE.BufferGeometry(); const sp = [];
  for (let i = 0; i < 600; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3 + 0.1; sp.push(Math.cos(a) * Math.cos(e) * 400, Math.sin(e) * 400, Math.sin(a) * Math.cos(e) * 400); }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true }));
  scene.add(stars);
  const C = { night: new THREE.Color(0x0b1233), dusk: new THREE.Color(0xe8946a), day: new THREE.Color(0x9fd0f0), dun: new THREE.Color(0x0d0a08) };
  const tmp = new THREE.Color();
  W.setTime = (tod, focus, inDungeon) => {
    const elev = Math.sin(tod * Math.PI * 2);
    const day = THREE.MathUtils.smoothstep(elev, -0.18, 0.3);
    const duskAmt = Math.max(0, 1 - Math.abs(elev) * 4) * 0.7;
    tmp.copy(C.night).lerp(C.day, day).lerp(C.dusk, duskAmt * (1 - day * 0.5));
    if (inDungeon) tmp.copy(C.dun);
    scene.background.copy(tmp); scene.fog.color.copy(tmp);
    scene.fog.near = inDungeon ? 8 : 40; scene.fog.far = inDungeon ? 55 : 120 + day * 70;
    const a = tod * Math.PI * 2;
    const sdir = new THREE.Vector3(Math.cos(a) * 0.8, Math.sin(a), 0.45).normalize();
    const lightDir = elev > -0.05 ? sdir : sdir.clone().negate();
    sun.position.copy(focus).addScaledVector(lightDir, 80); sun.target.position.copy(focus);
    sun.intensity = inDungeon ? 0.25 : elev > -0.05 ? 0.3 + day * 1.4 : 0.25;
    sun.color.setHex(elev > -0.05 ? 0xfff1d0 : 0x8fa6ff);
    hemi.intensity = inDungeon ? 0.55 : 0.35 + day * 0.6;
    hemi.color.setHex(inDungeon ? 0xffb070 : day > 0.5 ? 0xcfe8ff : 0x6f80c0);
    hemi.groundColor.setHex(inDungeon ? 0x302018 : 0x4a5a30);
    sunBall.position.copy(focus).addScaledVector(sdir, 300); moonBall.position.copy(focus).addScaledVector(sdir, -300);
    sunBall.visible = moonBall.visible = !inDungeon;
    stars.position.copy(focus); stars.material.opacity = inDungeon ? 0 : 1 - day; stars.visible = day < 0.95 && !inDungeon;
    water.visible = terrain.visible = !inDungeon;
    W.night = 1 - day;
    for (const l of W.lamps) l.material.color.setHex(day < 0.5 ? 0xffd27a : 0x9a8a60);
    for (const l of W.lampLights) l.intensity = day < 0.5 ? 18 * (1 - day * 2) : 0;
  };

  // ---------- village ----------
  const H = (x, z) => islandHeight(x, z);
  const village = new THREE.Group(); scene.add(village);
  const house = (x, z, w, d, rot = 0, roofColor = 0xa8452e, wall = 0xeadfc4) => {
    const g = new THREE.Group(); g.position.set(x, H(x, z), z); g.rotation.y = rot;
    g.add(mesh(new THREE.BoxGeometry(w, 3, d), wall, 0, 1.5, 0));
    const beams = mesh(new THREE.BoxGeometry(w + 0.2, 0.3, d + 0.2), 0x6b4a2e, 0, 3, 0); g.add(beams);
    const roof = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.6, 4), roofColor, 0, 4.4, 0); roof.rotation.y = Math.PI / 4; roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d)); g.add(roof);
    g.add(mesh(new THREE.BoxGeometry(1.1, 2, 0.15), 0x5a3a20, 0, 1, d / 2 + 0.05));
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.7, 0.15), 0x9ad0ff, w / 4 + 0.3, 1.9, d / 2 + 0.05));
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.7, 0.15), 0x9ad0ff, -w / 4 - 0.3, 1.9, d / 2 + 0.05));
    village.add(g);
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)); const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
    colliders.push({ minx: x - hw, maxx: x + hw, minz: z - hd, maxz: z + hd, cam: 1, top: 5.5 });
  };
  house(0, -5, 9, 6, 0, 0x7a3a8a);      // elder hall
  house(13, 4, 6, 6, -Math.PI / 2);
  house(14, 18, 6, 5, -Math.PI / 2, 0x3a6aa8);
  house(-14, 22, 6, 5, Math.PI / 2, 0x8a6a2e);
  house(-6, 30, 5, 5, Math.PI, 0xa8452e);
  // well
  const wx = 0, wz = 12;
  village.add(mesh(new THREE.CylinderGeometry(1.2, 1.3, 1, 8), 0x8d8f94, wx, H(wx, wz) + 0.5, wz));
  village.add(mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 8), 0x2f6fa8, wx, H(wx, wz) + 0.9, wz));
  for (const sx of [-1, 1]) village.add(mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), 0x6b4a2e, wx + sx * 1.1, H(wx, wz) + 1.2, wz));
  const wroof = mesh(new THREE.ConeGeometry(1.7, 1, 4), 0xa8452e, wx, H(wx, wz) + 2.8, wz); wroof.rotation.y = Math.PI / 4; village.add(wroof);
  colliders.push({ c: 1, x: wx, z: wz, r: 1.4 });
  // smithy
  const fx = -15, fz = 7, ax = -11, az = 11;
  const furnace = new THREE.Group(); furnace.position.set(fx, H(fx, fz), fz); village.add(furnace);
  furnace.add(mesh(new THREE.BoxGeometry(2.2, 2, 2), 0x6f6f72, 0, 1, 0));
  furnace.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.6, 6), 0x5a5a5c, 0.5, 2.6, -0.4));
  const fire = mesh(new THREE.BoxGeometry(1, 0.7, 0.1), new THREE.MeshBasicMaterial({ color: 0xff8a20 }), 0, 0.7, 1.01, false); furnace.add(fire);
  colliders.push({ minx: fx - 1.1, maxx: fx + 1.1, minz: fz - 1, maxz: fz + 1 });
  const anvil = new THREE.Group(); anvil.position.set(ax, H(ax, az), az); village.add(anvil);
  anvil.add(mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), 0x6b4a2e, 0, 0.3, 0));
  anvil.add(mesh(new THREE.BoxGeometry(0.5, 0.25, 0.35), 0x2e3036, 0, 0.72, 0));
  anvil.add(mesh(new THREE.BoxGeometry(1.1, 0.22, 0.45), 0x2e3036, 0, 0.94, 0));
  const horn = mesh(new THREE.ConeGeometry(0.2, 0.5, 4), 0x2e3036, 0.75, 0.94, 0); horn.rotation.z = -Math.PI / 2; anvil.add(horn);
  colliders.push({ c: 1, x: ax, z: az, r: 0.8 });
  W.stations.push({ kind: 'furnace', x: fx, z: fz + 1.4, label: 'Use Furnace (Smelt)', obj: furnace }, { kind: 'anvil', x: ax, z: az, label: 'Use Anvil (Forge)', obj: anvil });
  // smithy roof on posts
  for (const [px, pz] of [[-17.5, 4.5], [-8.5, 4.5], [-17.5, 13.5], [-8.5, 13.5]]) { village.add(mesh(new THREE.BoxGeometry(0.3, 4, 0.3), 0x6b4a2e, px, H(px, pz) + 2, pz)); colliders.push({ c: 1, x: px, z: pz, r: 0.25 }); }
  const sroof = mesh(new THREE.BoxGeometry(10, 0.3, 10), 0x5a3a20, -13, H(-13, 9) + 4.1, 9); sroof.rotation.z = 0.08; village.add(sroof);
  // fence ring (protected-zone boundary) with 4 gates
  const postGeo = new THREE.BoxGeometry(0.25, 1.2, 0.25), railGeo = new THREE.BoxGeometry(0.12, 0.12, 1);
  const N = 72;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, ang = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (ang < 0.12 || ang > Math.PI / 2 - 0.12) continue; // gates at E/S/W/N
    const x = VILLAGE.x + Math.cos(a) * VILLAGE.r, z = VILLAGE.z + Math.sin(a) * VILLAGE.r;
    village.add(mesh(postGeo, 0x7a5432, x, H(x, z) + 0.6, z));
    const a2 = ((i + 0.5) / N) * Math.PI * 2, x2 = VILLAGE.x + Math.cos(a2) * VILLAGE.r, z2 = VILLAGE.z + Math.sin(a2) * VILLAGE.r;
    const ang2 = ((a2 % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (ang2 > 0.12 && ang2 < Math.PI / 2 - 0.12) {
      const len = (2 * Math.PI * VILLAGE.r) / N;
      for (const yy of [0.45, 0.95]) { const r = mesh(railGeo, 0x8a6442, x2, H(x2, z2) + yy, z2); r.scale.z = len * 1.05; r.rotation.y = -a2; village.add(r); }
    }
    colliders.push({ c: 1, x, z, r: 0.35 });
  }
  // lamps
  W.lampLights = [];
  for (const [lx, lz] of [[4, 17], [-4, 3], [8, 26], [-9, 17], [24, 13.6], [-24, 6.4], [3.6, -14], [-3.6, 34]]) {
    const y = H(lx, lz);
    village.add(mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), 0x3a3a3a, lx, y + 1.3, lz));
    const head = mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshBasicMaterial({ color: 0xffd27a }), lx, y + 2.75, lz, false);
    village.add(head); W.lamps.push(head); colliders.push({ c: 1, x: lx, z: lz, r: 0.25 });
  }
  for (const [lx, lz] of [[0, 4], [-12, 12], [0, 28]]) { const pl = new THREE.PointLight(0xffc070, 0, 22, 1.6); pl.position.set(lx, H(lx, lz) + 3, lz); scene.add(pl); W.lampLights.push(pl); }
  // signposts at the south gate
  const sign = new THREE.Group(); sign.position.set(3, H(3, 37.5), 37.5); village.add(sign);
  sign.add(mesh(new THREE.BoxGeometry(0.15, 1.8, 0.15), 0x6b4a2e, 0, 0.9, 0));
  sign.add(mesh(new THREE.BoxGeometry(1.6, 0.6, 0.1), 0xc49a62, 0, 1.6, 0));
  const sl = makeLabel('Wilds → build here', '#ffe9a8', 0.8); sl.position.set(3, H(3, 37.5) + 2.5, 37.5); scene.add(sl);
  // flowers + bushes
  const decor = new THREE.Group(); scene.add(decor);
  const bushGeo = new THREE.IcosahedronGeometry(0.6, 0), flowerGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  for (let i = 0; i < 140; i++) {
    const a = Math.random() * 6.28, r = 8 + Math.random() * 100, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = H(x, z); if (h < 1.5) continue;
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r + 1 && Math.random() < 0.6) continue;
    if (i % 3 === 0) { const b = mesh(bushGeo, 0x3f8a3a, x, h + 0.3, z); b.scale.y = 0.7; decor.add(b); }
    else { const f = mesh(flowerGeo, [0xff6a8a, 0xffe060, 0xffffff, 0xa070ff][i % 4], x, h + 0.15, z, false); decor.add(f); }
  }
  mergeStatic(decor, { shadow: false });
  mergeStatic(village);

  // ---------- resource nodes ----------
  const NODE_GEO = {
    tree: [coloredGeometry([{ geo: new THREE.CylinderGeometry(0.22, 0.32, 1.6, 5), color: 0x6b4a2e, pos: [0, 0.8, 0] }, { geo: new THREE.ConeGeometry(1.5, 2.6, 6), color: 0x2f6f3a, pos: [0, 2.6, 0] }, { geo: new THREE.ConeGeometry(1.1, 2.0, 6), color: 0x3a8044, pos: [0, 3.7, 0] }]),
      coloredGeometry([{ geo: new THREE.CylinderGeometry(0.3, 0.36, 0.4, 5), color: 0x6b4a2e, pos: [0, 0.2, 0] }])],
    oak: [coloredGeometry([{ geo: new THREE.CylinderGeometry(0.29, 0.42, 2.1, 5), color: 0x6b4a2e, pos: [0, 1.05, 0] }, { geo: new THREE.IcosahedronGeometry(1.8, 0), color: 0x4f8f2f, pos: [0, 3.2, 0], scale: [1.2, 0.9, 1.2] }, { geo: new THREE.IcosahedronGeometry(1.08, 0), color: 0x5a9a36, pos: [0.8, 3.9, 0.4] }]),
      coloredGeometry([{ geo: new THREE.CylinderGeometry(0.36, 0.44, 0.4, 5), color: 0x6b4a2e, pos: [0, 0.2, 0] }])],
  };
  const fleckColor = { copper: 0xd77a2a, tin: 0xe8eef0, iron: 0x7a2a1a };
  for (const t of ['rock', 'copper', 'tin', 'iron']) {
    const parts = [{ geo: new THREE.DodecahedronGeometry(1, 0), color: t === 'rock' ? 0x8d8f94 : 0x77777a, pos: [0, 0.55, 0], scale: [1.1, 0.8, 1] }];
    if (fleckColor[t]) for (let i = 0; i < 5; i++) parts.push({ geo: new THREE.BoxGeometry(0.26, 0.26, 0.26), color: fleckColor[t], pos: [Math.cos(i * 1.3) * 0.75, 0.5 + (i % 3) * 0.2, Math.sin(i * 1.3) * 0.7], rot: [i, i * 2, 0] });
    NODE_GEO[t] = [coloredGeometry(parts), coloredGeometry([{ geo: new THREE.DodecahedronGeometry(1, 0), color: 0x6a6a6c, pos: [0, 0.15, 0], scale: [0.8, 0.25, 0.8] }])];
  }
  const all = generateNodes(), byType = {};
  for (const n of all) (byType[n.type] ||= []).push(n);
  const dummy = new THREE.Object3D(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const [type, list] of Object.entries(byType)) {
    const live = new THREE.InstancedMesh(NODE_GEO[type][0], VC_MAT, list.length), dep = new THREE.InstancedMesh(NODE_GEO[type][1], VC_MAT, list.length);
    live.castShadow = dep.castShadow = true; live.receiveShadow = dep.receiveShadow = true;
    list.forEach((n, i) => {
      const s = type === 'tree' ? 0.9 + (n.r % 1) * 0.4 : 1;
      dummy.position.set(n.x, H(n.x, n.z), n.z); dummy.rotation.set(0, n.r, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      live.setMatrixAt(i, dummy.matrix); dep.setMatrixAt(i, ZERO);
      const isTree = type === 'tree' || type === 'oak';
      colliders.push({ c: 1, x: n.x, z: n.z, r: isTree ? 0.55 : 0.95, node: n.id, ...(isTree ? { cam: 1.1, top: 5.5 } : {}) });
      W.nodes.set(n.id, { ...n, def: NODE_TYPES[n.type], live, dep, idx: i, matrix: dummy.matrix.clone(), depleted: false, until: 0, obj: { position: dummy.position.clone(), rotation: { z: 0 } } });
    });
    live.computeBoundingSphere(); dep.computeBoundingSphere();
    scene.add(live, dep);
  }
  W.setNodeDepleted = (id, d, until = 0) => {
    const n = W.nodes.get(id); if (!n) return;
    n.depleted = d; n.until = until;
    n.live.setMatrixAt(n.idx, d ? ZERO : n.matrix); n.dep.setMatrixAt(n.idx, d ? n.matrix : ZERO);
    n.live.instanceMatrix.needsUpdate = true; n.dep.instanceMatrix.needsUpdate = true;
  };

  // ---------- barrow entrance ----------
  const ex = ENTRANCE.x, ez = ENTRANCE.z, ey = H(ex, ez);
  const barrow = new THREE.Group(); barrow.position.set(ex, ey, ez); scene.add(barrow);
  const mound = mesh(new THREE.IcosahedronGeometry(9, 1), 0x5f7a3a, 0, -2, -7); mound.scale.set(1.2, 0.75, 1); barrow.add(mound);
  for (const sx of [-1, 1]) barrow.add(mesh(new THREE.BoxGeometry(1.2, 4.2, 1.2), 0x8d8f94, sx * 2, 2.1, 0));
  barrow.add(mesh(new THREE.BoxGeometry(5.6, 1, 1.4), 0x7d7f84, 0, 4.6, 0));
  barrow.add(mesh(new THREE.BoxGeometry(2.8, 4, 0.2), new THREE.MeshBasicMaterial({ color: 0x050505 }), 0, 2, -0.3, false));
  for (const sx of [-1, 1]) { const st = mesh(new THREE.BoxGeometry(0.8, 2.2, 0.8), 0x6f7176, sx * 5, 1.1, 2.5); st.rotation.y = 0.3 * sx; barrow.add(st); colliders.push({ c: 1, x: ex + sx * 5, z: ez + 2.5, r: 0.6 }); }
  colliders.push({ minx: ex - 2.7, maxx: ex - 1.4, minz: ez - 0.6, maxz: ez + 0.6 }, { minx: ex + 1.4, maxx: ex + 2.7, minz: ez - 0.6, maxz: ez + 0.6 });
  colliders.push({ c: 1, x: ex, z: ez - 7, r: 8.6 }); // the mound body (door is at its southern face)
  mergeStatic(barrow);
  const bl = makeLabel('The Hollow Barrow', '#ffcf7a', 1); bl.position.set(ex, ey + 6, ez); scene.add(bl);
  W.entrance = { x: ex, z: ez + 0.8, y: ey };

  W.height = islandHeight;
  return W;
}
