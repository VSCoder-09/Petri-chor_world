import { clamp, isTouchDevice } from './utils.js';

// ---------------------------------------------------------------------------
// controls.js — normalises keyboard+mouse and touch input into one small
// state object polled once per frame by main.js.
//
// On foot (touch): joystick (move) + drag-to-look + Jump / Sprint / Enter /
// Interact buttons.
// Driving (touch): the joystick is swapped for dedicated Accelerate / Brake
// / Steer-Left / Steer-Right buttons, plus Handbrake / Exit / Camera / Reset.
// Keyboard always exposes the full scheme regardless of touch mode.
// ---------------------------------------------------------------------------

export class Controls {
  constructor() {
    this.axisX = 0;
    this.axisY = 0;
    this.run = false;
    this.handbrakeHeld = false;
    this.jumpHeld = false;
    // touch's own contribution to each control — combined with keyboard
    // every poll() rather than one source replacing the other, so a
    // touchscreen laptop/2-in-1 gets working keyboard AND touch at once.
    this.touchAxisX = 0;
    this.touchAxisY = 0;
    this.touchRun = false;
    this.touchJumpHeld = false;
    this.touchHandbrakeHeld = false;
    this._jumpEdge = false;
    this._enterEdge = false;
    this._interactEdge = false;
    this._cameraEdge = false;
    this._resetEdge = false;
    this._pauseEdge = false;
    this.lookDX = 0;
    this.lookDY = 0;
    this.lookActive = false;

    this.keys = new Set();
    this.touch = isTouchDevice();
    this.drivingUI = false; // which touch panel is visible
    if (this.touch) document.body.classList.add('is-touch');
    else document.getElementById('mobile-toggle-hint')?.classList.add('hidden');

    this._bindKeyboard();
    this._bindMouse();
    if (this.touch) this._bindTouch();
    this.setDriving(false);
  }

