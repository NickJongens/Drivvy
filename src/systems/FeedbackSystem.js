function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export class FeedbackSystem {
  constructor({ vibrationEnabled = true } = {}) {
    this.vibrationEnabled = vibrationEnabled;
    this.audioContext = null;
    this.masterGain = null;
    this.engineLowOscillator = null;
    this.engineHighOscillator = null;
    this.engineLowGain = null;
    this.engineHighGain = null;
    this.engineFilter = null;
    this.boostWasActive = false;
    this.passByCooldown = 0;
    this.policePulseTimer = 0;
  }

  isVibrationSupported() {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  isVibrationEnabled() {
    return this.vibrationEnabled;
  }

  setVibrationEnabled(enabled) {
    this.vibrationEnabled = Boolean(enabled);
  }

  reset() {
    this.boostWasActive = false;
    this.passByCooldown = 0;
    this.policePulseTimer = 0;
  }

  async unlockAudio() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContextCtor();
      this.createEngineNodes();
    }

    if (this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch (error) {
        return;
      }
    }
  }

  createEngineNodes() {
    if (!this.audioContext) {
      return;
    }

    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0;

    this.engineFilter = this.audioContext.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 620;
    this.engineFilter.Q.value = 0.75;

    this.engineLowOscillator = this.audioContext.createOscillator();
    this.engineLowOscillator.type = "sawtooth";
    this.engineLowOscillator.frequency.value = 42;

    this.engineHighOscillator = this.audioContext.createOscillator();
    this.engineHighOscillator.type = "triangle";
    this.engineHighOscillator.frequency.value = 86;

    this.engineLowGain = this.audioContext.createGain();
    this.engineLowGain.gain.value = 0;
    this.engineHighGain = this.audioContext.createGain();
    this.engineHighGain.gain.value = 0;

    this.engineLowOscillator.connect(this.engineLowGain);
    this.engineHighOscillator.connect(this.engineHighGain);
    this.engineLowGain.connect(this.engineFilter);
    this.engineHighGain.connect(this.engineFilter);
    this.engineFilter.connect(this.masterGain);
    this.masterGain.connect(this.audioContext.destination);

    this.engineLowOscillator.start();
    this.engineHighOscillator.start();
  }

  update({ delta, running, speed, boostActive, policeGap }) {
    this.passByCooldown = Math.max(0, this.passByCooldown - delta);
    this.updateEngine(running, speed, boostActive);
    this.updatePolicePulse(delta, running ? policeGap : null);

    if (boostActive && !this.boostWasActive) {
      this.playNosBurst();
      this.vibrate([24, 16, 34]);
    }

    this.boostWasActive = boostActive;
  }

  updateEngine(running, speed, boostActive) {
    if (!this.audioContext || !this.masterGain || !this.engineFilter) {
      return;
    }

    const now = this.audioContext.currentTime;
    const runningFactor = running ? 1 : 0;
    const speedFactor = clamp(speed / 60, 0, 1.4);
    const boostFactor = boostActive ? 1 : 0;
    const lowFrequency = 38 + speed * 1.9 + boostFactor * 12;
    const highFrequency = 78 + speed * 4.4 + boostFactor * 18;
    const masterGain = runningFactor * (0.018 + speedFactor * 0.055 + boostFactor * 0.018);

    this.engineLowOscillator.frequency.setTargetAtTime(lowFrequency, now, 0.08);
    this.engineHighOscillator.frequency.setTargetAtTime(highFrequency, now, 0.08);
    this.engineLowGain.gain.setTargetAtTime(masterGain * 0.85, now, 0.08);
    this.engineHighGain.gain.setTargetAtTime(masterGain * 0.42, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(420 + speedFactor * 980 + boostFactor * 180, now, 0.1);
    this.masterGain.gain.setTargetAtTime(running ? 0.92 : 0, now, running ? 0.1 : 0.18);
  }

  playPassBy(relativeSpeed = 0) {
    if (!this.audioContext || this.audioContext.state !== "running" || this.passByCooldown > 0) {
      return;
    }

    const now = this.audioContext.currentTime;
    const strength = clamp(relativeSpeed / 36, 0.35, 1.15);
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(260 + strength * 180, now);
    oscillator.frequency.exponentialRampToValueAtTime(120 + strength * 40, now + 0.22);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(540 + strength * 260, now);
    filter.Q.value = 0.7;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.018 + strength * 0.024, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.26);
    this.passByCooldown = 0.16;
  }

  playNosBurst() {
    if (!this.audioContext || this.audioContext.state !== "running") {
      return;
    }

    const now = this.audioContext.currentTime;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(180, now);
    oscillator.frequency.exponentialRampToValueAtTime(460, now + 0.12);

    filter.type = "highpass";
    filter.frequency.value = 140;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.03, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  updatePolicePulse(delta, policeGap) {
    this.policePulseTimer = Math.max(0, this.policePulseTimer - delta);
    if (!Number.isFinite(policeGap) || policeGap === null || policeGap > 135) {
      return;
    }

    if (this.policePulseTimer > 0) {
      return;
    }

    const intensity = 1 - clamp((policeGap - 16) / 119, 0, 1);
    const duration = Math.round(10 + intensity * 26);
    const gapToNextPulse = 0.9 - intensity * 0.68;
    this.vibrate(duration);
    this.policePulseTimer = gapToNextPulse;
  }

  vibrate(pattern) {
    if (!this.vibrationEnabled || !this.isVibrationSupported()) {
      return;
    }

    navigator.vibrate(pattern);
  }
}
