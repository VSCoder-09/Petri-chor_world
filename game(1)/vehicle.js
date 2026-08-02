import * as THREE from 'three';
import { instantiate, autoScaleToSize, VEHICLE_CLASSES } from './assets.js';
import { getGroundHeight, ROAD_SPACING } from './world.js';
import { clamp } from './utils.js';

const TARGET_LENGTH = { car: 4.3, carAlt: 4.3, suv: 4.7, pickup: 5.2, van: 5, bus: 10.5, policeCar: 4.4, sportsCar: 4.1, sportsCarAlt: 4.1, motorcycle: 1.9 };

const DRAG = 0.6;
const MAX_REVERSE = 8;
const MAX_TURN_RATE = 2.1;
const NORMAL_GRIP_MULT = 0.9;
const DRIFT_GRIP_MULT = 0.16;
const GRAVITY = -26;
const KNOCKDOWN_SPEED = 3.5;
const CRASH_SPEED_LOSS = 0.45;
const FLIP_CHANCE_PER_HARD_HIT = 0.12; // odds a violent crash tips the vehicle over

export class Vehicle {
  constructor(scene, key, { isTraffic = false } = {}) {
    this.scene = scene;
    this.key = key;
    this.stats = VEHICLE_CLASSES[key] || { speed: 30, accel: 9, grip: 9, label: 'Car' };
    this.isTraffic = isTraffic;
    this.mode = isTraffic ? 'traffic' : 'parked';
    this.mesh = instantiate(key);
    this.scene.add(this.mesh);
    autoScaleToSize(this.mesh, TARGET_LENGTH[key] || 4.3, 'xz');

    const box = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3(); box.getSize(size);
    this.halfLength = Math.max(size.z, 1.2) / 2;
    this.halfWidth = Math.max(size.x, 0.8) / 2;
    this.boundRadius = Math.hypot(this.halfLength, this.halfWidth);
    this.seatHeight = size.y * 0.35;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.forwardSpeed = 0;
    this.verticalVel = 0;
    this.airborne = false;
    this.airTime = 0;
    this._lastGroundY = 0;
    this.driftAngle = 0;

    // flip state — the mesh can tip onto its side/roof after a hard crash;
    // "Reset Car" (R key / reset button) snaps it back upright in place.
    this.flipped = false;
    this.rollAngle = 0;

    this.axis = Math.random() < 0.5 ? 'x' : 'z';
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.laneOffset = -3;
    this._sinceTurnCheck = 0;
  }

  setPose(x, z, headingRad) {
    this.position.set(x, getGroundHeight(x, z), z);
    this.heading = headingRad;
    this._lastGroundY = this.position.y;
    this._syncMesh();
  }

