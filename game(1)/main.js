import * as THREE from 'three';
import { MANIFEST, VEHICLE_KEYS, loadAll } from './assets.js';
import { World, setHeightOverride } from './world.js';
import { Character } from './character.js';
import { Vehicle } from './vehicle.js';
import { NPC } from './npc.js';
import { Controls } from './controls.js';
import { AudioManager } from './audio.js';
import * as ui from './ui.js';
import * as creator from './creator.js';
import { clamp } from './utils.js';

// ---------------------------------------------------------------------------
// main.js — wires every system together: title screen -> loading -> game
// loop, mode switching (walk/drive/interior), day/night, sound, and every
// HUD/pause/settings/outfit control.
// ---------------------------------------------------------------------------

const MAX_TRAFFIC_VEHICLES = 18;
const ENTER_VEHICLE_RANGE = 3.2;
const ENTER_DOOR_RANGE = 2.6;
const INTERIOR_ORIGIN = new THREE.Vector3(200000, 0, 200000);
const DAY_LENGTH_SECONDS = 300; // one full day/night cycle, real seconds

let scene, camera, renderer, clock;
let world, character, controls, audio;
const vehicles = [];
const npcs = [];

let mode = 'walk';
let currentVehicle = null;
let outsidePos = null;
let interiorRoom = null;
let dayClock = DAY_LENGTH_SECONDS * 0.28; // start mid-morning
let running = false; // true once Play has been pressed and the loop is live
let muted = false;
let dayNightEnabled = true;   // Settings: freeze at current time-of-day when off
let seasonsEnabled = false;   // Settings: slow seasonal light/ground tint cycle
let seasonClock = 0;
const SEASON_LENGTH_SECONDS = 1200; // one full spring->winter cycle, real seconds

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd3ec);
  scene.fog = new THREE.FogExp2(0xafe0f0, 0.0038);

  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('game-container').appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xbfd9ea, 0x4a4632, 0.9);
  scene.add(hemi);
  window._hemi = hemi;

  const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
  sun.position.set(80, 140, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  sun.target.position.set(0, 0, 0);
  scene.add(sun.target);
  window._sun = sun;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// -------------------- day / night cycle --------------------
const NIGHT_COLOR = new THREE.Color(0x0a1020);
const DAY_COLOR = new THREE.Color(0x9fd3ec);
const SUNSET_COLOR = new THREE.Color(0xff9a5a);
const _lerpColor = new THREE.Color();
// four ground-tint moods cycled through when Seasons is enabled — a real,
// if simplified, seasonal effect (overall lighting mood) rather than a claim
// that every individual tree/leaf swaps color.
const SEASON_GROUND_COLORS = [0x4a6432, 0x4a6a2a, 0x6a5322, 0x3a4652]; // spring/summer/autumn/winter
const HEMI_GROUND_BASE = 0x4a4632;
const _seasonColor = new THREE.Color();

function updateDayNight(dt, focusPos) {
  if (dayNightEnabled) dayClock = (dayClock + dt) % DAY_LENGTH_SECONDS;
  const t = dayClock / DAY_LENGTH_SECONDS;
  const y = -Math.cos(t * Math.PI * 2);            // -1 (midnight) .. 1 (noon)
  const azimuth = (0.5 - t) * Math.PI;              // east at dawn -> west at dusk (toward the ocean)
  const horiz = Math.sqrt(Math.max(0, 1 - y * y));
  const dirX = horiz * Math.sin(azimuth), dirZ = horiz * Math.cos(azimuth);

  const sun = window._sun;
  sun.position.set(focusPos.x + dirX * 220, Math.max(y, 0.02) * 220 + 20, focusPos.z + dirZ * 220);
  sun.target.position.set(focusPos.x, 0, focusPos.z);
  const dayFactor = clamp(y * 0.8 + 0.35, 0, 1);
  sun.intensity = 0.15 + Math.max(0, y) * 1.6;

  if (seasonsEnabled) {
    seasonClock = (seasonClock + dt) % SEASON_LENGTH_SECONDS;
    const sIdx = (seasonClock / SEASON_LENGTH_SECONDS) * 4;
    const i0 = Math.floor(sIdx) % 4, i1 = (i0 + 1) % 4, sf = sIdx - Math.floor(sIdx);
    _seasonColor.setHex(SEASON_GROUND_COLORS[i0]).lerp(new THREE.Color(SEASON_GROUND_COLORS[i1]), sf);
    window._hemi.groundColor.copy(_seasonColor);
  } else {
    window._hemi.groundColor.setHex(HEMI_GROUND_BASE);
  }
  window._hemi.intensity = 0.25 + dayFactor * 0.7;

  const sunsetFactor = Math.max(0, 1 - Math.abs(y) * 2.6);
  _lerpColor.copy(NIGHT_COLOR).lerp(DAY_COLOR, dayFactor).lerp(SUNSET_COLOR, sunsetFactor * 0.55);
  scene.background.copy(_lerpColor);
  scene.fog.color.copy(_lerpColor);

  const nightFactor = clamp(1 - dayFactor * 1.3, 0, 1);
  for (const mat of world.getAllNightMaterials()) mat.emissiveIntensity = nightFactor;

  return { t, y };
}

// -------------------- building interior "pocket" --------------------
function buildInteriorRoom() {
  const group = new THREE.Group();
  group.position.copy(INTERIOR_ORIGIN);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8a7a63, roughness: 0.9 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcdc2ad, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 16), floorMat);
  floor.position.y = -0.2; floor.receiveShadow = true; group.add(floor);
  const wallH = 4;
  const walls = [
    { w: 16, h: wallH, d: 0.3, x: 0, z: -8 }, { w: 16, h: wallH, d: 0.3, x: 0, z: 8 },
    { w: 0.3, h: wallH, d: 16, x: -8, z: 0 },
  ];
  for (const wdef of walls) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wdef.w, wdef.h, wdef.d), wallMat);
    wall.position.set(wdef.x, wallH / 2, wdef.z);
    wall.castShadow = true; wall.receiveShadow = true;
    group.add(wall);
  }
  const eastA = new THREE.Mesh(new THREE.BoxGeometry(0.3, wallH, 6), wallMat);
  eastA.position.set(8, wallH / 2, -5.5); group.add(eastA);
  const eastB = new THREE.Mesh(new THREE.BoxGeometry(0.3, wallH, 6), wallMat);
  eastB.position.set(8, wallH / 2, 5.5); group.add(eastB);
  const platform = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4), floorMat);
  platform.position.set(-4, 1.05, -4); platform.receiveShadow = true; group.add(platform);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 3), floorMat);
  ramp.position.set(-4, 0.5, -1.3); ramp.rotation.x = -0.5; group.add(ramp);
  const roomLight = new THREE.PointLight(0xfff2d0, 15, 20, 2);
  roomLight.position.set(0, 3.2, 0); group.add(roomLight);
  const exitLocal = new THREE.Vector3(6.5, 0, 0);
  const heightFn = (wx, wz) => {
    const lx = wx - INTERIOR_ORIGIN.x, lz = wz - INTERIOR_ORIGIN.z;
    if (lx > -5.5 && lx < -2.5 && lz > -3 && lz < 0.3) { const t = clamp((0.3 - lz) / 3.3, 0, 1); return t * 0.9; }
    if (lx > -6 && lx < -2 && lz > -6 && lz < -2) return 0.9;
    return 0;
  };
  const wallColliders2 = [
    { minX: -8.2, maxX: 8.2, minZ: -8.2, maxZ: -7.8 }, { minX: -8.2, maxX: 8.2, minZ: 7.8, maxZ: 8.2 },
    { minX: -8.2, maxX: -7.8, minZ: -8.2, maxZ: 8.2 },
  ].map(b => ({ closestPoint: (x, z) => [clamp(x, b.minX, b.maxX), clamp(z, b.minZ, b.maxZ)] }));
  return { group, heightFn, colliders: wallColliders2, exitWorld: new THREE.Vector3(INTERIOR_ORIGIN.x + exitLocal.x, 0, INTERIOR_ORIGIN.z + exitLocal.z) };
}

