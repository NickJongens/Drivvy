import * as THREE from "three";
import { createBus, createPoliceCar, createRivalCar, createTaxiCar, createTrafficCar } from "./VehicleFactory.js";
import { LANE_WIDTH, ROAD_WIDTH } from "../world/TrackManager.js";

const LANE_OFFSETS = [-LANE_WIDTH, 0, LANE_WIDTH];
const POLICE_ESCAPE_DISTANCE = 260;
const POLICE_SPAWN_INTERVAL = 920;
const RACER_SPAWN_INTERVAL = 520;

export class TrafficSystem {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.vehicles = [];
    this.routeSpawnCursor = new Map();
    this.nextTrafficLaneChangeAt = new Map();
    this.nextPoliceSpawnS = 240;
    this.nextRacerSpawnS = 120;
    this.time = 0;
  }

  reset(playerS = 0) {
    for (const vehicle of this.vehicles) {
      this.scene.remove(vehicle.mesh);
    }

    this.vehicles = [];
    this.routeSpawnCursor = new Map([["main", playerS + 96]]);
    this.nextTrafficLaneChangeAt = new Map([["main", 0]]);
    this.nextPoliceSpawnS = playerS + 180 + Math.random() * 120;
    this.nextRacerSpawnS = playerS + 110 + Math.random() * 80;
    this.time = 0;
  }

  update(delta, player, weather) {
    this.time += delta;
    const activeRouteId = player.route.branchId || "main";
    const policeCount = this.countVehiclesOnRoute(activeRouteId, "police");
    const trafficPulse = Math.max(0, Math.sin(this.time * 0.12 + 0.8)) * 0.85;
    const trafficTarget = Math.max(5, Math.round(5.6 + weather.trafficModifier * 2.2 + trafficPulse) - policeCount);
    const spawnHorizon = player.s + 290 + weather.visibility * 110;
    let spawnCursor = this.routeSpawnCursor.get(activeRouteId) ?? player.s + 90;
    let attempts = 0;

    while (
      (this.countStandardTraffic(activeRouteId) < trafficTarget || spawnCursor < spawnHorizon) &&
      attempts < 16
    ) {
      spawnCursor = this.spawnTrafficVehicle(player, weather, activeRouteId, spawnCursor);
      attempts += 1;
    }
    this.routeSpawnCursor.set(activeRouteId, spawnCursor);
    this.ensureVisibleTrafficAhead(player, weather, activeRouteId);

    const racerTarget = activeRouteId === "main" ? (player.s > 900 ? 2 : 1) : 0;
    if (activeRouteId === "main" && this.countVehiclesOnRoute(activeRouteId, "racer") < racerTarget && player.s >= this.nextRacerSpawnS) {
      if (this.spawnRacer(player, activeRouteId)) {
        this.nextRacerSpawnS = player.s + (player.s > 900 ? 430 : RACER_SPAWN_INTERVAL) + Math.random() * 180;
      }
    }

    if (activeRouteId === "main" && policeCount < 1 && player.s >= this.nextPoliceSpawnS) {
      if (this.spawnPoliceTrap(player)) {
        this.nextPoliceSpawnS = player.s + POLICE_SPAWN_INTERVAL + Math.random() * 220;
      }
    }

    const routes = this.groupVehiclesByRoute();
    for (const vehicles of routes.values()) {
      vehicles.sort((vehicleA, vehicleB) => vehicleA.s - vehicleB.s);
      this.planLaneChanges(vehicles, player);
    }

    for (let index = this.vehicles.length - 1; index >= 0; index -= 1) {
      const vehicle = this.vehicles[index];
      vehicle.laneChangeCooldown = Math.max(0, vehicle.laneChangeCooldown - delta);

      if (vehicle.kind === "police") {
        this.updatePoliceVehicle(vehicle, player, weather);
      }

      const brakeLightAmount = THREE.MathUtils.clamp(
        (vehicle.speed - vehicle.desiredSpeed) / (vehicle.kind === "bus" ? 5.5 : vehicle.kind === "police" ? 6.5 : 7.5),
        0,
        1
      );

      const speedResponse =
        vehicle.kind === "bus" ? 1.7 : vehicle.kind === "racer" ? 3 : vehicle.kind === "police" ? 2.7 : 2.2;
      vehicle.speed += (vehicle.desiredSpeed - vehicle.speed) * Math.min(delta * speedResponse, 1);
      vehicle.speed = Math.max(vehicle.speed, vehicle.kind === "bus" ? 8 : vehicle.kind === "police" ? 0 : 6);
      vehicle.s += vehicle.speed * delta;

      const targetOffset = vehicle.laneTargetOffset ?? LANE_OFFSETS[vehicle.targetLaneIndex];
      const laneLerp =
        vehicle.kind === "bus" ? 1.7 : vehicle.kind === "racer" ? 4 : vehicle.kind === "police" ? 3.2 : 2.9;
      vehicle.laneOffset += (targetOffset - vehicle.laneOffset) * Math.min(delta * laneLerp, 1);

      if (vehicle.laneTargetOffset === null && Math.abs(vehicle.laneOffset - LANE_OFFSETS[vehicle.targetLaneIndex]) < 0.08) {
        vehicle.laneIndex = vehicle.targetLaneIndex;
      }

      if (vehicle.kind === "police") {
        this.updateEmergencyLights(vehicle, delta);
      }
      vehicle.mesh.userData.setNightLights?.((weather.nightLevel || 0) > 0.08, weather.nightLevel || 0);
      vehicle.mesh.userData.setBrakeLights?.(vehicle.kind === "police" && vehicle.mode === "parked" ? 1 : brakeLightAmount);

      if (this.shouldDespawnVehicle(vehicle, player)) {
        this.scene.remove(vehicle.mesh);
        this.vehicles.splice(index, 1);
        continue;
      }

      const extraRoll = vehicle.kind === "police" && vehicle.mode === "parked" ? vehicle.shoulderSide * 0.08 : 0;
      this.track.placeAlongTrack(vehicle.mesh, vehicle.s, vehicle.laneOffset, vehicle.height, extraRoll, vehicle.routeId);
    }
  }

  updatePoliceVehicle(vehicle, player, weather) {
    const playerLaneIndex = this.getNearestLaneIndex(player.laneOffset);
    const forwardGap = player.s - vehicle.s;
    const maxNonBoostSpeed = Math.max(player.baseCruiseSpeed + 10, player.baseMaxSpeed * weather.speedFactor - 1.2);

    if (vehicle.mode === "parked") {
      vehicle.desiredSpeed = 0;
      vehicle.lightsActive = forwardGap > -52;
      vehicle.laneTargetOffset = vehicle.shoulderOffset;

      if (forwardGap > 8) {
        vehicle.mode = "merging";
        vehicle.lightsActive = true;
        vehicle.targetLaneIndex = vehicle.shoulderSide > 0 ? 2 : 0;
        vehicle.laneTargetOffset = null;
        vehicle.laneChangeCooldown = 0.45;
      }
      return;
    }

    if (vehicle.mode === "merging") {
      vehicle.lightsActive = true;
      vehicle.targetLaneIndex = vehicle.shoulderSide > 0 ? 2 : 0;
      vehicle.laneTargetOffset = null;
      vehicle.desiredSpeed = THREE.MathUtils.clamp(player.speed + 2.2 + Math.max(0, forwardGap * 0.04), 22, maxNonBoostSpeed);

      if (Math.abs(vehicle.laneOffset - LANE_OFFSETS[vehicle.targetLaneIndex]) < 0.32) {
        vehicle.mode = "chasing";
        vehicle.shadowPhase = Math.random() * Math.PI * 2;
      }
      return;
    }

    vehicle.lightsActive = true;
    vehicle.laneTargetOffset = null;

    if (forwardGap > 0 && vehicle.laneChangeCooldown <= 0) {
      const targetLaneIndex = playerLaneIndex;
      if (
        targetLaneIndex !== vehicle.targetLaneIndex &&
        this.isLaneAvailable(vehicle.routeId, targetLaneIndex, vehicle.s, 20, 12, vehicle)
      ) {
        vehicle.targetLaneIndex = targetLaneIndex;
        vehicle.laneChangeCooldown = 0.5;
      }
    }

    if (
      forwardGap < 18 &&
      Math.abs(vehicle.laneOffset - player.laneOffset) < LANE_WIDTH * 0.65 &&
      vehicle.laneChangeCooldown <= 0
    ) {
      const shadowLane = this.pickLaneAwayFrom(vehicle, playerLaneIndex, 18, 12);
      if (shadowLane !== vehicle.targetLaneIndex) {
        vehicle.targetLaneIndex = shadowLane;
        vehicle.laneChangeCooldown = 0.65;
      }
    }

    const rhythm = (Math.sin(this.time * 0.75 + (vehicle.shadowPhase || 0)) + 1) * 0.5;
    const desiredGap = 10 + rhythm * 4.4;
    let chaseSpeed = THREE.MathUtils.clamp(player.speed * 0.88 + 5.4, 23, maxNonBoostSpeed);

    if (forwardGap > desiredGap + 14) {
      chaseSpeed = maxNonBoostSpeed;
    } else if (forwardGap > desiredGap + 6) {
      chaseSpeed = Math.min(maxNonBoostSpeed, THREE.MathUtils.clamp(player.speed * 0.95 + 4.8, 24, maxNonBoostSpeed));
    } else if (forwardGap > desiredGap - 2) {
      chaseSpeed = Math.min(maxNonBoostSpeed, THREE.MathUtils.clamp(player.speed * 0.9 + 3.2 - rhythm * 0.35, 23, maxNonBoostSpeed));
    } else {
      chaseSpeed = THREE.MathUtils.clamp(
        player.speed * 0.84 + 2.1 - rhythm * 0.75,
        21.5,
        Math.max(player.baseCruiseSpeed + 10, maxNonBoostSpeed - 5)
      );
    }

    vehicle.desiredSpeed = chaseSpeed;
  }

  updateEmergencyLights(vehicle, delta) {
    const emergencyLights = vehicle.mesh.userData.emergencyLights;
    if (!emergencyLights) {
      return;
    }

    if (!vehicle.lightsActive) {
      emergencyLights.redMaterial.emissiveIntensity = 0.16;
      emergencyLights.blueMaterial.emissiveIntensity = 0.16;
      emergencyLights.redGlow.intensity = 0;
      emergencyLights.blueGlow.intensity = 0;
      return;
    }

    vehicle.flashTime = (vehicle.flashTime || 0) + delta * 8;
    const redOn = Math.floor(vehicle.flashTime) % 2 === 0;
    emergencyLights.redMaterial.emissiveIntensity = redOn ? 1.65 : 0.18;
    emergencyLights.blueMaterial.emissiveIntensity = redOn ? 0.18 : 1.65;
    emergencyLights.redGlow.intensity = redOn ? 1.9 : 0.08;
    emergencyLights.blueGlow.intensity = redOn ? 0.08 : 1.9;
  }

  shouldDespawnVehicle(vehicle, player) {
    if (vehicle.kind === "police") {
      if (vehicle.mode === "parked") {
        return vehicle.s < player.s - 36;
      }

      return player.s - vehicle.s > POLICE_ESCAPE_DISTANCE || vehicle.s > player.s + 110;
    }

    if (vehicle.kind === "racer") {
      return vehicle.s < player.s - 110 || vehicle.s > player.s + 360;
    }

    return vehicle.s < player.s - 80;
  }

  checkCollision(player) {
    return this.vehicles.some((vehicle) => {
      if (vehicle.kind === "racer") {
        return false;
      }

      if (vehicle.routeId !== (player.route.branchId || "main")) {
        return false;
      }

      const distanceOverlap = Math.abs(vehicle.s - player.s) < (vehicle.length + player.length) * 0.5;
      const lateralOverlap = Math.abs(vehicle.laneOffset - player.laneOffset) < (vehicle.width + player.width) * 0.55;
      return distanceOverlap && lateralOverlap;
    });
  }

  getClosestVehicleAhead(routeId, s, laneOffset, laneTolerance = LANE_WIDTH * 0.72) {
    let closestVehicle = null;
    let closestGap = Number.POSITIVE_INFINITY;

    for (const vehicle of this.vehicles) {
      if (vehicle.routeId !== routeId) {
        continue;
      }

      const gap = vehicle.s - s;
      if (gap <= 0 || Math.abs(vehicle.laneOffset - laneOffset) > laneTolerance) {
        continue;
      }

      if (gap < closestGap) {
        closestGap = gap;
        closestVehicle = vehicle;
      }
    }

    return closestVehicle ? { vehicle: closestVehicle, gap: closestGap } : null;
  }

  getLaneMetrics(routeId, laneIndex, s, ignoreVehicle = null) {
    const laneOffset = LANE_OFFSETS[laneIndex];
    let aheadGap = Number.POSITIVE_INFINITY;
    let behindGap = Number.POSITIVE_INFINITY;
    let aheadVehicle = null;

    for (const vehicle of this.vehicles) {
      if (vehicle.routeId !== routeId || vehicle === ignoreVehicle) {
        continue;
      }

      if (Math.abs(vehicle.laneOffset - laneOffset) > LANE_WIDTH * 0.72) {
        continue;
      }

      const gap = vehicle.s - s;
      if (gap >= 0 && gap < aheadGap) {
        aheadGap = gap;
        aheadVehicle = vehicle;
      }

      if (gap < 0 && Math.abs(gap) < behindGap) {
        behindGap = Math.abs(gap);
      }
    }

    return { aheadGap, behindGap, aheadVehicle };
  }

  isLaneAvailable(routeId, laneIndex, s, aheadDistance = 30, behindDistance = 18, ignoreVehicle = null) {
    const metrics = this.getLaneMetrics(routeId, laneIndex, s, ignoreVehicle);
    return metrics.aheadGap > aheadDistance && metrics.behindGap > behindDistance;
  }

  getNearestLaneIndex(laneOffset) {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < LANE_OFFSETS.length; index += 1) {
      const distance = Math.abs(LANE_OFFSETS[index] - laneOffset);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }

    return nearestIndex;
  }

  spawnTrafficVehicle(player, weather, routeId, spawnCursor, options = {}) {
    const minAhead = options.minAhead ?? 100;
    const baseOffset = options.baseOffset ?? 24;
    const jitter = options.jitter ?? 46;
    const spawnS = Math.max(spawnCursor, player.s + minAhead) + baseOffset + Math.random() * jitter;
    const roll = Math.random();
    const laneMetrics = LANE_OFFSETS.map((_, laneIndex) => this.getLaneMetrics(routeId, laneIndex, player.s));
    const aheadGaps = laneMetrics.map((metrics) => metrics.aheadGap);
    const openLaneIndex = aheadGaps.indexOf(Math.max(...aheadGaps));
    if (aheadGaps[openLaneIndex] < 96) {
      return spawnS + 18;
    }

    const preferredLanes = [0, 1, 2].filter((laneIndex) => laneIndex !== openLaneIndex);
    const lanePool = preferredLanes.length ? preferredLanes : [openLaneIndex];
    const laneIndex = lanePool[Math.floor(Math.random() * lanePool.length)];

    let kind = "civilian";
    let mesh = createTrafficCar();
    let cruiseSpeed = 18 + Math.random() * 14 + weather.visibility * 2;
    let width = 2.35;
    let length = 4.75;
    let height = 0.72;
    let sameLaneGap = 84;
    let localSpacing = 52;

    if (roll < 0.16) {
      kind = "bus";
      mesh = createBus();
      cruiseSpeed = 13 + Math.random() * 5 + weather.visibility;
      width = 2.86;
      length = 9.8;
      height = 0.9;
      sameLaneGap = 110;
      localSpacing = 64;
    } else if (roll < 0.36) {
      kind = "taxi";
      mesh = createTaxiCar();
      cruiseSpeed = 20 + Math.random() * 10 + weather.visibility * 1.5;
      width = 2.36;
      length = 4.82;
      height = 0.74;
      sameLaneGap = 90;
      localSpacing = 56;
    }

    if (!this.canPlace(spawnS, laneIndex, routeId, sameLaneGap, localSpacing)) {
      return spawnS;
    }

    const vehicle = {
      kind,
      mesh,
      s: spawnS,
      laneIndex,
      targetLaneIndex: laneIndex,
      laneOffset: LANE_OFFSETS[laneIndex],
      laneTargetOffset: null,
      speed: cruiseSpeed,
      desiredSpeed: cruiseSpeed,
      cruiseSpeed,
      width,
      length,
      height,
      routeId,
      laneChangeCooldown: 0,
    };

    this.vehicles.push(vehicle);
    this.scene.add(mesh);
    this.track.placeAlongTrack(mesh, vehicle.s, vehicle.laneOffset, vehicle.height, 0, routeId);
    return spawnS;
  }

  spawnRacer(player, routeId) {
    const playerLaneIndex = this.getNearestLaneIndex(player.laneOffset);
    const laneCandidates = [playerLaneIndex, Math.max(0, playerLaneIndex - 1), Math.min(2, playerLaneIndex + 1)];
    const spawnBehind = Math.random() < 0.2;
    const spawnS = spawnBehind
      ? Math.max(10, player.s - (54 + Math.random() * 26))
      : player.s + 96 + Math.random() * 70;

    const laneIndex =
      laneCandidates.find((candidate) => this.canPlace(spawnS, candidate, routeId, 54, 28)) ??
      Math.floor(Math.random() * LANE_OFFSETS.length);

    if (laneIndex === playerLaneIndex && Math.abs(spawnS - player.s) < 34) {
      return false;
    }

    if (!this.canPlace(spawnS, laneIndex, routeId, 54, 28)) {
      return false;
    }

    const mesh = createRivalCar(`${this.time.toFixed(2)}-${laneIndex}-${spawnS.toFixed(0)}`);
    const cruiseSpeed = Math.max(20, player.speed - (spawnBehind ? 2.2 : 1.6) - Math.random() * 2.4);
    const vehicle = {
      kind: "racer",
      mesh,
      s: spawnS,
      laneIndex,
      targetLaneIndex: laneIndex,
      laneOffset: LANE_OFFSETS[laneIndex],
      laneTargetOffset: null,
      speed: cruiseSpeed,
      desiredSpeed: cruiseSpeed,
      cruiseSpeed,
      width: 2.4,
      length: 4.9,
      height: 0.76,
      routeId,
      laneChangeCooldown: 0.3,
    };

    this.vehicles.push(vehicle);
    this.scene.add(mesh);
    this.track.placeAlongTrack(mesh, vehicle.s, vehicle.laneOffset, vehicle.height, 0, routeId);
    return true;
  }

  spawnPoliceTrap(player) {
    const routeId = player.route.branchId || "main";
    const shoulderSide = Math.random() < 0.5 ? -1 : 1;
    const laneIndex = shoulderSide > 0 ? 2 : 0;
    const spawnS = player.s + 118 + Math.random() * 56;

    if (!this.canPlace(spawnS, laneIndex, routeId, 92, 52)) {
      return false;
    }

    const shoulderOffset = shoulderSide * (ROAD_WIDTH * 0.5 + 2.7);
    const mesh = createPoliceCar();
    const vehicle = {
      kind: "police",
      mesh,
      s: spawnS,
      laneIndex,
      targetLaneIndex: laneIndex,
      laneOffset: shoulderOffset,
      laneTargetOffset: shoulderOffset,
      speed: 0,
      desiredSpeed: 0,
      cruiseSpeed: 46,
      width: 2.42,
      length: 4.9,
      height: 0.72,
      routeId,
      laneChangeCooldown: 0,
      flashTime: Math.random() * 2,
      mode: "parked",
      lightsActive: false,
      shoulderSide,
      shoulderOffset,
    };

    this.vehicles.push(vehicle);
    this.scene.add(mesh);
    this.track.placeAlongTrack(mesh, vehicle.s, vehicle.laneOffset, vehicle.height, shoulderSide * 0.08, routeId);
    return true;
  }

  canPlace(spawnS, laneIndex, routeId, minSameLaneGap = 62, localSpacing = 34) {
    let nearbyCount = 0;

    for (const vehicle of this.vehicles) {
      if (vehicle.routeId !== routeId) {
        continue;
      }

      const gap = Math.abs(vehicle.s - spawnS);
      if (vehicle.laneIndex === laneIndex && gap < minSameLaneGap) {
        return false;
      }

      if (gap < localSpacing) {
        nearbyCount += 1;
      }
    }

    return nearbyCount < 1;
  }

  planLaneChanges(vehicles, player) {
    for (const vehicle of vehicles) {
      if (vehicle.kind === "police") {
        continue;
      }

      const currentMetrics = this.getLaneMetrics(vehicle.routeId, vehicle.laneIndex, vehicle.s, vehicle);
      const policeBehind = this.findPoliceBehind(vehicle.routeId, vehicle.s, vehicle.laneIndex);
      const isBus = vehicle.kind === "bus";
      const isTaxi = vehicle.kind === "taxi";
      const isRacer = vehicle.kind === "racer";
      const playerGap = vehicle.s - player.s;
      const nearPlayerLane = Math.abs(vehicle.laneOffset - player.laneOffset) < LANE_WIDTH * 0.68;
      const canLaneChangeNow = this.canTriggerTrafficLaneChange(vehicle.routeId);
      let desiredSpeed = vehicle.cruiseSpeed;

      if (policeBehind && policeBehind.gap < 34 && vehicle.laneChangeCooldown <= 0 && canLaneChangeNow) {
        const yieldLane = this.pickYieldLane(vehicle, policeBehind.laneIndex);
        if (yieldLane !== vehicle.laneIndex) {
          this.commitTrafficLaneChange(vehicle, yieldLane, isBus ? 1.5 : 1);
        }
      } else if (currentMetrics.aheadVehicle) {
        const gap = currentMetrics.aheadGap;
        const laneChangeTrigger = isRacer ? 68 : isTaxi ? 54 : isBus ? 38 : 46;

        if (!isBus && gap < laneChangeTrigger && vehicle.laneChangeCooldown <= 0 && canLaneChangeNow) {
          const laneChoice = this.pickLaneForVehicle(vehicle, currentMetrics.aheadGap);
          if (laneChoice !== vehicle.laneIndex) {
            this.commitTrafficLaneChange(vehicle, laneChoice, isRacer ? 1 : isTaxi ? 1.05 : 1.2);
          }
        }

        if (isRacer) {
          if (gap < 18) {
            desiredSpeed = Math.min(desiredSpeed, currentMetrics.aheadVehicle.speed - 1);
          } else if (gap < 42) {
            desiredSpeed = Math.min(desiredSpeed, currentMetrics.aheadVehicle.speed + 1.5);
          }
        } else if (isBus) {
          if (gap < 38) {
            desiredSpeed = Math.min(desiredSpeed, currentMetrics.aheadVehicle.speed * 0.72);
          } else if (gap < 62) {
            desiredSpeed = Math.min(desiredSpeed, currentMetrics.aheadVehicle.speed * 0.84);
          }
        } else {
          if (gap < 58) {
            const gapFactor = Math.max(0, Math.min(1, (gap - 14) / 44));
            desiredSpeed = Math.min(
              desiredSpeed,
              currentMetrics.aheadVehicle.speed * (0.82 + gapFactor * 0.18)
            );
          }

          if (gap < 22) {
            desiredSpeed = Math.min(desiredSpeed, currentMetrics.aheadVehicle.speed * (isTaxi ? 0.84 : 0.78));
          }
        }
      } else if (isRacer) {
        desiredSpeed = Math.min(desiredSpeed, Math.max(20, player.speed - 1.4));
      }

      if (isRacer) {
        if (playerGap < 28) {
          desiredSpeed = Math.min(desiredSpeed, Math.max(18, player.speed - 3.2));
        }

        if (playerGap < 14) {
          desiredSpeed = Math.min(desiredSpeed, Math.max(16, player.speed - 5.5));
        }

        if (nearPlayerLane && playerGap < 26 && vehicle.laneChangeCooldown <= 0 && canLaneChangeNow) {
          const retreatLane = this.pickLaneAwayFrom(vehicle, this.getNearestLaneIndex(player.laneOffset), 18, 10);
          if (retreatLane !== vehicle.targetLaneIndex) {
            this.commitTrafficLaneChange(vehicle, retreatLane, 1.1);
          }
        }
      }

      vehicle.desiredSpeed = Math.max(isBus ? 10 : isRacer ? 18 : 8, desiredSpeed);
    }
  }

  pickYieldLane(vehicle, blockedLaneIndex) {
    for (const candidate of [vehicle.laneIndex - 1, vehicle.laneIndex + 1]) {
      if (candidate < 0 || candidate >= LANE_OFFSETS.length || candidate === blockedLaneIndex) {
        continue;
      }

      if (this.isLaneAvailable(vehicle.routeId, candidate, vehicle.s, 22, 12, vehicle)) {
        return candidate;
      }
    }

    return vehicle.laneIndex;
  }

  canTriggerTrafficLaneChange(routeId) {
    return this.time >= (this.nextTrafficLaneChangeAt.get(routeId) ?? 0);
  }

  commitTrafficLaneChange(vehicle, nextLaneIndex, cooldown = 1) {
    vehicle.targetLaneIndex = nextLaneIndex;
    vehicle.laneIndex = nextLaneIndex;
    vehicle.laneChangeCooldown = cooldown;
    this.nextTrafficLaneChangeAt.set(vehicle.routeId, this.time + 1);
  }

  pickLaneAwayFrom(vehicle, blockedLaneIndex, aheadDistance = 22, behindDistance = 12) {
    let bestLane = vehicle.laneIndex;
    let bestDistance = -1;

    for (let candidate = 0; candidate < LANE_OFFSETS.length; candidate += 1) {
      if (candidate === blockedLaneIndex) {
        continue;
      }

      if (!this.isLaneAvailable(vehicle.routeId, candidate, vehicle.s, aheadDistance, behindDistance, vehicle)) {
        continue;
      }

      const distance = Math.abs(candidate - blockedLaneIndex);
      if (distance > bestDistance) {
        bestDistance = distance;
        bestLane = candidate;
      }
    }

    return bestLane;
  }

  pickLaneForVehicle(vehicle, currentGap) {
    const isBus = vehicle.kind === "bus";
    const isRacer = vehicle.kind === "racer";
    const isTaxi = vehicle.kind === "taxi";
    let bestLane = vehicle.laneIndex;
    let bestScore = Math.min(currentGap, isRacer ? 110 : 90);

    for (const candidate of [vehicle.laneIndex - 1, vehicle.laneIndex + 1]) {
      if (candidate < 0 || candidate >= LANE_OFFSETS.length) {
        continue;
      }

      const metrics = this.getLaneMetrics(vehicle.routeId, candidate, vehicle.s, vehicle);
      const minAheadGap = isRacer ? 24 : isTaxi ? 28 : isBus ? 52 : 32;
      const minBehindGap = isRacer ? 10 : isTaxi ? 14 : 18;
      if (metrics.aheadGap <= minAheadGap || metrics.behindGap <= minBehindGap) {
        continue;
      }

      const laneBias = candidate === 1 ? (isBus ? 5 : 2) : isRacer ? 4 : 0;
      const score =
        Math.min(metrics.aheadGap, isRacer ? 140 : 116) +
        laneBias -
        Math.abs(candidate - vehicle.laneIndex) * (isBus ? 10 : 4);

      if (score > bestScore + (isRacer ? 6 : 10)) {
        bestLane = candidate;
        bestScore = score;
      }
    }

    return bestLane;
  }

  findPoliceBehind(routeId, s, laneIndex) {
    const laneOffset = LANE_OFFSETS[laneIndex];
    let closest = null;

    for (const vehicle of this.vehicles) {
      if (vehicle.routeId !== routeId || vehicle.kind !== "police" || vehicle.mode === "parked") {
        continue;
      }

      const gap = s - vehicle.s;
      if (gap <= 0 || Math.abs(vehicle.laneOffset - laneOffset) > LANE_WIDTH * 0.75) {
        continue;
      }

      if (!closest || gap < closest.gap) {
        closest = { vehicle, gap, laneIndex };
      }
    }

    return closest;
  }

  getPoliceState(playerS) {
    let nearestGap = Number.POSITIVE_INFINITY;
    let activeCount = 0;

    for (const vehicle of this.vehicles) {
      if (vehicle.kind !== "police" || vehicle.mode === "parked") {
        continue;
      }

      activeCount += 1;
      const gap = playerS - vehicle.s;
      if (gap >= 0 && gap < nearestGap) {
        nearestGap = gap;
      }
    }

    return {
      active: activeCount > 0,
      activeCount,
      nearestGap: Number.isFinite(nearestGap) ? nearestGap : null,
    };
  }

  groupVehiclesByRoute() {
    const routes = new Map();

    for (const vehicle of this.vehicles) {
      if (!routes.has(vehicle.routeId)) {
        routes.set(vehicle.routeId, []);
      }

      routes.get(vehicle.routeId).push(vehicle);
    }

    return routes;
  }

  countVehiclesOnRoute(routeId, kind = null) {
    return this.vehicles.reduce((count, vehicle) => {
      return count + Number(vehicle.routeId === routeId && (!kind || vehicle.kind === kind));
    }, 0);
  }

  countStandardTraffic(routeId) {
    return this.vehicles.reduce((count, vehicle) => {
      const isStandard = vehicle.kind === "civilian" || vehicle.kind === "taxi" || vehicle.kind === "bus";
      return count + Number(vehicle.routeId === routeId && isStandard);
    }, 0);
  }

  ensureVisibleTrafficAhead(player, weather, routeId) {
    const visibleNear = 18;
    const visibleFar = 178 + weather.visibility * 82;

    if (this.hasVehicleInWindow(routeId, player.s + visibleNear, player.s + visibleFar)) {
      return;
    }

    const spawnCursor = player.s + visibleFar - 10 + Math.random() * 24;
    const nextCursor = this.spawnTrafficVehicle(player, weather, routeId, spawnCursor, {
      minAhead: visibleFar + 16,
      baseOffset: 0,
      jitter: 20,
    });
    this.routeSpawnCursor.set(routeId, Math.max(this.routeSpawnCursor.get(routeId) ?? 0, nextCursor));
  }

  hasVehicleInWindow(routeId, startS, endS) {
    return this.vehicles.some((vehicle) => {
      if (vehicle.routeId !== routeId || vehicle.kind === "police") {
        return false;
      }

      return vehicle.s >= startS && vehicle.s <= endS;
    });
  }
}
