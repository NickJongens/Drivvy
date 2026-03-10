import * as THREE from "three";

const WEATHER_PRESETS = [
  {
    id: "night",
    label: "Night",
    grip: 0.94,
    visibility: 0.74,
    fogColor: 0x101925,
    fogDensity: 0.0048,
    ambient: 0.42,
    sunlight: 0.16,
    particleRate: 0,
    trafficModifier: 1.08,
    speedFactor: 0.97,
    skyColor: 0x08111c,
    particleType: "none",
    nightLevel: 1,
  },
  {
    id: "clear",
    label: "Clear",
    grip: 1,
    visibility: 1,
    fogColor: 0x89b2cf,
    fogDensity: 0.0018,
    ambient: 1.35,
    sunlight: 1.1,
    particleRate: 0,
    trafficModifier: 0.9,
    speedFactor: 1,
    skyColor: 0x89b2cf,
    particleType: "none",
    nightLevel: 0,
  },
  {
    id: "rain",
    label: "Rain",
    grip: 0.8,
    visibility: 0.88,
    fogColor: 0x6c8396,
    fogDensity: 0.0036,
    ambient: 1.02,
    sunlight: 0.58,
    particleRate: 0.95,
    trafficModifier: 1.15,
    speedFactor: 0.92,
    skyColor: 0x6b7b87,
    particleType: "rain",
    nightLevel: 0,
  },
  {
    id: "fog",
    label: "Fog",
    grip: 0.88,
    visibility: 0.66,
    fogColor: 0xc6d1d8,
    fogDensity: 0.011,
    ambient: 1.08,
    sunlight: 0.34,
    particleRate: 0.12,
    trafficModifier: 1.05,
    speedFactor: 0.9,
    skyColor: 0xbcc8cf,
    particleType: "mist",
    nightLevel: 0,
  },
  {
    id: "snow",
    label: "Snow",
    grip: 0.68,
    visibility: 0.78,
    fogColor: 0xd8e0e6,
    fogDensity: 0.0078,
    ambient: 1.16,
    sunlight: 0.6,
    particleRate: 0.7,
    trafficModifier: 1.02,
    speedFactor: 0.82,
    skyColor: 0xcfdce4,
    particleType: "snow",
    nightLevel: 0,
  },
  {
    id: "ice",
    label: "Ice",
    grip: 0.6,
    visibility: 0.86,
    fogColor: 0xbac7d0,
    fogDensity: 0.0065,
    ambient: 1.02,
    sunlight: 0.56,
    particleRate: 0.14,
    trafficModifier: 1.08,
    speedFactor: 0.9,
    skyColor: 0xbfd0da,
    particleType: "mist",
    nightLevel: 0,
  },
];

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.highContrast = false;
    this.colorAssist = false;
    this.transitionDuration = 6;
    this.holdDuration = 20;
    this.sequence = [0, 1, 2, 1, 3, 1, 4, 1, 5, 1, 0];
    this.maxParticles = 700;
    this.particleBudget = this.maxParticles;
    this.localOffsets = new Float32Array(this.maxParticles * 3);
    this.positions = new Float32Array(this.maxParticles * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 0);

    this.particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.22,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(geometry, this.particleMaterial);
    this.scene.add(this.particles);

    this.reset();
  }

  setAccessibility({ highContrast = false, colorAssist = false } = {}) {
    this.highContrast = Boolean(highContrast);
    this.colorAssist = Boolean(colorAssist);
  }

  setQuality({ particleBudget = this.maxParticles } = {}) {
    this.particleBudget = THREE.MathUtils.clamp(
      Math.floor(particleBudget),
      0,
      this.maxParticles
    );
  }

  reset() {
    this.sequenceIndex = 0;
    this.currentIndex = this.sequence[this.sequenceIndex];
    this.nextIndex = this.sequence[(this.sequenceIndex + 1) % this.sequence.length];
    this.phaseTime = 0;
    this.transitionTime = 0;
    this.isTransitioning = false;
    this.active = { ...WEATHER_PRESETS[this.currentIndex] };
    this.time = 0;

    for (let index = 0; index < this.maxParticles; index += 1) {
      this.respawnParticle(index, "rain");
    }
  }

  update(delta) {
    this.time += delta;

    if (!this.isTransitioning) {
      this.phaseTime += delta;
      if (this.phaseTime >= this.holdDuration) {
        this.phaseTime = 0;
        this.transitionTime = 0;
        this.isTransitioning = true;
        this.nextIndex = this.pickNextIndex();
      }
    } else {
      this.transitionTime += delta;
      if (this.transitionTime >= this.transitionDuration) {
        this.currentIndex = this.nextIndex;
        this.isTransitioning = false;
        this.transitionTime = 0;
      }
    }

    const source = WEATHER_PRESETS[this.currentIndex];
    const target = this.isTransitioning ? WEATHER_PRESETS[this.nextIndex] : source;
    const blend = this.isTransitioning
      ? THREE.MathUtils.smoothstep(this.transitionTime / this.transitionDuration, 0, 1)
      : 0;

    this.active = this.blendPresets(source, target, blend);
    return this.active;
  }

  applyVisuals(anchorSample, weather, skyLight, sunLight, delta) {
    if (!anchorSample) {
      return;
    }

    const adjustedFogDensity = this.highContrast ? weather.fogDensity * 0.55 : weather.fogDensity;
    const backgroundColor = new THREE.Color(weather.skyColor);
    const fogColor = new THREE.Color(weather.fogColor);
    if (this.highContrast) {
      backgroundColor.lerp(new THREE.Color(0xf3f8ff), 0.16);
      fogColor.lerp(new THREE.Color(0xffffff), 0.12);
    }
    if (this.colorAssist) {
      backgroundColor.offsetHSL(0.02, 0.08, 0.02);
    }

    this.scene.background.copy(backgroundColor);

    if (!this.scene.fog) {
      this.scene.fog = new THREE.FogExp2(fogColor.getHex(), adjustedFogDensity);
    }

    this.scene.fog.color.copy(fogColor);
    this.scene.fog.density = adjustedFogDensity;
    skyLight.intensity = this.highContrast ? weather.ambient + 0.18 : weather.ambient;
    sunLight.intensity = this.highContrast ? weather.sunlight + 0.12 : weather.sunlight;
    const nightLevel = weather.nightLevel || 0;
    skyLight.color.copy(new THREE.Color(0xd9efff).lerp(new THREE.Color(0x90a8d6), nightLevel));
    skyLight.groundColor.copy(new THREE.Color(0x304534).lerp(new THREE.Color(0x111820), nightLevel));
    sunLight.color.copy(new THREE.Color(0xffefcf).lerp(new THREE.Color(0x91b3ff), nightLevel));

    const particleType = weather.particleType;
    const particleCount = Math.floor(this.particleBudget * weather.particleRate);
    const geometry = this.particles.geometry;
    geometry.setDrawRange(0, particleCount);

    if (particleType === "none") {
      this.particles.visible = false;
      return;
    }

    this.particles.visible = true;
    this.particleMaterial.size = particleType === "rain" ? 0.18 : particleType === "snow" ? 0.28 : 0.38;
    this.particleMaterial.opacity = this.highContrast
      ? particleType === "mist" ? 0.14 : 0.68
      : particleType === "mist" ? 0.26 : 0.86;
    this.particleMaterial.color.set(
      this.colorAssist
        ? particleType === "rain"
          ? 0x74f0ff
          : particleType === "snow"
            ? 0xffffff
            : 0xfafad2
        : particleType === "rain"
          ? 0xbadfff
          : particleType === "snow"
            ? 0xffffff
            : 0xe7ecef
    );

    const forward = anchorSample.tangent;
    const right = anchorSample.right;

    for (let index = 0; index < particleCount; index += 1) {
      const offsetIndex = index * 3;

      if (particleType === "rain") {
        this.localOffsets[offsetIndex + 1] -= delta * 34;
        this.localOffsets[offsetIndex + 2] -= delta * 52;
        this.localOffsets[offsetIndex] += delta * 4;
      } else if (particleType === "snow") {
        this.localOffsets[offsetIndex + 1] -= delta * 7;
        this.localOffsets[offsetIndex + 2] -= delta * 9;
        this.localOffsets[offsetIndex] += Math.sin(this.time * 1.5 + index) * delta * 1.8;
      } else {
        this.localOffsets[offsetIndex + 1] += Math.sin(this.time + index * 0.15) * delta * 0.2;
        this.localOffsets[offsetIndex + 2] -= delta * 4;
        this.localOffsets[offsetIndex] += Math.cos(this.time * 0.8 + index) * delta * 0.3;
      }

      const outOfRange =
        this.localOffsets[offsetIndex + 1] < -2 ||
        this.localOffsets[offsetIndex + 1] > 26 ||
        this.localOffsets[offsetIndex + 2] < -30 ||
        this.localOffsets[offsetIndex + 2] > 48 ||
        this.localOffsets[offsetIndex] < -22 ||
        this.localOffsets[offsetIndex] > 22;

      if (outOfRange) {
        this.respawnParticle(index, particleType);
      }

      const px = this.localOffsets[offsetIndex];
      const py = this.localOffsets[offsetIndex + 1];
      const pz = this.localOffsets[offsetIndex + 2];

      this.positions[offsetIndex] = anchorSample.position.x + right.x * px + forward.x * pz;
      this.positions[offsetIndex + 1] = anchorSample.position.y + py;
      this.positions[offsetIndex + 2] = anchorSample.position.z + right.z * px + forward.z * pz;
    }

    geometry.attributes.position.needsUpdate = true;
  }

  getCurrent() {
    return this.active;
  }

  blendPresets(source, target, blend) {
    const sourceFog = new THREE.Color(source.fogColor);
    const targetFog = new THREE.Color(target.fogColor);
    const sourceSky = new THREE.Color(source.skyColor);
    const targetSky = new THREE.Color(target.skyColor);

    return {
      id: blend < 0.5 ? source.id : target.id,
      label: blend < 0.5 ? source.label : target.label,
      grip: THREE.MathUtils.lerp(source.grip, target.grip, blend),
      visibility: THREE.MathUtils.lerp(source.visibility, target.visibility, blend),
      fogColor: sourceFog.lerp(targetFog, blend).getHex(),
      fogDensity: THREE.MathUtils.lerp(source.fogDensity, target.fogDensity, blend),
      ambient: THREE.MathUtils.lerp(source.ambient, target.ambient, blend),
      sunlight: THREE.MathUtils.lerp(source.sunlight, target.sunlight, blend),
      particleRate: THREE.MathUtils.lerp(source.particleRate, target.particleRate, blend),
      trafficModifier: THREE.MathUtils.lerp(source.trafficModifier, target.trafficModifier, blend),
      speedFactor: THREE.MathUtils.lerp(source.speedFactor, target.speedFactor, blend),
      skyColor: sourceSky.lerp(targetSky, blend).getHex(),
      particleType: blend < 0.5 ? source.particleType : target.particleType,
      nightLevel: THREE.MathUtils.lerp(source.nightLevel || 0, target.nightLevel || 0, blend),
    };
  }

  respawnParticle(index, particleType) {
    const offsetIndex = index * 3;
    this.localOffsets[offsetIndex] = THREE.MathUtils.randFloatSpread(36);
    this.localOffsets[offsetIndex + 1] = 4 + Math.random() * 22;
    this.localOffsets[offsetIndex + 2] = THREE.MathUtils.randFloat(-12, 40);

    if (particleType === "mist") {
      this.localOffsets[offsetIndex] = THREE.MathUtils.randFloatSpread(20);
      this.localOffsets[offsetIndex + 1] = 1 + Math.random() * 9;
      this.localOffsets[offsetIndex + 2] = THREE.MathUtils.randFloat(-18, 28);
    }
  }

  pickNextIndex() {
    this.sequenceIndex = (this.sequenceIndex + 1) % this.sequence.length;
    return this.sequence[this.sequenceIndex];
  }
}
