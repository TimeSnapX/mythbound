// Keyboard + mouse + touch input, mapped to game actions.
const KEYMAP = {
  KeyJ: 'attack', Tab: 'lock', KeyQ: 'shield', Space: 'roll', KeyE: 'interact', KeyG: 'grapple', KeyB: 'build',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyC: 'skills', KeyI: 'bag', KeyH: 'help', Enter: 'chat', Escape: 'escape',
  Digit1: 'piece1', Digit2: 'piece2', Digit3: 'piece3', KeyX: 'remove', KeyF: 'place',
};
export class Input {
  constructor(canvas) {
    this.canvas = canvas; this.down = new Set(); this.pressed = new Set(); this.released = new Set();
    this.keys = new Set(); this.look = { x: 0, y: 0 }; this.joy = { x: 0, y: 0 }; this.enabled = true;
    this.lastMouseLook = 0; this.buildMode = false;
    const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
    addEventListener('keydown', (e) => {
      if (typing()) { if (e.code === 'Escape' || e.code === 'Enter') this.press(e.code === 'Enter' ? 'chatSend' : 'escape'); return; }
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEYMAP[e.code]; if (a) this.press(a);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); const a = KEYMAP[e.code]; if (a) this.release(a); });
    addEventListener('blur', () => { for (const a of [...this.down]) this.release(a); this.keys.clear(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas && e.button === 0 && !this.touch && !this.noPointerLock) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) this.press(this.buildMode ? 'place' : 'attack');
      if (e.button === 2) this.press(this.buildMode ? 'remove' : 'lock');
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) { this.release('attack'); this.release('place'); } if (e.button === 2) { this.release('lock'); this.release('remove'); } });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.look.x += e.movementX; this.look.y += e.movementY; this.lastMouseLook = performance.now(); }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel = (this.wheel || 0) + Math.sign(e.deltaY); }, { passive: true });
  }
  press(a) { if (!this.down.has(a)) this.pressed.add(a); this.down.add(a); }
  release(a) { if (this.down.has(a)) this.released.add(a); this.down.delete(a); }
  isDown(a) { return this.down.has(a); }
  wasPressed(a) { return this.pressed.has(a); }
  wasReleased(a) { return this.released.has(a); }
  move() {
    let x = 0, y = 0; const k = this.keys;
    if (k.has('KeyW')) y += 1; if (k.has('KeyS')) y -= 1; if (k.has('KeyD')) x += 1; if (k.has('KeyA')) x -= 1;
    x += this.joy.x; y += this.joy.y;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  camKeys() { const k = this.keys; return { x: (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0), y: (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0) }; }
  consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
  endFrame() { this.pressed.clear(); this.released.clear(); }

  // ---- touch controls (phone) ----
  attachTouch(root) {
    this.touch = true;
    const joy = root.querySelector('#joy'), knob = root.querySelector('#joy-knob');
    let joyId = null, cx = 0, cy = 0;
    const R = 50;
    joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; joy.setPointerCapture(e.pointerId); upd(e); e.preventDefault(); });
    const upd = (e) => { let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } knob.style.transform = `translate(${dx}px,${dy}px)`; this.joy.x = dx / R; this.joy.y = -dy / R; };
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) upd(e); });
    const end = (e) => { if (e.pointerId !== joyId) return; joyId = null; this.joy.x = this.joy.y = 0; knob.style.transform = ''; };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
    root.querySelectorAll('[data-act]').forEach((b) => {
      const act = () => b.dataset.act;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture(e.pointerId); b.classList.add('on'); this.press(act()); });
      const up = (e) => { b.classList.remove('on'); this.release(act()); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    });
    // camera drag anywhere on the canvas
    let camId = null, lx = 0, ly = 0;
    this.canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' || camId !== null) return; camId = e.pointerId; lx = e.clientX; ly = e.clientY; });
    this.canvas.addEventListener('pointermove', (e) => { if (e.pointerId !== camId) return; this.look.x += (e.clientX - lx) * 1.6; this.look.y += (e.clientY - ly) * 1.6; lx = e.clientX; ly = e.clientY; this.lastMouseLook = performance.now(); });
    const cend = (e) => { if (e.pointerId === camId) camId = null; };
    this.canvas.addEventListener('pointerup', cend); this.canvas.addEventListener('pointercancel', cend);
  }
}
