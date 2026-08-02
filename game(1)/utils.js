// ---------------------------------------------------------------------------
// utils.js — small math / noise / helper library used across the game.
// No external deps: a lightweight deterministic value-noise implementation
// stands in for simplex noise so the whole project stays dependency-free.
// ---------------------------------------------------------------------------

export function hash2(x, z) {
  // Deterministic pseudo-random 0..1 from integer coords.
  let h = x * 374761393 + z * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function smooth(t) { return t * t * (3 - 2 * t); }
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// 2D value noise, smoothly interpolated, range ~[0,1]
export function valueNoise2D(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const v00 = hash2(xi, zi);
  const v10 = hash2(xi + 1, zi);
  const v01 = hash2(xi, zi + 1);
  const v11 = hash2(xi + 1, zi + 1);
  const u = smooth(xf), v = smooth(zf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

// fractal / multi-octave noise for smoother large-scale features
export function fbm(x, z, octaves = 4, freq = 1, persistence = 0.5) {
  let total = 0, amp = 1, maxAmp = 0, f = freq;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(x * f, z * f) * amp;
    maxAmp += amp;
    amp *= persistence;
    f *= 2;
  }
  return total / maxAmp;
}

export function randRange(seedX, seedZ, salt, min, max) {
  const r = hash2(seedX * 92821 + salt * 131, seedZ * 68917 + salt * 977);
  return min + r * (max - min);
}

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// simple 2D AABB (world-space, y ignored) used for building/prop colliders
export class AABB2 {
  constructor(minX, minZ, maxX, maxZ) {
    this.minX = minX; this.minZ = minZ; this.maxX = maxX; this.maxZ = maxZ;
  }
  static fromCenter(cx, cz, hx, hz) {
    return new AABB2(cx - hx, cz - hz, cx + hx, cz + hz);
  }
  intersects(o) {
    return this.minX <= o.maxX && this.maxX >= o.minX && this.minZ <= o.maxZ && this.maxZ >= o.minZ;
  }
  containsPoint(x, z) {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }
  // closest point on box to (x,z)
  closestPoint(x, z) {
    return [clamp(x, this.minX, this.maxX), clamp(z, this.minZ, this.maxZ)];
  }
}

export function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}
