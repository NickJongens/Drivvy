import * as THREE from "three";
import { LANE_WIDTH } from "../world/TrackManager.js";

const LANE_OFFSETS = [-LANE_WIDTH, 0, LANE_WIDTH];
const COIN_GEOMETRY = new THREE.TorusGeometry(0.72, 0.18, 8, 18);
const NOS_BODY_GEOMETRY = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 8);
const NOS_CAP_GEOMETRY = new THREE.CylinderGeometry(0.24, 0.24, 0.18, 8);
const NOS_FIN_GEOMETRY = new THREE.BoxGeometry(0.08, 0.4, 0.82);

NOS_BODY_GEOMETRY.rotateZ(Math.PI * 0.5);
NOS_CAP_GEOMETRY.rotateZ(Math.PI * 0.5);

export class CollectibleSystem {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.items = [];
    this.spawnCursor = 0;
    this.time = 0;
    this.coinMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd54d,
      emissive: 0xffb703,
      emissiveIntensity: 0.42,
      metalness: 0.45,
      roughness: 0.36,
      flatShading: true,
    });
    this.nosMaterial = new THREE.MeshStandardMaterial({
      color: 0x47b6ff,
      emissive: 0x1d7cf2,
      emissiveIntensity: 0.36,
      metalness: 0.3,
      roughness: 0.34,
      flatShading: true,
    });
    this.nosCapMaterial = new THREE.MeshStandardMaterial({
      color: 0xe7f5ff,
      emissive: 0x78c5ff,
      emissiveIntensity: 0.26,
      flatShading: true,
    });
  }

  reset(playerS = 0) {
    for (const item of this.items) {
      this.scene.remove(item.mesh);
    }

    this.items = [];
    this.spawnCursor = playerS + 150;
    this.time = 0;
  }

  update(delta, player) {
    this.time += delta;
    const pickups = {
      coins: 0,
      nosCharge: 0,
      boostPulse: 0,
    };

    while (this.spawnCursor < player.s + 360 && this.items.length < 8) {
      this.spawnCursor = this.spawnPattern(this.spawnCursor);
    }

    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      item.spin += delta * 2.8;
      item.bob += delta * 1.8;

      if (item.s < player.s - 32) {
        this.removeItem(index);
        continue;
      }

      item.mesh.rotation.y = item.spin;
      item.mesh.rotation.z = Math.sin(item.spin * 0.55) * 0.18;
      const hoverHeight = 1.52;
      const bobHeight = 0.14;
      this.track.placeAlongTrack(
        item.mesh,
        item.s,
        item.laneOffset,
        hoverHeight + Math.sin(item.bob) * bobHeight,
        0,
        "main"
      );

      const longitudinalGap = Math.abs(item.s - player.s);
      const lateralGap = Math.abs(item.laneOffset - player.laneOffset);
      if (longitudinalGap < player.length * 0.82 && lateralGap < player.width * 0.78) {
        pickups.nosCharge += 24;
        pickups.boostPulse += 0.55;

        this.removeItem(index);
      }
    }

    return pickups;
  }

  spawnPattern(cursorS) {
    const startS = cursorS + 110 + Math.random() * 110;
    const laneIndex = Math.floor(Math.random() * LANE_OFFSETS.length);
    this.spawnItem({
      type: "nos",
      s: startS,
      laneOffset: LANE_OFFSETS[laneIndex],
    });

    if (Math.random() < 0.18) {
      const alternateLanes = [0, 1, 2].filter((index) => index !== laneIndex);
      const secondLaneIndex = alternateLanes[Math.floor(Math.random() * alternateLanes.length)];
      this.spawnItem({
        type: "nos",
        s: startS + 42 + Math.random() * 18,
        laneOffset: LANE_OFFSETS[secondLaneIndex],
      });
    }

    return startS + 150 + Math.random() * 90;
  }

  spawnItem({ type, s, laneOffset }) {
    const mesh = type === "coin" ? this.createCoin() : this.createNosCanister();
    this.items.push({
      type,
      mesh,
      s,
      laneOffset,
      spin: Math.random() * Math.PI * 2,
      bob: Math.random() * Math.PI * 2,
    });
    this.scene.add(mesh);
  }

  createCoin() {
    const coin = new THREE.Mesh(COIN_GEOMETRY, this.coinMaterial);
    return coin;
  }

  createNosCanister() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(NOS_BODY_GEOMETRY, this.nosMaterial);
    group.add(body);

    const leftCap = new THREE.Mesh(NOS_CAP_GEOMETRY, this.nosCapMaterial);
    leftCap.position.set(-0.56, 0, 0);
    group.add(leftCap);

    const rightCap = new THREE.Mesh(NOS_CAP_GEOMETRY, this.nosCapMaterial);
    rightCap.position.set(0.56, 0, 0);
    group.add(rightCap);

    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(NOS_FIN_GEOMETRY, this.nosCapMaterial);
      fin.position.set(0, side * 0.16, 0);
      group.add(fin);
    }

    return group;
  }

  removeItem(index) {
    const [item] = this.items.splice(index, 1);
    if (item) {
      this.scene.remove(item.mesh);
    }
  }
}
