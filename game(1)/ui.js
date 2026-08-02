import { ROAD_SPACING } from './world.js';
import { PREMIUM_SHOWCASE } from './assets.js';

const loadingScreen = document.getElementById('loading-screen');
const loadingFill = document.getElementById('loading-fill');
const loadingText = document.getElementById('loading-text');
const promptEl = document.getElementById('prompt');
const speedoWrap = document.getElementById('speedo-wrap');
const speedoCanvas = document.getElementById('speedo');
const speedValueEl = document.getElementById('speed-value');
const gearValueEl = document.getElementById('gear-value');
const vehicleLabelEl = document.getElementById('vehicle-label');
const minimapWrap = document.getElementById('minimap-wrap');
const minimapCanvas = document.getElementById('minimap');
const stuntBanner = document.getElementById('stunt-banner');
const wantedMsg = document.getElementById('wanted-msg');
const fpsEl = document.getElementById('fps');
const toastEl = document.getElementById('toast');
const pauseOverlay = document.getElementById('pause-overlay');
const settingsPanel = document.getElementById('settings-panel');
const outfitPanel = document.getElementById('outfit-panel');
const soundBtnIcon = document.getElementById('btn-sound-icon');
const soundBtnIconSettings = document.getElementById('btn-sound-icon-settings');

const speedoCtx = speedoCanvas.getContext('2d');
const mapCtx = minimapCanvas.getContext('2d');

export function setLoadingProgress(frac, label) {
  loadingFill.style.width = `${Math.round(frac * 100)}%`;
  if (label) loadingText.textContent = `Loading ${label}…`;
}
export function hideLoadingScreen() {
  loadingScreen.style.opacity = '0';
  setTimeout(() => loadingScreen.style.display = 'none', 650);
}

export function showPrompt(text) { promptEl.textContent = text; promptEl.classList.remove('hidden'); }
export function hidePrompt() { promptEl.classList.add('hidden'); }

export function setDrivingHUD(active) { speedoWrap.classList.toggle('hidden', !active); }

export function updateSpeedo(speedKmh, gear, label) {
  const c = speedoCtx, size = 180, cx = size / 2, cy = size / 2, r = 78;
  c.clearRect(0, 0, size, size);
  c.save(); c.translate(cx, cy);
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.strokeStyle = '#2a3644'; c.lineWidth = 8; c.stroke();
  const maxSpeed = 220;
  const startAngle = Math.PI * 0.75, endAngle = Math.PI * 2.25;
  const frac = Math.min(speedKmh / maxSpeed, 1);
  c.beginPath(); c.arc(0, 0, r, startAngle, startAngle + (endAngle - startAngle) * frac);
  c.strokeStyle = speedKmh > 140 ? '#ff4d4d' : '#3ddcff'; c.lineWidth = 8; c.lineCap = 'round'; c.stroke();
  for (let i = 0; i <= 11; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / 11);
    const x1 = Math.cos(a) * (r - 12), y1 = Math.sin(a) * (r - 12);
    const x2 = Math.cos(a) * (r - 4), y2 = Math.sin(a) * (r - 4);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = '#5f7385'; c.lineWidth = 2; c.stroke();
  }
  c.restore();
  speedValueEl.innerHTML = `${Math.round(speedKmh)}<span>km/h</span>`;
  gearValueEl.textContent = gear;
  if (vehicleLabelEl && label) vehicleLabelEl.textContent = label;
}

let bannerTimeout = null;
export function showStuntBanner(text) {
  stuntBanner.textContent = text; stuntBanner.classList.remove('hidden'); stuntBanner.classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => stuntBanner.classList.remove('show'), 1400);
}

let crashTimeout = null;
export function flashCrash() {
  wantedMsg.textContent = 'CRASH!';
  wantedMsg.classList.remove('hidden'); wantedMsg.classList.add('show');
  clearTimeout(crashTimeout);
  crashTimeout = setTimeout(() => wantedMsg.classList.remove('show'), 500);
}
export function flashFlip() {
  wantedMsg.textContent = 'FLIPPED! Tap Reset Car';
  wantedMsg.classList.remove('hidden'); wantedMsg.classList.add('show');
  clearTimeout(crashTimeout);
  crashTimeout = setTimeout(() => wantedMsg.classList.remove('show'), 1800);
}

