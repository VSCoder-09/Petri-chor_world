import * as THREE from 'three';
import { fbm, hash2, randRange, clamp, AABB2 } from './utils.js';
import { instantiate, autoScaleToSize, BUILDING_KEYS, PROP_KEYS } from './assets.js';

// ---------------------------------------------------------------------------
// world.js — infinite, chunk-streamed open world with a hand-placed
// landmark city ("V&V CITY") in the blocks around spawn, surrounded by the
// original infinite noise-driven biome rings (suburb/forest/desert/mountain
// /water) further out. Roads run along every multiple of ROAD_SPACING on
// both axes; the square lot between four road segments is one "block"/chunk.
// ---------------------------------------------------------------------------

export const ROAD_SPACING = 100;
export const ROAD_HALF = 5;
export const SIDEWALK_EXTRA = 3;
export const ROAD_BAND = ROAD_HALF + SIDEWALK_EXTRA;
// V&V City is a finite circular island (not an infinite continent): every
// block within ISLAND_RADIUS of the tower is land, everything beyond it is
// open ocean forever — except three small satellite islands (Science /
// Launch / Cargo) connected back to the mainland by the grid roads, which
// happen to cross the intervening water blocks as de-facto bridges (roads
// are drawn into every block's ground texture regardless of biome, and
// getGroundHeight already flattens toward 0 near any road centerline).
export const ISLAND_RADIUS = 5.3;
const SATELLITE_ISLANDS = [
  { key: 'scienceIsland', cx: -3, cz: 6, r: 1.3 },
  { key: 'launchIsland',  cx: 0,  cz: 7, r: 1.3 },
  { key: 'cargoIsland',   cx: 3,  cz: 6, r: 1.3 },
];

const RENDER_DISTANCE = 3;

const BIOME_COLORS = {
  city: 0x555a60, suburb: 0x5c7a52, forest: 0x2f5c3a,
  desert: 0xcdb27a, mountain: 0x8a8a86, water: 0x1f5878, plaza: 0x9aa4ac,
};

// ---------------------------------------------------------------------------
// V&V CITY — curated landmark layout, laid out radially around the tower to
// mirror the concept map: coastal/leisure landmarks toward the south shore,
// civic/industrial toward the east, campus/research toward the west, and the
// mountain + forest along the north edge. Key = "bx,bz" block coordinate.
// ---------------------------------------------------------------------------
export const LANDMARKS = {
  '0,0':   'tower',          // V&V INFINITY TOWER (helipad)
  '1,-2':  'stadium',        // CITY STADIUM (premium)
  '-2,-2': 'university',
  '-3,0':  'sciencelab',     // SCIENCE DISTRICT
  '-3,1':  'market',         // MARKET & SHOPS
  '-2,2':  'carnival',       // CARNIVAL CELEBRATION
  '-4,3':  'hotel',          // LUXURY HOTEL
  '0,1':   'metro',          // METRO STATION
  '0,2':   'gasStation',
  '-1,3':  'beach',
  '1,3':   'marina',
  '1,1':   'policeStation',
  '2,1':   'fireStation',
  '2,0':   'hospital',
  '3,-1':  'mall',           // SHOPPING MALL
  '3,0':   'apartmentArea',
  '2,2':   'school',
  '3,2':   'construction',   // CONSTRUCTION ZONE
  '1,-3':  'windFarm',
  '3,-2':  'airport',        // V&V AIRPORT
  '-3,-2': 'disaster',       // flavor easter egg, tucked out of the main flow
  // satellite islands, bridge-connected across the surrounding ocean
  '-3,6':  'scienceIsland',
  '0,7':   'launchIsland',
  '3,6':   'cargoIsland',
};