  _syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(0, this.heading, this.flipped ? Math.PI * 0.5 : 0);
  }

  getBoundingRadius() { return this.boundRadius; }

  resetUpright() {
    if (!this.flipped) return;
    this.flipped = false;
    this.position.y = getGroundHeight(this.position.x, this.position.z) + 0.05;
    this.velocity.set(0, 0, 0);
    this.forwardSpeed = 0;
    this._syncMesh();
  }

  update(dt, input, collidersNear, otherVehicles, npcs, callbacks = {}) {
    if (this.mode === 'parked') return;
    if (this.flipped) { this._syncMesh(); return; } // sits tipped over until reset

    if (this.mode === 'traffic') this._updateTrafficAI(dt, otherVehicles);
    else this._updatePlayerPhysics(dt, input, callbacks);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    const groundY = getGroundHeight(this.position.x, this.position.z);
    if (!this.airborne) {
      const drop = groundY - this._lastGroundY;
      const speedAbs = Math.abs(this.forwardSpeed);
      if (drop < -0.18 && speedAbs > 4) {
        this.verticalVel = clamp(speedAbs * 0.45, 2, 11);
        this.airborne = true;
      }
    }
    if (this.airborne) {
      this.verticalVel += GRAVITY * dt;
      this.position.y += this.verticalVel * dt;
      this.airTime += dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.airborne = false;
        this.verticalVel = 0;
        if (this.airTime > 0.35 && callbacks.onStunt) callbacks.onStunt(Math.round(this.airTime * 140));
        this.airTime = 0;
      }
    } else {
      this.position.y = groundY;
    }
    this._lastGroundY = groundY;

    if (collidersNear && collidersNear.length) this._resolveStaticCollisions(collidersNear, callbacks);
    if (npcs && npcs.length) this._resolvePedestrianHits(npcs, callbacks);

    this._syncMesh();
  }

  _updatePlayerPhysics(dt, input, callbacks) {
    const accel = this.stats.accel, maxSpeed = this.stats.speed, grip = this.stats.grip;
    const throttle = input.throttle || 0;
    const engineAccel = throttle >= 0 ? throttle * accel : throttle * (accel * 1.6);
    this.forwardSpeed += engineAccel * dt;
    this.forwardSpeed *= Math.max(0, 1 - DRAG * dt * (this.airborne ? 0.2 : 1));
    this.forwardSpeed = clamp(this.forwardSpeed, -MAX_REVERSE, maxSpeed);

    if (!this.airborne) {
      const speedFactor = clamp(Math.abs(this.forwardSpeed) / 8, 0.25, 1);
      const dirSign = this.forwardSpeed >= 0 ? 1 : -1;
      this.heading += input.steer * MAX_TURN_RATE * speedFactor * dirSign * dt;
    }

    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const targetVel = forward.multiplyScalar(this.forwardSpeed);
    const gripRate = (input.handbrake ? DRIFT_GRIP_MULT : NORMAL_GRIP_MULT) * grip;
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVel.x, clamp(gripRate * dt, 0, 1));
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVel.z, clamp(gripRate * dt, 0, 1));

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const velLen = Math.hypot(this.velocity.x, this.velocity.z);
    if (velLen > 0.5) {
      const dot = (this.velocity.x * fx + this.velocity.z * fz) / velLen;
      this.driftAngle = Math.acos(clamp(dot, -1, 1));
    } else this.driftAngle = 0;
  }

  _updateTrafficAI(dt, otherVehicles) {
    this._sinceTurnCheck += dt;
    const speedTarget = Math.min(7, this.stats.speed * 0.5);
    this.forwardSpeed = THREE.MathUtils.lerp(this.forwardSpeed, speedTarget, dt * 0.6);

    const snapTo = (v) => Math.round(v / ROAD_SPACING) * ROAD_SPACING;
    if (this.axis === 'x') {
      const laneZ = snapTo(this.position.z) + this.laneOffset;
      this.position.z = THREE.MathUtils.lerp(this.position.z, laneZ, clamp(dt * 3, 0, 1));
      this.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.velocity.set(this.dir * this.forwardSpeed, 0, 0);
    } else {
      const laneX = snapTo(this.position.x) + this.laneOffset;
      this.position.x = THREE.MathUtils.lerp(this.position.x, laneX, clamp(dt * 3, 0, 1));
      this.heading = this.dir > 0 ? 0 : Math.PI;
      this.velocity.set(0, 0, this.dir * this.forwardSpeed);
    }

    for (const other of otherVehicles) {
      if (other === this) continue;
      const d = this.position.distanceTo(other.position);
      if (d < 9) {
        const ahead = this.axis === 'x'
          ? Math.sign(other.position.x - this.position.x) === this.dir
          : Math.sign(other.position.z - this.position.z) === this.dir;
        if (ahead) this.forwardSpeed = Math.min(this.forwardSpeed, Math.max(0, d - 4));
      }
    }

    if (this._sinceTurnCheck > 2.5) {
      this._sinceTurnCheck = 0;
      const nearIntersection = this.axis === 'x'
        ? Math.abs(this.position.x % ROAD_SPACING) < 6
        : Math.abs(this.position.z % ROAD_SPACING) < 6;
      if (nearIntersection && Math.random() < 0.3) {
        this.axis = this.axis === 'x' ? 'z' : 'x';
        this.dir = Math.random() < 0.5 ? 1 : -1;
      }
    }
  }

  _resolveStaticCollisions(colliders, callbacks) {
    for (const box of colliders) {
      const [cx, cz] = box.closestPoint(this.position.x, this.position.z);
      const dx = this.position.x - cx, dz = this.position.z - cz;
      const distSq = dx * dx + dz * dz;
      const r = this.boundRadius * 0.85;
      if (distSq < r * r) {
        const dist = Math.sqrt(distSq) || 0.001;
        const push = r - dist;
        this.position.x += (dx / dist) * push;
        this.position.z += (dz / dist) * push;
        const hardHit = Math.abs(this.forwardSpeed) > 10;
        if (Math.abs(this.forwardSpeed) > 3 && this.mode === 'player' && callbacks.onCrash) callbacks.onCrash();
        if (hardHit && this.mode === 'player' && Math.random() < FLIP_CHANCE_PER_HARD_HIT) {
          this.flipped = true;
          if (callbacks.onFlip) callbacks.onFlip();
        }
        this.forwardSpeed *= (1 - CRASH_SPEED_LOSS);
        this.velocity.multiplyScalar(1 - CRASH_SPEED_LOSS);
      }
    }
  }

  _resolvePedestrianHits(npcs, callbacks) {
    const speedAbs = Math.hypot(this.velocity.x, this.velocity.z);
    for (const npc of npcs) {
      if (npc.isDown) continue;
      const d = Math.hypot(this.position.x - npc.position.x, this.position.z - npc.position.z);
      if (d < this.boundRadius * 0.7 + 0.4) {
        if (speedAbs > KNOCKDOWN_SPEED) {
          npc.knockDown();
          if (callbacks.onHitPedestrian) callbacks.onHitPedestrian();
        }
        this.forwardSpeed *= 0.7;
      }
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); } });
  }
}
