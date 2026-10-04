// Chunky low-poly avatar (RuneScape-2 style boxes) with procedural animation.
import * as THREE from 'three';
import { SWORDS } from './shared.js';

export const SKINS = [0xf2d0b0, 0xe0ac7e, 0xc68642, 0x8d5524, 0x5a3a22];
export const HAIR_COLORS = [0x2b1a10, 0x6b3e1e, 0xd9a441, 0xb03a1e, 0xe8e8e8, 0x2a4fa0];
export const TUNICS = [0x2f8f3a, 0x2a5fb0, 0xb02a2a, 0x7a3fa0, 0xd08a1c, 0x3a3f48];
export const HAIR_STYLES = ['Short', 'Long', 'Spiky', 'Bald'];
export const hex = (c) => '#' + c.toString(16).padStart(6, '0');

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const box = (w, h, d, m) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.castShadow = true; return g; };

export function makeSword(kind = 'wood') {
  const g = new THREE.Group();
  const s = SWORDS[kind] || SWORDS.wood;
  const blade = box(0.09, 0.95, 0.035, mat(s.color));
  blade.position.y = 0.62;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.16, 4), mat(s.color));
  tip.position.y = 1.17; tip.rotation.y = Math.PI / 4;
  const guard = box(0.32, 0.06, 0.08, mat(0x5a4632));
  guard.position.y = 0.14;
  const grip = box(0.06, 0.2, 0.06, mat(0x3b2a1a));
  grip.position.y = 0.02;
  g.add(blade, tip, guard, grip);
  g.userData.blade = blade;
  return g;
}
export function makeTool(kind) {
  const g = new THREE.Group();
  const handle = box(0.06, 0.8, 0.06, mat(0x7a5432)); handle.position.y = 0.35; g.add(handle);
  if (kind === 'axe') { const head = box(0.06, 0.22, 0.3, mat(0x9aa0a8)); head.position.set(0, 0.68, 0.12); g.add(head); }
  else { const head = box(0.06, 0.08, 0.62, mat(0x9aa0a8)); head.position.set(0, 0.72, 0); g.add(head); }
  return g;
}