// -------------------- chunk entity spawning --------------------
function onChunkBuilt(chunk) {
  for (const spawn of chunk.npcSpawns) {
    const npc = new NPC(scene, spawn);
    npcs.push(npc);
    chunk.entities.push({ type: 'npc', ref: npc });
  }
  for (const spawn of chunk.parkedVehicleSpawns) {
    const key = spawn.key || VEHICLE_KEYS[Math.floor(Math.random() * VEHICLE_KEYS.length)];
    const v = new Vehicle(scene, key, { isTraffic: false });
    v.homeMode = 'parked';
    v.setPose(spawn.x, spawn.z, spawn.heading);
    vehicles.push(v);
    chunk.entities.push({ type: 'vehicle', ref: v });
  }
  if (vehicles.filter(v => v.isTraffic).length < MAX_TRAFFIC_VEHICLES) {
    for (const spawn of chunk.trafficSpawns) {
      const key = VEHICLE_KEYS[Math.floor(Math.random() * VEHICLE_KEYS.length)];
      const v = new Vehicle(scene, key, { isTraffic: true });
      v.homeMode = 'traffic';
      v.setPose(spawn.x, spawn.z, spawn.heading);
      vehicles.push(v);
      chunk.entities.push({ type: 'vehicle', ref: v });
    }
  }
}

