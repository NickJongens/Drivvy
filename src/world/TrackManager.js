import * as THREE from "three";

export const LANE_WIDTH = 4.8;
export const ROAD_WIDTH = LANE_WIDTH * 3 + 2.4;

const SAMPLE_STEP = 4;
const POINTS_PER_CHUNK = 34;
const FORWARD_BUFFER = 760;
const BACKWARD_BUFFER = 240;
const TERRAIN_HALF_WIDTH = 126;
const DASH_OFFSETS = [-LANE_WIDTH * 0.5, LANE_WIDTH * 0.5];
const SCENERY_CLEARANCE = ROAD_WIDTH * 0.7 + 7;

const BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const CYLINDER_GEOMETRY = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CONE_GEOMETRY = new THREE.ConeGeometry(0.7, 1.2, 6);
const ICOSAHEDRON_GEOMETRY = new THREE.IcosahedronGeometry(1, 0);
const DASH_GEOMETRY = new THREE.BoxGeometry(0.18, 0.03, SAMPLE_STEP * 1.4);
const BUILDING_COLORS = [0xf4a261, 0xe9c46a, 0xdad7cd, 0x84a59d, 0xa8dadc, 0xf28482];
const TREE_GREENS = [0x3e7c59, 0x4f8d69, 0x6a994e];
const SHRUB_GREENS = [0x658b52, 0x5f7c49, 0x7da36a];
const DISTANT_CITY_COLORS = [0x7b8490, 0x6d7680, 0x8a929b];
const NZ_SIGN_DESTINATIONS = [
  ["Auckland", "Hamilton"],
  ["Hamilton", "Tauranga"],
  ["Tauranga", "Rotorua"],
  ["Taupo", "Napier"],
  ["Palmerston North", "Wellington"],
  ["Wellington", "Picton"],
  ["Christchurch", "Ashburton"],
  ["Dunedin", "Invercargill"],
  ["Nelson", "Blenheim"],
  ["New Plymouth", "Whanganui"],
  ["Whangarei", "Auckland"],
];

