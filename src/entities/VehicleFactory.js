import * as THREE from "three";

const BODY_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const LIGHT_GEOMETRY = new THREE.BoxGeometry(0.24, 0.08, 0.18);
const SIGNAL_GEOMETRY = new THREE.BoxGeometry(0.18, 0.12, 0.16);
const WHEEL_GEOMETRY = new THREE.CylinderGeometry(0.37, 0.37, 0.28, 6);
const RIM_GEOMETRY = new THREE.CylinderGeometry(0.22, 0.22, 0.31, 6);
const SHADOW_GEOMETRY = new THREE.CircleGeometry(1.9, 12);
const FLAME_GEOMETRY = new THREE.ConeGeometry(0.12, 0.54, 6);
const VEHICLE_FACTORY_QUALITY = {
  dynamicLights: true,
};

WHEEL_GEOMETRY.rotateZ(Math.PI * 0.5);
RIM_GEOMETRY.rotateZ(Math.PI * 0.5);
SHADOW_GEOMETRY.rotateX(-Math.PI * 0.5);
FLAME_GEOMETRY.rotateX(Math.PI * 0.5);

export function setVehicleFactoryQuality({ dynamicLights = VEHICLE_FACTORY_QUALITY.dynamicLights } = {}) {
  VEHICLE_FACTORY_QUALITY.dynamicLights = Boolean(dynamicLights);
}

