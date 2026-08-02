// ---------------------------------------------------------------------------
// audio.js — small procedural sound manager (Web Audio API, no sound files
// needed). Engine tone pitches up with speed, a soft wind bed plays while
// outdoors, and UI actions get short synthesized blips. Everything routes
// through one master gain so the Sound On/Off button can mute instantly.
// ---------------------------------------------------------------------------
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.windGain = null;
    this.muted = false;
    this.started = false;
  }

  // must be called from a user gesture (Play button) — browsers block audio
  // contexts from starting silently.
  start() {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);

    // engine drone: a detuned sawtooth pair, gain/pitch driven each frame
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineGain).connect(this.master);
    this.engineOsc.start();

    // soft filtered noise bed for wind/ambience
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer; noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 500;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.06;
    noise.connect(filter).connect(this.windGain).connect(this.master);
    noise.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  // called every frame while driving; speedFrac is 0..1 of top speed
  updateEngine(speedFrac, driving) {
    if (!this.started) return;
    const targetGain = driving ? 0.12 + speedFrac * 0.18 : 0;
    const targetFreq = 55 + speedFrac * 260;
    this.engineGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.08);
    this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.12);
  }

  // short synthesized blip for UI/interaction feedback
  blip(freq = 440, dur = 0.08) {
    if (!this.started || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.value = 0.25;
    o.connect(g).connect(this.master);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.stop(this.ctx.currentTime + dur + 0.02);
  }

  crashThud() {
    if (!this.started || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = 90;
    g.gain.value = 0.4;
    o.connect(g).connect(this.master);
    o.start();
    o.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
    o.stop(this.ctx.currentTime + 0.32);
  }
}
