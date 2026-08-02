import * as THREE from 'three';
import { instantiate, findClip, autoScaleToSize } from './assets.js';
import { getGroundHeight } from './world.js';
import { clamp } from './utils.js';

const GRAVITY = -28;
const WALK_SPEED = 3.4;
const RUN_SPEED = 7.2;
const JUMP_SPEED = 8.5;
const RADIUS = 0.35;

export class Character {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.position = new THREE.Vector3(0, 0, 6);
    this.velocityY = 0;
    this.heading = Math.PI;
    this.onGround = true;
    this.visible = true;
    this.outfitKey = 'playerWoman';

    // camera rig — tuned for a slightly higher, closer "over-the-shoulder"
    // GTA-style framing rather than a flat behind-the-head view.
    this.camYaw = Math.PI;
    this.camPitch = 0.30;
    this.camDistance = 5.6;
    this.firstPerson = false;
    this.cameraTarget = new THREE.Vector3();
    this.mesh = null;
    this.mixer = null;
    this.idleAction = null;
    this.moveAction = null;
    this.tint = 0xffffff;
    this.playerName = '';
    this.nameSprite = null;

    scene.add(this.root);
  }

  async init(outfitKey = this.outfitKey) {
    this.outfitKey = outfitKey;
    this.mesh = instantiate(outfitKey);
    this.root.add(this.mesh);
    autoScaleToSize(this.mesh, 1.75, 'y');
    this._bindAnimations(outfitKey);
    this._applyTint();
  }

  // swap the on-foot outfit at runtime (character customization panel)
  async setOutfit(outfitKey) {
    if (outfitKey === this.outfitKey && this.mesh) return;
    if (this.mesh) this.root.remove(this.mesh);
    this.outfitKey = outfitKey;
    this.mesh = instantiate(outfitKey);
    this.root.add(this.mesh);
    autoScaleToSize(this.mesh, 1.75, 'y');
    this._bindAnimations(outfitKey);
    this._applyTint();
  }

  // recolors the current outfit by multiplying each material's original
  // color (cached once so repeated re-tints don't compound) by the chosen
  // tint — works generically across every GLB without knowing its materials.
  _applyTint() {
    if (!this.mesh) return;
    const c = new THREE.Color(this.tint);
    this.mesh.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m.color) continue;
        if (m.userData._baseColor === undefined) m.userData._baseColor = m.color.getHex();
        m.color.setHex(m.userData._baseColor).multiply(c);
      }
    });
  }

  setTint(hex) {
    this.tint = hex;
    this._applyTint();
  }

  _makeNameSprite(text) {
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 64;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = 'rgba(8,12,18,0.6)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(4, 4, 248, 56, 14); ctx.fill(); }
    else ctx.fillRect(4, 4, 248, 56);
    ctx.font = '700 30px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#3ddcff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.6, 0.4, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  // shows/updates a floating name tag above the character's head (empty
  // string removes it). Hidden automatically in first-person, same as the body.
  setPlayerName(name) {
    this.playerName = (name || '').trim();
    if (this.nameSprite) {
      this.root.remove(this.nameSprite);
      this.nameSprite.material.map.dispose();
      this.nameSprite.material.dispose();
      this.nameSprite = null;
    }
    if (this.playerName) {
      this.nameSprite = this._makeNameSprite(this.playerName);
      this.nameSprite.position.set(0, 2.05, 0);
      this.root.add(this.nameSprite);
    }
  }

  _bindAnimations(outfitKey) {
    const idleClip = findClip(outfitKey, ['idle'], 0);
    const walkClip = findClip(outfitKey, ['walk'], 0);
    const runClip = findClip(outfitKey, ['run'], 0);
    this.mixer = null; this.idleAction = null; this.moveAction = null; this.runAction = null;
    if (idleClip) {
      this.mixer = new THREE.AnimationMixer(this.mesh);
      this.idleAction = this.mixer.clipAction(idleClip);
      this.moveAction = this.mixer.clipAction(walkClip);
      this.runAction = runClip && runClip !== walkClip ? this.mixer.clipAction(runClip) : null;
      this.idleAction.play(); this.moveAction.play(); this.runAction?.play();
      this.idleAction.setEffectiveWeight(1);
      this.moveAction.setEffectiveWeight(0);
      this.runAction?.setEffectiveWeight(0);
    }
  }

  setHidden(hidden) {
    this.root.visible = !hidden;
    this.visible = !hidden;
  }

  toggleFirstPerson() { this.firstPerson = !this.firstPerson; }

  teleport(x, z, headingRad = null) {
    this.position.set(x, getGroundHeight(x, z), z);
    if (headingRad !== null) this.heading = headingRad;
    this.velocityY = 0;
  }

  _resolveCollisions(colliders) {
    for (const box of colliders) {
      const [cx, cz] = box.closestPoint(this.position.x, this.position.z);
      const dx = this.position.x - cx, dz = this.position.z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq < RADIUS * RADIUS && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = (RADIUS - dist);
        this.position.x += (dx / dist) * push;
        this.position.z += (dz / dist) * push;
      } else if (distSq <= 1e-6) {
        this.position.x += RADIUS;
      }
    }
  }

  update(dt, input, colliders) {
    if (!this.visible) return;

    const running = input.run;
    const speed = running ? RUN_SPEED : WALK_SPEED;
    const moveX = input.moveX, moveZ = input.moveZ;
    const moving = Math.abs(moveX) > 0.05 || Math.abs(moveZ) > 0.05;

    if (moving) {
      const inputAngle = Math.atan2(moveX, -moveZ);
      const targetHeading = this.camYaw + inputAngle + Math.PI;
      let diff = targetHeading - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * clamp(dt * 10, 0, 1);

      const mag = clamp(Math.hypot(moveX, moveZ), 0, 1);
      const dirX = Math.sin(this.heading), dirZ = Math.cos(this.heading);
      this.position.x += dirX * speed * mag * dt;
      this.position.z += dirZ * speed * mag * dt;
    }

    if (colliders && colliders.length) this._resolveCollisions(colliders);

    const groundY = getGroundHeight(this.position.x, this.position.z);
    if (input.jumpPressed && this.onGround) {
      this.velocityY = JUMP_SPEED;
      this.onGround = false;
    }
    this.velocityY += GRAVITY * dt;
    this.position.y += this.velocityY * dt;
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.velocityY = 0;
      this.onGround = true;
    }

    this.root.position.copy(this.position);
    this.root.rotation.y = this.heading;
    this.mesh.visible = !this.firstPerson; // hide own body in first-person
    if (this.nameSprite) this.nameSprite.visible = !this.firstPerson;

    if (this.mixer) {
      const useRun = moving && running && this.runAction;
      const targetIdle = moving ? 0 : 1;
      const targetWalk = moving && !useRun ? 1 : 0;
      const targetRun = useRun ? 1 : 0;
      const lerpW = clamp(dt * 7, 0, 1);
      this.idleAction.setEffectiveWeight(THREE.MathUtils.lerp(this.idleAction.getEffectiveWeight(), targetIdle, lerpW));
      this.moveAction.setEffectiveWeight(THREE.MathUtils.lerp(this.moveAction.getEffectiveWeight(), targetWalk, lerpW));
      this.runAction?.setEffectiveWeight(THREE.MathUtils.lerp(this.runAction.getEffectiveWeight(), targetRun, lerpW));
      if (!this.runAction && running) this.moveAction.timeScale = 1.6; else this.moveAction.timeScale = 1.0;
      this.mixer.update(dt);
    }
  }

  // smooth third-person orbit camera, or a locked first-person eye view.
  updateCamera(camera, input, dt, targetPos, targetHeading, desiredDistance) {
    this.camYaw += input.lookDX * 0.0028;
    this.camPitch = clamp(this.camPitch - input.lookDY * 0.0022, -0.35, 1.1);

    if (this.firstPerson) {
      const eyeHeight = targetPos === this.position ? 1.62 : 1.35;
      const eyePos = new THREE.Vector3(targetPos.x, targetPos.y + eyeHeight, targetPos.z);
      camera.position.lerp(eyePos, clamp(dt * 14, 0, 1));
      const lookDir = new THREE.Vector3(Math.sin(this.heading), Math.sin(this.camPitch) * 0.6, Math.cos(this.heading));
      this.cameraTarget.copy(eyePos).add(lookDir);
      camera.lookAt(this.cameraTarget);
      return;
    }

    const dist = desiredDistance ?? this.camDistance;
    const offset = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch) + 0.32,
      Math.cos(this.camYaw) * Math.cos(this.camPitch)
    ).multiplyScalar(dist);
    const desired = new THREE.Vector3(targetPos.x, targetPos.y + 1.5, targetPos.z).add(offset);
    camera.position.lerp(desired, clamp(dt * 6, 0, 1));
    const lookAt = new THREE.Vector3(targetPos.x, targetPos.y + 1.25, targetPos.z);
    this.cameraTarget.lerp(lookAt, clamp(dt * 8, 0, 1));
    camera.lookAt(this.cameraTarget);
  }
}