export function buildAvatar(look = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body); // body handles roll / spin
  const M = { skin: mat(SKINS[0]), hair: mat(HAIR_COLORS[0]), tunic: mat(TUNICS[0]), dark: mat(0x3b2a1a), boot: mat(0x4a3220), belt: mat(0x5a3a1a), eye: mat(0x111111), shield: mat(0x7a5a3a), shieldRim: mat(0xb0b4bc) };
  const hips = new THREE.Group(); hips.position.y = 0.88; body.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = box(0.6, 0.62, 0.36, M.tunic); chest.position.y = 0.34; torso.add(chest);
  const belt = box(0.62, 0.08, 0.38, M.belt); belt.position.y = 0.06; torso.add(belt);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.42, 0.32, 6), M.tunic); skirt.position.y = -0.1; skirt.castShadow = true; hips.add(skirt);
  const head = new THREE.Group(); head.position.y = 0.68; torso.add(head);
  const skull = box(0.42, 0.42, 0.42, M.skin); skull.position.y = 0.2; head.add(skull);
  const eyeL = box(0.07, 0.07, 0.02, M.eye); eyeL.position.set(-0.1, 0.24, 0.215);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.1;
  const nose = box(0.07, 0.09, 0.07, M.skin); nose.position.set(0, 0.16, 0.23);
  head.add(eyeL, eyeR, nose);
  const hair = new THREE.Group(); head.add(hair);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.42, 4, 1), M.tunic); cap.rotation.set(-0.5, Math.PI / 4, 0); cap.position.set(0, 0.5, -0.12); cap.castShadow = true; head.add(cap);

  const arm = (side) => {
    const pivot = new THREE.Group(); pivot.position.set(0.39 * side, 0.58, 0); torso.add(pivot);
    const upper = box(0.17, 0.36, 0.18, M.tunic); upper.position.y = -0.16; pivot.add(upper);
    const fore = box(0.15, 0.34, 0.16, M.skin); fore.position.y = -0.48; pivot.add(fore);
    const hand = new THREE.Group(); hand.position.y = -0.66; pivot.add(hand);
    return { pivot, hand };
  };
  const armR = arm(-1), armL = arm(1); // model faces +z; character's right is -x
  const leg = (side) => {
    const pivot = new THREE.Group(); pivot.position.set(0.15 * side, 0, 0); hips.add(pivot);
    const thigh = box(0.2, 0.46, 0.22, M.dark); thigh.position.y = -0.24; pivot.add(thigh);
    const boot = box(0.22, 0.42, 0.28, M.boot); boot.position.set(0, -0.66, 0.03); pivot.add(boot);
    return pivot;
  };
  const legR = leg(-1), legL = leg(1);

  // sword in right hand: points forward (+z) when arm hangs
  const swordHolder = new THREE.Group(); swordHolder.rotation.x = Math.PI / 2; armR.hand.add(swordHolder);
  let sword = makeSword('wood'); swordHolder.add(sword);
  const axe = makeTool('axe'), pick = makeTool('pick');
  axe.rotation.x = Math.PI / 2; pick.rotation.x = Math.PI / 2; axe.visible = pick.visible = false;
  armR.hand.add(axe, pick);
  // shield on left forearm
  const shield = new THREE.Group();
  const sface = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.07, 8), M.shield); sface.rotation.z = Math.PI / 2; sface.castShadow = true;
  const srim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 6), M.shieldRim); srim.rotation.z = Math.PI / 2; srim.position.x = 0.03;
  shield.add(sface, srim); shield.position.set(0.12, 0.2, 0.02); armL.hand.add(shield);
  // charge glow
  const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.0 }));
  swordHolder.add(glow); glow.position.y = 1.1;

  const A = { root, body, hips, torso, head, armR, armL, legR, legL, swordHolder, shield, glow, axe, pick, M, hair, cap, t: 0, look: {} };
  A.setLook = (l) => {
    A.look = { skin: 0, hair: 0, hairColor: 0, tunic: 0, sword: 'wood', ...l };
    M.skin.color.setHex(SKINS[A.look.skin % SKINS.length]);
    M.hair.color.setHex(HAIR_COLORS[A.look.hairColor % HAIR_COLORS.length]);
    M.tunic.color.setHex(TUNICS[A.look.tunic % TUNICS.length]);
    while (hair.children.length) hair.remove(hair.children[0]);
    const style = A.look.hair % HAIR_STYLES.length;
    if (style === 0) { const t = box(0.46, 0.14, 0.46, M.hair); t.position.y = 0.43; const b = box(0.46, 0.3, 0.12, M.hair); b.position.set(0, 0.3, -0.18); hair.add(t, b); }
    if (style === 1) { const t = box(0.46, 0.14, 0.46, M.hair); t.position.y = 0.43; const b = box(0.48, 0.62, 0.14, M.hair); b.position.set(0, 0.14, -0.2); const s1 = box(0.08, 0.4, 0.3, M.hair); s1.position.set(-0.23, 0.24, -0.04); const s2 = s1.clone(); s2.position.x = 0.23; hair.add(t, b, s1, s2); }
    if (style === 2) { for (let i = 0; i < 7; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 4), M.hair); const a = (i / 7) * Math.PI * 2; c.position.set(Math.cos(a) * 0.14, 0.5, Math.sin(a) * 0.14 - 0.03); c.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); c.castShadow = true; hair.add(c); } }
    cap.visible = style !== 2;
    A.setSword(A.look.sword);
  };
  A.setSword = (kind) => {
    A.look.sword = kind;
    swordHolder.remove(sword); sword = makeSword(kind); swordHolder.add(sword);
  };
  A.setLook(look);
  return A;
}

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
// s = { anim, t (seconds in anim), speed (0..1+), charge (0..1), tool }
export function animateAvatar(A, s, dt) {
  A.t += dt;
  const k = 1 - Math.exp(-dt * 18);
  const tgt = { rAx: 0, rAy: 0, rAz: 0.1, lAx: 0, lAy: 0, lAz: -0.1, rL: 0, lL: 0, torsoY: 0, torsoX: 0, hipsY: 0.88, bodyX: 0, bodyY: 0, headX: 0 };
  const sp = s.speed || 0;
  const cyc = A.t * (6 + sp * 5);
  if (sp > 0.05) {
    const amp = Math.min(1, sp) * 0.75;
    tgt.rL = Math.sin(cyc) * amp; tgt.lL = -Math.sin(cyc) * amp;
    tgt.rAx = -Math.sin(cyc) * amp * 0.7; tgt.lAx = Math.sin(cyc) * amp * 0.7;
    tgt.hipsY = 0.88 + Math.abs(Math.cos(cyc)) * 0.06;
    tgt.torsoX = sp > 1.2 ? 0.2 : 0.05;
  } else {
    tgt.hipsY = 0.88 + Math.sin(A.t * 2) * 0.012;
    tgt.rAx = -0.25; // sword held slightly forward
  }
  A.axe.visible = s.anim === 'gather' && s.tool === 'axe';
  A.pick.visible = s.anim === 'gather' && s.tool === 'pick';
  A.swordHolder.visible = s.anim !== 'gather';
  let glow = 0, bodyRotDirect = null;
  const t = s.t || 0;
  switch (s.anim) {
    case 'attack1': { const p = ease(t / 0.22); tgt.rAx = -1.5; tgt.rAy = lerp(1.2, -1.1, p); tgt.torsoY = lerp(0.6, -0.6, p); break; }
    case 'attack2': { const p = ease(t / 0.22); tgt.rAx = -1.3; tgt.rAy = lerp(-1.1, 1.2, p); tgt.rAz = 0.8; tgt.torsoY = lerp(-0.6, 0.6, p); break; }
    case 'attack3': { const p = ease(t / 0.25); tgt.rAx = lerp(-2.9, -1.2, p); tgt.torsoX = lerp(-0.2, 0.35, p); tgt.lAx = -0.6; break; }
    case 'charge': tgt.rAx = -0.9; tgt.rAy = 1.4; tgt.torsoY = 0.9; glow = Math.min(1, s.charge || 0); tgt.hipsY = 0.8; break;
    case 'spin': { tgt.rAx = -1.55; tgt.rAy = 0; tgt.lAx = -1.2; bodyRotDirect = -ease(t / 0.45) * Math.PI * 2; glow = 1 - t / 0.5; break; }
    case 'block': tgt.lAx = -1.45; tgt.lAy = -0.9; tgt.lAz = 0; tgt.rAx = -0.4; tgt.hipsY = 0.8; tgt.torsoX = 0.1; break;
    case 'roll': { const p = Math.min(1, t / 0.5); A.body.rotation.x = p * Math.PI * 2; A.body.position.y = Math.sin(p * Math.PI) * 0.35; tgt.hipsY = 0.6; tgt.rL = -1.4; tgt.lL = -1.4; tgt.rAx = -1; tgt.lAx = -1; break; }
    case 'gather': { const p = (t * 1.6) % 1; tgt.rAx = p < 0.6 ? lerp(-2.8, -0.6, ease(p / 0.6)) : lerp(-0.6, -2.8, (p - 0.6) / 0.4); tgt.lAx = tgt.rAx * 0.8; tgt.torsoX = 0.15; break; }
    case 'hurt': tgt.torsoX = -0.4; tgt.rAx = -0.8; tgt.lAx = -0.8; tgt.headX = -0.3; break;
    case 'dead': tgt.hipsY = 0.25; tgt.torsoX = -1.3; tgt.rAx = -2.5; tgt.lAx = -2.5; break;
    case 'grapple': tgt.rAx = -1.6; tgt.lAx = -1.6; tgt.rL = -0.5; tgt.lL = 0.3; break;
    case 'jump': tgt.rL = -0.6; tgt.lL = 0.4; tgt.rAx = -1.2; tgt.lAx = -1.2; break;
  }
  if (s.anim !== 'roll') { A.body.rotation.x = lerp(A.body.rotation.x % (Math.PI * 2), 0, k); A.body.position.y = lerp(A.body.position.y, 0, k); }
  if (bodyRotDirect !== null) A.body.rotation.y = bodyRotDirect; else A.body.rotation.y = lerp(A.body.rotation.y, 0, k);
  const kk = s.anim && s.anim.startsWith('attack') ? Math.min(1, k * 2.5) : k;
  A.armR.pivot.rotation.x = lerp(A.armR.pivot.rotation.x, tgt.rAx, kk);
  A.armR.pivot.rotation.y = lerp(A.armR.pivot.rotation.y, tgt.rAy, kk);
  A.armR.pivot.rotation.z = lerp(A.armR.pivot.rotation.z, tgt.rAz, kk);
  A.armL.pivot.rotation.x = lerp(A.armL.pivot.rotation.x, tgt.lAx, k);
  A.armL.pivot.rotation.y = lerp(A.armL.pivot.rotation.y, tgt.lAy, k);
  A.armL.pivot.rotation.z = lerp(A.armL.pivot.rotation.z, tgt.lAz, k);
  A.legR.rotation.x = lerp(A.legR.rotation.x, tgt.rL, k);
  A.legL.rotation.x = lerp(A.legL.rotation.x, tgt.lL, k);
  A.torso.rotation.y = lerp(A.torso.rotation.y, tgt.torsoY, kk);
  A.torso.rotation.x = lerp(A.torso.rotation.x, tgt.torsoX, k);
  A.head.rotation.x = lerp(A.head.rotation.x, tgt.headX, k);
  A.hips.position.y = lerp(A.hips.position.y, tgt.hipsY, k);
  A.glow.material.opacity = glow * (0.6 + Math.sin(A.t * 30) * 0.3);
  A.glow.scale.setScalar(0.6 + glow);
}