function createMaterials({ bodyColor, accentColor, cabinColor = 0x9dc0d8 }) {
  return {
    body: new THREE.MeshStandardMaterial({
      color: bodyColor,
      flatShading: true,
      roughness: 0.6,
      metalness: 0.14,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: accentColor,
      flatShading: true,
      roughness: 0.48,
      metalness: 0.18,
    }),
    cabin: new THREE.MeshStandardMaterial({
      color: cabinColor,
      flatShading: true,
      roughness: 0.34,
      metalness: 0.08,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x33526a,
      emissive: 0x10202d,
      emissiveIntensity: 0.24,
      flatShading: true,
      roughness: 0.22,
    }),
    wheel: new THREE.MeshStandardMaterial({ color: 0x141414, flatShading: true }),
    rim: new THREE.MeshStandardMaterial({
      color: 0xb5c4cf,
      flatShading: true,
      roughness: 0.34,
      metalness: 0.42,
    }),
    headlight: new THREE.MeshStandardMaterial({
      color: 0xfff4d5,
      emissive: 0xffd585,
      emissiveIntensity: 1.12,
      toneMapped: false,
      flatShading: true,
    }),
    taillight: new THREE.MeshStandardMaterial({
      color: 0xff7360,
      emissive: 0xff4b34,
      emissiveIntensity: 1.08,
      toneMapped: false,
      flatShading: true,
    }),
    signal: new THREE.MeshStandardMaterial({
      color: 0xffca73,
      emissive: 0xff9b2f,
      emissiveIntensity: 0.52,
      transparent: true,
      opacity: 0.72,
      flatShading: true,
    }),
    shadow: new THREE.MeshBasicMaterial({
      color: 0x040506,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
    flame: new THREE.MeshBasicMaterial({
      color: 0x7fe5ff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  };
}

function addShadow(group, shadowMaterial) {
  const shadow = new THREE.Mesh(SHADOW_GEOMETRY, shadowMaterial);
  shadow.position.y = 0.03;
  group.add(shadow);
}

function addWheels(group, materials, wheelOffsets) {
  for (const [x, y, z] of wheelOffsets) {
    const wheel = new THREE.Mesh(WHEEL_GEOMETRY, materials.wheel);
    wheel.position.set(x, y, z);
    group.add(wheel);

    const rim = new THREE.Mesh(RIM_GEOMETRY, materials.rim);
    rim.position.set(x, y, z);
    group.add(rim);
  }
}

function addSignals(group, signalMaterial, offsets) {
  const leftSignals = [];
  const rightSignals = [];

  for (const offset of offsets) {
    const signal = new THREE.Mesh(SIGNAL_GEOMETRY, signalMaterial);
    signal.position.set(offset.x, offset.y, offset.z);
    signal.visible = false;
    group.add(signal);

    if (offset.side === "left") {
      leftSignals.push(signal);
    } else {
      rightSignals.push(signal);
    }
  }

  group.userData.turnSignals = {
    left: leftSignals,
    right: rightSignals,
    material: signalMaterial,
  };
}

function attachBoostFlames(group, flameMaterial, positions) {
  const flames = [];

  for (const [x, y, z] of positions) {
    const flame = new THREE.Mesh(FLAME_GEOMETRY, flameMaterial.clone());
    flame.position.set(x, y, z);
    flame.visible = false;
    group.add(flame);
    flames.push(flame);
  }

  group.userData.setBoostActive = (active, intensity = 1) => {
    for (const flame of flames) {
      flame.visible = active;
      flame.scale.setScalar(active ? 0.8 + intensity * 0.6 : 0.001);
      flame.material.opacity = 0.46 + intensity * 0.36;
    }
  };
}

function attachNightLights(
  group,
  materials,
  headlightPositions,
  tailLightPositions = [],
  { beam = false, range = 28, intensity = 1.6, rearRange = 10, rearIntensity = 0.55 } = {}
) {
  const headlightBeams = [];
  const headlightSpots = [];
  const tailLightGlows = [];
  const lightingState = {
    nightActive: false,
    nightLevel: 0,
    brakeLevel: 0,
  };

  if (beam && VEHICLE_FACTORY_QUALITY.dynamicLights) {
    for (const [x, y, z] of headlightPositions) {
      const headlightBeam = new THREE.PointLight(0xffefc4, 0, range, 2);
      headlightBeam.position.set(x, y, z + 0.55);
      group.add(headlightBeam);
      headlightBeams.push(headlightBeam);

      const target = new THREE.Object3D();
      target.position.set(x * 0.16, y - 0.28, z + 28);
      group.add(target);

      const spot = new THREE.SpotLight(0xfff1cf, 0, range * 1.9, 0.42, 0.48, 1.25);
      spot.position.set(x, y + 0.05, z + 0.18);
      spot.target = target;
      group.add(spot);
      headlightSpots.push(spot);
    }
  }

  if (VEHICLE_FACTORY_QUALITY.dynamicLights) {
    for (const [x, y, z] of tailLightPositions) {
      const tailGlow = new THREE.PointLight(0xff4b34, 0, rearRange, 2);
      tailGlow.position.set(x, y, z - 0.18);
      group.add(tailGlow);
      tailLightGlows.push(tailGlow);
    }
  }

  const applyLightingState = () => {
    const beamStrength = lightingState.nightActive ? lightingState.nightLevel : 0;
    const brakeStrength = lightingState.brakeLevel;

    materials.headlight.emissiveIntensity = lightingState.nightActive ? 1.72 + beamStrength * 1.9 : 1.12;
    materials.taillight.emissiveIntensity =
      (lightingState.nightActive ? 1.38 + beamStrength * 1.28 : 1.16) + brakeStrength * 2.1;

    for (const headlightBeam of headlightBeams) {
      headlightBeam.intensity = beamStrength > 0 ? intensity + beamStrength * 4.2 : 0;
    }

    for (const headlightSpot of headlightSpots) {
      headlightSpot.intensity = beamStrength > 0 ? intensity * 1.4 + beamStrength * 5.4 : 0;
    }

    for (const tailLightGlow of tailLightGlows) {
      tailLightGlow.intensity =
        (lightingState.nightActive ? rearIntensity + beamStrength * 1.6 : rearIntensity * 0.58) + brakeStrength * 1.85;
    }
  };

  const previousHandler = group.userData.setNightLights;
  group.userData.setNightLights = (active, nightLevel = 1) => {
    previousHandler?.(active, nightLevel);
    lightingState.nightActive = active;
    lightingState.nightLevel = active ? nightLevel : 0;
    applyLightingState();
  };

  group.userData.setBrakeLights = (amount = 0) => {
    lightingState.brakeLevel = THREE.MathUtils.clamp(amount, 0, 1);
    applyLightingState();
  };

  applyLightingState();
}

function buildPlayerSportsCar({
  bodyColor = 0xff6b57,
  accentColor = 0x1f7ff0,
  cabinColor = 0xa8cde8,
} = {}) {
  const group = new THREE.Group();
  const materials = createMaterials({ bodyColor, accentColor, cabinColor });

  addShadow(group, materials.shadow);

  const body = new THREE.Mesh(BODY_GEOMETRY, materials.body);
  body.scale.set(2.28, 0.54, 4.7);
  body.position.y = 0.8;
  group.add(body);

  const frontBumper = new THREE.Mesh(BODY_GEOMETRY, materials.accent);
  frontBumper.scale.set(2.06, 0.18, 0.54);
  frontBumper.position.set(0, 0.68, 2.36);
  group.add(frontBumper);

  const rearBumper = new THREE.Mesh(BODY_GEOMETRY, materials.accent);
  rearBumper.scale.set(2.02, 0.18, 0.6);
  rearBumper.position.set(0, 0.7, -2.28);
  group.add(rearBumper);

  const hood = new THREE.Mesh(BODY_GEOMETRY, materials.body);
  hood.scale.set(1.84, 0.2, 1.3);
  hood.position.set(0, 1.0, 1.44);
  group.add(hood);

  const hoodScoop = new THREE.Mesh(BODY_GEOMETRY, materials.accent);
  hoodScoop.scale.set(0.72, 0.12, 0.42);
  hoodScoop.position.set(0, 1.12, 1.18);
  group.add(hoodScoop);

  const cabin = new THREE.Mesh(BODY_GEOMETRY, materials.cabin);
  cabin.scale.set(1.48, 0.56, 1.86);
  cabin.position.set(0, 1.38, -0.22);
  group.add(cabin);

  const windshield = new THREE.Mesh(BODY_GEOMETRY, materials.glass);
  windshield.scale.set(1.28, 0.34, 0.92);
  windshield.position.set(0, 1.46, 0.38);
  windshield.rotation.x = -0.22;
  group.add(windshield);

  const rearGlass = new THREE.Mesh(BODY_GEOMETRY, materials.glass);
  rearGlass.scale.set(1.2, 0.3, 0.88);
  rearGlass.position.set(0, 1.42, -0.82);
  rearGlass.rotation.x = 0.18;
  group.add(rearGlass);

  const sideSkirtLeft = new THREE.Mesh(BODY_GEOMETRY, materials.accent);
  sideSkirtLeft.scale.set(0.16, 0.14, 2.8);
  sideSkirtLeft.position.set(-1.14, 0.58, -0.05);
  group.add(sideSkirtLeft);

  const sideSkirtRight = sideSkirtLeft.clone();
  sideSkirtRight.position.x = 1.14;
  group.add(sideSkirtRight);

  const spoilerPostLeft = new THREE.Mesh(BODY_GEOMETRY, materials.accent);
  spoilerPostLeft.scale.set(0.1, 0.36, 0.12);
  spoilerPostLeft.position.set(-0.66, 1.3, -2.04);
  group.add(spoilerPostLeft);

  const spoilerPostRight = spoilerPostLeft.clone();
  spoilerPostRight.position.x = 0.66;
  group.add(spoilerPostRight);

  const spoilerWing = new THREE.Mesh(BODY_GEOMETRY, materials.accent);
  spoilerWing.scale.set(1.72, 0.12, 0.34);
  spoilerWing.position.set(0, 1.5, -2.08);
  group.add(spoilerWing);

  const headlightOffsets = [
    [-0.72, 0.98, 2.28],
    [0.72, 0.98, 2.28],
  ];
  for (const [x, y, z] of headlightOffsets) {
    const headlight = new THREE.Mesh(LIGHT_GEOMETRY, materials.headlight);
    headlight.position.set(x, y, z);
    group.add(headlight);
  }

  const tailOffsets = [
    [-0.78, 0.94, -2.34],
    [0.78, 0.94, -2.34],
  ];
  for (const [x, y, z] of tailOffsets) {
    const taillight = new THREE.Mesh(LIGHT_GEOMETRY, materials.taillight);
    taillight.position.set(x, y, z);
    group.add(taillight);
  }

  attachNightLights(group, materials, headlightOffsets, tailOffsets, {
    beam: true,
    range: 68,
    intensity: 4.8,
    rearRange: 14,
    rearIntensity: 0.9,
  });

  addSignals(group, materials.signal, [
    { side: "left", x: -0.94, y: 0.98, z: 2.2 },
    { side: "right", x: 0.94, y: 0.98, z: 2.2 },
    { side: "left", x: -0.94, y: 0.94, z: -2.24 },
    { side: "right", x: 0.94, y: 0.94, z: -2.24 },
  ]);

  addWheels(group, materials, [
    [-1.08, 0.38, 1.56],
    [1.08, 0.38, 1.56],
    [-1.08, 0.38, -1.44],
    [1.08, 0.38, -1.44],
  ]);

  attachBoostFlames(group, materials.flame, [
    [-0.34, 0.76, -2.6],
    [0.34, 0.76, -2.6],
  ]);

  const cockpitAnchor = new THREE.Object3D();
  cockpitAnchor.position.set(0, 1.62, 0.16);
  group.add(cockpitAnchor);

  const lookAheadAnchor = new THREE.Object3D();
  lookAheadAnchor.position.set(0, 1.52, 10.5);
  group.add(lookAheadAnchor);

  const rearLookAnchor = new THREE.Object3D();
  rearLookAnchor.position.set(0, 1.5, -10.5);
  group.add(rearLookAnchor);

  group.userData.cameraAnchors = {
    cockpit: cockpitAnchor,
    lookAhead: lookAheadAnchor,
    rearLook: rearLookAnchor,
  };

  return group;
}

function buildSedanCar({ bodyColor, accentColor, cabinColor = 0xa9bdca } = {}) {
  const group = new THREE.Group();
  const materials = createMaterials({ bodyColor, accentColor, cabinColor });

  addShadow(group, materials.shadow);

  const body = new THREE.Mesh(BODY_GEOMETRY, materials.body);
  body.scale.set(2.18, 0.7, 4.42);
  body.position.y = 0.88;
  group.add(body);

  const bonnet = new THREE.Mesh(BODY_GEOMETRY, materials.accent);
  bonnet.scale.set(1.78, 0.2, 1.06);
  bonnet.position.set(0, 1.04, 1.48);
  group.add(bonnet);

  const roof = new THREE.Mesh(BODY_GEOMETRY, materials.cabin);
  roof.scale.set(1.52, 0.72, 1.88);
  roof.position.set(0, 1.48, -0.06);
  group.add(roof);

  const windshield = new THREE.Mesh(BODY_GEOMETRY, materials.glass);
  windshield.scale.set(1.3, 0.42, 1.08);
  windshield.position.set(0, 1.6, 0.18);
  windshield.rotation.x = -0.12;
  group.add(windshield);

  const rearShelf = new THREE.Mesh(BODY_GEOMETRY, materials.accent);
  rearShelf.scale.set(1.84, 0.24, 0.84);
  rearShelf.position.set(0, 1.02, -1.82);
  group.add(rearShelf);

  const headlights = [
    [-0.72, 0.98, 2.18],
    [0.72, 0.98, 2.18],
  ];
  for (const [x, y, z] of headlights) {
    const lamp = new THREE.Mesh(LIGHT_GEOMETRY, materials.headlight);
    lamp.position.set(x, y, z);
    group.add(lamp);
  }

  const tails = [
    [-0.74, 0.98, -2.16],
    [0.74, 0.98, -2.16],
  ];
  for (const [x, y, z] of tails) {
    const lamp = new THREE.Mesh(LIGHT_GEOMETRY, materials.taillight);
    lamp.position.set(x, y, z);
    group.add(lamp);
  }

  addWheels(group, materials, [
    [-1.04, 0.38, 1.44],
    [1.04, 0.38, 1.44],
    [-1.04, 0.38, -1.34],
    [1.04, 0.38, -1.34],
  ]);

  attachNightLights(group, materials, headlights, tails, {
    beam: true,
    range: 18,
    intensity: 0.9,
    rearRange: 11,
    rearIntensity: 0.7,
  });

  return group;
}

function buildPoliceCar() {
  const group = buildSedanCar({
    bodyColor: 0xf1f3f6,
    accentColor: 0x1c2330,
    cabinColor: 0xc6d6e2,
  });

  const doorPanelLeft = new THREE.Mesh(
    BODY_GEOMETRY,
    new THREE.MeshStandardMaterial({ color: 0x1b2430, flatShading: true, roughness: 0.52 })
  );
  doorPanelLeft.scale.set(0.18, 0.48, 1.92);
  doorPanelLeft.position.set(-1.04, 0.98, -0.02);
  group.add(doorPanelLeft);

  const doorPanelRight = doorPanelLeft.clone();
  doorPanelRight.position.x = 1.04;
  group.add(doorPanelRight);

  const lightRedMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6678,
    emissive: 0xff3344,
    emissiveIntensity: 0.34,
    flatShading: true,
  });
  const lightBlueMaterial = new THREE.MeshStandardMaterial({
    color: 0x7ac8ff,
    emissive: 0x1b7cff,
    emissiveIntensity: 0.34,
    flatShading: true,
  });

  const lightbarBase = new THREE.Mesh(
    BODY_GEOMETRY,
    new THREE.MeshStandardMaterial({ color: 0xd9dee4, flatShading: true, roughness: 0.34 })
  );
  lightbarBase.scale.set(0.96, 0.12, 0.26);
  lightbarBase.position.set(0, 1.98, -0.06);
  group.add(lightbarBase);

  const redLight = new THREE.Mesh(BODY_GEOMETRY, lightRedMaterial);
  redLight.scale.set(0.36, 0.12, 0.22);
  redLight.position.set(-0.26, 2.04, -0.06);
  group.add(redLight);

  const blueLight = new THREE.Mesh(BODY_GEOMETRY, lightBlueMaterial);
  blueLight.scale.set(0.36, 0.12, 0.22);
  blueLight.position.set(0.26, 2.04, -0.06);
  group.add(blueLight);

  let redGlow = null;
  let blueGlow = null;
  if (VEHICLE_FACTORY_QUALITY.dynamicLights) {
    redGlow = new THREE.PointLight(0xff4458, 0, 10, 2);
    redGlow.position.set(-0.28, 2.18, -0.06);
    group.add(redGlow);

    blueGlow = new THREE.PointLight(0x3f8bff, 0, 10, 2);
    blueGlow.position.set(0.28, 2.18, -0.06);
    group.add(blueGlow);
  }

  group.userData.emergencyLights = {
    red: [redLight],
    blue: [blueLight],
    redMaterial: lightRedMaterial,
    blueMaterial: lightBlueMaterial,
    redGlow,
    blueGlow,
  };

  return group;
}

function buildTaxiCar() {
  const group = buildSedanCar({
    bodyColor: 0xf4c542,
    accentColor: 0x232323,
    cabinColor: 0xbfd2de,
  });

  const roofSign = new THREE.Mesh(
    BODY_GEOMETRY,
    new THREE.MeshStandardMaterial({
      color: 0xf9f6ef,
      emissive: 0xffcf54,
      emissiveIntensity: 0.28,
      flatShading: true,
    })
  );
  roofSign.scale.set(0.5, 0.16, 0.36);
  roofSign.position.set(0, 2.02, -0.1);
  group.add(roofSign);

  return group;
}

function buildBus() {
  const group = new THREE.Group();
  const materials = createMaterials({
    bodyColor: 0xd7e0e8,
    accentColor: 0x2a6f97,
    cabinColor: 0xaac4d6,
  });

  addShadow(group, materials.shadow);

  const lowerBody = new THREE.Mesh(BODY_GEOMETRY, materials.body);
  lowerBody.scale.set(2.7, 1.05, 8.9);
  lowerBody.position.y = 1.0;
  group.add(lowerBody);

  const upperBody = new THREE.Mesh(BODY_GEOMETRY, materials.accent);
  upperBody.scale.set(2.48, 0.78, 8.5);
  upperBody.position.y = 2.0;
  group.add(upperBody);

  const frontGlass = new THREE.Mesh(BODY_GEOMETRY, materials.glass);
  frontGlass.scale.set(2.18, 0.72, 0.42);
  frontGlass.position.set(0, 2.12, 4.12);
  frontGlass.rotation.x = -0.12;
  group.add(frontGlass);

  for (const zOffset of [-2.9, -1.35, 0.2, 1.75, 3.3]) {
    const windowBandLeft = new THREE.Mesh(BODY_GEOMETRY, materials.glass);
    windowBandLeft.scale.set(0.14, 0.54, 0.94);
    windowBandLeft.position.set(-1.29, 2.08, zOffset);
    group.add(windowBandLeft);

    const windowBandRight = windowBandLeft.clone();
    windowBandRight.position.x = 1.29;
    group.add(windowBandRight);
  }

  for (const [x, y, z] of [
    [-0.86, 1.46, 4.44],
    [0.86, 1.46, 4.44],
    [-0.86, 1.34, -4.44],
    [0.86, 1.34, -4.44],
  ]) {
    const lamp = new THREE.Mesh(LIGHT_GEOMETRY, z > 0 ? materials.headlight : materials.taillight);
    lamp.position.set(x, y, z);
    group.add(lamp);
  }

  addWheels(group, materials, [
    [-1.34, 0.48, 3.45],
    [1.34, 0.48, 3.45],
    [-1.34, 0.48, 0.7],
    [1.34, 0.48, 0.7],
    [-1.34, 0.48, -2.2],
    [1.34, 0.48, -2.2],
  ]);

  attachNightLights(
    group,
    materials,
    [
      [-0.86, 1.46, 4.44],
      [0.86, 1.46, 4.44],
    ],
    [
      [-0.86, 1.34, -4.44],
      [0.86, 1.34, -4.44],
    ],
    {
      beam: true,
      range: 22,
      intensity: 1.1,
      rearRange: 12,
      rearIntensity: 0.8,
    }
  );

  return group;
}

function hashSeed(value) {
  const seedString = String(value || "seed");
  let hash = 0;
  for (let index = 0; index < seedString.length; index += 1) {
    hash = (hash * 31 + seedString.charCodeAt(index)) >>> 0;
  }

  return hash >>> 0;
}

function addRivalLivery(group, { accentColor, stripeColor, variant = 0 }) {
  const stripeMaterial = new THREE.MeshStandardMaterial({
    color: stripeColor,
    emissive: stripeColor,
    emissiveIntensity: 0.08,
    flatShading: true,
    roughness: 0.42,
    metalness: 0.24,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    flatShading: true,
    roughness: 0.4,
    metalness: 0.2,
  });

  const splitter = new THREE.Mesh(BODY_GEOMETRY, trimMaterial);
  splitter.scale.set(1.82, 0.08, 0.34);
  splitter.position.set(0, 0.58, 2.48);
  group.add(splitter);

  const diffuser = new THREE.Mesh(BODY_GEOMETRY, trimMaterial);
  diffuser.scale.set(1.54, 0.1, 0.28);
  diffuser.position.set(0, 0.62, -2.48);
  group.add(diffuser);

  if (variant === 0) {
    for (const xOffset of [-0.26, 0.26]) {
      const stripe = new THREE.Mesh(BODY_GEOMETRY, stripeMaterial);
      stripe.scale.set(0.12, 0.05, 4.08);
      stripe.position.set(xOffset, 1.12, -0.06);
      group.add(stripe);
    }
  } else if (variant === 1) {
    const stripe = new THREE.Mesh(BODY_GEOMETRY, stripeMaterial);
    stripe.scale.set(0.28, 0.05, 3.96);
    stripe.position.set(0, 1.12, -0.04);
    group.add(stripe);

    const hoodStripe = new THREE.Mesh(BODY_GEOMETRY, trimMaterial);
    hoodStripe.scale.set(0.92, 0.05, 0.86);
    hoodStripe.position.set(0, 1.16, 1.28);
    group.add(hoodStripe);
  } else {
    for (const side of [-1, 1]) {
      const flash = new THREE.Mesh(BODY_GEOMETRY, stripeMaterial);
      flash.scale.set(0.08, 0.2, 2.22);
      flash.position.set(side * 1.12, 0.9, 0.22);
      flash.rotation.z = side * 0.18;
      group.add(flash);
    }
  }
}

export function createPlayerCar() {
  return buildPlayerSportsCar();
}

export function createRivalCar(seedValue = "") {
  const palettes = [
    [0xff6b57, 0x1f7ff0, 0xfefefe],
    [0x44b8ff, 0xffd166, 0xffffff],
    [0x9b5de5, 0xfee440, 0xf4f1de],
    [0x00bb8f, 0xff6b6b, 0xffffff],
    [0xe76f51, 0x2a9d8f, 0xf8f5f1],
    [0x2ec4b6, 0xff9f1c, 0xfefae0],
    [0xff4d6d, 0x3a86ff, 0xffffff],
    [0x7b2cbf, 0x80ed99, 0xfefefe],
  ];

  const hash = hashSeed(seedValue || "rival");
  const [bodyColor, accentColor, stripeColor] = palettes[hash % palettes.length];
  const group = buildPlayerSportsCar({
    bodyColor,
    accentColor,
    cabinColor: (hash & 1) === 0 ? 0xb8d2e6 : 0xaec8db,
  });
  addRivalLivery(group, {
    accentColor,
    stripeColor,
    variant: (hash >>> 3) % 3,
  });
  return group;
}

export function createTrafficCar() {
  const palettes = [
    [0x324c7b, 0x8ecae6],
    [0x264653, 0xe9c46a],
    [0x6d597a, 0xe56b6f],
    [0x505a66, 0xf4a261],
    [0x335c67, 0xb7c8d6],
  ];

  const [bodyColor, accentColor] = palettes[Math.floor(Math.random() * palettes.length)];
  return buildSedanCar({ bodyColor, accentColor });
}

export function createPoliceCar() {
  return buildPoliceCar();
}

export function createTaxiCar() {
  return buildTaxiCar();
}

export function createBus() {
  return buildBus();
}