  // called by main.js whenever walk<->drive mode changes, to swap which
  // touch button panel is visible.
  setDriving(isDriving) {
    this.drivingUI = isDriving;
    document.getElementById('walk-controls')?.classList.toggle('hidden', isDriving);
    document.getElementById('drive-controls')?.classList.toggle('hidden', !isDriving);
    if (!isDriving) { this.touchAxisX = 0; this.touchAxisY = 0; }
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this.keys.has(e.code)) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this._jumpEdge = true;
      if (e.code === 'KeyE') this._enterEdge = true;
      if (e.code === 'KeyF') this._interactEdge = true;
      if (e.code === 'KeyC') this._cameraEdge = true;
      if (e.code === 'KeyR') this._resetEdge = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this._pauseEdge = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  _bindMouse() {
    let dragging = false, lastX = 0, lastY = 0;
    const canvasHost = document.getElementById('game-container');
    canvasHost.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; this.lookActive = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.lookDX += (e.clientX - lastX);
      this.lookDY += (e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
      this.lookActive = true;
    });
  }

  _bindTouch() {
    const zone = document.getElementById('joystick-zone');
    const knob = document.getElementById('joystick-knob');
    let joyId = null, baseX = 0, baseY = 0;
    const maxR = 45;
    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      joyId = t.identifier;
      const rect = zone.getBoundingClientRect();
      baseX = rect.left + rect.width / 2; baseY = rect.top + rect.height / 2;
    }, { passive: true });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        let dx = t.clientX - baseX, dy = t.clientY - baseY;
        const len = Math.hypot(dx, dy);
        if (len > maxR) { dx = dx / len * maxR; dy = dy / len * maxR; }
        knob.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px)`;
        this.touchAxisX = clamp(dx / maxR, -1, 1);
        this.touchAxisY = clamp(-dy / maxR, -1, 1);
      }
    }, { passive: true });
    const endJoy = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        joyId = null; knob.style.transform = `translate(-50%,-50%)`;
        this.touchAxisX = 0; this.touchAxisY = 0;
      }
    };
    zone.addEventListener('touchend', endJoy);
    zone.addEventListener('touchcancel', endJoy);

    const camZone = document.getElementById('cam-zone');
    let camId = null, lastX = 0, lastY = 0;
    camZone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; camId = t.identifier; lastX = t.clientX; lastY = t.clientY;
    }, { passive: true });
    camZone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== camId) continue;
        this.lookDX += (t.clientX - lastX) * 1.3;
        this.lookDY += (t.clientY - lastY) * 1.3;
        lastX = t.clientX; lastY = t.clientY;
        this.lookActive = true;
      }
    }, { passive: true });
    const endCam = (e) => { for (const t of e.changedTouches) if (t.identifier === camId) camId = null; };
    camZone.addEventListener('touchend', endCam);
    camZone.addEventListener('touchcancel', endCam);

    const bindBtn = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); }, { passive: false });
      if (onUp) el.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); }, { passive: false });
    };
    // on-foot buttons
    bindBtn('btn-enter', () => { this._enterEdge = true; });
    bindBtn('btn-interact', () => { this._interactEdge = true; });
    bindBtn('btn-jump', () => { this.touchJumpHeld = true; this._jumpEdge = true; }, () => { this.touchJumpHeld = false; });
    bindBtn('btn-run', () => { this.touchRun = true; }, () => { this.touchRun = false; });
    // driving buttons — reuse touchAxisX/touchAxisY so main.js's throttle/
    // steer mapping (throttle: axisY, steer: -axisX) needs no special-casing.
    bindBtn('btn-accel', () => { this.touchAxisY = 1; }, () => { if (this.touchAxisY > 0) this.touchAxisY = 0; });
    bindBtn('btn-brake', () => { this.touchAxisY = -1; }, () => { if (this.touchAxisY < 0) this.touchAxisY = 0; });
    bindBtn('btn-steer-left', () => { this.touchAxisX = -1; }, () => { if (this.touchAxisX < 0) this.touchAxisX = 0; });
    bindBtn('btn-steer-right', () => { this.touchAxisX = 1; }, () => { if (this.touchAxisX > 0) this.touchAxisX = 0; });
    bindBtn('btn-handbrake', () => { this.touchHandbrakeHeld = true; }, () => { this.touchHandbrakeHeld = false; });
    bindBtn('btn-exit', () => { this._enterEdge = true; });
    bindBtn('btn-camera', () => { this._cameraEdge = true; });
    bindBtn('btn-reset-car', () => { this._resetEdge = true; });
  }

  poll() {
    // keyboard is always live, on every device — a touchscreen laptop still
    // has a keyboard. Touch is combined on top of it, not instead of it.
    let kx = 0, ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky -= 1;
    const kRun = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const kHandbrake = this.keys.has('Space');
    const kJump = this.keys.has('Space');

    this.axisX = clamp(kx + this.touchAxisX, -1, 1);
    this.axisY = clamp(ky + this.touchAxisY, -1, 1);
    this.run = kRun || this.touchRun;
    this.handbrakeHeld = kHandbrake || this.touchHandbrakeHeld;
    this.jumpHeld = kJump || this.touchJumpHeld;

    const snapshot = {
      axisX: this.axisX, axisY: this.axisY, run: this.run,
      handbrake: this.handbrakeHeld, jumpHeld: this.jumpHeld,
      jumpPressed: this._jumpEdge, enterPressed: this._enterEdge,
      interactPressed: this._interactEdge, cameraPressed: this._cameraEdge,
      resetPressed: this._resetEdge, pausePressed: this._pauseEdge,
      lookDX: this.lookDX, lookDY: this.lookDY, lookActive: this.lookActive,
    };
    this._jumpEdge = false; this._enterEdge = false; this._interactEdge = false;
    this._cameraEdge = false; this._resetEdge = false; this._pauseEdge = false;
    this.lookDX = 0; this.lookDY = 0;
    return snapshot;
  }
}