function onChunkRemoved(chunk) {
  for (const ent of chunk.entities) {
    if (ent.ref === currentVehicle) continue;
    if (ent.type === 'npc') {
      const idx = npcs.indexOf(ent.ref);
      if (idx >= 0) npcs.splice(idx, 1);
      ent.ref.dispose();
    } else if (ent.type === 'vehicle') {
      const idx = vehicles.indexOf(ent.ref);
      if (idx >= 0) vehicles.splice(idx, 1);
      ent.ref.dispose();
    }
  }
}

// -------------------- mode transitions --------------------
function tryEnterVehicle() {
  let best = null, bestD = ENTER_VEHICLE_RANGE;
  for (const v of vehicles) {
    if (v.mode === 'player') continue;
    const d = Math.hypot(v.position.x - character.position.x, v.position.z - character.position.z);
    if (d < bestD) { bestD = d; best = v; }
  }
  if (!best) return false;
  currentVehicle = best;
  currentVehicle.mode = 'player';
  character.setHidden(true);
  ui.setDrivingHUD(true);
  controls.setDriving(true);
  mode = 'drive';
  audio.blip(520);
  return true;
}

function exitVehicle() {
  const v = currentVehicle;
  const sideX = Math.cos(v.heading) * (v.halfWidth + 1.4);
  const sideZ = -Math.sin(v.heading) * (v.halfWidth + 1.4);
  character.teleport(v.position.x + sideX, v.position.z + sideZ, v.heading);
  character.setHidden(false);
  v.mode = v.homeMode;
  currentVehicle = null;
  ui.setDrivingHUD(false);
  controls.setDriving(false);
  mode = 'walk';
  audio.blip(340);
}

function tryEnterBuilding() {
  const door = world.findNearestDoor(character.position.x, character.position.z, ENTER_DOOR_RANGE + 6);
  if (!door) return false;
  const d = Math.hypot(door.x - character.position.x, door.z - character.position.z);
  if (d > ENTER_DOOR_RANGE) return false;
  outsidePos = { x: character.position.x, z: character.position.z, heading: character.heading };
  if (!interiorRoom) { interiorRoom = buildInteriorRoom(); scene.add(interiorRoom.group); }
  setHeightOverride(interiorRoom.heightFn);
  character.teleport(INTERIOR_ORIGIN.x - 6, INTERIOR_ORIGIN.z, Math.PI / 2);
  mode = 'interior';
  audio.blip(480);
  return true;
}

function exitBuilding() {
  setHeightOverride(null);
  character.teleport(outsidePos.x, outsidePos.z, outsidePos.heading);
  mode = 'walk';
  audio.blip(340);
}