export class TrackManager {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.roadMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2d31, flatShading: true });
    this.terrainMaterial = new THREE.MeshStandardMaterial({ color: 0x5f794c, flatShading: true });
    this.lineMaterial = new THREE.MeshStandardMaterial({
      color: 0xf6e8b1,
      emissive: 0x6a6331,
      flatShading: true,
    });
    this.edgeLineMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff2c4,
      emissive: 0x746122,
      emissiveIntensity: 0.28,
      flatShading: true,
    });
    this.propMaterial = new THREE.MeshStandardMaterial({ color: 0x6c7a80, flatShading: true });
    this.concreteMaterial = new THREE.MeshStandardMaterial({ color: 0x8a9198, flatShading: true });
    this.parkingMaterial = new THREE.MeshStandardMaterial({ color: 0x555c61, flatShading: true });
    this.grassMaterial = new THREE.MeshStandardMaterial({ color: 0x6c8f55, flatShading: true });
    this.fieldMaterial = new THREE.MeshStandardMaterial({ color: 0x87a45f, flatShading: true });
    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x5f9fb6,
      emissive: 0x1a4052,
      emissiveIntensity: 0.16,
      flatShading: true,
    });
    this.iceMaterial = new THREE.MeshStandardMaterial({
      color: 0x262a2e,
      emissive: 0x1a2430,
      emissiveIntensity: 0.04,
      transparent: true,
      opacity: 0.24,
      flatShading: true,
    });
    this.windowMaterial = new THREE.MeshStandardMaterial({
      color: 0x567185,
      emissive: 0x173040,
      emissiveIntensity: 0.16,
      flatShading: true,
    });
    this.trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6d4c41, flatShading: true });
    this.buildingMaterials = BUILDING_COLORS.map(
      (color) => new THREE.MeshStandardMaterial({ color, flatShading: true })
    );
    this.treeMaterials = TREE_GREENS.map(
      (color) => new THREE.MeshStandardMaterial({ color, flatShading: true })
    );
    this.shrubMaterials = SHRUB_GREENS.map(
      (color) => new THREE.MeshStandardMaterial({ color, flatShading: true })
    );
    this.distantCityMaterials = DISTANT_CITY_COLORS.map(
      (color) => new THREE.MeshStandardMaterial({ color, flatShading: true })
    );

    this.tempMatrix = new THREE.Matrix4();
    this.tempUp = new THREE.Vector3();
    this.roads = new Map();
    this.signMaterialCache = new Map();
    this.iceWarningMaterial = null;
    this.iceMarkersVisible = false;
    this.seed = 1;
    this.randomState = 1;

    this.setSeed((Date.now() ^ 0xa341316c) >>> 0);
    this.reset();
  }

  setSeed(seed) {
    const normalizedSeed = Number.isFinite(seed) ? seed >>> 0 : (Date.now() ^ 0x9e3779b9) >>> 0;
    this.seed = normalizedSeed || 1;
    this.randomState = this.seed;
  }

  random() {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }

  randomFloat(min, max) {
    return min + this.random() * (max - min);
  }

  randomSpread(range) {
    return (this.random() - 0.5) * range;
  }

  randomIndex(length) {
    return Math.floor(this.random() * length);
  }

  reset(seed = null) {
    if (seed !== null) {
      this.setSeed(seed);
    } else {
      this.randomState = this.seed;
    }

    for (const road of this.roads.values()) {
      for (const chunk of road.chunks) {
        this.root.remove(chunk.group);
        this.disposeChunk(chunk.group);
      }
    }

    this.roads.clear();
    this.iceMarkersVisible = false;

    const center = new THREE.Vector3(0, this.heightAt(0), 0);
    const nextCenter = new THREE.Vector3(0, this.heightAt(SAMPLE_STEP), SAMPLE_STEP);
    const tangent = nextCenter.clone().sub(center).normalize();

    this.roads.set("main", {
      id: "main",
      points: [
        {
          s: 0,
          center,
          tangent,
          right: new THREE.Vector3(1, 0, 0),
          bank: 0,
          widthScale: 1,
        },
      ],
      chunks: [],
      center: center.clone(),
      heading: 0,
      curve: 0,
      curveTarget: 0,
      curveHold: 0,
      nextS: 0,
    });

    this.ensure(0, null);
  }

  ensure(playerS, routeRef = null) {
    const road = this.getRoad(routeRef);
    if (!road) {
      return;
    }

    while (road.nextS < playerS + FORWARD_BUFFER) {
      this.addChunk(road);
    }

    while (road.chunks.length && road.chunks[0].endS < playerS - BACKWARD_BUFFER) {
      const chunk = road.chunks.shift();
      this.root.remove(chunk.group);
      this.disposeChunk(chunk.group);
    }
  }

  sample(s, laneOffset = 0, routeRef = null) {
    const road = this.getRoad(routeRef);
    return this.sampleFromRoad(road || this.roads.get("main"), s, laneOffset);
  }

  placeAlongTrack(object, s, laneOffset = 0, height = 0, extraRoll = 0, routeRef = null) {
    const sample = this.sample(s, laneOffset, routeRef);
    this.tempUp.crossVectors(sample.tangent, sample.right).normalize();
    this.tempMatrix.makeBasis(sample.right, this.tempUp, sample.tangent);
    object.position.copy(sample.position);
    object.position.y += height;
    object.quaternion.setFromRotationMatrix(this.tempMatrix);
    if (object.userData.yawOffset) {
      object.rotateY(object.userData.yawOffset);
    }
    object.rotateZ(sample.bank + extraRoll);
    return sample;
  }

  getDrivingBounds(s, routeRef = null) {
    const shoulderLimit = ROAD_WIDTH * 0.5 - 0.7;
    return {
      left: shoulderLimit,
      right: -shoulderLimit,
    };
  }

  getUpcomingTurn(s, routeRef = null, lookBehind = -18, lookAhead = 120) {
    return null;
  }

  getTurnLaneOffset(side) {
    return 0;
  }

  getLaneTargets(s, routeRef = null) {
    return [-LANE_WIDTH, 0, LANE_WIDTH];
  }

  updateRouteState(routeState, s, laneOffset) {
    routeState.branchId = null;
    return { changed: false };
  }

  getLaneState(s, laneOffset, routeRef = null) {
    if (laneOffset >= LANE_WIDTH * 0.5) {
      return { label: "Left Lane", signal: 0 };
    }

    if (laneOffset <= -LANE_WIDTH * 0.5) {
      return { label: "Right Lane", signal: 0 };
    }

    return { label: "Center Lane", signal: 0 };
  }

  getRegionState(s) {
    const cycleLength = 3600;
    const localS = ((s % cycleLength) + cycleLength) % cycleLength;
    let urbanity = 0;

    if (localS < 1100) {
      urbanity = 0;
    } else if (localS < 1600) {
      urbanity = THREE.MathUtils.smoothstep((localS - 1100) / 500, 0, 1);
    } else if (localS < 2550) {
      urbanity = 1;
    } else if (localS < 3100) {
      urbanity = 1 - THREE.MathUtils.smoothstep((localS - 2550) / 550, 0, 1);
    }

    return {
      kind: urbanity > 0.6 ? "city" : urbanity < 0.4 ? "country" : "transition",
      urbanity,
      localS,
    };
  }

  getSurfaceEffect(s, laneOffset, weather, routeRef = null) {
    if (weather?.id !== "ice") {
      return { grip: 1, blackIce: false, sideDrift: 0 };
    }

    const road = this.getRoad(routeRef);
    if (!road) {
      return { grip: 1, blackIce: false, sideDrift: 0 };
    }

    for (const chunk of road.chunks) {
      if (s < chunk.startS - 14 || s > chunk.endS + 14 || !chunk.icePatches?.length) {
        continue;
      }

      for (const patch of chunk.icePatches) {
        if (s >= patch.startS && s <= patch.endS && laneOffset >= patch.left && laneOffset <= patch.right) {
          return {
            grip: 0.46,
            blackIce: true,
            sideDrift: patch.sideDrift,
          };
        }
      }
    }

    return { grip: 1, blackIce: false, sideDrift: 0 };
  }

  addChunk(road) {
    const chunkPoints = [road.points[road.points.length - 1]];

    for (let index = 0; index < POINTS_PER_CHUNK; index += 1) {
      chunkPoints.push(this.buildNextPoint(road));
    }

    const region = this.getRegionState(chunkPoints[Math.floor(chunkPoints.length * 0.5)].s);
    const icePatches = this.createIcePatchData(chunkPoints, region);
    const { group, icePatchGroup, iceWarningGroup } = this.createRoadChunkGroup(chunkPoints, region, icePatches);
    this.root.add(group);
    road.chunks.push({
      startS: chunkPoints[0].s,
      endS: chunkPoints[chunkPoints.length - 1].s,
      group,
      icePatches,
      icePatchGroup,
      iceWarningGroup,
    });
  }

  buildNextPoint(road) {
    if (road.nextS === 0 && road.points.length === 1) {
      road.center = road.points[0].center.clone();
    }

    if (road.curveHold <= 0) {
      const longSweep = Math.sin((road.nextS + 180) * 0.00125) * 0.0026;
      const mediumSweep = Math.sin((road.nextS + 40) * 0.0038) * 0.0014;
      const centeringForce = THREE.MathUtils.clamp(
        -road.heading * 0.42 - road.center.x * 0.0029,
        -0.0023,
        0.0023
      );
      const wander = this.randomSpread(0.0013);
      road.curveTarget = THREE.MathUtils.clamp(longSweep + mediumSweep + centeringForce + wander, -0.0048, 0.0048);
      road.curveHold = 18 + this.randomIndex(18);
    }
    road.curveHold -= 1;

    road.curve += (road.curveTarget - road.curve) * 0.07;
    road.heading += road.curve * SAMPLE_STEP;
    road.heading = THREE.MathUtils.clamp(road.heading, -0.19, 0.19);

    const nextS = road.nextS + SAMPLE_STEP;
    let forwardFlat = new THREE.Vector3(Math.sin(road.heading), 0, Math.cos(road.heading));
    let nextCenter = road.center.clone().addScaledVector(forwardFlat, SAMPLE_STEP);
    nextCenter.y = this.heightAt(nextS);

    if (this.isRoadConflict(nextCenter, nextS, ROAD_WIDTH + 12, road.id)) {
      road.curveTarget *= -0.2;
      road.curve *= 0.3;
      road.heading *= 0.62;
      forwardFlat = new THREE.Vector3(Math.sin(road.heading), 0, Math.cos(road.heading));
      nextCenter = road.center.clone().addScaledVector(forwardFlat, SAMPLE_STEP);
      nextCenter.y = this.heightAt(nextS);
    }

    const tangent = nextCenter.clone().sub(road.center).normalize();
    const flatTangent = tangent.clone().setY(0).normalize();
    const point = {
      s: nextS,
      center: nextCenter.clone(),
      tangent,
      right: new THREE.Vector3(flatTangent.z, 0, -flatTangent.x).normalize(),
      bank: THREE.MathUtils.clamp(road.curve * 4.6, -0.035, 0.035),
      widthScale: 1,
    };

    road.points.push(point);
    road.center.copy(nextCenter);
    road.nextS = nextS;
    return point;
  }

  createRoadChunkGroup(points, region, icePatches = []) {
    const group = new THREE.Group();
    let icePatchGroup = null;
    let iceWarningGroup = null;

    group.add(this.createStripMesh(points, TERRAIN_HALF_WIDTH, TERRAIN_HALF_WIDTH, -0.2, this.terrainMaterial));
    group.add(this.createBackdrop(points, region));
    group.add(
      this.createStripMesh(
        points,
        (point) => ROAD_WIDTH * 0.5 * (point.widthScale ?? 1),
        (point) => ROAD_WIDTH * 0.5 * (point.widthScale ?? 1),
        0.06,
        this.roadMaterial
      )
    );
    if (icePatches.length) {
      icePatchGroup = this.createIcePatches(points, icePatches);
      icePatchGroup.visible = this.iceMarkersVisible;
      group.add(icePatchGroup);
      iceWarningGroup = this.createIceWarnings(points, icePatches);
      iceWarningGroup.visible = this.iceMarkersVisible;
      group.add(iceWarningGroup);
    }
    group.add(this.createEdgeLines(points));
    group.add(this.createLaneMarkers(points));
    if (this.shouldPlaceOverheadSign(points)) {
      group.add(this.createOverheadSign(points));
    }
    group.add(this.createRoadside(points, region));

    if (this.isElevatedChunk(points)) {
      group.add(this.createRoadRails(points));
    }

    return { group, icePatchGroup, iceWarningGroup };
  }

  createStripMesh(points, leftWidth, rightWidth, heightOffset, material) {
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const currentLeftWidth = typeof leftWidth === "function" ? leftWidth(point, index) : leftWidth;
      const currentRightWidth = typeof rightWidth === "function" ? rightWidth(point, index) : rightWidth;
      const left = point.center.clone().addScaledVector(point.right, -currentLeftWidth);
      const right = point.center.clone().addScaledVector(point.right, currentRightWidth);
      left.y += heightOffset;
      right.y += heightOffset;

      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      uvs.push(0, point.s * 0.04, 1, point.s * 0.04);
    }

    for (let index = 0; index < points.length - 1; index += 1) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1);
      indices.push(offset + 2, offset + 3, offset + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.disposeGeometry = true;
    return mesh;
  }

  createOffsetStripMesh(points, offset, halfWidth, heightOffset, material) {
    const shiftedPoints = points.map((point, index) => {
      const currentOffset = typeof offset === "function" ? offset(point, index) : offset;
      return {
        ...point,
        center: point.center.clone().addScaledVector(point.right, currentOffset),
      };
    });

    return this.createStripMesh(shiftedPoints, halfWidth, halfWidth, heightOffset, material);
  }

  createEdgeLines(points) {
    const group = new THREE.Group();
    const lineHalfWidth = 0.11;

    group.add(
      this.createOffsetStripMesh(
        points,
        (point) => -(ROAD_WIDTH * 0.5 * (point.widthScale ?? 1) - 0.26),
        lineHalfWidth,
        0.085,
        this.edgeLineMaterial
      )
    );
    group.add(
      this.createOffsetStripMesh(
        points,
        (point) => ROAD_WIDTH * 0.5 * (point.widthScale ?? 1) - 0.26,
        lineHalfWidth,
        0.085,
        this.edgeLineMaterial
      )
    );

    return group;
  }

  createLaneMarkers(points) {
    const group = new THREE.Group();

    for (let index = 1; index < points.length; index += 2) {
      const pointA = points[index - 1];
      const pointB = points[index];
      const center = pointA.center.clone().lerp(pointB.center, 0.5);
      const tangent = pointB.center.clone().sub(pointA.center).normalize();
      const right = pointA.right.clone().lerp(pointB.right, 0.5).normalize();
      this.tempUp.crossVectors(tangent, right).normalize();
      this.tempMatrix.makeBasis(right, this.tempUp, tangent);

      for (const offset of DASH_OFFSETS) {
        const dash = new THREE.Mesh(DASH_GEOMETRY, this.lineMaterial);
        dash.position.copy(center).addScaledVector(right, offset);
        dash.position.y += 0.12;
        dash.quaternion.setFromRotationMatrix(this.tempMatrix);
        group.add(dash);
      }
    }

    return group;
  }

  createBackdrop(points) {
    const group = new THREE.Group();

    for (let index = 4; index < points.length - 4; index += 10) {
      const point = points[index];
      const region = this.getRegionState(point.s);

      for (const side of [-1, 1]) {
        if (this.random() < 0.05) {
          continue;
        }

        const roll = this.random();
        const offset =
          region.urbanity > 0.55
            ? ROAD_WIDTH * 0.5 + 34 + this.random() * 42
            : ROAD_WIDTH * 0.5 + 40 + this.random() * 56;
        const anchor = point.center.clone().addScaledVector(point.right, side * offset);

        if (!this.isSceneryAnchorClear(anchor, SCENERY_CLEARANCE + 18, point.s, "main")) {
          continue;
        }

        if (region.urbanity > 0.45) {
          group.add(this.createDistantCityCluster(anchor, point, side));

          if (roll > 0.38) {
            const secondaryAnchor = point.center
              .clone()
              .addScaledVector(point.right, side * (offset + 16 + this.random() * 18));
            if (this.isSceneryAnchorClear(secondaryAnchor, SCENERY_CLEARANCE + 14, point.s, "main")) {
              group.add(this.createDistantCityCluster(secondaryAnchor, point, side));
            }
          }
        } else {
          group.add(this.createCountryBackdrop(anchor, point, side));
        }

        if (roll > 0.84 || region.urbanity < 0.28) {
          group.add(this.createTreeCluster(anchor));
        }
      }
    }

    return group;
  }

  createRoadside(points) {
    const group = new THREE.Group();

    for (let index = 3; index < points.length - 3; index += 3) {
      const point = points[index];
      const region = this.getRegionState(point.s);

      for (const side of [-1, 1]) {
        if (this.random() < 0.1) {
          continue;
        }

        const roll = this.random();
        const offset =
          roll < 0.26 ? ROAD_WIDTH * 0.5 + 22 + this.random() * 26 : ROAD_WIDTH * 0.5 + 14 + this.random() * 30;
        const anchor = point.center.clone().addScaledVector(point.right, side * offset);

        if (!this.isSceneryAnchorClear(anchor, SCENERY_CLEARANCE, point.s, "main")) {
          continue;
        }

        if (region.urbanity < 0.35) {
          if (roll < 0.26) {
            group.add(this.createCountryProperty(anchor, point, side));
          } else if (roll < 0.42) {
            group.add(this.createAnimalGroup(anchor));
          } else if (roll < 0.76) {
            group.add(this.createTreeCluster(anchor));
          } else if (roll < 0.92) {
            group.add(this.createTree(anchor));
          } else {
            group.add(this.createRoadProp(anchor, point, side));
          }
        } else if (roll < 0.12) {
          group.add(this.createPark(anchor, point, side));
        } else if (roll < 0.2) {
          group.add(this.createMonument(anchor, point, side));
        } else if (roll < 0.46) {
          group.add(this.createCityBlock(anchor, point, side));
        } else if (roll < 0.88) {
          group.add(this.createBuilding(anchor, point, side));
        } else if (roll < 0.95) {
          group.add(this.createTree(anchor));
        } else {
          group.add(this.createRoadProp(anchor, point, side));
        }
      }
    }

    return group;
  }

  createIcePatchData(points, region) {
    const patches = [];
    if (region.urbanity > 0.45 || this.random() < 0.48) {
      return patches;
    }

    const patchCount = this.random() < 0.34 ? 2 : 1;
    const startS = points[0].s;
    const endS = points[points.length - 1].s;

    for (let index = 0; index < patchCount; index += 1) {
      const centerS = startS + 28 + this.random() * Math.max(endS - startS - 56, 8);
      const width = 2.2 + this.random() * 2.4;
      const laneCenter = [-LANE_WIDTH, 0, LANE_WIDTH][this.randomIndex(3)] + this.randomSpread(0.9);
      patches.push({
        startS: centerS - (10 + this.random() * 8),
        endS: centerS + (10 + this.random() * 10),
        centerOffset: laneCenter,
        width,
        left: laneCenter - width * 0.5,
        right: laneCenter + width * 0.5,
        sideDrift: this.randomSpread(1.6),
        warningSide: this.random() < 0.5 ? -1 : 1,
        warningS: Math.max(startS + 10, centerS - (28 + this.random() * 12)),
      });
    }

    return patches;
  }

  createIcePatches(points, patches) {
    const group = new THREE.Group();

    for (const patch of patches) {
      const sample = this.sampleFromPoints(points, (patch.startS + patch.endS) * 0.5, patch.centerOffset);
      const mesh = new THREE.Mesh(BOX_GEOMETRY, this.iceMaterial);
      mesh.scale.set(patch.width, 0.012, Math.max(8, patch.endS - patch.startS));
      this.tempUp.crossVectors(sample.tangent, sample.right).normalize();
      this.tempMatrix.makeBasis(sample.right, this.tempUp, sample.tangent);
      mesh.position.copy(sample.position);
      mesh.position.y += 0.073;
      mesh.quaternion.setFromRotationMatrix(this.tempMatrix);
      group.add(mesh);
    }

    return group;
  }

  createIceWarnings(points, patches) {
    const group = new THREE.Group();
    const warningMaterial = this.getIceWarningMaterial();

    for (const patch of patches) {
      const side = patch.warningSide || 1;
      const sample = this.sampleFromPoints(points, patch.warningS, side * (ROAD_WIDTH * 0.5 + 5.8));
      const signGroup = new THREE.Group();
      this.tempUp.crossVectors(sample.tangent, sample.right).normalize();
      this.tempMatrix.makeBasis(sample.right, this.tempUp, sample.tangent);
      signGroup.position.copy(sample.position);
      signGroup.quaternion.setFromRotationMatrix(this.tempMatrix);
      signGroup.rotateY(side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5);

      const pole = new THREE.Mesh(CYLINDER_GEOMETRY, this.propMaterial);
      pole.scale.set(0.18, 3.1, 0.18);
      pole.position.y = 1.55;
      signGroup.add(pole);

      const panel = new THREE.Mesh(BOX_GEOMETRY, warningMaterial);
      panel.scale.set(2.1, 1.6, 0.12);
      panel.position.set(0, 3.3, 0);
      signGroup.add(panel);

      const panelBack = new THREE.Mesh(BOX_GEOMETRY, this.concreteMaterial);
      panelBack.scale.set(2.2, 1.7, 0.08);
      panelBack.position.set(0, 3.3, -0.08);
      signGroup.add(panelBack);

      group.add(signGroup);
    }

    return group;
  }

  createCountryBackdrop(anchor, point, side) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = Math.atan2(point.right.x * -side, point.right.z * -side) + this.randomSpread(0.16);

    const field = new THREE.Mesh(BOX_GEOMETRY, this.fieldMaterial);
    field.scale.set(24 + this.random() * 20, 0.18, 18 + this.random() * 12);
    field.position.y = 0.08;
    group.add(field);

    if (this.random() < 0.6) {
      const barn = new THREE.Mesh(BOX_GEOMETRY, this.concreteMaterial);
      barn.scale.set(6 + this.random() * 5, 4 + this.random() * 3, 7 + this.random() * 5);
      barn.position.set(-field.scale.x * 0.18, barn.scale.y * 0.5, -field.scale.z * 0.08);
      group.add(barn);

      const shed = new THREE.Mesh(BOX_GEOMETRY, this.propMaterial);
      shed.scale.set(4 + this.random() * 3, 2.4 + this.random() * 1.8, 4 + this.random() * 3);
      shed.position.set(field.scale.x * 0.16, shed.scale.y * 0.5, field.scale.z * 0.12);
      group.add(shed);
    }

    if (this.random() < 0.4) {
      for (const xOffset of [-4.2, -2.6]) {
        const silo = new THREE.Mesh(CYLINDER_GEOMETRY, this.concreteMaterial);
        silo.scale.set(1, 5 + this.random() * 2.5, 1);
        silo.position.set(xOffset, silo.scale.y * 0.5, field.scale.z * 0.22);
        group.add(silo);
      }
    }

    return group;
  }

  createCountryProperty(anchor, point, side) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = Math.atan2(point.right.x * -side, point.right.z * -side) + this.randomSpread(0.12);

    const lot = new THREE.Mesh(BOX_GEOMETRY, this.grassMaterial);
    lot.scale.set(16 + this.random() * 10, 0.12, 14 + this.random() * 8);
    lot.position.y = 0.05;
    group.add(lot);

    const house = new THREE.Mesh(
      BOX_GEOMETRY,
      this.buildingMaterials[this.randomIndex(this.buildingMaterials.length)]
    );
    house.scale.set(5 + this.random() * 3.4, 3.6 + this.random() * 1.8, 6 + this.random() * 3);
    house.position.set(-2.8, house.scale.y * 0.5, -2.2);
    group.add(house);

    const shed = new THREE.Mesh(BOX_GEOMETRY, this.propMaterial);
    shed.scale.set(4.2, 2.8, 4.8);
    shed.position.set(4.2, shed.scale.y * 0.5, 2.8);
    group.add(shed);

    group.add(this.createAnimalGroup(new THREE.Vector3(2.2, 0, -1.6)));
    return group;
  }

  createPark(anchor, point, side) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = Math.atan2(point.right.x * -side, point.right.z * -side) + this.randomSpread(0.1);

    const lawn = new THREE.Mesh(BOX_GEOMETRY, this.grassMaterial);
    lawn.scale.set(18 + this.random() * 10, 0.12, 18 + this.random() * 10);
    lawn.position.y = 0.05;
    group.add(lawn);

    const pathA = new THREE.Mesh(BOX_GEOMETRY, this.concreteMaterial);
    pathA.scale.set(lawn.scale.x * 0.12, 0.05, lawn.scale.z * 0.9);
    pathA.position.y = 0.09;
    group.add(pathA);

    const pathB = new THREE.Mesh(BOX_GEOMETRY, this.concreteMaterial);
    pathB.scale.set(lawn.scale.x * 0.76, 0.05, lawn.scale.z * 0.12);
    pathB.position.y = 0.09;
    group.add(pathB);

    if (this.random() < 0.45) {
      const pond = new THREE.Mesh(BOX_GEOMETRY, this.waterMaterial);
      pond.scale.set(5.4, 0.04, 3.6);
      pond.position.set(3.6, 0.08, -3.4);
      group.add(pond);
    }

    for (const position of [
      new THREE.Vector3(-5.6, 0, -4.8),
      new THREE.Vector3(5.1, 0, 4.2),
      new THREE.Vector3(-3.8, 0, 4.9),
    ]) {
      group.add(this.createTree(position));
    }

    return group;
  }

  createMonument(anchor, point, side) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = Math.atan2(point.right.x * -side, point.right.z * -side) + this.randomSpread(0.08);

    const base = new THREE.Mesh(BOX_GEOMETRY, this.concreteMaterial);
    base.scale.set(8 + this.random() * 4, 0.8, 8 + this.random() * 4);
    base.position.y = 0.4;
    group.add(base);

    const plinth = new THREE.Mesh(BOX_GEOMETRY, this.propMaterial);
    plinth.scale.set(3.2, 2.4, 3.2);
    plinth.position.y = base.scale.y + plinth.scale.y * 0.5;
    group.add(plinth);

    const sculpture = new THREE.Mesh(
      ICOSAHEDRON_GEOMETRY,
      this.buildingMaterials[this.randomIndex(this.buildingMaterials.length)]
    );
    const sculptureScale = 2 + this.random() * 1.2;
    sculpture.scale.setScalar(sculptureScale);
    sculpture.position.y = base.scale.y + plinth.scale.y + sculptureScale * 0.55;
    sculpture.rotation.y = this.random() * Math.PI;
    group.add(sculpture);

    return group;
  }

  createAnimalGroup(anchor) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = this.random() * Math.PI * 2;

    const count = 2 + this.randomIndex(3);
    for (let index = 0; index < count; index += 1) {
      const body = new THREE.Mesh(
        BOX_GEOMETRY,
        new THREE.MeshStandardMaterial({
          color: this.random() < 0.55 ? 0xf1f0e8 : 0x8d715c,
          flatShading: true,
        })
      );
      body.scale.set(1.2 + this.random() * 0.5, 0.72 + this.random() * 0.2, 1.7 + this.random() * 0.5);
      body.position.set(this.randomSpread(3.8), body.scale.y * 0.5, this.randomSpread(3.2));
      group.add(body);

      const head = new THREE.Mesh(
        BOX_GEOMETRY,
        new THREE.MeshStandardMaterial({ color: 0x6d5747, flatShading: true })
      );
      head.scale.set(0.46, 0.42, 0.52);
      head.position.copy(body.position).add(new THREE.Vector3(0.56, 0.22, 0.42));
      group.add(head);
    }

    return group;
  }

  createBuilding(anchor, point, side) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = Math.atan2(point.right.x * -side, point.right.z * -side) + this.randomSpread(0.18);

    const bodyMaterial = this.buildingMaterials[this.randomIndex(this.buildingMaterials.length)];
    const variant = this.random();

    if (variant < 0.24) {
      const width = 10 + this.random() * 10;
      const depth = 9 + this.random() * 10;
      const height = 24 + this.random() * 34;
      const podium = new THREE.Mesh(BOX_GEOMETRY, this.concreteMaterial);
      podium.scale.set(width + 1.8, 1.2, depth + 1.8);
      podium.position.y = 0.6;
      group.add(podium);

      const tower = new THREE.Mesh(BOX_GEOMETRY, bodyMaterial);
      tower.scale.set(width, height, depth);
      tower.position.y = podium.scale.y + height * 0.5;
      group.add(tower);

      for (const zOffset of [-depth * 0.44, 0, depth * 0.44]) {
        const glazing = new THREE.Mesh(BOX_GEOMETRY, this.windowMaterial);
        glazing.scale.set(width * 0.88, height * 0.1, 0.14);
        glazing.position.set(0, podium.scale.y + height * 0.52, zOffset);
        group.add(glazing);
      }
    } else if (variant < 0.48) {
      const baseWidth = 16 + this.random() * 8;
      const baseDepth = 10 + this.random() * 8;
      const baseHeight = 10 + this.random() * 8;
      const midHeight = 12 + this.random() * 10;
      const topHeight = 10 + this.random() * 10;

      const base = new THREE.Mesh(BOX_GEOMETRY, bodyMaterial);
      base.scale.set(baseWidth, baseHeight, baseDepth);
      base.position.y = baseHeight * 0.5;
      group.add(base);

      const mid = new THREE.Mesh(BOX_GEOMETRY, bodyMaterial);
      mid.scale.set(baseWidth * 0.72, midHeight, baseDepth * 0.8);
      mid.position.set(-1.2, baseHeight + midHeight * 0.5, -0.8);
      group.add(mid);

      const top = new THREE.Mesh(BOX_GEOMETRY, this.propMaterial);
      top.scale.set(baseWidth * 0.42, topHeight, baseDepth * 0.48);
      top.position.set(1.6, baseHeight + midHeight + topHeight * 0.5, 0.4);
      group.add(top);
    } else if (variant < 0.74) {
      const width = 18 + this.random() * 9;
      const depth = 10 + this.random() * 7;
      const height = 14 + this.random() * 10;
      const apartment = new THREE.Mesh(BOX_GEOMETRY, bodyMaterial);
      apartment.scale.set(width, height, depth);
      apartment.position.y = height * 0.5;
      group.add(apartment);

      for (let band = -2; band <= 2; band += 1) {
        const balconyBand = new THREE.Mesh(BOX_GEOMETRY, this.windowMaterial);
        balconyBand.scale.set(width * 0.92, 0.14, 0.22);
        balconyBand.position.set(0, height * 0.28 + band * (height * 0.13), depth * 0.5 + 0.12);
        group.add(balconyBand);
      }
    } else {
      const width = 18 + this.random() * 10;
      const depth = 12 + this.random() * 8;
      const height = 7 + this.random() * 6;
      const hall = new THREE.Mesh(BOX_GEOMETRY, bodyMaterial);
      hall.scale.set(width, height, depth);
      hall.position.y = height * 0.5;
      group.add(hall);

      const signBand = new THREE.Mesh(BOX_GEOMETRY, this.windowMaterial);
      signBand.scale.set(width * 0.84, 0.6, 0.18);
      signBand.position.set(0, height * 0.72, depth * 0.5 + 0.08);
      group.add(signBand);

      const tower = new THREE.Mesh(BOX_GEOMETRY, this.concreteMaterial);
      tower.scale.set(width * 0.18, 10 + this.random() * 8, depth * 0.2);
      tower.position.set(width * 0.3, height + tower.scale.y * 0.5, -depth * 0.18);
      group.add(tower);
    }

    return group;
  }

  createTree(anchor) {
    const group = new THREE.Group();
    group.position.copy(anchor);

    const trunk = new THREE.Mesh(CYLINDER_GEOMETRY, this.trunkMaterial);
    trunk.scale.set(0.55, 3 + this.random() * 2.5, 0.55);
    trunk.position.y = trunk.scale.y * 0.5;
    group.add(trunk);

    const canopy = new THREE.Mesh(
      CONE_GEOMETRY,
      this.treeMaterials[this.randomIndex(this.treeMaterials.length)]
    );
    canopy.scale.set(2 + this.random() * 1.6, 4 + this.random() * 2.5, 2 + this.random() * 1.6);
    canopy.position.y = trunk.scale.y + canopy.scale.y * 0.35;
    canopy.rotation.y = this.random() * Math.PI;
    group.add(canopy);

    return group;
  }

  createShrub(anchor) {
    const group = new THREE.Group();
    group.position.copy(anchor);

    const shrub = new THREE.Mesh(
      ICOSAHEDRON_GEOMETRY,
      this.shrubMaterials[this.randomIndex(this.shrubMaterials.length)]
    );
    const scale = 1 + this.random() * 1.2;
    shrub.scale.set(scale, scale * this.randomFloat(0.7, 1.2), scale);
    shrub.position.y = shrub.scale.y * 0.45;
    group.add(shrub);

    return group;
  }

  createRoadProp(anchor, point, side) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = Math.atan2(point.tangent.x, point.tangent.z) + side * Math.PI * 0.5;

    const pole = new THREE.Mesh(CYLINDER_GEOMETRY, this.propMaterial);
    pole.scale.set(0.22, 5.5, 0.22);
    pole.position.y = pole.scale.y * 0.5;
    group.add(pole);

    const lamp = new THREE.Mesh(BOX_GEOMETRY, this.lineMaterial);
    lamp.scale.set(1.5, 0.28, 0.55);
    lamp.position.set(side * -0.4, pole.scale.y + 0.1, 0);
    group.add(lamp);

    return group;
  }

  createCityBlock(anchor, point, side) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = Math.atan2(point.right.x * -side, point.right.z * -side) + this.randomSpread(0.035);

    const lotWidth = 30 + this.random() * 18;
    const anchorOffsetFromRoad = Math.abs(anchor.clone().sub(point.center).setY(0).dot(point.right));
    const shoulderBuffer = 2.4;
    const drivewayClearance = 1.2;
    const frontAllowance = Math.max(8, anchorOffsetFromRoad - ROAD_WIDTH * 0.5 - shoulderBuffer);
    const lotDepth = Math.min(22 + this.random() * 16, Math.max(12, frontAllowance * 1.92));
    const roadGap = Math.max(0, frontAllowance - lotDepth * 0.5);
    const drivewayLength = Math.max(0, roadGap - drivewayClearance);

    const lot = new THREE.Mesh(BOX_GEOMETRY, this.parkingMaterial);
    lot.scale.set(lotWidth, 0.18, lotDepth);
    lot.position.y = 0.09;
    group.add(lot);

    if (drivewayLength > 0.35) {
      const driveway = new THREE.Mesh(BOX_GEOMETRY, this.parkingMaterial);
      driveway.scale.set(4.6, 0.14, drivewayLength);
      driveway.position.set(0, 0.08, lotDepth * 0.5 + drivewayLength * 0.5);
      group.add(driveway);
    }

    for (const xOffset of [-lotWidth * 0.34, 0, lotWidth * 0.34]) {
      const parkingStripe = new THREE.Mesh(BOX_GEOMETRY, this.edgeLineMaterial);
      parkingStripe.scale.set(0.16, 0.03, lotDepth * 0.74);
      parkingStripe.position.set(xOffset, 0.14, -lotDepth * 0.08);
      group.add(parkingStripe);
    }

    for (let index = 0; index < 4; index += 1) {
      const width = 8 + this.random() * 9;
      const depth = 7 + this.random() * 8;
      const height = 20 + this.random() * 28;
      const body = new THREE.Mesh(
        BOX_GEOMETRY,
        this.buildingMaterials[this.randomIndex(this.buildingMaterials.length)]
      );
      body.scale.set(width, height, depth);
      body.position.set(
        -lotWidth * 0.34 + index * lotWidth * 0.22,
        0.18 + height * 0.5,
        -lotDepth * 0.22 - this.random() * 2
      );
      group.add(body);

      const glazing = new THREE.Mesh(BOX_GEOMETRY, this.windowMaterial);
      glazing.scale.set(width * 0.84, height * 0.08, 0.14);
      glazing.position.set(body.position.x, body.position.y * 0.9, body.position.z + depth * 0.5 + 0.08);
      group.add(glazing);

      const roofUnit = new THREE.Mesh(BOX_GEOMETRY, this.propMaterial);
      roofUnit.scale.set(width * 0.24, 1.1, depth * 0.22);
      roofUnit.position.set(body.position.x - width * 0.12, body.position.y + height * 0.5 + 0.55, body.position.z);
      group.add(roofUnit);
    }

    for (let index = 0; index < 4; index += 1) {
      const parkedCar = this.createParkingCar();
      parkedCar.position.set(
        -lotWidth * 0.34 + index * (lotWidth * 0.22),
        0.18,
        lotDepth * 0.08 + (index % 2 === 0 ? 0.4 : -0.4)
      );
      parkedCar.rotation.y = (index % 2 === 0 ? 1 : -1) * Math.PI * 0.5;
      group.add(parkedCar);
    }

    for (const xOffset of [-lotWidth * 0.42, lotWidth * 0.42]) {
      const lamp = this.createRoadProp(new THREE.Vector3(xOffset, 0, -lotDepth * 0.16), point, side);
      lamp.scale.setScalar(0.72);
      group.add(lamp);
    }

    return group;
  }

  createDistantCityCluster(anchor, point, side) {
    const group = new THREE.Group();
    group.position.copy(anchor);
    group.rotation.y = Math.atan2(point.right.x * -side, point.right.z * -side) + this.randomSpread(0.1);

    const podium = new THREE.Mesh(BOX_GEOMETRY, this.concreteMaterial);
    podium.scale.set(36 + this.random() * 18, 1.1, 20 + this.random() * 12);
    podium.position.y = 0.55;
    group.add(podium);

    const towerCount = 5 + this.randomIndex(4);
    for (let index = 0; index < towerCount; index += 1) {
      const width = 6 + this.random() * 8;
      const depth = 6 + this.random() * 6;
      const height = 18 + this.random() * 34;
      const body = new THREE.Mesh(
        BOX_GEOMETRY,
        this.distantCityMaterials[this.randomIndex(this.distantCityMaterials.length)]
      );
      body.scale.set(width, height, depth);
      body.position.set(
        -podium.scale.x * 0.34 + index * (podium.scale.x * 0.2) + this.randomSpread(3),
        podium.scale.y + height * 0.5,
        this.randomSpread(4)
      );
      group.add(body);

      const windowBand = new THREE.Mesh(BOX_GEOMETRY, this.windowMaterial);
      windowBand.scale.set(width * 0.82, height * 0.08, 0.12);
      windowBand.position.set(body.position.x, body.position.y * 0.9, body.position.z + depth * 0.5 + 0.08);
      group.add(windowBand);
    }

    return group;
  }

  createTreeCluster(anchor) {
    const group = new THREE.Group();
    group.position.copy(anchor);

    const shrubBase = new THREE.Mesh(BOX_GEOMETRY, this.terrainMaterial);
    shrubBase.scale.set(16 + this.random() * 10, 0.22, 12 + this.random() * 8);
    shrubBase.position.y = 0.08;
    group.add(shrubBase);

    const treeCount = 3 + this.randomIndex(4);
    for (let index = 0; index < treeCount; index += 1) {
      const tree = this.createTree(
        new THREE.Vector3(
          this.randomSpread(8),
          0,
          this.randomSpread(5)
        )
      );
      group.add(tree);
    }

    return group;
  }

  createParkingCar() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      BOX_GEOMETRY,
      this.buildingMaterials[this.randomIndex(this.buildingMaterials.length)]
    );
    body.scale.set(2.2, 0.52, 4.1);
    body.position.y = 0.46;
    group.add(body);

    const cabin = new THREE.Mesh(BOX_GEOMETRY, this.windowMaterial);
    cabin.scale.set(1.42, 0.42, 1.48);
    cabin.position.set(0, 0.92, -0.1);
    group.add(cabin);

    return group;
  }

  shouldPlaceOverheadSign(points) {
    const marker = Math.floor(points[0].s / 320);
    return points[0].s > 260 && marker % 5 === 2;
  }

  createOverheadSign(points) {
    const group = new THREE.Group();
    const pivotIndex = Math.floor(points.length * 0.5);
    const point = points[pivotIndex];
    const center = point.center.clone();
    const tangent = point.tangent.clone();
    const right = point.right.clone();

    this.tempUp.crossVectors(tangent, right).normalize();
    this.tempMatrix.makeBasis(right, this.tempUp, tangent);
    group.position.copy(center);
    group.quaternion.setFromRotationMatrix(this.tempMatrix);

    const span = ROAD_WIDTH + 5;

    for (const xOffset of [-span * 0.5, span * 0.5]) {
      const pole = new THREE.Mesh(BOX_GEOMETRY, this.propMaterial);
      pole.scale.set(0.35, 6.8, 0.35);
      pole.position.set(xOffset, 3.4, 0);
      group.add(pole);
    }

    const beam = new THREE.Mesh(BOX_GEOMETRY, this.propMaterial);
    beam.scale.set(span + 0.7, 0.24, 0.28);
    beam.position.set(0, 6.9, 0);
    group.add(beam);

    const destinations =
      NZ_SIGN_DESTINATIONS[Math.floor((points[0].s / 1600) % NZ_SIGN_DESTINATIONS.length)] || NZ_SIGN_DESTINATIONS[0];
    const signMaterial = this.getMotorwaySignMaterial(destinations);

    for (const xOffset of [-LANE_WIDTH * 0.78, LANE_WIDTH * 0.78]) {
      const panel = new THREE.Mesh(
        BOX_GEOMETRY,
        signMaterial
      );
      panel.scale.set(4.8, 2.2, 0.14);
      panel.position.set(xOffset, 5.6, 0.18);
      group.add(panel);
    }

    return group;
  }

  getMotorwaySignMaterial(destinations) {
    const cacheKey = destinations.join("|");
    if (this.signMaterialCache.has(cacheKey)) {
      return this.signMaterialCache.get(cacheKey);
    }

    let material;
    if (typeof document === "undefined") {
      material = new THREE.MeshStandardMaterial({ color: 0x0c7c45, flatShading: true });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 256;
      const context = canvas.getContext("2d");

      if (!context) {
        material = new THREE.MeshStandardMaterial({ color: 0x0c7c45, flatShading: true });
        this.signMaterialCache.set(cacheKey, material);
        return material;
      }

      context.fillStyle = "#0c7c45";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#f4f7f3";
      context.lineWidth = 12;
      context.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

      context.fillStyle = "#f4f7f3";
      context.font = "bold 42px sans-serif";
      context.fillText("SH1", 28, 58);
      context.font = "bold 48px sans-serif";
      context.fillText(destinations[0], 28, 126);
      context.font = "bold 40px sans-serif";
      context.fillText(destinations[1], 28, 186);
      context.font = "bold 54px sans-serif";
      context.fillText("v", 444, 168);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshStandardMaterial({ map: texture, flatShading: true });
    }

    this.signMaterialCache.set(cacheKey, material);
    return material;
  }

  getIceWarningMaterial() {
    if (this.iceWarningMaterial) {
      return this.iceWarningMaterial;
    }

    if (typeof document === "undefined") {
      this.iceWarningMaterial = new THREE.MeshStandardMaterial({ color: 0xf4c542, flatShading: true });
      return this.iceWarningMaterial;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");

    if (!context) {
      this.iceWarningMaterial = new THREE.MeshStandardMaterial({ color: 0xf4c542, flatShading: true });
      return this.iceWarningMaterial;
    }

    context.fillStyle = "#f2c449";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#1d2226";
    context.lineWidth = 18;
    context.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);
    context.fillStyle = "#1d2226";
    context.font = "bold 86px sans-serif";
    context.textAlign = "center";
    context.fillText("ICE", canvas.width * 0.5, 118);
    context.font = "bold 54px sans-serif";
    context.fillText("SLIP", canvas.width * 0.5, 184);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.iceWarningMaterial = new THREE.MeshStandardMaterial({ map: texture, flatShading: true });
    return this.iceWarningMaterial;
  }

  setIceZoneVisibility(visible) {
    if (this.iceMarkersVisible === visible) {
      return;
    }

    this.iceMarkersVisible = visible;
    for (const road of this.roads.values()) {
      for (const chunk of road.chunks) {
        if (chunk.icePatchGroup) {
          chunk.icePatchGroup.visible = visible;
        }

        if (chunk.iceWarningGroup) {
          chunk.iceWarningGroup.visible = visible;
        }
      }
    }
  }

  createRoadRails(points) {
    const group = new THREE.Group();

    for (let index = 1; index < points.length; index += 2) {
      const pointA = points[index - 1];
      const pointB = points[index];
      const center = pointA.center.clone().lerp(pointB.center, 0.5);
      const tangent = pointB.center.clone().sub(pointA.center).normalize();
      const right = pointA.right.clone().lerp(pointB.right, 0.5).normalize();
      this.tempUp.crossVectors(tangent, right).normalize();
      this.tempMatrix.makeBasis(right, this.tempUp, tangent);

      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(BOX_GEOMETRY, this.propMaterial);
        rail.scale.set(0.14, 0.22, SAMPLE_STEP * 1.5);
        rail.position.copy(center).addScaledVector(right, side * (ROAD_WIDTH * 0.5 + 0.55));
        rail.position.y += 1.15;
        rail.quaternion.setFromRotationMatrix(this.tempMatrix);
        group.add(rail);
      }
    }

    return group;
  }

  sampleFromRoad(road, s, laneOffset = 0) {
    const points = road.points;
    return this.sampleFromPoints(points, s, laneOffset);
  }

  sampleFromPoints(points, s, laneOffset = 0) {
    const maxS = points[points.length - 1].s - 0.001;
    const minS = points[0].s;
    const clampedS = THREE.MathUtils.clamp(s, minS, maxS);
    let index = Math.floor((clampedS - minS) / SAMPLE_STEP);
    index = THREE.MathUtils.clamp(index, 0, points.length - 2);

    while (index < points.length - 2 && points[index + 1].s < clampedS) {
      index += 1;
    }

    const pointA = points[index];
    const pointB = points[index + 1];
    const blend = (clampedS - pointA.s) / Math.max(pointB.s - pointA.s, 0.0001);
    const center = pointA.center.clone().lerp(pointB.center, blend);
    const tangent = pointA.tangent.clone().lerp(pointB.tangent, blend).normalize();
    const right = pointA.right.clone().lerp(pointB.right, blend).normalize();
    const bank = THREE.MathUtils.lerp(pointA.bank, pointB.bank, blend);
    const position = center.clone().addScaledVector(right, laneOffset);
    return { s: clampedS, center, position, tangent, right, bank };
  }

  getRoad(routeRef = null) {
    return this.roads.get(this.resolveRoadId(routeRef)) || this.roads.get("main");
  }

  resolveRoadId(routeRef = null) {
    if (typeof routeRef === "string") {
      return routeRef || "main";
    }

    return routeRef?.branchId || "main";
  }

  isRoadConflict(candidateCenter, candidateS, clearance, currentRoadId) {
    const clearanceSq = clearance * clearance;

    for (const road of this.roads.values()) {
      for (let index = 0; index < road.points.length; index += 6) {
        const point = road.points[index];
        if (road.id === currentRoadId && candidateS - point.s < 96) {
          continue;
        }

        const dx = point.center.x - candidateCenter.x;
        const dz = point.center.z - candidateCenter.z;
        if (dx * dx + dz * dz < clearanceSq) {
          return true;
        }
      }
    }

    return false;
  }

  isSceneryAnchorClear(anchor, clearance, sourceS, sourceRoadId) {
    const clearanceSq = clearance * clearance;

    for (const road of this.roads.values()) {
      for (let index = 0; index < road.points.length; index += 4) {
        const point = road.points[index];
        if (road.id === sourceRoadId && Math.abs(point.s - sourceS) < 24) {
          continue;
        }

        const dx = point.center.x - anchor.x;
        const dz = point.center.z - anchor.z;
        if (dx * dx + dz * dz < clearanceSq) {
          return false;
        }
      }
    }

    return true;
  }

  isElevatedChunk(points) {
    return points.some((point) => point.center.y > 0.8);
  }

  disposeChunk(group) {
    group.traverse((child) => {
      if (child.isMesh && child.userData.disposeGeometry) {
        child.geometry.dispose();
      }
    });
  }

  heightAt(distance) {
    return Math.sin(distance * 0.008) * 0.95 + Math.sin(distance * 0.019 + 0.8) * 0.38;
  }
}
