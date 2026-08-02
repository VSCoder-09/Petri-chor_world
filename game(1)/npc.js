import * as THREE from 'three';
import { instantiate, findClip, autoScaleToSize } from './assets.js';
import { getGroundHeight } from './world.js';
import { clamp } from './utils.js';

const WALK_SPEED = 1.35;
const DOWN_DURATION = 6; // seconds collapsed before getting back up

const NPC_KEYS = ['npcWomanA', 'npcWomanB'];

export class NPC {
  constructor(scene, spawn) {
    this.scene = scene;
    this.key = NPC_KEYS[Math.floor(Math.random() * NPC_KEYS.length)];
    this.mesh = instantiate(this.key);
    this.scene.add(this.mesh);
    autoScaleToSize(this.mesh, 1.7 + Math.random() * 0.15, 'y');

    this.ring = spawn.ringCenterX !== undefined
      ? { cx: spawn.ringCenterX, cz: spawn.ringCenterZ, r: spawn.ringRadius }
      : null;
    this.position = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.angle = this.ring ? Math.atan2(spawn.z - this.ring.cz, spawn.x - this.ring.cx) : 0;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.wanderTarget = this.ring ? null : new THREE.Vector3(spawn.x, 0, spawn.z);
    this.heading = 0;
    this.isDown = false;
    this.downTimer = 0;

    const walkClip = findClip(this.key, ['walk'], 0);
    this.mixer = null;
    if (walkClip) {
      this.mixer = new THREE.AnimationMixer(this.mesh);
      this.action = this.mixer.clipAction(walkClip);
      this.action.play();
    }

    this.position.y = getGroundHeight(this.position.x, this.position.z);
    this._sync();
  }

  knockDown() {
    if (this.isDown) return;
    this.isDown = true;
    this.downTimer = 0;
    this.mesh.rotation.x = -Math.PI / 2; // simple tip-over, no gore
    if (this.action) this.action.paused = true;
  }

  _sync() {
    this.mesh.position.copy(this.position);
    if (!this.isDown) this.mesh.rotation.y = this.heading;
  }

  update(dt) {
    if (this.isDown) {
      this.downTimer += dt;
      if (this.downTimer > DOWN_DURATION) {
        this.isDown = false;
        this.mesh.rotation.x = 0;
        if (this.action) this.action.paused = false;
        // move them along a little so they don't instantly get hit again
        if (this.ring) this.angle += 0.6 * this.dir;
      }
      return;
    }

    if (this.ring) {
      this.angle += (WALK_SPEED / this.ring.r) * this.dir * dt;
      this.position.x = this.ring.cx + Math.cos(this.angle) * this.ring.r;
      this.position.z = this.ring.cz + Math.sin(this.angle) * this.ring.r;
      const tangent = this.angle + (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.heading = tangent;
    } else {
      const d = this.wanderTarget.distanceTo(this.position);
      if (d < 0.4) {
        this.wanderTarget.set(
          this.position.x + (Math.random() - 0.5) * 12,
          0,
          this.position.z + (Math.random() - 0.5) * 12
        );
      } else {
        const dx = this.wanderTarget.x - this.position.x, dz = this.wanderTarget.z - this.position.z;
        this.heading = Math.atan2(dx, dz);
        this.position.x += Math.sin(this.heading) * WALK_SPEED * dt;
        this.position.z += Math.cos(this.heading) * WALK_SPEED * dt;
      }
    }

    this.position.y = getGroundHeight(this.position.x, this.position.z);
    if (this.mixer) this.mixer.update(dt);
    this._sync();
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}