// -------------------- title screen / pause / settings / outfit wiring --------------------
function wireMenus() {
  document.getElementById('btn-play').addEventListener('click', onPlayPressed);
  document.getElementById('btn-title-settings').addEventListener('click', () => ui.showSettings());

  document.getElementById('btn-pause').addEventListener('click', () => { running = false; ui.showPause(); });
  document.getElementById('btn-resume').addEventListener('click', () => { ui.hidePause(); running = true; clock.getDelta(); });
  document.getElementById('btn-pause-settings').addEventListener('click', () => ui.showSettings());
  document.getElementById('btn-quit-title').addEventListener('click', () => window.location.reload());

  document.getElementById('btn-close-settings').addEventListener('click', () => ui.hideSettings());
  function toggleSound() {
    muted = !muted; audio.setMuted(muted); ui.setSoundIcon(!muted);
  }
  document.getElementById('btn-sound').addEventListener('click', toggleSound);
  document.getElementById('btn-sound-settings').addEventListener('click', toggleSound);
  document.getElementById('btn-garage').addEventListener('click', () => ui.showToast('Garage — coming soon!'));
  document.getElementById('btn-minimap-toggle').addEventListener('click', () => ui.toggleMinimap());

  document.getElementById('btn-daynight-toggle').addEventListener('click', () => {
    dayNightEnabled = !dayNightEnabled; ui.setDayNightIcon(dayNightEnabled);
  });
  document.getElementById('btn-seasons-toggle').addEventListener('click', () => {
    seasonsEnabled = !seasonsEnabled; ui.setSeasonsIcon(seasonsEnabled);
  });

  async function openCharacterCreator() {
    ui.showOutfitPanel();
    await creator.initCreatorUI();
    creator.startPreview();
  }
  async function closeCharacterCreator() {
    ui.hideOutfitPanel();
    creator.stopPreview();
    await applyCreatorStateToCharacter();
  }
  document.getElementById('btn-outfit-prev').addEventListener('click', () => creator.cycleOutfit(-1));
  document.getElementById('btn-outfit-next').addEventListener('click', () => creator.cycleOutfit(1));
  document.getElementById('btn-outfit').addEventListener('click', openCharacterCreator);
  document.getElementById('btn-title-character').addEventListener('click', openCharacterCreator);
  document.getElementById('btn-close-outfit').addEventListener('click', closeCharacterCreator);
}

// pushes the creator's saved outfit/tint/name onto the live in-game
// character (a no-op before Play has been pressed — start() applies the
// saved state itself once the character exists).
async function applyCreatorStateToCharacter() {
  if (!character) return;
  const cs = creator.getCharacterState();
  if (cs.outfitKey !== character.outfitKey) await character.setOutfit(cs.outfitKey);
  character.setTint(cs.tint);
  character.setPlayerName(cs.name);
}

async function onPlayPressed() {
  audio.start();
  ui.hideStartScreen();
  await start();
}

// -------------------- main loop --------------------
async function start() {
  init3D();
  clock = new THREE.Clock();
  controls = new Controls();

  const keys = Object.keys(MANIFEST);
  await loadAll(keys, (frac, key) => ui.setLoadingProgress(frac, key));

  world = new World(scene, { onChunkBuilt, onChunkRemoved });
  const savedCharacter = creator.getCharacterState();
  character = new Character(scene);
  await character.init(savedCharacter.outfitKey);
  character.setTint(savedCharacter.tint);
  character.setPlayerName(savedCharacter.name);
  character.teleport(6, 6, Math.PI);

  world.update(character.position.x, character.position.z);
  ui.hideLoadingScreen();

  running = true;
  renderer.setAnimationLoop(loop);
  setTimeout(() => document.getElementById('mobile-toggle-hint')?.classList.add('hidden'), 6000);
}

