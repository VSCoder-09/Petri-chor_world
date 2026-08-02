import * as THREE from 'three';
import { PLAYER_OUTFITS, loadAll, instantiate, isLoaded, autoScaleToSize } from './assets.js';

// ---------------------------------------------------------------------------
// creator.js — the player character creator. Owns its own tiny preview
// renderer (independent of the main game renderer, so it works even before
// Play is pressed) plus the saved character state: body/outfit, a color
// tint (multiplies every material's own color — works on any GLB without
// knowing its parts), and a display name. Persisted in localStorage so it
// survives a reload; this is a real downloadable site (not a chat artifact),
// so browser storage is the right tool here.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'vv-character-v1';

export const TINT_SWATCHES = [
  { hex: 0xffffff, label: 'Classic' },
  { hex: 0xff8a3d, label: 'Sunset' },
  { hex: 0x3ddcff, label: 'Cyan' },
  { hex: 0xff4d6a, label: 'Crimson' },
  { hex: 0x6bff8a, label: 'Emerald' },
  { hex: 0xffd23a, label: 'Gold' },
  { hex: 0x9a6bff, label: 'Violet' },
  { hex: 0x2a2f33, label: 'Shadow' },
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s.outfitKey === 'string') return { name: s.name || 'Driver', outfitKey: s.outfitKey, tint: s.tint ?? 0xffffff };
    }
  } catch (e) { /* private-browsing / storage disabled — fall back below */ }
  return { name: 'Driver', outfitKey: PLAYER_OUTFITS[0].key, tint: 0xffffff };
}
const state = loadState();
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
export function getCharacterState() { return { ...state }; }

let onChangeCb = null;
export function onCharacterChange(cb) { onChangeCb = cb; }
function notify() { saveState(); if (onChangeCb) onChangeCb(getCharacterState()); }

// ---------------- preview renderer (separate scene, own render loop) ----------------
let renderer3 = null, scene3 = null, camera3 = null, model3 = null;
let previewRunning = false;

function ensurePreview() {
  if (renderer3) return true;
  const canvas = document.getElementById('creator-preview');
  if (!canvas) return false;
  renderer3 = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer3.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  scene3 = new THREE.Scene();
  camera3 = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera3.position.set(0, 1.45, 4);
  camera3.lookAt(0, 1.05, 0);
  scene3.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2, 4, 3);
  scene3.add(key);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), new THREE.MeshStandardMaterial({ color: 0x141a20, roughness: 1 }));
  disc.rotation.x = -Math.PI / 2;
  scene3.add(disc);
  return true;
}

function tick() {
  if (!previewRunning) return;
  requestAnimationFrame(tick);
  const canvas = renderer3.domElement;
  const w = canvas.clientWidth || 260, h = canvas.clientHeight || 320;
  if (canvas.width !== w || canvas.height !== h) {
    renderer3.setSize(w, h, false);
    camera3.aspect = w / h;
    camera3.updateProjectionMatrix();
  }
  if (model3) model3.rotation.y += 0.012;
  renderer3.render(scene3, camera3);
}

export function startPreview() {
  if (!ensurePreview()) return;
  if (previewRunning) return;
  previewRunning = true;
  tick();
}
export function stopPreview() { previewRunning = false; }

function applyTint(model, hex) {
  const c = new THREE.Color(hex);
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m.color) continue;
      if (m.userData._baseColor === undefined) m.userData._baseColor = m.color.getHex();
      m.color.setHex(m.userData._baseColor).multiply(c);
    }
  });
}

async function refreshPreviewModel() {
  if (!ensurePreview()) return;
  if (!isLoaded(state.outfitKey)) await loadAll([state.outfitKey]);
  if (model3) scene3.remove(model3);
  model3 = instantiate(state.outfitKey);
  autoScaleToSize(model3, 1.9, 'y');
  applyTint(model3, state.tint);
  scene3.add(model3);
}

// ---------------- panel wiring ----------------
export async function initCreatorUI() {
  const labelEl = document.getElementById('outfit-current-label');
  const nameInput = document.getElementById('player-name-input');
  const swatchWrap = document.getElementById('tint-swatches');

  const updateLabel = () => {
    const cur = PLAYER_OUTFITS.find(o => o.key === state.outfitKey);
    if (labelEl) labelEl.textContent = cur ? cur.label : state.outfitKey;
  };
  const updateSwatchSelection = () => {
    if (!swatchWrap) return;
    for (const ch of swatchWrap.children) ch.classList.toggle('active', Number(ch.dataset.hex) === state.tint);
  };

  if (swatchWrap && !swatchWrap.dataset.built) {
    swatchWrap.dataset.built = '1';
    for (const sw of TINT_SWATCHES) {
      const el = document.createElement('button');
      el.className = 'tint-swatch';
      el.style.background = `#${sw.hex.toString(16).padStart(6, '0')}`;
      el.title = sw.label;
      el.dataset.hex = String(sw.hex);
      el.addEventListener('click', () => {
        state.tint = sw.hex;
        if (model3) applyTint(model3, state.tint);
        updateSwatchSelection();
        notify();
      });
      swatchWrap.appendChild(el);
    }
  }

  if (nameInput && !nameInput.dataset.bound) {
    nameInput.dataset.bound = '1';
    nameInput.addEventListener('input', () => {
      state.name = nameInput.value.slice(0, 16);
      notify();
    });
  }
  if (nameInput) nameInput.value = state.name;

  updateLabel();
  updateSwatchSelection();
  await refreshPreviewModel();
}

export async function cycleOutfit(dir) {
  const idx = PLAYER_OUTFITS.findIndex(o => o.key === state.outfitKey);
  const next = PLAYER_OUTFITS[(idx + dir + PLAYER_OUTFITS.length) % PLAYER_OUTFITS.length];
  state.outfitKey = next.key;
  const labelEl = document.getElementById('outfit-current-label');
  if (labelEl) labelEl.textContent = next.label;
  await refreshPreviewModel();
  notify();
}