let toastTimeout = null;
export function showToast(text) {
  toastEl.textContent = text; toastEl.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

let fpsAcc = 0, fpsFrames = 0, fpsLast = performance.now();
export function tickFps() {
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast > 500) {
    fpsEl.textContent = `${Math.round(fpsFrames / ((now - fpsLast) / 1000))} fps`;
    fpsLast = now; fpsFrames = 0;
  }
}

export function updateMinimap(px, pz, headingRad, entities) {
  if (minimapWrap.classList.contains('hidden')) return;
  const size = 220, cx = size / 2, cy = size / 2;
  const range = 90;
  const scale = (size / 2) / range;
  mapCtx.clearRect(0, 0, size, size);
  mapCtx.fillStyle = '#0d1116'; mapCtx.fillRect(0, 0, size, size);
  mapCtx.strokeStyle = '#454d57'; mapCtx.lineWidth = 5;
  const firstLineX = Math.floor((px - range) / ROAD_SPACING) * ROAD_SPACING;
  for (let wx = firstLineX; wx <= px + range; wx += ROAD_SPACING) {
    const sx = cx + (wx - px) * scale;
    mapCtx.beginPath(); mapCtx.moveTo(sx, 0); mapCtx.lineTo(sx, size); mapCtx.stroke();
  }
  const firstLineZ = Math.floor((pz - range) / ROAD_SPACING) * ROAD_SPACING;
  for (let wz = firstLineZ; wz <= pz + range; wz += ROAD_SPACING) {
    const sy = cy - (wz - pz) * scale;
    mapCtx.beginPath(); mapCtx.moveTo(0, sy); mapCtx.lineTo(size, sy); mapCtx.stroke();
  }
  for (const e of entities) {
    const dx = e.x - px, dz = e.z - pz;
    if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
    const sx = cx + dx * scale, sy = cy - dz * scale;
    mapCtx.beginPath();
    if (e.type === 'vehicle') { mapCtx.fillStyle = '#ff8a3d'; mapCtx.arc(sx, sy, 3, 0, Math.PI * 2); }
    else if (e.type === 'landmark') { mapCtx.fillStyle = '#3ddcff'; mapCtx.arc(sx, sy, 3, 0, Math.PI * 2); }
    else { mapCtx.fillStyle = '#e8edf2'; mapCtx.arc(sx, sy, 2, 0, Math.PI * 2); }
    mapCtx.fill();
  }
  mapCtx.save(); mapCtx.translate(cx, cy); mapCtx.rotate(-headingRad);
  mapCtx.beginPath(); mapCtx.moveTo(0, -9); mapCtx.lineTo(6, 7); mapCtx.lineTo(-6, 7); mapCtx.closePath();
  mapCtx.fillStyle = '#3ddcff'; mapCtx.fill(); mapCtx.restore();
}

export function toggleMinimap() { minimapWrap.classList.toggle('hidden'); }

// ---------------- pause / settings / outfit panels ----------------
export function showPause() { pauseOverlay.classList.remove('hidden'); }
export function hidePause() { pauseOverlay.classList.add('hidden'); }
export function isPaused() { return !pauseOverlay.classList.contains('hidden'); }

export function showSettings() { buildPremiumList(); settingsPanel.classList.remove('hidden'); }
export function hideSettings() { settingsPanel.classList.add('hidden'); }

export function setSoundIcon(on) {
  const icon = on ? '🔊' : '🔇';
  if (soundBtnIcon) soundBtnIcon.textContent = icon;
  if (soundBtnIconSettings) soundBtnIconSettings.textContent = icon;
}

export function buildPremiumList() {
  const el = document.getElementById('premium-vehicle-list');
  if (!el || el.dataset.built) return;
  el.dataset.built = '1';
  for (const v of PREMIUM_SHOWCASE) {
    const chip = document.createElement('div');
    chip.className = 'premium-chip';
    chip.textContent = v.label;
    el.appendChild(chip);
  }
}

export function setDayNightIcon(on) { const el = document.getElementById('btn-daynight-toggle'); if (el) el.textContent = on ? '☀️' : '🌙'; }
export function setSeasonsIcon(on) { const el = document.getElementById('btn-seasons-toggle'); if (el) el.textContent = on ? '🍃' : '❄️'; }
export function showOutfitPanel() { outfitPanel.classList.remove('hidden'); }
export function hideOutfitPanel() { outfitPanel.classList.add('hidden'); }

// ---------------- start screen ----------------
export function showStartScreen() { document.getElementById('start-screen').classList.remove('hidden'); }
export function hideStartScreen() { document.getElementById('start-screen').classList.add('hidden'); }