function groundTextureCache() {
  const cache = new Map();
  return (biome) => {
    if (cache.has(biome)) return cache.get(biome);
    const size = 256;
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = size;
    const ctx = cnv.getContext('2d');
    const lotColor = new THREE.Color(BIOME_COLORS[biome] || 0x555a60);
    ctx.fillStyle = `#${lotColor.getHexString()}`;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
      ctx.fillRect(x, y, 2, 2);
    }
    const bandFrac = ROAD_BAND / ROAD_SPACING;
    const asphaltFrac = ROAD_HALF / ROAD_SPACING;
    const bandPx = bandFrac * size;
    const asphaltPx = asphaltFrac * size;
    const drawBand = (isHorizontalEdge, atStart) => {
      ctx.fillStyle = '#828a90';
      if (isHorizontalEdge) {
        ctx.fillRect(0, atStart ? 0 : size - bandPx, size, bandPx);
        ctx.fillStyle = '#3a3f46';
        ctx.fillRect(0, atStart ? 0 : size - asphaltPx, size, asphaltPx);
      } else {
        ctx.fillRect(atStart ? 0 : size - bandPx, 0, bandPx, size);
        ctx.fillStyle = '#3a3f46';
        ctx.fillRect(atStart ? 0 : size - asphaltPx, 0, asphaltPx, size);
      }
    };
    if (biome !== 'forest' && biome !== 'mountain') {
      drawBand(true, true); drawBand(true, false);
      drawBand(false, true); drawBand(false, false);
      ctx.fillStyle = '#e8c94a';
      ctx.fillRect(0, 1, size, 1.5); ctx.fillRect(0, size - 2.5, size, 1.5);
      ctx.fillRect(1, 0, 1.5, size); ctx.fillRect(size - 2.5, 0, 1.5, size);
    } else {
      ctx.fillStyle = '#6b6355';
      drawBand(true, true); drawBand(true, false);
      drawBand(false, true); drawBand(false, false);
    }
    if (biome === 'plaza') {
      ctx.strokeStyle = '#9aa4ac'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(size/2, size/2, size*0.36, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(size/2, size/2, size*0.46, 0, Math.PI*2); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    cache.set(biome, tex);
    return tex;
  };
}
const getGroundTexture = groundTextureCache();

// canvas-texture text sign, reused for every landmark label + the mountain
// "V&V CITY" hillside sign. transparent=true renders text-only (no backing
// plate), used for the Hollywood-style mountain sign.
export function makeSignPlane(text, { width = 7, height = 1.6, bg = '#0d1116', fg = '#e8edf2', accent = '#3ddcff', transparent = false, fontPx = 84 } = {}) {
  const cw = 512, ch = Math.round(512 * (height / width));
  const cnv = document.createElement('canvas'); cnv.width = cw; cnv.height = ch;
  const ctx = cnv.getContext('2d');
  if (!transparent) {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = accent; ctx.lineWidth = 6; ctx.strokeRect(4, 4, cw - 8, ch - 8);
  }
  ctx.fillStyle = fg;
  ctx.font = `900 ${fontPx}px 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = transparent ? 18 : 4;
  ctx.fillText(text, cw / 2, ch / 2);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  return mesh;
}

function blockIndex(v) { return Math.floor(v / ROAD_SPACING); }
function blockCenter(i) { return (i + 0.5) * ROAD_SPACING; }
function distToNearestGridLine(v) {
  const nearest = Math.round(v / ROAD_SPACING) * ROAD_SPACING;
  return Math.abs(v - nearest);
}
export function isOnRoad(x, z) {
  return distToNearestGridLine(x) <= ROAD_HALF || distToNearestGridLine(z) <= ROAD_HALF;
}
export function isOnRoadOrSidewalk(x, z) {
  return distToNearestGridLine(x) <= ROAD_BAND || distToNearestGridLine(z) <= ROAD_BAND;
}

function isInSatellite(bx, bz) {
  return SATELLITE_ISLANDS.some(s => Math.hypot(bx - s.cx, bz - s.cz) <= s.r);
}

export function getBiome(bx, bz) {
  const key = `${bx},${bz}`;
  if (LANDMARKS[key]) return 'city';
  if (bx === 0 && bz === 0) return 'plaza';
  if (Math.abs(bx) <= 1 && Math.abs(bz) <= 1) return 'plaza'; // ring-road plaza around the tower

  const onMainIsland = Math.hypot(bx, bz) <= ISLAND_RADIUS && bz <= 3; // south coastline cap — leaves open water before the satellite islands
  const onSatellite = isInSatellite(bx, bz);
  if (!onMainIsland && !onSatellite) return 'water'; // open ocean, every direction, forever

  if (onMainIsland) {
    if (bz <= -3 && bx >= -1 && bx <= 3) return 'mountain'; // north range + hillside "V&V CITY" sign
    if (bx <= -2 && bz <= -2) return 'forest';               // north-west forest, beside the university
  }
  if (onSatellite) return 'city'; // small built-up satellite-island filler
  return 'suburb'; // remaining main-island filler between landmarks
}

function biomeAmplitude(biome) {
  switch (biome) {
    case 'mountain': return 22;
    case 'forest': return 6;
    case 'desert': return 3.5;
    case 'water': return 0.4;
    default: return 0;
  }
}

let heightOverride = null;
export function setHeightOverride(fn) { heightOverride = fn; }

export function getGroundHeight(x, z) {
  if (heightOverride) return heightOverride(x, z);
  const bx = blockIndex(x), bz = blockIndex(z);
  const biome = getBiome(bx, bz);
  const amp = biomeAmplitude(biome);
  if (amp === 0) return 0;
  let h = (fbm(x * 0.02, z * 0.02, 4, 1, 0.5) - 0.5) * 2 * amp;
  if (biome === 'water') h = -0.6;
  const dRoad = Math.min(distToNearestGridLine(x), distToNearestGridLine(z));
  const flattenMargin = ROAD_BAND + 6;
  if (dRoad < flattenMargin) {
    const t = clamp(dRoad / flattenMargin, 0, 1);
    h *= t * t;
  }
  return h;
}

function makeTree(bx, bz, salt) {
  const g = new THREE.Group();
  const trunkH = randRange(bx, bz, salt, 1.6, 2.6);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, trunkH, 6),
    new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 1 }));
  trunk.position.y = trunkH / 2; trunk.castShadow = true; g.add(trunk);
  const foliageColor = Math.random() < 0.5 ? 0x2f6b3a : 0x35793f;
  for (let i = 0; i < 3; i++) {
    const r = randRange(bx, bz, salt + i + 1, 1.1, 1.7) * (1 - i * 0.22);
    const h = randRange(bx, bz, salt + i + 5, 1.4, 2.0);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7),
      new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 1 }));
    cone.position.y = trunkH + i * 1.05 + h * 0.4; cone.castShadow = true; g.add(cone);
  }
  return g;
}
function makeRock(bx, bz, salt) {
  const s = randRange(bx, bz, salt, 0.6, 2.1);
  const geo = new THREE.IcosahedronGeometry(s, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const j = 0.15 * s;
    pos.setXYZ(i, pos.getX(i) + (Math.random() - 0.5) * j, pos.getY(i) + (Math.random() - 0.5) * j, pos.getZ(i) + (Math.random() - 0.5) * j);
  }
  geo.computeVertexNormals();
  const rock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x82807a, roughness: 1, flatShading: true }));
  rock.castShadow = true; rock.receiveShadow = true;
  rock.position.y = s * 0.4;
  rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  return rock;
}

// generic tall block "skyscraper" builder shared by several landmarks.
// Returns the group plus a shared emissive "window" material other code can
// tag with userData.nightLight so main.js can light it up after dark.
function makeTower(w, h, d, color) {
  const g = new THREE.Group();
  const winMat = new THREE.MeshStandardMaterial({ color: 0x223142, roughness: 0.6, metalness: 0.2, emissive: 0xffdd88, emissiveIntensity: 0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), winMat);
  body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
  body.userData.nightLight = true;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.4, d * 0.98),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
  cap.position.y = h + 0.2; g.add(cap);
  return { group: g, body, winMat };
}

// small pole-mounted lamp; the bulb is tagged for the day/night system
// (main.js dims/brightens anything flagged userData.nightLight).
function makeLampPost(height = 3.2) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, height, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2f34 }));
  pole.position.y = height / 2; g.add(pole);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xfff2c8, emissiveIntensity: 0 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), bulbMat);
  bulb.position.y = height; bulb.userData.nightLight = true;
  g.add(bulb);
  return g;
}

// ---------------------------------------------------------------------------
// Individual landmark builders. Each receives a ctx object with the chunk's
// local group (chunk origin = block center, so positions below are chunk-
// local), block coords, half-lot size, and the arrays buildChunk collects
// (colliders / npcSpawns / parkedVehicleSpawns / trafficSpawns / nightMeshes
// / smokeSprites). Every builder adds a text sign so the landmark reads
// clearly even though it's built from primitives + the provided GLB props.
// ---------------------------------------------------------------------------

function addSign(group, text, y, z, opts) {
  const sign = makeSignPlane(text, opts);
  sign.position.set(0, y, z);
  group.add(sign);
  return sign;
}

function buildTower(ctx) {
  const { group, cx, cz, colliders, nightMeshes, parkedVehicleSpawns } = ctx;
  parkedVehicleSpawns.push({ x: cx - 12, z: cz + 9, heading: Math.PI * 0.4, key: 'policeCar' });
  const { group: tg, winMat } = makeTower(14, 58, 14, 0xd7dadd);
  group.add(tg);
  nightMeshes.push(winMat);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.3, 24),
    new THREE.MeshStandardMaterial({ color: 0x2b2f33 }));
  pad.position.y = 58.6; group.add(pad);
  const h = makeSignPlane('H', { width: 3, height: 3, bg: '#e8c94a', fg: '#101418', fontPx: 220 });
  h.rotation.x = -Math.PI / 2; h.position.y = 58.76; group.add(h);
  colliders.push(AABB2.fromCenter(cx, cz, 7.5, 7.5));
  group.userData.door = { x: cx, z: cz + 7.5 + 1.2 };
  addSign(group, 'V&V TOWER', 8, 7.6, { width: 9 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const lamp = makeLampPost(3.6);
    lamp.position.set(Math.cos(a) * 34, 0, Math.sin(a) * 34);
    group.add(lamp);
    nightMeshes.push(lamp.children[1].material);
  }
}

function buildStadium(ctx) {
  const { group, cx, cz, colliders, npcSpawns, parkedVehicleSpawns } = ctx;
  parkedVehicleSpawns.push({ x: cx, z: cz + 30, heading: 0, key: 'suv' });
  const outerR = 24, wallH = 9;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(outerR, outerR + 2, wallH, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x8a2f2f, side: THREE.DoubleSide, roughness: 0.9 }));
  wall.position.y = wallH / 2; wall.castShadow = true; group.add(wall);
  const field = new THREE.Mesh(new THREE.CircleGeometry(outerR - 4, 28),
    new THREE.MeshStandardMaterial({ color: 0x2e7d3a, roughness: 1 }));
  field.rotation.x = -Math.PI / 2; field.position.y = 0.05; field.receiveShadow = true; group.add(field);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const lamp = makeLampPost(11);
    lamp.position.set(Math.cos(a) * (outerR - 1), 0, Math.sin(a) * (outerR - 1));
    group.add(lamp); ctx.nightMeshes.push(lamp.children[1].material);
  }
  colliders.push(AABB2.fromCenter(cx, cz, outerR + 2, outerR + 2));
  group.userData.door = { x: cx, z: cz + outerR + 3 };
  addSign(group, 'FOOTBALL STADIUM (PREMIUM)', wallH + 3, 0, { width: 12 });
  npcSpawns.push({ x: cx + outerR + 6, z: cz, ringCenterX: cx, ringCenterZ: cz, ringRadius: outerR + 6 });
}

function buildHotel(ctx) {
  const { group, cx, cz, colliders, nightMeshes, parkedVehicleSpawns } = ctx;
  parkedVehicleSpawns.push({ x: cx + 10, z: cz + 8, heading: Math.PI * 0.75, key: 'sportsCar' });
  const { group: tg, winMat } = makeTower(16, 34, 12, 0xe4dccb);
  group.add(tg);
  nightMeshes.push(winMat);
  const pool = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0x2aa8c9, emissive: 0x0e5b73, emissiveIntensity: 0.6 }));
  pool.position.set(-2, 34.5, 0); group.add(pool);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0xcac2b0 }));
  deck.position.y = 34.3; group.add(deck);
  for (let i = 0; i < 6; i++) {
    const lamp = makeLampPost(1.6);
    lamp.position.set(-6 + i * 2.2, 34.4, 4.5);
    group.add(lamp); nightMeshes.push(lamp.children[1].material);
  }
  colliders.push(AABB2.fromCenter(cx, cz, 8.5, 6.5));
  group.userData.door = { x: cx, z: cz + 6.5 + 1.2 };
  addSign(group, 'GRAND HOTEL', 6, 6.6, { width: 8 });
}

function buildAirport(ctx) {
  const { group, cx, cz, colliders } = ctx;
  const cnv = document.createElement('canvas'); cnv.width = 128; cnv.height = 512;
  const c2 = cnv.getContext('2d'); c2.fillStyle = '#33383d'; c2.fillRect(0, 0, 128, 512);
  c2.fillStyle = '#e8edf2';
  for (let y = 10; y < 512; y += 40) c2.fillRect(58, y, 12, 22);
  const runwayTex = new THREE.CanvasTexture(cnv);
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(16, 90), new THREE.MeshStandardMaterial({ map: runwayTex, roughness: 1 }));
  runway.rotation.x = -Math.PI / 2; runway.position.set(0, 0.03, 0); group.add(runway);
  const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 16, 10), new THREE.MeshStandardMaterial({ color: 0xd7dadd }));
  towerBase.position.set(-25, 8, 20); towerBase.castShadow = true; group.add(towerBase);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 3, 10), new THREE.MeshStandardMaterial({ color: 0x2a3644 }));
  cab.position.set(-25, 17.5, 20); group.add(cab);
  colliders.push(AABB2.fromCenter(cx - 25, cz + 20, 3, 3));
  colliders.push(AABB2.fromCenter(cx, cz, 9, 46));
  group.userData.door = { x: cx - 25, z: cz + 20 + 3 };
  addSign(group, 'V&V AIRPORT', 6, 22, { width: 9 });
}

function buildMarket(ctx) {
  const { group, cx, cz, colliders, npcSpawns, lotHalf } = ctx;
  const stallColors = [0xd15b4a, 0xe0a83a, 0x3f9e6b, 0x3d7ec9];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, r = 18;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const stall = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2, 2.2), new THREE.MeshStandardMaterial({ color: 0xcabb98 }));
    stall.position.set(x, 1, z); stall.castShadow = true; group.add(stall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.2, 4), new THREE.MeshStandardMaterial({ color: stallColors[i % stallColors.length] }));
    roof.position.set(x, 2.6, z); roof.rotation.y = Math.PI / 4; group.add(roof);
    colliders.push(AABB2.fromCenter(cx + x, cz + z, 1.3, 1.3));
  }
  npcSpawns.push({ x: cx + 18, z: cz, ringCenterX: cx, ringCenterZ: cz, ringRadius: 20 });
  npcSpawns.push({ x: cx - 18, z: cz + 4, ringCenterX: cx, ringCenterZ: cz, ringRadius: 22 });
  addSign(group, 'MARKET & SHOPS', 10, -24, { width: 10 });
  colliders.push(AABB2.fromCenter(cx, cz, lotHalf * 0.9, lotHalf * 0.9));
}

function buildCarnival(ctx) {
  const { group, cx, cz, colliders, npcSpawns, nightMeshes } = ctx;
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(9, 0.4, 8, 24), new THREE.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0xff8a3d, emissiveIntensity: 0 }));
  wheel.position.set(0, 10, 0); group.add(wheel);
  nightMeshes.push(wheel.material);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe8edf2 }));
    cab.position.set(Math.cos(a) * 9, 10 + Math.sin(a) * 9, 0);
    group.add(cab);
  }
  // festive string-light ring around the wheel base, tagged for the night system
  const lightColors = [0xff4d6a, 0xffd23a, 0x3ddcff, 0x6bff8a];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const bulbMat = new THREE.MeshStandardMaterial({ color: lightColors[i % 4], emissive: lightColors[i % 4], emissiveIntensity: 0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), bulbMat);
    bulb.position.set(Math.cos(a) * 13, 2, Math.sin(a) * 13);
    group.add(bulb); nightMeshes.push(bulbMat);
  }
  // small tent stalls for carnival games/food
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3, r = 18;
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2, 3, 8), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd6362f : 0x3d7ec9 }));
    tent.position.set(Math.cos(a) * r, 1.5, Math.sin(a) * r);
    group.add(tent);
    colliders.push(AABB2.fromCenter(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 1.2, 1.2));
  }
  npcSpawns.push({ x: cx + 16, z: cz, ringCenterX: cx, ringCenterZ: cz, ringRadius: 18 });
  addSign(group, 'CARNIVAL CELEBRATION', 15, -16, { width: 11 });
  colliders.push(AABB2.fromCenter(cx, cz, 15, 15));
}

function buildMetro(ctx) {
  const { group, cx, cz, colliders } = ctx;
  const entrance = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), new THREE.MeshStandardMaterial({ color: 0x2f6b8a }));
  entrance.position.y = 1.5; entrance.castShadow = true; group.add(entrance);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 3), new THREE.MeshStandardMaterial({ color: 0x05070a }));
  hole.position.set(0, 0.15, 2); hole.rotation.x = -0.35; group.add(hole);
  addSign(group, 'METRO', 4, 3.1, { width: 6, bg: '#112233', fg: '#3ddcff' });
  for (let i = -3; i <= 3; i++) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 5, 8), new THREE.MeshStandardMaterial({ color: 0x555a60 }));
    pillar.position.set(i * 6, 2.5, -20); group.add(pillar);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(44, 0.6, 3), new THREE.MeshStandardMaterial({ color: 0x3a3f46 }));
  deck.position.set(0, 5.2, -20); group.add(deck);
  colliders.push(AABB2.fromCenter(cx, cz, 4, 3));
  group.userData.door = { x: cx, z: cz + 3.2 };
}

function buildScienceLab(ctx) {
  const { group, cx, cz, colliders, nightMeshes } = ctx;
  for (let i = 0; i < 3; i++) {
    const ox = -14 + i * 14;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 6, 16), new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.5 }));
    base.position.set(ox, 3, 0); base.castShadow = true; group.add(base);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8fd0e0, roughness: 0.3, metalness: 0.3, emissive: 0x2a7a8a, emissiveIntensity: 0 }));
    dome.position.set(ox, 6, 0); group.add(dome);
    nightMeshes.push(dome.material);
    colliders.push(AABB2.fromCenter(cx + ox, cz, 4.6, 4.6));
  }
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
  dish.position.set(0, 2.5, -12); group.add(dish);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2, 16), new THREE.MeshStandardMaterial({ color: 0xd7dadd, side: THREE.DoubleSide }));
  disc.position.set(0, 5, -12); disc.rotation.x = -1.1; group.add(disc);
  addSign(group, 'SCIENCE LABS', 9, 5.5, { width: 9 });
  group.userData.door = { x: cx, z: cz + 6 };
}

function buildMall(ctx) {
  const { group, cx, cz, colliders, npcSpawns, nightMeshes } = ctx;
  const key = BUILDING_KEYS[1];
  const building = instantiate(key);
  autoScaleToSize(building, 26, 'xz');
  building.scale.y = Math.min(building.scale.y, building.scale.x * 0.35);
  group.add(building);
  const box = new THREE.Box3().setFromObject(building);
  const size = new THREE.Vector3(); box.getSize(size);
  colliders.push(AABB2.fromCenter(cx, cz, size.x / 2, size.z / 2));
  group.userData.door = { x: cx, z: cz + size.z / 2 + 1.2 };
  addSign(group, 'V&V MALL', size.y + 3, size.z / 2 + 0.2, { width: 9 });
  for (let i = 0; i < 4; i++) {
    const lamp = makeLampPost(3);
    lamp.position.set(-12 + i * 8, 0, size.z / 2 + 4);
    group.add(lamp); nightMeshes.push(lamp.children[1].material);
  }
  npcSpawns.push({ x: cx + size.x / 2 + 4, z: cz, ringCenterX: cx, ringCenterZ: cz, ringRadius: size.x / 2 + 4 });
}

function buildHospital(ctx) {
  const { group, cx, cz, colliders } = ctx;
  const body = new THREE.Mesh(new THREE.BoxGeometry(20, 16, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2ec, roughness: 0.8 }));
  body.position.y = 8; body.castShadow = true; body.receiveShadow = true; group.add(body);
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xd6362f, emissive: 0xd6362f, emissiveIntensity: 0.4 });
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5, 0.3), crossMat);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(5, 1.4, 0.3), crossMat);
  crossV.position.set(0, 16.5, 7.05); crossH.position.set(0, 16.5, 7.05);
  group.add(crossV, crossH);
  colliders.push(AABB2.fromCenter(cx, cz, 10, 7));
  group.userData.door = { x: cx, z: cz + 7 + 1.2 };
  addSign(group, 'ST. VICTORY HOSPITAL', 18.5, 7.1, { width: 12 });
}

function buildConstruction(ctx) {
  const { group, cx, cz, colliders } = ctx;
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.8, 22, 0.8), new THREE.MeshStandardMaterial({ color: 0xe0a83a }));
  mast.position.set(-10, 11, -6); mast.castShadow = true; group.add(mast);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(20, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xe0a83a }));
  arm.position.set(-2, 21.5, -6); group.add(arm);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0x33383d }));
  counter.position.set(-13, 21, -6); group.add(counter);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 10), new THREE.MeshStandardMaterial({ color: 0x9a9186, roughness: 1 }));
  shell.position.set(6, 5, 4); shell.castShadow = true; group.add(shell);
  for (let i = 0; i < 6; i++) {
    const rub = new THREE.Mesh(new THREE.BoxGeometry(1 + Math.random(), 0.6, 1 + Math.random()), new THREE.MeshStandardMaterial({ color: 0x7a736a }));
    rub.position.set(6 + (Math.random() - 0.5) * 12, 0.3, 4 + (Math.random() - 0.5) * 10);
    rub.rotation.y = Math.random() * Math.PI; group.add(rub);
  }
  colliders.push(AABB2.fromCenter(cx - 10, cz - 6, 1, 1));
  colliders.push(AABB2.fromCenter(cx + 6, cz + 4, 6, 5));
  addSign(group, 'CONSTRUCTIONS', 4, 12, { width: 9, bg: '#3a2f0f', fg: '#ffd23a' });
}

function buildDisaster(ctx) {
  const { group, cx, cz, colliders, smokeSprites } = ctx;
  const key = BUILDING_KEYS[0];
  const building = instantiate(key);
  autoScaleToSize(building, 14, 'y');
  building.rotation.z = 0.55; building.position.set(2, 0, 0);
  group.add(building);
  const crack = new THREE.Mesh(new THREE.CircleGeometry(16, 20), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1, transparent: true, opacity: 0.55 }));
  crack.rotation.x = -Math.PI / 2; crack.position.y = 0.04; group.add(crack);
  for (let i = 0; i < 3; i++) {
    const spriteMat = new THREE.SpriteMaterial({ color: 0x888888, transparent: true, opacity: 0.35 });
    const smoke = new THREE.Sprite(spriteMat);
    smoke.scale.set(4, 4, 1);
    smoke.position.set(-2 + i * 2, 2 + i, -2);
    smoke.userData.baseY = smoke.position.y;
    smoke.userData.speed = 0.4 + Math.random() * 0.3;
    group.add(smoke);
    smokeSprites.push(smoke);
  }
  colliders.push(AABB2.fromCenter(cx + 2, cz, 7, 5));
  addSign(group, 'NATURAL DISASTER', 5, 12, { width: 10, bg: '#3a0f0f', fg: '#ffd23a' });
}

function buildLaunchPad(ctx) {
  const { group, cx, cz, colliders } = ctx;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.6, 20), new THREE.MeshStandardMaterial({ color: 0x2a2f33 }));
  pad.position.y = 0.3; group.add(pad);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 14, 14), new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.4, metalness: 0.3 }));
  body.position.y = 7.6; body.castShadow = true; group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4, 14), new THREE.MeshStandardMaterial({ color: 0xd6362f }));
  nose.position.y = 14.6 + 2; group.add(nose);
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 1.4), new THREE.MeshStandardMaterial({ color: 0xd6362f }));
    const a = (i / 3) * Math.PI * 2;
    fin.position.set(Math.cos(a) * 1.6, 1.6, Math.sin(a) * 1.6);
    fin.rotation.y = -a; group.add(fin);
  }
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 18, 6), new THREE.MeshStandardMaterial({ color: 0x555a60 }));
    leg.position.set(8 + (i % 2) * 2, 9, -2 + Math.floor(i / 2) * 2);
    group.add(leg);
  }
  colliders.push(AABB2.fromCenter(cx, cz, 9.5, 9.5));
  colliders.push(AABB2.fromCenter(cx + 9, cz, 2, 2));
  addSign(group, 'LAUNCH ISLAND — PAD 1', 4, 9.6, { width: 10, bg: '#0f1a2f', fg: '#3ddcff' });
}

function buildUniversity(ctx) {
  const { group, cx, cz, colliders, npcSpawns } = ctx;
  const key = BUILDING_KEYS[2];
  const building = instantiate(key);
  autoScaleToSize(building, 15, 'y');
  group.add(building);
  const box = new THREE.Box3().setFromObject(building);
  const size = new THREE.Vector3(); box.getSize(size);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xcabf9e, roughness: 0.6 }));
  dome.position.set(0, size.y, 0); group.add(dome);
  colliders.push(AABB2.fromCenter(cx, cz, size.x / 2, size.z / 2));
  group.userData.door = { x: cx, z: cz + size.z / 2 + 1.2 };
  addSign(group, 'UNIVERSITY', size.y + 5, size.z / 2 + 0.2, { width: 8 });
  npcSpawns.push({ x: cx + size.x / 2 + 5, z: cz, ringCenterX: cx, ringCenterZ: cz, ringRadius: size.x / 2 + 5 });
  npcSpawns.push({ x: cx - size.x / 2 - 4, z: cz + 3, ringCenterX: cx, ringCenterZ: cz, ringRadius: size.x / 2 + 4 });
}

function buildPoliceStation(ctx) {
  const { group, cx, cz, colliders, parkedVehicleSpawns } = ctx;
  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 10), new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.8 }));
  body.position.y = 4; body.castShadow = true; body.receiveShadow = true; group.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(14.1, 1, 0.2), new THREE.MeshStandardMaterial({ color: 0x2a5cc9 }));
  stripe.position.set(0, 3, 5.05); group.add(stripe);
  colliders.push(AABB2.fromCenter(cx, cz, 7, 5));
  group.userData.door = { x: cx, z: cz + 5 + 1.2 };
  addSign(group, 'POLICE STATION', 9, 5.1, { width: 9, bg: '#0f1a3a', fg: '#7fb0ff' });
  parkedVehicleSpawns.push({ x: cx + 9, z: cz + 6, heading: Math.PI * 0.5, key: 'policeCar' });
  parkedVehicleSpawns.push({ x: cx + 9, z: cz + 2, heading: Math.PI * 0.5, key: 'policeCar' });
}

function buildFireStation(ctx) {
  const { group, cx, cz, colliders, parkedVehicleSpawns } = ctx;
  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 10), new THREE.MeshStandardMaterial({ color: 0xb03a2f, roughness: 0.8 }));
  body.position.y = 3.5; body.castShadow = true; body.receiveShadow = true; group.add(body);
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 0.2), new THREE.MeshStandardMaterial({ color: 0x1a1e22 }));
  doorMesh.position.set(-3.5, 2.5, 5.05); group.add(doorMesh);
  const doorMesh2 = doorMesh.clone(); doorMesh2.position.x = 3.5; group.add(doorMesh2);
  colliders.push(AABB2.fromCenter(cx, cz, 7, 5));
  group.userData.door = { x: cx, z: cz + 5 + 1.2 };
  addSign(group, 'FIRE STATION', 8, 5.1, { width: 8, bg: '#3a0f0f', fg: '#ffb08a' });
  parkedVehicleSpawns.push({ x: cx + 9, z: cz, heading: Math.PI * 0.5, key: 'van' });
}

function buildApartmentArea(ctx) {
  const { group, cx, cz, colliders, npcSpawns, nightMeshes, lotHalf } = ctx;
  const spots = [[-16, -10], [14, -8], [-12, 12], [16, 10]];
  spots.forEach(([ox, oz], i) => {
    const key = BUILDING_KEYS[i % BUILDING_KEYS.length];
    const b = instantiate(key);
    autoScaleToSize(b, randRange(ox, oz, i, 14, 22), 'y');
    b.position.set(ox, 0, oz);
    group.add(b);
    const box = new THREE.Box3().setFromObject(b);
    const size = new THREE.Vector3(); box.getSize(size);
    colliders.push(AABB2.fromCenter(cx + ox, cz + oz, size.x / 2, size.z / 2));
  });
  const lamp = makeLampPost(3);
  lamp.position.set(0, 0, lotHalf * 0.7);
  group.add(lamp); nightMeshes.push(lamp.children[1].material);
  addSign(group, 'APARTMENT AREA', 4, lotHalf * 0.75, { width: 10 });
  npcSpawns.push({ x: cx, z: cz + 8, ringCenterX: cx, ringCenterZ: cz, ringRadius: 22 });
  npcSpawns.push({ x: cx - 8, z: cz - 4, ringCenterX: cx, ringCenterZ: cz, ringRadius: 22 });
}

function buildSchool(ctx) {
  const { group, cx, cz, colliders, npcSpawns } = ctx;
  const body = new THREE.Mesh(new THREE.BoxGeometry(20, 7, 12), new THREE.MeshStandardMaterial({ color: 0xd6b25a, roughness: 0.9 }));
  body.position.y = 3.5; body.castShadow = true; body.receiveShadow = true; group.add(body);
  const court = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 1 }));
  court.rotation.x = -Math.PI / 2; court.position.set(0, 0.03, 12); group.add(court);
  const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), new THREE.MeshStandardMaterial({ color: 0x555a60 }));
  hoop.position.set(0, 1.5, 8); group.add(hoop);
  colliders.push(AABB2.fromCenter(cx, cz, 10, 6));
  group.userData.door = { x: cx, z: cz + 6 + 1.2 };
  addSign(group, 'SCHOOL', 8.5, 6.1, { width: 7 });
  npcSpawns.push({ x: cx + 12, z: cz + 12, ringCenterX: cx, ringCenterZ: cz, ringRadius: 16 });
}

function buildBeach(ctx) {
  const { group, cx, cz, colliders, npcSpawns } = ctx;
  const water = new THREE.Mesh(new THREE.CircleGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x2a8fb0, transparent: true, opacity: 0.85, roughness: 0.3 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.15, 22); group.add(water);
  for (let i = 0; i < 4; i++) {
    const umbrella = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2, 6), new THREE.MeshStandardMaterial({ color: 0xe8edf2 }));
    pole.position.y = 1; umbrella.add(pole);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.8, 10), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd6362f : 0xffd23a }));
    canopy.position.y = 2.1; umbrella.add(canopy);
    umbrella.position.set(-12 + i * 8, 0, -6 + (i % 2) * 4);
    group.add(umbrella);
  }
  addSign(group, 'BEACH', 5, -18, { width: 6, bg: '#0f2a3a', fg: '#ffd23a' });
  npcSpawns.push({ x: cx, z: cz - 4, ringCenterX: cx, ringCenterZ: cz - 4, ringRadius: 14 });
  colliders.push(AABB2.fromCenter(cx, cz + 26, 22, 12));
}

function buildMarina(ctx) {
  const { group, cx, cz, colliders } = ctx;
  const dock = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 26), new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 1 }));
  dock.position.set(0, 0.2, 16); dock.castShadow = true; group.add(dock);
  for (let i = 0; i < 3; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0x8a6a44 }));
    pier.position.set(side * 5, 0.2, 8 + i * 8); group.add(pier);
    const hullGroup = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 4), new THREE.MeshStandardMaterial({ color: 0xe8edf2 }));
    hull.position.y = 0.4; hullGroup.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1.4), new THREE.MeshStandardMaterial({ color: 0x2a5cc9 }));
    cabin.position.set(0, 1, -0.6); hullGroup.add(cabin);
    hullGroup.position.set(side * 8, 0, 8 + i * 8);
    group.add(hullGroup);
  }
  colliders.push(AABB2.fromCenter(cx, cz, 5, 4));
  addSign(group, 'MARINA', 4, -6, { width: 6, bg: '#0f2a3a', fg: '#3ddcff' });
}

function buildGasStation(ctx) {
  const { group, cx, cz, colliders, nightMeshes } = ctx;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0xe0a83a }));
  canopy.position.y = 4.6; canopy.castShadow = true; group.add(canopy);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xcac2b0 });
  [[-5, -3], [5, -3], [-5, 3], [5, 3]].forEach(([px, pz]) => {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 4.4, 8), pillarMat);
    pillar.position.set(px, 2.2, pz); group.add(pillar);
  });
  for (let i = 0; i < 2; i++) {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.5), new THREE.MeshStandardMaterial({ color: 0xd6362f, emissive: 0xd6362f, emissiveIntensity: 0 }));
    pump.position.set(-2.5 + i * 5, 0.7, 0); group.add(pump);
    nightMeshes.push(pump.material);
  }
  colliders.push(AABB2.fromCenter(cx, cz, 8, 5));
  addSign(group, 'GAS STATION', 6, -5.5, { width: 8, bg: '#0f2a12', fg: '#7cff8a' });
}

function buildWindFarm(ctx) {
  const { group, cx, cz, bx, bz, colliders, lotHalf } = ctx;
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const ox = -lotHalf * 0.7 + t * lotHalf * 1.4, oz = randRange(bx, bz, i, -lotHalf * 0.4, lotHalf * 0.4);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 16, 8), new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.4 }));
    mast.position.set(ox, 8, oz); mast.castShadow = true; group.add(mast);
    const hub = new THREE.Group();
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 5, 0.6), new THREE.MeshStandardMaterial({ color: 0xf2f2ec }));
      blade.position.y = 2.5; blade.rotation.z = (b / 3) * Math.PI * 2;
      hub.add(blade);
    }
    hub.position.set(ox, 16, oz);
    group.add(hub);
    colliders.push(AABB2.fromCenter(cx + ox, cz + oz, 0.5, 0.5));
  }
  addSign(group, 'WIND FARM', 4, lotHalf * 0.6, { width: 7, bg: '#0f2a2a', fg: '#7cffe0' });
}

function buildScienceIsland(ctx) {
  const { group, cx, cz, colliders, nightMeshes } = ctx;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 8, 18), new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.5 }));
  base.position.y = 4; base.castShadow = true; group.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8fd0e0, roughness: 0.25, metalness: 0.3, emissive: 0x2a7a8a, emissiveIntensity: 0 }));
  dome.position.y = 8; group.add(dome);
  nightMeshes.push(dome.material);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 6, 10), new THREE.MeshStandardMaterial({ color: 0x33383d }));
  scope.position.set(0, 10, 0); scope.rotation.z = 0.5; group.add(scope);
  // half-buried "bunker" hatch
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.4, roughness: 0.6 }));
  hatch.position.set(-14, 0.2, -6); group.add(hatch);
  const hatchRing = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.15, 8, 20), new THREE.MeshStandardMaterial({ color: 0xffd23a }));
  hatchRing.rotation.x = -Math.PI / 2; hatchRing.position.set(-14, 0.42, -6); group.add(hatchRing);
  colliders.push(AABB2.fromCenter(cx, cz, 7, 7));
  colliders.push(AABB2.fromCenter(cx - 14, cz - 6, 2.8, 2.8));
  group.userData.door = { x: cx, z: cz + 7.5 };
  addSign(group, 'SCIENCE ISLAND — AI & ROBOTICS', 15, 7.5, { width: 12 });
}

function buildCargoIsland(ctx) {
  const { group, cx, cz, colliders } = ctx;
  const warehouse = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 12), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9 }));
  warehouse.position.set(-6, 3.5, -8); warehouse.castShadow = true; group.add(warehouse);
  const containerColors = [0xd15b4a, 0x3d7ec9, 0xe0a83a, 0x3f9e6b];
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const container = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.4), new THREE.MeshStandardMaterial({ color: containerColors[i % 4] }));
    container.position.set(6 + (col % 2) * 6.5, 1.3 + row * 2.7, 4 + Math.floor(col / 2) * 3);
    container.castShadow = true; group.add(container);
    colliders.push(AABB2.fromCenter(cx + container.position.x, cz + container.position.z, 3, 1.3));
  }
  const craneMast = new THREE.Mesh(new THREE.BoxGeometry(0.8, 18, 0.8), new THREE.MeshStandardMaterial({ color: 0xe0a83a }));
  craneMast.position.set(14, 9, -10); craneMast.castShadow = true; group.add(craneMast);
  const craneArm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 22), new THREE.MeshStandardMaterial({ color: 0xe0a83a }));
  craneArm.position.set(14, 17.5, 0); group.add(craneArm);
  colliders.push(AABB2.fromCenter(cx - 6, cz - 8, 8, 6));
  colliders.push(AABB2.fromCenter(cx + 14, cz - 10, 0.6, 0.6));
  group.userData.door = { x: cx - 6, z: cz - 8 + 6 + 1.2 };
  addSign(group, 'CARGO ISLAND', 9, -8 + 6 + 0.2, { width: 8 });
}

const LANDMARK_BUILDERS = {
  tower: buildTower, stadium: buildStadium, hotel: buildHotel, airport: buildAirport,
  market: buildMarket, carnival: buildCarnival, metro: buildMetro, sciencelab: buildScienceLab, mall: buildMall,
  hospital: buildHospital, construction: buildConstruction, disaster: buildDisaster, launchIsland: buildLaunchPad,
  university: buildUniversity, policeStation: buildPoliceStation, fireStation: buildFireStation,
  apartmentArea: buildApartmentArea, school: buildSchool, beach: buildBeach, marina: buildMarina,
  gasStation: buildGasStation, windFarm: buildWindFarm, scienceIsland: buildScienceIsland, cargoIsland: buildCargoIsland,
};

function buildMountainSign(group, lotHalf) {
  const sign = makeSignPlane('V&V CITY', { width: 26, height: 7, transparent: true, fg: '#f2efe4', fontPx: 150 });
  sign.position.set(0, 16, lotHalf * 0.3);
  sign.rotation.x = -0.28;
  group.add(sign);
}

export class World {
  constructor(scene, { onChunkBuilt, onChunkRemoved } = {}) {
    this.scene = scene;
    this.chunks = new Map();
    this.onChunkBuilt = onChunkBuilt || (() => {});
    this.onChunkRemoved = onChunkRemoved || (() => {});
    this.time = 0;
  }

  key(bx, bz) { return `${bx},${bz}`; }

  update(playerX, playerZ) {
    const pbx = blockIndex(playerX), pbz = blockIndex(playerZ);
    const wanted = new Set();
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
        const bx = pbx + dx, bz = pbz + dz;
        const k = this.key(bx, bz);
        wanted.add(k);
        if (!this.chunks.has(k)) this.buildChunk(bx, bz);
      }
    }
    for (const [k, chunk] of this.chunks) {
      if (!wanted.has(k)) this.removeChunk(k, chunk);
    }
  }

  // advances smoke-sprite drift for every currently-loaded disaster zone
  tickEffects(dt) {
    this.time += dt;
    for (const chunk of this.chunks.values()) {
      for (const s of chunk.smokeSprites) {
        s.position.y = s.userData.baseY + ((this.time * s.userData.speed) % 4);
        s.material.opacity = 0.35 * (1 - ((this.time * s.userData.speed) % 4) / 4);
      }
    }
  }

  buildChunk(bx, bz) {
    const biome = getBiome(bx, bz);
    const cx = blockCenter(bx), cz = blockCenter(bz);
    const group = new THREE.Group();
    group.position.set(cx, 0, cz);

    const colliders = [];
    const npcSpawns = [];
    const parkedVehicleSpawns = [];
    const trafficSpawns = [];
    const nightMeshes = [];
    const smokeSprites = [];

    const segs = (biome === 'city' || biome === 'plaza' || biome === 'suburb') ? 2 : 24;
    const groundGeo = new THREE.PlaneGeometry(ROAD_SPACING, ROAD_SPACING, segs, segs);
    groundGeo.rotateX(-Math.PI / 2);
    const posAttr = groundGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i), lz = posAttr.getZ(i);
      const h = getGroundHeight(cx + lx, cz + lz);
      posAttr.setY(i, h);
    }
    groundGeo.computeVertexNormals();
    const landmarkType = LANDMARKS[this.key(bx, bz)];
    const LANDMARK_GROUND_TEX = { tower: 'plaza', beach: 'desert' };
    const groundTexBiome = LANDMARK_GROUND_TEX[landmarkType] || biome;
    const groundMat = new THREE.MeshStandardMaterial({ map: getGroundTexture(groundTexBiome), roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    group.add(ground);

    const lotHalf = ROAD_SPACING / 2 - ROAD_BAND;

    if (landmarkType && LANDMARK_BUILDERS[landmarkType]) {
      LANDMARK_BUILDERS[landmarkType]({ group, cx, cz, bx, bz, colliders, npcSpawns, parkedVehicleSpawns, trafficSpawns, nightMeshes, smokeSprites, lotHalf });
      trafficSpawns.push({ x: cx + ROAD_SPACING / 2, z: cz, heading: Math.PI / 2 });
    } else if (biome === 'city' || biome === 'suburb' || biome === 'plaza') {
      this._populateUrban(group, bx, bz, biome, lotHalf, colliders, npcSpawns, parkedVehicleSpawns, nightMeshes);
      trafficSpawns.push({ x: cx + ROAD_SPACING / 2, z: cz, heading: Math.PI / 2 });
    } else if (biome === 'forest') {
      const n = Math.floor(randRange(bx, bz, 1, 6, 13));
      for (let i = 0; i < n; i++) {
        const lx = randRange(bx, bz, 10 + i, -lotHalf, lotHalf);
        const lz = randRange(bx, bz, 40 + i, -lotHalf, lotHalf);
        const t = makeTree(bx, bz, i);
        t.position.set(lx, getGroundHeight(cx + lx, cz + lz), lz);
        group.add(t);
        colliders.push(AABB2.fromCenter(cx + lx, cz + lz, 0.6, 0.6));
      }
      if (Math.random() < 0.5) npcSpawns.push({ x: cx + randRange(bx, bz, 99, -lotHalf, lotHalf), z: cz + randRange(bx, bz, 98, -lotHalf, lotHalf) });
    } else if (biome === 'desert') {
      const n = Math.floor(randRange(bx, bz, 2, 3, 7));
      for (let i = 0; i < n; i++) {
        const lx = randRange(bx, bz, 60 + i, -lotHalf, lotHalf);
        const lz = randRange(bx, bz, 90 + i, -lotHalf, lotHalf);
        const r = makeRock(bx, bz, i);
        r.position.x += lx; r.position.z += lz; r.position.y += getGroundHeight(cx + lx, cz + lz);
        group.add(r);
        colliders.push(AABB2.fromCenter(cx + lx, cz + lz, 1, 1));
      }
    } else if (biome === 'mountain') {
      const n = Math.floor(randRange(bx, bz, 3, 4, 9));
      for (let i = 0; i < n; i++) {
        const lx = randRange(bx, bz, 70 + i, -lotHalf, lotHalf);
        const lz = randRange(bx, bz, 110 + i, -lotHalf, lotHalf);
        const r = makeRock(bx, bz, i + 50);
        r.position.x += lx; r.position.z += lz; r.position.y += getGroundHeight(cx + lx, cz + lz);
        r.scale.multiplyScalar(1.5);
        group.add(r);
        colliders.push(AABB2.fromCenter(cx + lx, cz + lz, 1.6, 1.6));
      }
      if (Math.random() < 0.4) {
        const t = makeTree(bx, bz, 200);
        const lx = randRange(bx, bz, 201, -lotHalf, lotHalf), lz = randRange(bx, bz, 202, -lotHalf, lotHalf);
        t.position.set(lx, getGroundHeight(cx + lx, cz + lz), lz);
        group.add(t);
      }
      if (bx === 1 && bz === -4) buildMountainSign(group, lotHalf);
    }

    if (biome === 'water') {
      colliders.push(AABB2.fromCenter(cx, cz, lotHalf * 0.9, lotHalf * 0.9));
    }

    this.scene.add(group);
    const chunk = { bx, bz, biome, cx, cz, group, colliders, npcSpawns, parkedVehicleSpawns, trafficSpawns, nightMeshes, smokeSprites, entities: [] };
    this.chunks.set(this.key(bx, bz), chunk);
    this.onChunkBuilt(chunk);
  }

  _populateUrban(group, bx, bz, biome, lotHalf, colliders, npcSpawns, parkedVehicleSpawns, nightMeshes) {
    if (biome === 'plaza') {
      // ring-road plaza around the central tower: keep clear, just curb lamps
      for (let i = 0; i < 4; i++) {
        const lamp = makeLampPost(3);
        const ox = (i % 2 === 0 ? 1 : -1) * lotHalf * 0.8, oz = (i < 2 ? 1 : -1) * lotHalf * 0.8;
        lamp.position.set(ox, 0, oz);
        group.add(lamp); nightMeshes.push(lamp.children[1].material);
      }
      return;
    }
    const key = BUILDING_KEYS[Math.floor(randRange(bx, bz, 6, 0, BUILDING_KEYS.length))];
    const building = instantiate(key);
    const targetHeight = biome === 'city' ? randRange(bx, bz, 5, 9, 26) : randRange(bx, bz, 5, 5, 9);
    autoScaleToSize(building, targetHeight, 'y');
    const rot = Math.floor(randRange(bx, bz, 7, 0, 4)) * (Math.PI / 2);
    building.rotation.y = rot;
    const jitterX = randRange(bx, bz, 8, -lotHalf * 0.25, lotHalf * 0.25);
    const jitterZ = randRange(bx, bz, 9, -lotHalf * 0.25, lotHalf * 0.25);
    building.position.set(jitterX, 0, jitterZ);
    group.add(building);

    const box = new THREE.Box3().setFromObject(building);
    const size = new THREE.Vector3(); box.getSize(size);
    colliders.push(AABB2.fromCenter(group.position.x + jitterX, group.position.z + jitterZ,
      Math.max(size.x, 1) / 2, Math.max(size.z, 1) / 2));
    group.userData.door = { x: group.position.x + jitterX, z: group.position.z + jitterZ + size.z / 2 + 1.2 };

    const PROP_HEIGHTS = {
      billboard: 5.5, busStop: 2.4, busStopSign: 2.2, bench: 0.9,
      atm: 1.5, dumpster: 1.3, fencePiece: 1.1, fenceEnd: 1.1, bicycle: 1.05,
      trafficLight: 3.2, stopSign: 2, fireHydrant: 0.8, trashCan: 1, flowerPot: 0.8, planter: 0.9,
    };
    const cornerOffsets = [[-lotHalf * 0.85, -lotHalf * 0.85], [lotHalf * 0.85, -lotHalf * 0.85],
                           [-lotHalf * 0.85, lotHalf * 0.85], [lotHalf * 0.85, lotHalf * 0.85]];
    cornerOffsets.forEach(([ox, oz], i) => {
      if (randRange(bx, bz, 20 + i, 0, 1) < 0.45) {
        const pKey = PROP_KEYS[Math.floor(randRange(bx, bz, 30 + i, 0, PROP_KEYS.length))];
        const prop = instantiate(pKey);
        autoScaleToSize(prop, PROP_HEIGHTS[pKey] || 1.4, 'y');
        prop.position.set(ox, 0, oz);
        prop.rotation.y = randRange(bx, bz, 40 + i, 0, Math.PI * 2);
        group.add(prop);
        colliders.push(AABB2.fromCenter(group.position.x + ox, group.position.z + oz, 0.8, 0.8));
      }
    });
    // curb lamp posts, tagged for the day/night system
    const lamp = makeLampPost(3.2);
    lamp.position.set(lotHalf * 0.95, 0, -lotHalf * 0.95);
    group.add(lamp); nightMeshes.push(lamp.children[1].material);

    const pedCount = biome === 'city' ? Math.floor(randRange(bx, bz, 50, 1, 4)) : (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < pedCount; i++) {
      const t = randRange(bx, bz, 55 + i, 0, 1);
      const ring = lotHalf + 4;
      const angle = t * Math.PI * 2;
      npcSpawns.push({
        x: group.position.x + Math.cos(angle) * ring,
        z: group.position.z + Math.sin(angle) * ring,
        ringCenterX: group.position.x, ringCenterZ: group.position.z, ringRadius: ring,
      });
    }

    if (randRange(bx, bz, 60, 0, 1) < 0.5) {
      parkedVehicleSpawns.push({
        x: group.position.x + lotHalf + 2.5,
        z: group.position.z + randRange(bx, bz, 61, -lotHalf * 0.5, lotHalf * 0.5),
        heading: Math.PI / 2,
      });
    }
  }

  removeChunk(key, chunk) {
    this.onChunkRemoved(chunk);
    this.scene.remove(chunk.group);
    chunk.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else if (o.material?.map !== getGroundTexture) o.material?.dispose?.();
      }
    });
    this.chunks.delete(key);
  }

  getCollidersNear(x, z, radius) {
    const out = [];
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - x, dz = chunk.cz - z;
      if (Math.abs(dx) > ROAD_SPACING + radius || Math.abs(dz) > ROAD_SPACING + radius) continue;
      for (const c of chunk.colliders) out.push(c);
    }
    return out;
  }

  findNearestDoor(x, z, maxDist = 12) {
    let best = null, bestD = maxDist;
    for (const chunk of this.chunks.values()) {
      const d = chunk.group.userData.door;
      if (!d) continue;
      const dist = Math.hypot(d.x - x, d.z - z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  // every emissive "night" material currently loaded (windows, lamps, domes,
  // pool lights, the carnival wheel) — main.js fades their emissiveIntensity
  // in/out with the day/night cycle.
  getAllNightMaterials() {
    const out = [];
    for (const chunk of this.chunks.values()) out.push(...chunk.nightMeshes);
    return out;
  }
}