function loop() {
  const dt = running ? Math.min(clock.getDelta(), 0.05) : (clock.getDelta(), 0);
  if (!running) { renderer.render(scene, camera); return; }

  const raw = controls.poll();

  if (raw.pausePressed) { running = false; ui.showPause(); return; }

  if (mode !== 'interior') {
    const refX = mode === 'drive' ? currentVehicle.position.x : character.position.x;
    const refZ = mode === 'drive' ? currentVehicle.position.z : character.position.z;
    world.update(refX, refZ);
  }

  const refPos = mode === 'drive' ? currentVehicle.position : character.position;
  const collidersNear = mode === 'interior' ? interiorRoom.colliders : world.getCollidersNear(refPos.x, refPos.z, 70);

  world.tickEffects(dt);
  for (const npc of npcs) npc.update(dt);

  for (const v of vehicles) {
    if (v === currentVehicle) {
      if (raw.resetPressed) v.resetUpright();
      const vInput = { throttle: raw.axisY, steer: -raw.axisX, handbrake: raw.handbrake || raw.jumpHeld };
      v.update(dt, vInput, collidersNear, vehicles, npcs, {
        onStunt: (score) => ui.showStuntBanner(`STUNT JUMP! +${score}`),
        onCrash: () => { ui.flashCrash(); audio.crashThud(); },
        onHitPedestrian: () => ui.flashCrash(),
        onFlip: () => { ui.flashFlip(); audio.crashThud(); },
      });
    } else if (v.mode === 'traffic') {
      const nearbyColliders = world.getCollidersNear(v.position.x, v.position.z, 20);
      v.update(dt, null, nearbyColliders, vehicles, npcs, {});
    }
  }

  if (mode === 'walk' || mode === 'interior') {
    const charInput = { moveX: raw.axisX, moveZ: -raw.axisY, run: raw.run, jumpPressed: raw.jumpPressed };
    character.update(dt, charInput, collidersNear);

    if (mode === 'walk') {
      const nearVehicle = vehicles.some(v => v.mode !== 'player' &&
        Math.hypot(v.position.x - character.position.x, v.position.z - character.position.z) < ENTER_VEHICLE_RANGE);
      const doorNear = world.findNearestDoor(character.position.x, character.position.z, ENTER_DOOR_RANGE);
      if (nearVehicle) ui.showPrompt('Press E to enter vehicle');
      else if (doorNear) ui.showPrompt('Press F to interact (enter building)');
      else ui.hidePrompt();
      if (raw.enterPressed) tryEnterVehicle();
      if (raw.interactPressed) tryEnterBuilding();
    } else {
      const d = Math.hypot(character.position.x - interiorRoom.exitWorld.x, character.position.z - interiorRoom.exitWorld.z);
      if (d < 2.2) { ui.showPrompt('Press F to exit building'); if (raw.interactPressed || raw.enterPressed) exitBuilding(); }
      else ui.hidePrompt();
    }
  } else if (mode === 'drive') {
    const speedKmh = Math.hypot(currentVehicle.velocity.x, currentVehicle.velocity.z) * 3.6;
    const gear = currentVehicle.forwardSpeed > 0.3 ? 'D' : (currentVehicle.forwardSpeed < -0.3 ? 'R' : 'N');
    ui.updateSpeedo(speedKmh, gear, currentVehicle.stats.label);
    audio.updateEngine(clamp(speedKmh / (currentVehicle.stats.speed * 3.6), 0, 1), true);
    if (currentVehicle.flipped) ui.showPrompt('Flipped! Press R to reset car');
    else ui.showPrompt('Press E to exit vehicle');
    if (raw.enterPressed) exitVehicle();
  }

  if (raw.cameraPressed) character.toggleFirstPerson();

  const camTargetPos = mode === 'drive' ? currentVehicle.position : character.position;
  const camDist = mode === 'drive' ? 7.5 : 5.6;
  character.updateCamera(camera, raw, dt, camTargetPos, 0, camDist);

  updateDayNight(dt, camTargetPos);

  const mapEntities = [];
  for (const v of vehicles) mapEntities.push({ x: v.position.x, z: v.position.z, type: 'vehicle' });
  for (const n of npcs) mapEntities.push({ x: n.position.x, z: n.position.z, type: 'npc' });
  ui.updateMinimap(camTargetPos.x, camTargetPos.z, mode === 'drive' ? currentVehicle.heading : character.heading, mapEntities);

  ui.tickFps();
  renderer.render(scene, camera);
}

// -------------------- boot --------------------
audio = new AudioManager();
wireMenus();
ui.showStartScreen();
