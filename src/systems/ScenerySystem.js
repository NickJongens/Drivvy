import * as THREE from "three";

const BODY_GEOMETRY = new THREE.BoxGeometry(0.4, 0.16, 0.75);
const WING_GEOMETRY = new THREE.BoxGeometry(0.72, 0.04, 0.22);

function createBird(material, index) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(BODY_GEOMETRY, material);
  group.add(body);

  const leftWing = new THREE.Mesh(WING_GEOMETRY, material);
  leftWing.position.set(-0.34, 0.03, 0);
  group.add(leftWing);

  const rightWing = new THREE.Mesh(WING_GEOMETRY, material);
  rightWing.position.set(0.34, 0.03, 0);
  group.add(rightWing);

  group.userData.leftWing = leftWing;
  group.userData.rightWing = rightWing;
  group.userData.followOffset = new THREE.Vector3(
    THREE.MathUtils.randFloatSpread(0.45),
    THREE.MathUtils.randFloat(-0.15, 0.25),
    -1.5 - index * THREE.MathUtils.randFloat(0.65, 1.05)
  );
  group.userData.phase = Math.random() * Math.PI * 2;
  return group;
}

export class ScenerySystem {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.time = 0;
    this.flocks = [];
    this.birdMaterial = new THREE.MeshStandardMaterial({ color: 0x283044, flatShading: true });

    for (let index = 0; index < 4; index += 1) {
      const flock = this.createFlock(index);
      this.flocks.push(flock);
      this.scene.add(flock.group);
    }
  }

  reset(playerS = 0, routeRef = null) {
    this.time = 0;
    const routeId = this.getRouteId(routeRef);
    this.flocks.forEach((flock, index) => {
      this.respawnFlock(flock, playerS + 140 + index * 70, routeId);
    });
  }

  update(delta, playerS, routeRef = null) {
    this.time += delta;
    const routeId = this.getRouteId(routeRef);

    for (const flock of this.flocks) {
      if (flock.routeId !== routeId || flock.s < playerS - 90 || flock.s > playerS + 560) {
        this.respawnFlock(flock, playerS + 220 + Math.random() * 220, routeId);
      }

      flock.s += flock.speed * delta;
      flock.targetTimer -= delta;
      if (flock.targetTimer <= 0) {
        flock.targetTimer = 1.1 + Math.random() * 1.8;
        flock.lateralTarget = THREE.MathUtils.clamp(
          flock.lateral + THREE.MathUtils.randFloatSpread(18),
          -34,
          34
        );
        flock.altitudeTarget = THREE.MathUtils.clamp(
          flock.altitude + THREE.MathUtils.randFloatSpread(5),
          11,
          25
        );
        flock.speedTarget = THREE.MathUtils.clamp(
          flock.speed + THREE.MathUtils.randFloatSpread(4),
          10,
          20
        );
      }

      flock.lateral = THREE.MathUtils.damp(flock.lateral, flock.lateralTarget, 2.1, delta);
      flock.altitude = THREE.MathUtils.damp(flock.altitude, flock.altitudeTarget, 1.8, delta);
      flock.speed = THREE.MathUtils.damp(flock.speed, flock.speedTarget, 1.6, delta);

      const sample = this.track.sample(flock.s, flock.lateral, flock.routeId);
      flock.group.position.copy(sample.position);
      flock.group.position.y += flock.altitude;

      const lookTarget = sample.position
        .clone()
        .addScaledVector(sample.tangent, 14)
        .addScaledVector(sample.right, flock.lateralDrift + Math.sin(this.time * 0.8 + flock.phase) * 3.5);
      lookTarget.y += flock.altitude + Math.sin(this.time * 1.3 + flock.phase) * 1.4;
      flock.group.lookAt(lookTarget);
      flock.group.rotateX(0.05);

      const leader = flock.birds[0];
      leader.position.lerp(
        new THREE.Vector3(
          Math.sin(this.time * 1.7 + flock.phase) * 0.2,
          Math.sin(this.time * 2.3 + flock.phase) * 0.24,
          0
        ),
        1 - Math.exp(-delta * 6.5)
      );

      for (let index = 1; index < flock.birds.length; index += 1) {
        const bird = flock.birds[index];
        const previousBird = flock.birds[index - 1];
        const target = previousBird.position
          .clone()
          .add(bird.userData.followOffset)
          .add(
            new THREE.Vector3(
              Math.sin(this.time * 1.4 + bird.userData.phase) * 0.18,
              Math.cos(this.time * 1.8 + bird.userData.phase) * 0.16,
              0
            )
          );
        bird.position.lerp(target, 1 - Math.exp(-delta * (3.4 - index * 0.3)));
      }

      flock.birds.forEach((bird, index) => {
        const flap = Math.sin(this.time * 12 + flock.phase + bird.userData.phase + index * 0.35) * 0.58;
        bird.userData.leftWing.rotation.z = flap;
        bird.userData.rightWing.rotation.z = -flap;
      });
    }
  }

  createFlock(seed) {
    const group = new THREE.Group();
    const birds = [];
    const count = 3 + (seed % 2);

    for (let index = 0; index < count; index += 1) {
      const bird = createBird(this.birdMaterial, index);
      group.add(bird);
      birds.push(bird);
    }

    return {
      group,
      birds,
      routeId: "main",
      s: 0,
      lateral: 24,
      lateralTarget: 24,
      altitude: 16,
      altitudeTarget: 16,
      speed: 14,
      speedTarget: 14,
      targetTimer: 1.5,
      lateralDrift: THREE.MathUtils.randFloatSpread(8),
      phase: Math.random() * Math.PI * 2,
    };
  }

  respawnFlock(flock, startS, routeId) {
    flock.routeId = routeId;
    flock.s = startS;
    flock.lateral = THREE.MathUtils.randFloatSpread(28);
    flock.lateralTarget = flock.lateral;
    flock.altitude = 12 + Math.random() * 9;
    flock.altitudeTarget = flock.altitude;
    flock.speed = 11 + Math.random() * 6;
    flock.speedTarget = flock.speed;
    flock.targetTimer = 0.8 + Math.random() * 1.5;
    flock.lateralDrift = THREE.MathUtils.randFloatSpread(10);
    flock.phase = Math.random() * Math.PI * 2;

    flock.birds.forEach((bird, index) => {
      bird.position.set(
        bird.userData.followOffset.x * index * 0.4,
        bird.userData.followOffset.y,
        bird.userData.followOffset.z
      );
    });
  }

  getRouteId(routeRef = null) {
    if (typeof routeRef === "string") {
      return routeRef || "main";
    }

    return routeRef?.branchId || "main";
  }
}
