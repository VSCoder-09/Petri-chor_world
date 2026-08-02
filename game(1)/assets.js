import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------------------
// assets.js — manifest of every provided GLB plus a small loader/cache layer.
// Everything below points at files that live in /assets. Add your own models
// by adding an entry here and referencing its key elsewhere.
// ---------------------------------------------------------------------------

export const MANIFEST = {
  // playable / pedestrian characters (outfits)
  playerWoman:   'assets/Animated_Woman.glb',
  adventurer:    'assets/Adventurer.glb',
  man:           'assets/Man.glb',
  npcWomanA:     'assets/Animated_Woman-nIItLV9nxS.glb',
  npcWomanB:     'assets/Animated_Woman-qJ2gsTUBHL.glb',

  // vehicles
  car:           'assets/Car.glb',
  carAlt:        'assets/Car-unqqkULtRU.glb',
  suv:           'assets/SUV.glb',
  pickup:        'assets/Pickup_Truck.glb',
  sportsCar:     'assets/Sports_Car.glb',
  sportsCarAlt:  'assets/Sports_Car-Gzj704DXdr.glb',
  policeCar:     'assets/Police_Car.glb',
  van:           'assets/Van.glb',
  motorcycle:    'assets/Motorcycle.glb',
  bus:           'assets/Bus.glb',
  bicycle:       'assets/Bicycle.glb',

  // buildings
  bigBuilding:   'assets/Big_Building.glb',
  brownBuilding: 'assets/Brown_Building.glb',
  greenBuilding: 'assets/Building_Green.glb',
  redBuilding:   'assets/Building_Red.glb',
  redCorner:     'assets/Building_Red_Corner.glb',

  // street props / landmark furniture
  billboard:     'assets/Billboard.glb',
  busStop:       'assets/Bus_Stop.glb',
  busStopSign:   'assets/Bus_stop_sign.glb',
  bench:         'assets/Bench.glb',
  atm:           'assets/ATM.glb',
  dumpster:      'assets/Dumpster.glb',
  fencePiece:    'assets/Fence_Piece.glb',
  fenceEnd:      'assets/Fence_End.glb',
  fence:         'assets/Fence.glb',
  cone:          'assets/Cone.glb',
  trafficLight:  'assets/Traffic_Light.glb',
  stopSign:      'assets/Stop_sign.glb',
  fireHydrant:   'assets/Fire_hydrant.glb',
  manhole:       'assets/Manhole_Cover.glb',
  trashCan:      'assets/Trash_Can.glb',
  flowerPot:     'assets/Flower_Pot.glb',
  planter:       'assets/Planter_&_Bushes.glb',
  tree:          'assets/Tree.glb',
};

// keys we treat as "buildings" for procedural placement in world.js
export const BUILDING_KEYS = ['bigBuilding', 'brownBuilding', 'greenBuilding', 'redBuilding', 'redCorner'];
// keys we treat as small street props
export const PROP_KEYS = ['billboard', 'busStop', 'busStopSign', 'bench', 'atm', 'dumpster', 'fencePiece', 'fenceEnd', 'bicycle', 'trafficLight', 'stopSign', 'fireHydrant', 'trashCan', 'flowerPot', 'planter'];
// keys treated as drivable vehicle templates, with arcade "class" stats.
// speed: top speed (m/s) · accel: engine accel · grip: cornering grip · label: shown in HUD
export const VEHICLE_CLASSES = {
  car:          { speed: 30, accel: 9,  grip: 9,   label: 'Sedan' },
  carAlt:       { speed: 30, accel: 9,  grip: 9,   label: 'Sedan' },
  suv:          { speed: 32, accel: 8,  grip: 8,   label: 'Phantom' },
  pickup:       { speed: 30, accel: 8,  grip: 7.5, label: 'Titan' },
  van:          { speed: 27, accel: 7,  grip: 7,   label: 'Van' },
  bus:          { speed: 24, accel: 5,  grip: 6,   label: 'Bus' },
  policeCar:    { speed: 36, accel: 11, grip: 10,  label: 'Police' },
  sportsCar:    { speed: 46, accel: 14, grip: 11,  label: 'Venom GT' },
  sportsCarAlt: { speed: 46, accel: 14, grip: 11,  label: 'Venom GT' },
  motorcycle:   { speed: 38, accel: 13, grip: 8,   label: 'Apex Superbike' },
};
export const VEHICLE_KEYS = Object.keys(VEHICLE_CLASSES);
// the flashier set used for landmark showcase parking (hotel valet, stadium VIP, etc.)
export const PREMIUM_VEHICLE_KEYS = ['sportsCar', 'sportsCarAlt', 'suv', 'policeCar'];
// labels shown in the "PREMIUM VEHICLES" garage/showcase list
export const PREMIUM_SHOWCASE = [
  { key: 'sportsCar', label: 'Venom GT' },
  { key: 'suv',       label: 'Phantom' },
  { key: 'pickup',    label: 'Titan' },
  { key: 'motorcycle',label: 'Apex Superbike' },
];

// keys the player can pick as their on-foot outfit
export const PLAYER_OUTFITS = [
  { key: 'playerWoman', label: 'Explorer' },
  { key: 'adventurer',  label: 'Adventurer' },
  { key: 'man',         label: 'Casual' },
  { key: 'npcWomanA',   label: 'Street' },
  { key: 'npcWomanB',   label: 'Runner' },
];

const loader = new GLTFLoader();
const rawCache = new Map();   // key -> gltf (original, never mutate)
const loadingPromises = new Map();

export function loadGLTF(key) {
  if (rawCache.has(key)) return Promise.resolve(rawCache.get(key));
  if (loadingPromises.has(key)) return loadingPromises.get(key);

  const path = MANIFEST[key];
  const p = new Promise((resolve, reject) => {
    loader.load(path, (gltf) => {
      gltf.scene.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      rawCache.set(key, gltf);
      resolve(gltf);
    }, undefined, (err) => {
      console.error(`Failed to load asset "${key}" (${path})`, err);
      reject(err);
    });
  });
  loadingPromises.set(key, p);
  return p;
}

export async function loadAll(keys, onProgress) {
  let done = 0;
  const total = keys.length;
  for (const key of keys) {
    try { await loadGLTF(key); } catch (e) { /* keep going even if one asset fails */ }
    done++;
    if (onProgress) onProgress(done / total, key);
  }
}

export function isLoaded(key) { return rawCache.has(key); }

// Returns a fresh, independently-animatable clone of a loaded GLTF's scene.
export function instantiate(key) {
  const gltf = rawCache.get(key);
  if (!gltf) {
    console.warn(`instantiate() called before "${key}" finished loading`);
    return new THREE.Group();
  }
  const scene = skeletonClone(gltf.scene);
  scene.animations = gltf.animations;
  return scene;
}

export function getAnimations(key) {
  const gltf = rawCache.get(key);
  return gltf ? gltf.animations : [];
}

export function findClip(key, substrings, fallbackIndex = 0) {
  const clips = getAnimations(key);
  if (!clips || !clips.length) return null;
  for (const s of substrings) {
    const found = clips.find(c => c.name.toLowerCase().includes(s.toLowerCase()));
    if (found) return found;
  }
  return clips[Math.min(fallbackIndex, clips.length - 1)];
}

export function autoScaleToSize(object3D, targetDimension, axis = 'y') {
  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  box.getSize(size);
  const current = axis === 'xz' ? Math.max(size.x, size.z) : size[axis];
  if (current > 1e-5) {
    object3D.scale.multiplyScalar(targetDimension / current);
  }
  return size;
}

export function computeLocalBounds(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center };
}
