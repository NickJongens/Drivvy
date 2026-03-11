import * as THREE from "three";
import { createPlayerCar, createRivalCar, setVehicleFactoryQuality } from "./entities/VehicleFactory.js";
import { TrafficSystem } from "./entities/TrafficSystem.js";
import { InputController } from "./systems/InputController.js";
import { CollectibleSystem } from "./systems/CollectibleSystem.js";
import { FeedbackSystem } from "./systems/FeedbackSystem.js";
import { LeaderboardService } from "./systems/LeaderboardService.js";
import { MultiplayerClient } from "./systems/MultiplayerClient.js";
import { ScenerySystem } from "./systems/ScenerySystem.js";
import { TelemetryService } from "./systems/TelemetryService.js";
import { TrackingConsentService } from "./systems/TrackingConsentService.js";
import { WeatherSystem } from "./systems/WeatherSystem.js";
import { Hud } from "./ui/Hud.js";
import { LANE_WIDTH, TrackManager } from "./world/TrackManager.js";

const CAMERA_LAG = 5.5;
const LOOK_LAG = 6.5;
const CONTROLS_HINT_DURATION = 7;
const MAIN_LANE_OFFSETS = [-LANE_WIDTH, 0, LANE_WIDTH];
const LANE_OCCUPANCY_THRESHOLD = LANE_WIDTH * 0.58;
const AUTOPILOT_STORAGE_KEY = "drivvy.aiAssist";
const PLAYER_NAME_STORAGE_KEY = "drivvy.playerName";
const SECRET_STORAGE_KEY = "drivvy.secretMenu";
const GRAPHICS_PRESET_STORAGE_KEY = "drivvy.graphicsPreset";
const VIBRATION_STORAGE_KEY = "drivvy.vibration";
const ACCESSIBILITY_PROMPT_SEEN_STORAGE_KEY = "drivvy.a11yPromptSeen";
const HIGH_CONTRAST_STORAGE_KEY = "drivvy.highContrast";
const COLOR_ASSIST_STORAGE_KEY = "drivvy.colorAssist";
const LEGACY_AUTOPILOT_STORAGE_KEY = "polySprint.autopilot";
const LEGACY_PLAYER_NAME_STORAGE_KEY = "polySprint.playerName";
const LEGACY_SECRET_STORAGE_KEY = "polySprint.secretMenu";
const MULTIPLAYER_SEND_INTERVAL = 0.08;
const MULTIPLAYER_TARGET_DISTANCE = 6000;
const MULTIPLAYER_ROLLING_SPEED = 32;
const GRAPHICS_PRESETS = {
  low: {
    label: "Low",
    maxPixelRatio: 1,
    renderScale: 0.72,
    cameraFar: 900,
    rearMirror: false,
    sceneryFlocks: 1,
    particleBudget: 120,
    dynamicVehicleLights: false,
    trackQuality: "low",
  },
  medium: {
    label: "Balanced",
    maxPixelRatio: 1.35,
    renderScale: 0.84,
    cameraFar: 1000,
    rearMirror: true,
    sceneryFlocks: 1,
    particleBudget: 180,
    dynamicVehicleLights: false,
    trackQuality: "medium",
  },
  high: {
    label: "High",
    maxPixelRatio: 1.75,
    renderScale: 1,
    cameraFar: 1800,
    rearMirror: true,
    sceneryFlocks: 4,
    particleBudget: 700,
    dynamicVehicleLights: true,
    trackQuality: "high",
  },
};
const MULTIPLAYER_CLEAR_WEATHER = {
  id: "clear",
  label: "Clear",
  grip: 1,
  visibility: 1,
  fogColor: 0x89b2cf,
  fogDensity: 0.0018,
  ambient: 1.35,
  sunlight: 1.1,
  particleRate: 0,
  trafficModifier: 0,
  speedFactor: 1,
  skyColor: 0x89b2cf,
  particleType: "none",
  nightLevel: 0,
};

function readStoredValue(key, fallback = "", legacyKey = "") {
  try {
    const currentValue = window.localStorage.getItem(key);
    if (currentValue !== null) {
      return currentValue;
    }

    if (legacyKey) {
      const legacyValue = window.localStorage.getItem(legacyKey);
      if (legacyValue !== null) {
        window.localStorage.setItem(key, legacyValue);
        return legacyValue;
      }
    }

    return fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    return;
  }
}

function normalizeGraphicsPreset(value) {
  if (Object.prototype.hasOwnProperty.call(GRAPHICS_PRESETS, value)) {
    return value;
  }

  return "medium";
}

export class Game {
  constructor({ mount, hudElements }) {
    this.mount = mount;
    this.hud = new Hud(hudElements);
    this.leaderboardService = new LeaderboardService();
    this.telemetryService = new TelemetryService();
    this.trackingConsentService = new TrackingConsentService();
    this.multiplayerClient = new MultiplayerClient();
    this.feedbackSystem = new FeedbackSystem({
      vibrationEnabled: readStoredValue(VIBRATION_STORAGE_KEY, "1") !== "0",
    });
    this.highContrastEnabled = readStoredValue(HIGH_CONTRAST_STORAGE_KEY, "0") === "1";
    this.colorAssistEnabled = readStoredValue(COLOR_ASSIST_STORAGE_KEY, "0") === "1";
    this.accessibilityExposureBias = 0;
    this.accessibilityPromptSeen = readStoredValue(ACCESSIBILITY_PROMPT_SEEN_STORAGE_KEY, "0") === "1";
    this.graphicsPreset = normalizeGraphicsPreset(readStoredValue(GRAPHICS_PRESET_STORAGE_KEY, "medium"));
    this.graphics = GRAPHICS_PRESETS[this.graphicsPreset];

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.autoClear = false;
    this.mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x89b2cf);

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1800);
    this.camera.position.set(0, 8, -12);

    this.skyLight = new THREE.HemisphereLight(0xd9efff, 0x304534, 1.35);
    this.sunLight = new THREE.DirectionalLight(0xffefcf, 1.1);
    this.sunLight.position.set(80, 120, -60);
    this.scene.add(this.skyLight, this.sunLight);

    this.skyAccent = this.createSkyAccent();
    this.scene.add(this.skyAccent.group);

    setVehicleFactoryQuality({ dynamicLights: this.graphics.dynamicVehicleLights });
    this.track = new TrackManager(this.scene, { qualityPreset: this.graphics.trackQuality });
    this.weatherSystem = new WeatherSystem(this.scene);
    this.trafficSystem = new TrafficSystem(this.scene, this.track, { qualityPreset: this.graphicsPreset });
    this.scenerySystem = new ScenerySystem(this.scene, this.track);
    this.collectibleSystem = new CollectibleSystem(this.scene, this.track);
    this.input = new InputController(this.mount);

    this.player = {
      mesh: createPlayerCar(),
      s: 0,
      laneOffset: 0,
      targetLaneOffset: 0,
      lateralVelocity: 0,
      speed: 0,
      baseCruiseSpeed: 18,
      baseMaxSpeed: 60,
      width: 2.4,
      length: 4.9,
      steerVisual: 0,
      nosCharge: 12,
      coins: 0,
      boostActive: false,
      route: {
        branchId: null,
      },
    };

    this.scene.add(this.player.mesh);
    this.crashEffect = this.createCrashEffect();
    this.player.mesh.add(this.crashEffect.group);
    this.multiplayerRaceMarkers = this.createMultiplayerRaceMarkers();
    this.scene.add(this.multiplayerRaceMarkers.group);

    this.clock = new THREE.Clock();
    this.cameraLookAt = new THREE.Vector3();
    this.cameraUp = new THREE.Vector3();
    this.cameraForward = new THREE.Vector3();
    this.cameraRight = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.tempQuaternion = new THREE.Quaternion();
    this.playerSample = this.track.sample(0, 0);
    this.laneState = this.track.getLaneState(0, 0, this.player.route);
    this.weather = this.weatherSystem.getCurrent();
    this.state = "boot";
    this.indicatorTime = 0;
    this.routeTransitionTime = 0;
    this.pursuitState = { active: false, activeCount: 0, nearestGap: null };
    this.crashOverlayDelay = 0;
    this.crashDistance = 0;
    this.crashMotion = this.createCrashMotionState();
    this.controlsHintTime = 0;
    this.multiplayerTrafficPenaltyTime = 0;
    this.hasRunStarted = false;
    this.menuCanResume = false;
    this.scoreSubmitted = false;
    this.aiEnabled = readStoredValue(AUTOPILOT_STORAGE_KEY, "0", LEGACY_AUTOPILOT_STORAGE_KEY) === "1";
    this.secretMenuUnlocked = readStoredValue(SECRET_STORAGE_KEY, "0", LEGACY_SECRET_STORAGE_KEY) === "1";
    this.trackingConsent = this.trackingConsentService.getChoice();
    this.trackingSessionId = this.trackingConsent === "accepted" ? this.trackingConsentService.getSessionId() : "";
    this.trackingSessionRegistered = false;
    this.currentTrackSeed = this.createSoloSeed();
    this.lookBehindActive = false;
    this.attractTime = 0;

    this.multiplayer = {
      mode: "solo",
      lobby: null,
      race: {
        active: false,
        startAt: 0,
        targetDistance: 0,
        trackSeed: 0,
        startGrid: [],
        finished: false,
        finishTime: null,
        results: null,
        countdownCleared: false,
      },
      remotePlayers: new Map(),
      sendAccumulator: 0,
      position: 1,
      playerCount: 1,
      lastRaceState: null,
      waitingLobbies: [],
      status: "Online mode unavailable.",
      powerups: {
        clear: {
          cooldown: 0,
          activeTime: 0,
        },
        turbo: {
          cooldown: 0,
          activeTime: 0,
        },
      },
    };

    this.handleResize = this.handleResize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
    this.animate = this.animate.bind(this);

    this.hud.setRestartHandler(() => this.startNewRun());
    this.hud.setMainMenuHandler(() => this.openMenu({ canResume: false }));
    this.hud.setMenuPlayHandler(() => this.handleMenuPlay());
    this.hud.setMenuNewRunHandler(() => this.startNewRun());
    this.hud.setMenuOpenHandler(() => this.toggleMenu());
    this.hud.setMenuModeHandler((mode) => this.setMenuMode(mode));
    this.hud.setAiToggleHandler((nextValue) => this.setAiEnabled(nextValue));
    this.hud.setGraphicsPresetHandler((preset) => this.setGraphicsPreset(preset));
    this.hud.setTrackingConsentHandler((choice) => this.setTrackingConsent(choice));
    this.hud.setAccessibilityNameContinueHandler(() => this.handleAccessibilityNameContinue());
    this.hud.setAccessibilityPromptYesHandler(() => this.handleAccessibilityPromptYes());
    this.hud.setAccessibilityPromptNoHandler(() => this.handleAccessibilityPromptNo());
    this.hud.setAccessibilityPromptContinueHandler(() => this.handleAccessibilityPromptContinue());
    this.hud.setAccessibilityReviewHandler(() => this.showAccessibilityPrompt({ step: "setup" }));
    this.hud.setHighContrastHandler(() => this.toggleHighContrast());
    this.hud.setColorAssistHandler(() => this.toggleColorAssist());
    this.hud.setFullscreenHandler(() => {
      void this.toggleFullscreen();
    });
    this.hud.setVibrationToggleHandler(() => this.setVibrationEnabled(!this.feedbackSystem.isVibrationEnabled()));
    this.hud.setSecretUnlockHandler(() => {
      this.secretMenuUnlocked = true;
      writeStoredValue(SECRET_STORAGE_KEY, "1");
      this.hud.setMenuStatus("Assist controls unlocked.");
    });
    this.hud.setMultiplayerCreateHandler(() => {
      void this.handleMultiplayerCreateLobby();
    });
    this.hud.setMultiplayerJoinHandler(() => {
      void this.handleMultiplayerJoinLobby();
    });
    this.hud.setMultiplayerRefreshHandler(() => {
      void this.requestWaitingLobbies();
    });
    this.hud.setWaitingLobbyJoinHandler((code) => {
      void this.handleMultiplayerJoinLobby(code);
    });
    this.hud.setMultiplayerReadyHandler(() => {
      void this.handleMultiplayerToggleReady();
    });
    this.hud.setMultiplayerStartHandler(() => {
      void this.handleMultiplayerStartRace();
    });
    this.hud.setMultiplayerLeaveHandler(() => {
      void this.handleMultiplayerLeaveLobby();
    });

    this.multiplayerClient.onStatus = (message) => {
      this.multiplayer.status = message;
      this.hud.setMultiplayerStatus(message);
    };
    this.multiplayerClient.onLobbyState = (message) => {
      this.handleMultiplayerLobbyState(message);
    };
    this.multiplayerClient.onWaitingLobbies = (message) => {
      this.handleMultiplayerWaitingLobbies(message);
    };
    this.multiplayerClient.onRaceStarted = (message) => {
      this.handleMultiplayerRaceStarted(message);
    };
    this.multiplayerClient.onRaceState = (message) => {
      this.handleMultiplayerRaceState(message);
    };
    this.multiplayerClient.onRaceFinished = (message) => {
      this.handleMultiplayerRaceFinished(message);
    };
    this.multiplayerClient.onError = (message) => {
      this.multiplayer.status = message;
      this.hud.setMultiplayerStatus(message);
    };

    if (this.secretMenuUnlocked) {
      this.hud.unlockSecretMenu();
    }

    this.hud.setAiEnabled(this.aiEnabled);
    this.hud.setGraphicsPreset(this.graphicsPreset);
    this.hud.setFullscreenAvailable(this.isFullscreenSupported());
    this.hud.setAccessibilitySettings({
      highContrast: this.highContrastEnabled,
      colorAssist: this.colorAssistEnabled,
    });
    this.hud.setAccessibilityStatus(this.getAccessibilityStatusLabel());
    this.hud.setVibrationEnabled(
      this.feedbackSystem.isVibrationEnabled(),
      this.feedbackSystem.isVibrationSupported()
    );
    this.hud.setPlayerName(readStoredValue(PLAYER_NAME_STORAGE_KEY, "", LEGACY_PLAYER_NAME_STORAGE_KEY));
    this.hud.setMultiplayerStatus(this.multiplayer.status);
    this.hud.setControlsVisible(true);
    this.hud.setControlsText?.(this.getAdaptiveControlsText());
    this.applyAccessibilitySettings(
      {
        highContrast: this.highContrastEnabled,
        colorAssist: this.colorAssistEnabled,
      },
      { persist: false, silent: true }
    );
    this.applyGraphicsPreset(this.graphicsPreset, { persist: false, silent: true });
    this.syncTrackingConsentUi();
    this.handleFullscreenChange();
    this.handleResize();
    this.resetRun({ seed: this.currentTrackSeed });
    this.openMenu({ canResume: false });
    this.showAccessibilityPromptIfNeeded();
    this.loadLeaderboard();
    void this.registerTrackingSession();
  }

  start() {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    document.addEventListener("visibilitychange", this.handleVisibility);
    document.addEventListener("fullscreenchange", this.handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", this.handleFullscreenChange);
    this.clock.start();
    requestAnimationFrame(this.animate);
  }

  getTrackingConsentLabel() {
    if (this.trackingConsent === "accepted") {
      return "Tracking allowed. Play runs, the chosen driver name, and in-memory visitor details are available through the stats API.";
    }

    if (this.trackingConsent === "declined") {
      return "Tracking declined. Drivvy will not record analytics, driver names, IP addresses, or browser details.";
    }

    return "Tracking is undecided. Choose whether Drivvy may store a consent cookie and record run analytics including the chosen driver name.";
  }

  syncTrackingConsentUi() {
    this.hud.setTrackingStatus(this.getTrackingConsentLabel());
    if (this.hud.isAccessibilityPromptVisible?.()) {
      this.hud.hideTrackingConsent();
      return;
    }
    if (this.trackingConsent) {
      this.hud.hideTrackingConsent();
      return;
    }

    this.hud.showTrackingConsent();
  }

  getAccessibilityStatusLabel() {
    if (this.highContrastEnabled && this.colorAssistEnabled) {
      return "High contrast and color assist are active.";
    }

    if (this.highContrastEnabled) {
      return "High contrast is active.";
    }

    if (this.colorAssistEnabled) {
      return "Color assist is active.";
    }

    return "Standard visibility is active.";
  }

  applyAccessibilitySettings(
    { highContrast = this.highContrastEnabled, colorAssist = this.colorAssistEnabled } = {},
    { persist = true, silent = false } = {}
  ) {
    this.highContrastEnabled = Boolean(highContrast);
    this.colorAssistEnabled = Boolean(colorAssist);
    this.accessibilityExposureBias = this.highContrastEnabled ? 0.18 : this.colorAssistEnabled ? 0.08 : 0;
    document.body.classList.toggle("theme-high-contrast", this.highContrastEnabled);
    document.body.classList.toggle("theme-color-assist", this.colorAssistEnabled);
    this.renderer.domElement.style.filter =
      this.highContrastEnabled && this.colorAssistEnabled
        ? "contrast(1.18) saturate(1.12) brightness(1.05)"
        : this.highContrastEnabled
          ? "contrast(1.16) brightness(1.05)"
          : this.colorAssistEnabled
            ? "saturate(1.15) contrast(1.04)"
            : "";
    this.track.setAccessibility({
      highContrast: this.highContrastEnabled,
      colorAssist: this.colorAssistEnabled,
    });
    this.weatherSystem.setAccessibility({
      highContrast: this.highContrastEnabled,
      colorAssist: this.colorAssistEnabled,
    });
    this.collectibleSystem.setAccessibility({
      highContrast: this.highContrastEnabled,
      colorAssist: this.colorAssistEnabled,
    });
    this.hud.setAccessibilitySettings({
      highContrast: this.highContrastEnabled,
      colorAssist: this.colorAssistEnabled,
    });
    this.hud.setAccessibilityStatus(this.getAccessibilityStatusLabel());

    if (persist) {
      writeStoredValue(HIGH_CONTRAST_STORAGE_KEY, this.highContrastEnabled ? "1" : "0");
      writeStoredValue(COLOR_ASSIST_STORAGE_KEY, this.colorAssistEnabled ? "1" : "0");
    }

    if (!silent) {
      this.hud.setMenuStatus(this.getAccessibilityStatusLabel());
    }
  }

  toggleHighContrast() {
    this.applyAccessibilitySettings({
      highContrast: !this.highContrastEnabled,
      colorAssist: this.colorAssistEnabled,
    });
  }

  toggleColorAssist() {
    this.applyAccessibilitySettings({
      highContrast: this.highContrastEnabled,
      colorAssist: !this.colorAssistEnabled,
    });
  }

  showAccessibilityPrompt({ step = "name" } = {}) {
    this.hud.showAccessibilityPrompt({ step });
    this.hud.hideTrackingConsent();
    if (step === "name") {
      this.hud.focusOnboardingNameInput?.();
    }
  }

  hideAccessibilityPrompt() {
    this.hud.hideAccessibilityPrompt();
    this.syncTrackingConsentUi();
  }

  showAccessibilityPromptIfNeeded() {
    if (this.accessibilityPromptSeen) {
      return;
    }

    const hasStoredName = Boolean(this.hud.getPlayerName().trim());
    this.showAccessibilityPrompt({ step: hasStoredName ? "question" : "name" });
  }

  handleAccessibilityNameContinue() {
    const trimmed = this.hud.getOnboardingName().replace(/\s+/g, " ").trim();
    const name = trimmed.slice(0, 18) || "Guest";
    this.hud.setPlayerName(name);
    writeStoredValue(PLAYER_NAME_STORAGE_KEY, name);
    this.showAccessibilityPrompt({ step: "question" });
  }

  handleAccessibilityPromptYes() {
    this.applyAccessibilitySettings({ highContrast: true, colorAssist: true }, { silent: true });
    this.showAccessibilityPrompt({ step: "setup" });
  }

  handleAccessibilityPromptNo() {
    this.accessibilityPromptSeen = true;
    writeStoredValue(ACCESSIBILITY_PROMPT_SEEN_STORAGE_KEY, "1");
    this.hideAccessibilityPrompt();
  }

  handleAccessibilityPromptContinue() {
    this.accessibilityPromptSeen = true;
    writeStoredValue(ACCESSIBILITY_PROMPT_SEEN_STORAGE_KEY, "1");
    this.hideAccessibilityPrompt();
    this.hud.setMenuStatus(this.getAccessibilityStatusLabel());
  }

  setTrackingConsent(choice) {
    this.trackingConsent = choice === "accepted" ? "accepted" : "declined";
    this.trackingSessionId = this.trackingConsentService.setChoice(this.trackingConsent);
    this.trackingSessionRegistered = false;
    this.syncTrackingConsentUi();

    if (this.trackingConsent === "accepted") {
      this.hud.setMenuStatus("Tracking enabled. Stats can now include play runs and consenting visitor details.");
      void this.registerTrackingSession();
      return;
    }

    this.hud.setMenuStatus("Tracking declined. Analytics and visitor details stay off for this browser.");
  }

  async registerTrackingSession() {
    if (this.trackingConsent !== "accepted" || this.trackingSessionRegistered) {
      return;
    }

    try {
      const sessionId = this.trackingSessionId || this.trackingConsentService.getSessionId();
      if (!sessionId) {
        return;
      }

      this.trackingSessionId = sessionId;
      await this.telemetryService.registerSession({
        sessionId,
        consent: true,
      });
      this.trackingSessionRegistered = true;
    } catch (error) {
      return;
    }
  }

  recordRunTelemetry(mode = this.multiplayer.mode, trackSeed = this.currentTrackSeed) {
    if (this.trackingConsent !== "accepted") {
      return;
    }

    const name = this.capturePlayerName();
    void this.registerTrackingSession().then(() =>
      this.telemetryService.recordRun({
        sessionId: this.trackingSessionId,
        consent: true,
        name,
        mode,
        trackSeed,
      }).catch(() => {})
    );
  }

  recordScoreTelemetry(distance) {
    if (this.trackingConsent !== "accepted" || distance < 1) {
      return;
    }

    void this.registerTrackingSession().then(() =>
      this.telemetryService.recordScore({
        sessionId: this.trackingSessionId,
        consent: true,
        distance,
        mode: this.multiplayer.mode,
        weather: this.weather.label,
        aiEnabled: this.aiEnabled,
      }).catch(() => {})
    );
  }

  createSoloSeed() {
    return ((Date.now() & 0xffffffff) ^ ((performance.now() * 1000) | 0) ^ 0x9e3779b9) >>> 0;
  }

  resetRun({ seed = this.createSoloSeed(), multiplayer = false } = {}) {
    this.currentTrackSeed = seed >>> 0;
    this.track.reset(this.currentTrackSeed);
    this.weatherSystem.reset();
    this.weather = multiplayer ? { ...MULTIPLAYER_CLEAR_WEATHER } : this.weatherSystem.getCurrent();

    this.player.s = 0;
    this.player.laneOffset = 0;
    this.player.targetLaneOffset = 0;
    this.player.lateralVelocity = 0;
    this.player.speed = 0;
    this.player.steerVisual = 0;
    this.player.route.branchId = null;

    this.trafficSystem.reset(0);
    this.scenerySystem.reset(0, this.player.route);
    this.collectibleSystem.reset(0);
    this.clearRemotePlayers();

    this.indicatorTime = 0;
    this.routeTransitionTime = 0;
    this.scoreSubmitted = false;
    this.attractTime = 0;
    this.crashOverlayDelay = 0;
    this.crashDistance = 0;
    this.multiplayerTrafficPenaltyTime = 0;
    this.input.resetState();
    this.player.nosCharge = multiplayer ? 48 : 12;
    this.player.coins = 0;
    this.player.boostActive = false;
    this.pursuitState = { active: false, activeCount: 0, nearestGap: null };
    this.player.mesh.userData.setBoostActive?.(false, 0);
    this.feedbackSystem.reset();
    this.resetCrashEffect();
    this.resetCrashMotion();
    this.resetMultiplayerPowerups();

    this.playerSample = this.track.placeAlongTrack(
      this.player.mesh,
      this.player.s,
      this.player.laneOffset,
      1.05,
      0,
      this.player.route
    );
    this.laneState = this.track.getLaneState(this.player.s, this.player.laneOffset, this.player.route);
    this.camera.position.copy(this.playerSample.position).add(new THREE.Vector3(0, 8, -16));
    this.cameraLookAt.copy(this.playerSample.position).add(new THREE.Vector3(0, 2, 22));
    this.snapCameraToCurrentView();
    this.hud.hideCrash();
    this.hud.setScoreStatus("Score will save on impact once high scores are ready.");
    this.updateMultiplayerRaceMarkers();
    this.clock.getDelta();
  }

  startNewRun() {
    if (this.multiplayer.mode === "multiplayer") {
      return;
    }

    this.capturePlayerName();
    void this.feedbackSystem.unlockAudio();
    this.resetRun({ seed: this.createSoloSeed() });
    this.lookBehindActive = false;
    this.snapCameraToCurrentView();
    this.player.speed = this.player.baseCruiseSpeed * 0.7;
    this.controlsHintTime = CONTROLS_HINT_DURATION;
    this.hud.setControlsVisible(true);
    this.hasRunStarted = true;
    this.menuCanResume = false;
    this.state = "running";
    this.hud.hideMenu();
    this.hud.hideTrackingConsent();
    this.recordRunTelemetry("solo", this.currentTrackSeed);
    this.clock.getDelta();
  }

  resumeRun() {
    if (this.isMultiplayerRaceActive()) {
      return;
    }

    this.capturePlayerName();
    void this.feedbackSystem.unlockAudio();
    this.controlsHintTime = CONTROLS_HINT_DURATION;
    this.hud.setControlsVisible(true);
    this.menuCanResume = false;
    this.state = "running";
    this.hud.hideMenu();
    this.hud.hideTrackingConsent();
    this.clock.getDelta();
  }

  openMenu({ canResume = this.hasRunStarted && this.state === "running" && !this.isMultiplayerRaceActive() } = {}) {
    if (this.state === "running") {
      this.state = "menu";
    } else if (this.state === "crashed") {
      this.state = "menu";
      this.hud.hideCrash();
    } else if (!this.hasRunStarted) {
      this.state = "menu";
    }

    this.capturePlayerName();
    this.input.resetState();
    this.controlsHintTime = 0;
    this.hud.setControlsVisible(true);
    this.menuCanResume = canResume;
    this.hud.showMenu({
      canResume,
      aiEnabled: this.aiEnabled,
      mode: this.multiplayer.mode,
    });
    if (!this.hud.getPlayerName().trim()) {
      this.hud.focusNameInput?.();
    }
    this.syncTrackingConsentUi();

    if (this.multiplayer.mode === "multiplayer") {
      void this.requestWaitingLobbies();
    }
  }

  toggleMenu() {
    this.handleMenuToggleRequest();
  }

  handleMenuPlay() {
    if (this.multiplayer.mode === "multiplayer") {
      return;
    }

    if (this.state === "menu" && this.menuCanResume) {
      this.resumeRun();
      return;
    }

    this.startNewRun();
  }

  setMenuMode(mode) {
    if (mode === "options") {
      this.hud.setMenuMode("options");
      return;
    }

    const nextMode = mode === "multiplayer" ? "multiplayer" : "solo";
    if (this.isMultiplayerRaceActive()) {
      return;
    }

    if (this.multiplayer.mode === nextMode) {
      this.hud.setMenuMode(nextMode);
      return;
    }

    this.multiplayer.mode = nextMode;
    this.hud.setMenuMode(nextMode);

    if (nextMode === "multiplayer") {
      this.setAiEnabled(false);
      this.hud.setMultiplayerStatus(this.multiplayer.status);
      void this.requestWaitingLobbies();
      return;
    }

    if (this.multiplayer.lobby) {
      void this.multiplayerClient.leaveLobby();
    }
    this.multiplayer.lobby = null;
    this.multiplayer.lastRaceState = null;
    this.resetMultiplayerRaceState();
    this.clearRemotePlayers();
    this.hud.clearLobbyState();
  }

  handleMenuToggleRequest() {
    if (this.isMultiplayerRaceActive() || this.hud.isAccessibilityPromptVisible?.()) {
      return;
    }

    if (this.state === "running") {
      this.openMenu({ canResume: true });
      return;
    }

    if (this.state === "menu" && this.menuCanResume) {
      this.resumeRun();
      return;
    }

    if (this.state === "crashed") {
      this.openMenu({ canResume: false });
    }
  }

  async requestWaitingLobbies() {
    try {
      await this.multiplayerClient.requestWaitingLobbies();
    } catch (error) {
      this.hud.setMultiplayerStatus(error.message);
    }
  }

  handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  handleKeyDown(event) {
    const lowerKey = event.key.toLowerCase();
    const typingTarget = this.input.isTypingTarget(event);

    if (event.key === "Escape") {
      event.preventDefault();
      this.handleMenuToggleRequest();
      return;
    }

    if (!typingTarget && lowerKey === "v") {
      event.preventDefault();
      this.lookBehindActive = true;
      return;
    }

    if (this.state === "menu" && event.key === "Enter" && document.activeElement === this.hud.playerNameInput) {
      event.preventDefault();
      if (this.multiplayer.mode === "solo") {
        this.handleMenuPlay();
      }
      return;
    }

    if (
      this.state === "crashed" &&
      (event.key === "Enter" || lowerKey === "r" || event.code === "Space")
    ) {
      event.preventDefault();
      this.startNewRun();
    }
  }

  handleKeyUp(event) {
    if (this.input.isTypingTarget(event)) {
      return;
    }

    if (event.key.toLowerCase() === "v") {
      this.lookBehindActive = false;
    }
  }

  handleVisibility() {
    if (!document.hidden) {
      this.clock.getDelta();
    }
  }

  animate() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.update(delta);
    this.renderFrame();
    requestAnimationFrame(this.animate);
  }

  update(delta) {
    const previousPlayerS = this.player.s;
    this.input.update();
    if (this.input.consumeMenuPress()) {
      this.handleMenuToggleRequest();
    }
    if (this.state === "running" && this.isMultiplayerRaceActive()) {
      this.handleMultiplayerPowerupInput();
    }
    this.routeTransitionTime = Math.max(0, this.routeTransitionTime - delta);

    if (this.state === "running") {
      if (this.isMultiplayerRaceActive()) {
        this.updateMultiplayer(delta);
      } else {
        this.updateSolo(delta);
      }
    } else {
      if (!this.hasRunStarted && this.multiplayer.mode === "solo") {
        this.weather = this.weatherSystem.update(delta * 0.35);
        this.updateAttractMode(delta);
        this.track.ensure(this.player.s, this.player.route);
        this.trafficSystem.update(delta * 0.75, this.player, this.weather);
        this.scenerySystem.update(delta, this.player.s, this.player.route);
      } else if (this.state === "crashed") {
        this.updateCrashMotion(delta);
      } else if (this.multiplayer.mode === "multiplayer") {
        this.weather = { ...MULTIPLAYER_CLEAR_WEATHER };
        this.track.ensure(this.player.s, this.player.route);
        this.scenerySystem.update(delta, this.player.s, this.player.route);
        this.updateRemotePlayers(delta);
      }

      this.playerSample = this.track.placeAlongTrack(
        this.player.mesh,
        this.player.s,
        this.player.laneOffset,
        1.05,
        -this.player.steerVisual * 0.18,
        this.player.route
      );
      if (this.state === "crashed") {
        this.applyCrashPose();
      }

      this.player.mesh.userData.setBoostActive?.(false, 0);
    }

    this.laneState = this.track.getLaneState(this.player.s, this.player.laneOffset, this.player.route);
    this.updateTurnSignals(delta, this.laneState.signal);
    this.track.setIceZoneVisibility(this.weather.id === "ice");
    this.weatherSystem.applyVisuals(this.playerSample, this.weather, this.skyLight, this.sunLight, delta);
    const nightLevel = this.weather.nightLevel || 0;
    this.renderer.toneMappingExposure = THREE.MathUtils.damp(
      this.renderer.toneMappingExposure,
      1.12 - nightLevel * 0.24 + this.accessibilityExposureBias,
      3.8,
      delta
    );
    this.player.mesh.userData.setNightLights?.(nightLevel > 0.08, nightLevel);
    this.updateCamera(delta);
    this.updateSkyAccent();
    this.updateCrashEffect(delta);
    this.updateCrashOverlay(delta);
    this.updateControlsHint(delta);
    this.updateFeedback(delta, previousPlayerS);
    this.hud.update({
      speed: this.player.speed,
      distance: this.player.s,
      weather: this.weather.label,
      lane: this.laneState.label,
      nos: this.player.nosCharge,
      coins: this.player.coins,
      pursuit: this.getPursuitLabel(),
      race: this.getRaceLabel(),
      assist: this.aiEnabled ? "Drive Assist" : "Manual",
    });
    this.updateMultiplayerRaceMarkers();
  }

  updateFeedback(delta, previousPlayerS) {
    if (this.state === "running" && !this.hud.isMenuVisible()) {
      this.playTrafficPassBySounds(previousPlayerS);
    }

    const policeGap =
      this.multiplayer.mode === "solo" && this.pursuitState.active ? this.pursuitState.nearestGap : null;
    this.feedbackSystem.update({
      delta,
      running: this.state === "running",
      speed: this.player.speed,
      boostActive: this.player.boostActive,
      policeGap,
    });
  }

  playTrafficPassBySounds(previousPlayerS) {
    const activeRouteId = this.player.route.branchId || "main";

    for (const vehicle of this.trafficSystem.vehicles) {
      if (vehicle.routeId !== activeRouteId || vehicle.kind === "police") {
        continue;
      }

      if (Math.abs(vehicle.laneOffset - this.player.laneOffset) > LANE_WIDTH * 1.35) {
        continue;
      }

      if (this.player.s <= vehicle.s + 1.2 || previousPlayerS > vehicle.s + 3) {
        continue;
      }

      if ((vehicle.lastPassSoundS ?? -Infinity) > this.player.s - 24) {
        continue;
      }

      vehicle.lastPassSoundS = this.player.s;
      this.feedbackSystem.playPassBy(Math.max(8, this.player.speed - vehicle.speed));
    }
  }

  updateSolo(delta) {
    this.weather = this.weatherSystem.update(delta);
    this.updatePlayer(delta, this.weather);

    this.track.ensure(this.player.s, this.player.route);
    this.playerSample = this.track.placeAlongTrack(
      this.player.mesh,
      this.player.s,
      this.player.laneOffset,
      1.05,
      -this.player.steerVisual * 0.18,
      this.player.route
    );
    this.trafficSystem.update(delta, this.player, this.weather);
    this.scenerySystem.update(delta, this.player.s, this.player.route);
    const pickups = this.collectibleSystem.update(delta, this.player);
    this.applyPickups(pickups);
    this.pursuitState = this.trafficSystem.getPoliceState(this.player.s);

    if (this.trafficSystem.checkCollision(this.player)) {
      this.handleCrash();
    }
  }

  updateMultiplayer(delta) {
    this.weather = { ...MULTIPLAYER_CLEAR_WEATHER };
    this.updateMultiplayerPowerups(delta);
    const countdownSeconds = Math.max(0, (this.multiplayer.race.startAt - Date.now()) / 1000);

    if (countdownSeconds <= 0) {
      if (!this.multiplayer.race.countdownCleared) {
        this.multiplayer.race.countdownCleared = true;
        this.player.speed = Math.max(this.player.speed, MULTIPLAYER_ROLLING_SPEED);
        this.hud.setMultiplayerStatus("Go.");
      }
      this.updatePlayer(delta, this.weather);
    } else {
      this.updateMultiplayerRollingStart(delta);
      this.player.mesh.userData.setBoostActive?.(false, 0);
    }

    this.track.ensure(this.player.s, this.player.route);
    this.playerSample = this.track.placeAlongTrack(
      this.player.mesh,
      this.player.s,
      this.player.laneOffset,
      1.05,
      -this.player.steerVisual * 0.18,
      this.player.route
    );
    this.trafficSystem.update(delta, this.player, {
      ...this.weather,
      trafficModifier: 0.92,
    }, {
      allowPolice: false,
      allowRacers: false,
      priorityVehicles: this.getPriorityRaceVehicles(),
      roadClearActive: this.multiplayer.powerups.clear.activeTime > 0,
    });
    this.scenerySystem.update(delta, this.player.s, this.player.route);
    this.updateRemotePlayers(delta);
    this.syncMultiplayerPlayerState(delta);
    this.multiplayerTrafficPenaltyTime = Math.max(0, this.multiplayerTrafficPenaltyTime - delta);

    if (this.multiplayerTrafficPenaltyTime === 0 && this.trafficSystem.checkCollision(this.player)) {
      this.applyMultiplayerTrafficPenalty();
    }

    if (!this.multiplayer.race.finished && this.player.s >= this.multiplayer.race.targetDistance) {
      this.multiplayer.race.finished = true;
      this.multiplayer.race.finishTime = Date.now();
      this.hud.setMultiplayerStatus("Finished. Waiting for the other drivers...");
    }
  }

  updateMultiplayerRollingStart(delta) {
    const startSlot = this.getMultiplayerStartSlot(this.multiplayerClient.clientId);
    if (startSlot) {
      this.player.targetLaneOffset = startSlot.laneOffset;
    }

    const laneError = this.player.targetLaneOffset - this.player.laneOffset;
    this.player.lateralVelocity = THREE.MathUtils.damp(this.player.lateralVelocity, laneError * 2.8, 6.5, delta);
    this.player.laneOffset += this.player.lateralVelocity * delta;
    this.player.speed = THREE.MathUtils.damp(this.player.speed, MULTIPLAYER_ROLLING_SPEED, 4.5, delta);
    this.player.s += this.player.speed * delta;
    this.player.steerVisual = THREE.MathUtils.damp(this.player.steerVisual, laneError * 0.1, 6, delta);
    this.player.boostActive = false;
  }

  updatePlayer(delta, weather) {
    const bounds = this.track.getDrivingBounds(this.player.s, this.player.route);
    const laneTargets = this.track.getLaneTargets(this.player.s, this.player.route);
    const autopilot =
      this.aiEnabled && this.multiplayer.mode === "solo" ? this.getAutoPilotCommand(bounds, weather) : null;

    if (autopilot) {
      this.player.targetLaneOffset = this.pickNearestLaneTarget(autopilot.targetOffset, laneTargets, bounds);
    } else if (this.input.hasManualSteer()) {
      const manualTarget = this.input.getSteeringTarget(bounds);
      const laneProbe =
        this.player.laneOffset +
        THREE.MathUtils.clamp(manualTarget - this.player.laneOffset, -LANE_WIDTH * 1.22, LANE_WIDTH * 1.22);
      this.player.targetLaneOffset = this.pickNearestLaneTarget(laneProbe, laneTargets, bounds);
    } else if (!this.hasLaneTarget(this.player.targetLaneOffset, laneTargets)) {
      this.player.targetLaneOffset = this.pickNearestLaneTarget(this.player.laneOffset, laneTargets, bounds);
    }

    const targetOffset = THREE.MathUtils.clamp(this.player.targetLaneOffset, bounds.right, bounds.left);
    const throttleAmount = autopilot ? autopilot.throttle : this.input.getThrottle();
    const brakeAmount = autopilot ? autopilot.brake : this.input.getBrake();
    const wantsBoost =
      !this.hud.isMenuVisible() &&
      this.player.nosCharge > 0 &&
      (
        this.input.getBoost() > 0 ||
        this.multiplayer.powerups.turbo.activeTime > 0 ||
        (this.aiEnabled && this.pursuitState.active && this.player.nosCharge > 28)
      );
    const boostDrain = wantsBoost ? Math.min(this.player.nosCharge, delta * 30) : 0;
    const boostRatio = boostDrain / Math.max(delta * 30, 0.0001);
    this.player.nosCharge = Math.max(0, this.player.nosCharge - boostDrain);
    this.player.boostActive = boostRatio > 0.05;
    if (this.multiplayer.mode === "multiplayer" && !this.player.boostActive) {
      this.player.nosCharge = Math.min(72, this.player.nosCharge + delta * 8);
    }
    const surfaceEffect = this.track.getSurfaceEffect(this.player.s, this.player.laneOffset, weather, this.player.route);
    const grip = Math.max(0.24, weather.grip * (surfaceEffect.grip || 1));
    const steeringRange = Math.max(bounds.left, Math.abs(bounds.right), 0.001);
    const steeringInput = targetOffset / steeringRange;

    const steeringForce = steeringInput * (30 * grip) + (targetOffset - this.player.laneOffset) * (20 * grip);
    this.player.lateralVelocity += steeringForce * delta;
    if (surfaceEffect.blackIce) {
      this.player.lateralVelocity += surfaceEffect.sideDrift * delta * 5.4;
    }
    this.player.lateralVelocity *= Math.exp(-delta * ((surfaceEffect.blackIce ? 2.9 : 5.2) / grip));
    this.player.lateralVelocity = THREE.MathUtils.clamp(this.player.lateralVelocity, -18, 18);
    this.player.laneOffset += this.player.lateralVelocity * delta;
    this.player.laneOffset = THREE.MathUtils.clamp(this.player.laneOffset, bounds.right, bounds.left);

    if (this.player.laneOffset >= bounds.left - 0.15 || this.player.laneOffset <= bounds.right + 0.15) {
      this.player.lateralVelocity *= 0.55;
    }

    const cornerPenalty = Math.min(Math.abs(this.player.lateralVelocity) * 0.03, 0.12);
    const cruiseSpeed = this.player.baseCruiseSpeed * weather.speedFactor;
    const maxSpeed = this.player.baseMaxSpeed * weather.speedFactor;
    let targetSpeed = cruiseSpeed;
    let speedResponse = 3.4;

    if (throttleAmount > 0 && brakeAmount === 0) {
      targetSpeed = THREE.MathUtils.lerp(cruiseSpeed, maxSpeed, throttleAmount);
      speedResponse = THREE.MathUtils.lerp(3.4, 4.8, throttleAmount);
    } else if (brakeAmount > 0 && throttleAmount === 0) {
      targetSpeed = THREE.MathUtils.lerp(cruiseSpeed * 0.65, 2, brakeAmount);
      speedResponse = THREE.MathUtils.lerp(4.5, 7.2, brakeAmount);
    } else if (throttleAmount > 0 && brakeAmount > 0) {
      targetSpeed = cruiseSpeed * 0.55;
      speedResponse = 5.6;
    }

    if (boostRatio > 0) {
      targetSpeed = Math.min(
        maxSpeed + 34 * boostRatio,
        Math.max(targetSpeed, cruiseSpeed + 18 * boostRatio, this.player.speed + 8 * boostRatio) + 26 * boostRatio
      );
      speedResponse += 5 * boostRatio;
    }

    this.player.speed = THREE.MathUtils.damp(this.player.speed, targetSpeed, speedResponse, delta);
    if (boostRatio > 0) {
      this.player.speed += 8.5 * boostRatio * delta;
    }
    this.player.speed *= 1 - cornerPenalty * (boostRatio > 0 ? 0.72 : 1) * delta * 6;
    this.player.speed = Math.max(this.player.speed, 0);

    this.player.s += this.player.speed * delta;
    this.player.steerVisual = THREE.MathUtils.damp(this.player.steerVisual, steeringInput, 13, delta);
    const brakeLightAmount = Math.max(
      brakeAmount,
      THREE.MathUtils.clamp((this.player.speed - targetSpeed) / 10, 0, 1)
    );

    if (!this.aiEnabled && !this.input.hasManualSteer()) {
      this.player.laneOffset = THREE.MathUtils.damp(this.player.laneOffset, targetOffset, 7.5, delta);
    }

    this.player.mesh.userData.setBoostActive?.(this.player.boostActive, boostRatio);
    this.player.mesh.userData.setBrakeLights?.(brakeLightAmount);
  }

  updateAttractMode(delta) {
    this.attractTime += delta;
    this.player.boostActive = false;
    this.player.speed = THREE.MathUtils.damp(this.player.speed, 24, 1.8, delta);
    const targetOffset = Math.sin(this.attractTime * 0.21) * LANE_WIDTH * 0.52;
    this.player.laneOffset = THREE.MathUtils.damp(this.player.laneOffset, targetOffset, 1.5, delta);
    this.player.targetLaneOffset = targetOffset;
    this.player.steerVisual = THREE.MathUtils.damp(
      this.player.steerVisual,
      THREE.MathUtils.clamp((targetOffset - this.player.laneOffset) / Math.max(LANE_WIDTH, 0.001), -1, 1),
      2.4,
      delta
    );
    this.player.s += this.player.speed * delta;
  }

  applyMultiplayerTrafficPenalty() {
    this.multiplayerTrafficPenaltyTime = 1.4;
    this.player.speed = Math.min(this.player.speed, Math.max(7, this.player.baseCruiseSpeed * 0.45));
    this.player.lateralVelocity *= -0.18;
    this.player.nosCharge = Math.max(0, this.player.nosCharge - 8);
    this.hud.setMultiplayerStatus("Traffic hit. Speed lost.");
  }

  updateControlsHint(delta) {
    this.hud.setControlsText?.(this.getAdaptiveControlsText());
    if (this.state !== "running") {
      this.hud.setControlsVisible(true);
      return;
    }

    if (this.controlsHintTime > 0) {
      this.controlsHintTime = Math.max(0, this.controlsHintTime - delta);
      this.hud.setControlsVisible(true);
      return;
    }

    this.hud.setControlsVisible(false);
  }

  getAdaptiveControlsText() {
    const gamepad = this.input.isGamepadActive();
    const inMultiplayerRace = this.isMultiplayerRaceActive();

    if (gamepad) {
      if (inMultiplayerRace) {
        return "Stick steers. RT drives. LT brakes. X or Y boosts. LB clears traffic. RB triggers turbo. Menu pauses.";
      }

      return "Stick steers. RT drives. LT brakes. X or Y boosts. Menu pauses.";
    }

    if (inMultiplayerRace) {
      return "WASD or arrows drive. Shift boosts. Enter uses race power. Q clears traffic. E triggers turbo. Esc pauses.";
    }

    if (this.input.getLastInputSource?.() === "mouse") {
      return "Move the mouse to steer. Left click drives. Right click brakes. Shift boosts. Esc opens the menu.";
    }

    return "WASD or arrows drive. Shift boosts. Esc opens the menu.";
  }

  getAutoPilotCommand(bounds, weather) {
    const routeId = "main";
    const currentLaneIndex = this.trafficSystem.getNearestLaneIndex(this.player.laneOffset);
    const targetLaneIndex = this.trafficSystem.getNearestLaneIndex(this.player.targetLaneOffset);
    const occupiedLaneIndices = this.getOccupiedLaneIndices(this.player.laneOffset);
    const currentHazard = this.getClosestHazard(routeId, occupiedLaneIndices);
    const laneChoice = this.pickAutoPilotLane(routeId, currentLaneIndex, targetLaneIndex, currentHazard);
    const laneMetrics = this.trafficSystem.getLaneMetrics(routeId, laneChoice, this.player.s);
    let desiredOffset = MAIN_LANE_OFFSETS[laneChoice];
    desiredOffset = THREE.MathUtils.clamp(desiredOffset, bounds.right, bounds.left);

    let targetSpeed = this.player.baseMaxSpeed * weather.speedFactor * 0.93;
    targetSpeed = Math.min(targetSpeed, this.getTrafficSpeedCap(currentHazard));
    targetSpeed = Math.min(
      targetSpeed,
      this.getTrafficSpeedCap(
        laneMetrics.aheadVehicle
          ? { vehicle: laneMetrics.aheadVehicle, gap: laneMetrics.aheadGap, laneIndex: laneChoice }
          : null
      )
    );

    if (currentHazard?.gap < 10) {
      targetSpeed = Math.min(targetSpeed, Math.max(1.5, currentHazard.vehicle.speed - 14));
    }

    let throttle = 0;
    let brake = 0;
    if (currentHazard?.gap < 9) {
      brake = 1;
    } else if (currentHazard?.gap < 13 && this.player.speed > currentHazard.vehicle.speed + 1) {
      brake = 0.8;
    } else if (this.player.speed < targetSpeed - 3) {
      throttle = 1;
    } else if (this.player.speed < targetSpeed - 0.6) {
      throttle = 0.45;
    } else if (this.player.speed > targetSpeed + 2) {
      brake = 1;
    } else if (this.player.speed > targetSpeed + 0.8) {
      brake = 0.45;
    }

    return { targetOffset: desiredOffset, throttle, brake };
  }

  pickAutoPilotLane(routeId, currentLaneIndex, targetLaneIndex, currentHazard) {
    const isTransitioning = Math.abs(this.player.laneOffset - MAIN_LANE_OFFSETS[targetLaneIndex]) > 0.55;

    if (isTransitioning && this.trafficSystem.isLaneAvailable(routeId, targetLaneIndex, this.player.s, 18, 12)) {
      return targetLaneIndex;
    }

    let bestLane = currentLaneIndex;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let laneIndex = 0; laneIndex < MAIN_LANE_OFFSETS.length; laneIndex += 1) {
      const metrics = this.trafficSystem.getLaneMetrics(routeId, laneIndex, this.player.s);
      if (
        laneIndex !== currentLaneIndex &&
        !this.trafficSystem.isLaneAvailable(routeId, laneIndex, this.player.s, 24, 14)
      ) {
        continue;
      }

      const aheadScore = Math.min(metrics.aheadGap, 92);
      const laneChangePenalty = Math.abs(laneIndex - currentLaneIndex) * 10;
      const targetBonus = laneIndex === targetLaneIndex ? 8 : 0;
      const centerBonus = laneIndex === 1 ? 6 : 0;
      const blockPenalty = metrics.aheadGap < 14 ? 40 : metrics.aheadGap < 22 ? 18 : 0;
      const transitionPenalty = isTransitioning && laneIndex !== targetLaneIndex ? 9 : 0;
      const escapeBonus =
        currentHazard && currentHazard.gap < 18 && laneIndex !== currentHazard.laneIndex ? 14 : 0;
      const score =
        aheadScore +
        targetBonus +
        centerBonus +
        escapeBonus -
        laneChangePenalty -
        blockPenalty -
        transitionPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestLane = laneIndex;
      }
    }

    return bestLane;
  }

  updateTurnSignals(delta, signalDirection) {
    this.indicatorTime += delta;

    const turnSignals = this.player.mesh.userData.turnSignals;
    if (!turnSignals) {
      return;
    }

    const blinkOn = Math.floor(this.indicatorTime * 3.8) % 2 === 0;
    turnSignals.material.emissiveIntensity = signalDirection === 0 ? 0.16 : blinkOn ? 1.05 : 0.28;

    for (const signal of turnSignals.left) {
      signal.visible = signalDirection < 0 && blinkOn;
    }

    for (const signal of turnSignals.right) {
      signal.visible = signalDirection > 0 && blinkOn;
    }

    this.hud.updateTurnIndicator(signalDirection, blinkOn);
  }

  updateCamera(delta) {
    const { routeBoost, targetFov } = this.populateCameraRig();
    const cameraAlpha = 1 - Math.exp(-(CAMERA_LAG * routeBoost) * delta);
    const lookAlpha = 1 - Math.exp(-(LOOK_LAG * routeBoost) * delta);

    this.camera.position.lerp(this.cameraTarget, cameraAlpha);
    this.cameraLookAt.lerp(this.lookTarget, lookAlpha);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, this.player.boostActive ? 7.5 : 4.5, delta);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraLookAt);
  }

  renderFrame() {
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  populateCameraRig() {
    this.player.mesh.updateWorldMatrix(true, false);
    this.player.mesh.getWorldQuaternion(this.tempQuaternion);
    this.cameraForward.set(0, 0, 1).applyQuaternion(this.tempQuaternion).normalize();
    this.cameraRight.set(1, 0, 0).applyQuaternion(this.tempQuaternion).normalize();
    this.cameraUp.set(0, 1, 0).applyQuaternion(this.tempQuaternion).normalize();
    const speedFactor = THREE.MathUtils.clamp(this.player.speed / Math.max(this.player.baseMaxSpeed, 0.001), 0, 1);
    const lookingBack = this.lookBehindActive;
    const cinematic = !this.hasRunStarted && this.multiplayer.mode === "solo";
    const routeBoost = cinematic ? 1.2 : this.routeTransitionTime > 0 ? 1.9 : 1;
    let targetFov = 63.5;

    if (cinematic) {
      const orbit = Math.sin(this.attractTime * 0.24);
      const sweep = Math.cos(this.attractTime * 0.18);
      this.cameraTarget
        .copy(this.playerSample.position)
        .addScaledVector(this.cameraForward, -(18.5 + sweep * 1.4))
        .addScaledVector(this.cameraRight, orbit * 8.4)
        .addScaledVector(this.cameraUp, 7 + sweep * 0.7);

      this.lookTarget
        .copy(this.playerSample.position)
        .addScaledVector(this.cameraForward, 18.5)
        .addScaledVector(this.cameraRight, -orbit * 1.2)
        .addScaledVector(this.cameraUp, 2.7);

      targetFov = 66.5 + Math.abs(orbit) * 1.8;
      return { routeBoost, targetFov };
    }

    if (this.isMultiplayerRaceCountdownActive()) {
      const countdownFactor = THREE.MathUtils.clamp(
        1 - (this.multiplayer.race.startAt - Date.now()) / 5000,
        0,
        1
      );
      this.cameraTarget
        .copy(this.playerSample.position)
        .addScaledVector(this.cameraForward, -(23 - countdownFactor * 4))
        .addScaledVector(this.cameraRight, 9 - countdownFactor * 4.5)
        .addScaledVector(this.cameraUp, 7 - countdownFactor * 0.8);

      this.lookTarget
        .copy(this.playerSample.position)
        .addScaledVector(this.cameraForward, 26)
        .addScaledVector(this.cameraRight, -1.2)
        .addScaledVector(this.cameraUp, 2.6);

      targetFov = 66 - countdownFactor * 2;
      return { routeBoost: 1.25, targetFov };
    }

    if (lookingBack) {
      this.cameraTarget
        .copy(this.playerSample.position)
        .addScaledVector(this.cameraForward, 8.2)
        .addScaledVector(this.cameraRight, -this.player.laneOffset * 0.04)
        .addScaledVector(this.cameraUp, 4.9);

      this.lookTarget
        .copy(this.playerSample.position)
        .addScaledVector(this.cameraForward, -30)
        .addScaledVector(this.cameraRight, -this.player.laneOffset * 0.14)
        .addScaledVector(this.cameraUp, 2.4);

      targetFov = 64.5;
      return { routeBoost, targetFov };
    }

    this.cameraTarget
      .copy(this.playerSample.position)
      .addScaledVector(this.cameraForward, -16.8)
      .addScaledVector(this.cameraRight, this.player.laneOffset * 0.06)
      .addScaledVector(this.cameraUp, 7.3);

    this.lookTarget
      .copy(this.playerSample.position)
      .addScaledVector(this.cameraForward, 24.5)
      .addScaledVector(this.cameraRight, this.player.steerVisual * 0.45)
      .addScaledVector(this.cameraUp, 2.8);

    targetFov = 63.5 + speedFactor * 2.1 + (this.player.boostActive ? 4.8 : 0);
    return { routeBoost, targetFov };
  }

  snapCameraToCurrentView() {
    const { targetFov } = this.populateCameraRig();
    this.camera.position.copy(this.cameraTarget);
    this.cameraLookAt.copy(this.lookTarget);
    this.camera.fov = targetFov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraLookAt);
  }

  createMultiplayerRaceMarkers() {
    const group = new THREE.Group();
    group.visible = false;

    const startLine = this.createRaceMarker();
    const finishLine = this.createRaceMarker();
    finishLine.add(this.createFinishGate());
    finishLine.add(this.createCrowdSection(-1));
    finishLine.add(this.createCrowdSection(1));
    group.add(startLine, finishLine);

    return {
      group,
      startLine,
      finishLine,
    };
  }

  createRaceMarker() {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH * 4, 5.2),
      this.getRaceMarkerMaterial()
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    group.add(mesh);
    return group;
  }

  createFinishGate() {
    const gate = new THREE.Group();
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4f6fb,
      flatShading: true,
      metalness: 0.08,
      roughness: 0.46,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0x111418,
      emissive: 0xffffff,
      emissiveIntensity: 0.08,
      flatShading: true,
    });

    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5.4, 0.9), postMaterial);
      post.position.set(side * (LANE_WIDTH * 1.8), 2.7, 0);
      gate.add(post);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.4), trimMaterial);
      foot.position.set(side * (LANE_WIDTH * 1.8), 0.22, 0);
      gate.add(foot);
    }

    const arch = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 4.2, 0.9, 1.1), trimMaterial);
    arch.position.set(0, 5.35, 0);
    gate.add(arch);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH * 3.3, 1.35),
      this.getFinishBannerMaterial()
    );
    banner.position.set(0, 4.35, 0.56);
    gate.add(banner);

    for (const side of [-1, 1]) {
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 1.7, 0.18),
        trimMaterial
      );
      flag.position.set(side * (LANE_WIDTH * 1.55), 6.4, 0);
      gate.add(flag);

      const pennant = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.48, 0.08),
        new THREE.MeshStandardMaterial({
          color: side < 0 ? 0xff5f5f : 0xffd166,
          emissive: side < 0 ? 0xff7373 : 0xffd166,
          emissiveIntensity: 0.18,
          flatShading: true,
        })
      );
      pennant.position.set(side * (LANE_WIDTH * 1.38), 6.1, 0);
      gate.add(pennant);
    }

    return gate;
  }

  createCrowdSection(side = 1) {
    const group = new THREE.Group();
    group.position.set(side * (LANE_WIDTH * 2.6), 0, 0);

    const barrierMaterial = new THREE.MeshStandardMaterial({
      color: 0xd6dee6,
      flatShading: true,
      roughness: 0.54,
    });
    const personPalette = [0xff6b57, 0x2ec4b6, 0xffd166, 0x6ea8ff, 0xffffff, 0x8bd450];

    const barrier = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 18), barrierMaterial);
    barrier.position.set(side * 0.32, 0.35, 0);
    group.add(barrier);

    for (let index = 0; index < 11; index += 1) {
      const spectator = new THREE.Group();
      const shirtMaterial = new THREE.MeshStandardMaterial({
        color: personPalette[index % personPalette.length],
        flatShading: true,
      });
      const headMaterial = new THREE.MeshStandardMaterial({
        color: 0xf1c7a7,
        flatShading: true,
      });

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.72, 0.24), shirtMaterial);
      body.position.y = 1.08;
      spectator.add(body);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), headMaterial);
      head.position.y = 1.62;
      spectator.add(head);

      spectator.position.set(
        side * (1.35 + (index % 2) * 0.35),
        0,
        -7.8 + index * 1.55
      );
      spectator.rotation.y = side < 0 ? Math.PI * 0.18 : -Math.PI * 0.18;
      group.add(spectator);
    }

    return group;
  }

  getRaceMarkerMaterial() {
    if (this.raceMarkerMaterial) {
      return this.raceMarkerMaterial;
    }

    if (typeof document === "undefined") {
      this.raceMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      return this.raceMarkerMaterial;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 48;
    const context = canvas.getContext("2d");

    if (!context) {
      this.raceMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      return this.raceMarkerMaterial;
    }

    const cellSize = 16;
    for (let row = 0; row < canvas.height / cellSize; row += 1) {
      for (let column = 0; column < canvas.width / cellSize; column += 1) {
        context.fillStyle = (row + column) % 2 === 0 ? "#faf7ef" : "#111418";
        context.fillRect(column * cellSize, row * cellSize, cellSize, cellSize);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3.4, 1);
    this.raceMarkerMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
    });
    return this.raceMarkerMaterial;
  }

  getFinishBannerMaterial() {
    if (this.finishBannerMaterial) {
      return this.finishBannerMaterial;
    }

    if (typeof document === "undefined") {
      this.finishBannerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      return this.finishBannerMaterial;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");

    if (!context) {
      this.finishBannerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      return this.finishBannerMaterial;
    }

    context.fillStyle = "#0e1114";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f7f3e7";
    context.fillRect(12, 12, canvas.width - 24, canvas.height - 24);
    context.fillStyle = "#111418";
    context.font = "bold 64px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("FINISH", canvas.width * 0.5, canvas.height * 0.52);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.finishBannerMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
    });
    return this.finishBannerMaterial;
  }

  updateMultiplayerRaceMarkers() {
    if (!this.multiplayerRaceMarkers) {
      return;
    }

    const markersVisible = this.isMultiplayerRaceActive() && this.multiplayer.race.targetDistance > 0;
    this.multiplayerRaceMarkers.group.visible = markersVisible;
    if (!markersVisible) {
      return;
    }

    this.track.placeAlongTrack(this.multiplayerRaceMarkers.startLine, 0, 0, 0.03, 0, "main");
    this.track.placeAlongTrack(
      this.multiplayerRaceMarkers.finishLine,
      this.multiplayer.race.targetDistance,
      0,
      0.03,
      0,
      "main"
    );
  }

  createSkyAccent() {
    const group = new THREE.Group();
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(52, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffca80,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      })
    );
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(28, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffe3aa,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      })
    );

    group.add(halo, sun);
    return { group, halo, sun };
  }

  updateSkyAccent() {
    if (!this.playerSample) {
      return;
    }

    const anchor = this.playerSample.center.clone();
    const sunPosition = anchor
      .clone()
      .addScaledVector(this.playerSample.tangent, 340)
      .addScaledVector(this.playerSample.right, -220)
      .add(new THREE.Vector3(0, 86, 0));

    this.skyAccent.group.position.copy(sunPosition);
    this.skyAccent.group.lookAt(this.camera.position);
    const nightLevel = this.weather.nightLevel || 0;
    this.skyAccent.halo.material.color.set(nightLevel > 0.35 ? 0x9fbfff : 0xffca80);
    this.skyAccent.sun.material.color.set(nightLevel > 0.35 ? 0xe7f1ff : 0xffe3aa);
    this.skyAccent.halo.material.opacity =
      nightLevel > 0.35 ? 0.09 + nightLevel * 0.08 : this.weather.id === "fog" ? 0.08 : 0.14;
    this.skyAccent.sun.material.opacity =
      nightLevel > 0.35 ? 0.12 + nightLevel * 0.1 : this.weather.id === "rain" ? 0.18 : this.weather.id === "fog" ? 0.1 : 0.28;
  }

  createCrashEffect() {
    const group = new THREE.Group();
    group.position.set(0, 1.05, 1.72);
    group.visible = false;

    const burstMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.92,
    });
    const flameMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6b2d,
      transparent: true,
      opacity: 0.78,
    });
    const smokeMaterial = new THREE.MeshBasicMaterial({
      color: 0x2d2b2b,
      transparent: true,
      opacity: 0.4,
    });
    const shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd3a0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    const burst = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), burstMaterial);
    group.add(burst);
    const flash = new THREE.PointLight(0xffa14a, 0, 18, 2);
    flash.position.set(0, 0.22, 0.08);
    group.add(flash);

    const shockwave = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.08, 6, 18), shockwaveMaterial);
    shockwave.rotation.x = Math.PI * 0.5;
    shockwave.position.set(0, 0.12, 0.04);
    group.add(shockwave);

    const flames = [];
    for (const [x, y, z] of [
      [0, 0.22, 0.06],
      [-0.18, 0.12, -0.08],
      [0.18, 0.15, -0.06],
    ]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 6), flameMaterial.clone());
      flame.position.set(x, y, z);
      flame.rotation.x = Math.PI;
      group.add(flame);
      flames.push(flame);
    }

    const smoke = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), smokeMaterial);
    smoke.position.set(0, 0.48, -0.08);
    group.add(smoke);

    const debris = [];
    for (const [x, y, z] of [
      [-0.22, 0.2, 0.18],
      [0.26, 0.18, 0.06],
      [-0.08, 0.28, -0.12],
      [0.16, 0.14, -0.18],
      [0.02, 0.22, 0.26],
    ]) {
      const shard = new THREE.Mesh(
        new THREE.BoxGeometry(0.12 + Math.random() * 0.12, 0.08 + Math.random() * 0.08, 0.12 + Math.random() * 0.16),
        new THREE.MeshBasicMaterial({ color: 0x3b3d40 })
      );
      shard.position.set(x, y, z);
      shard.visible = false;
      shard.userData.basePosition = shard.position.clone();
      shard.userData.baseRotation = shard.rotation.clone();
      shard.userData.baseScale = shard.scale.clone();
      shard.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 5.4,
        4.4 + Math.random() * 2.8,
        2.8 + Math.random() * 4.2
      );
      shard.userData.spin = new THREE.Vector3(
        2.4 + Math.random() * 4.4,
        3.2 + Math.random() * 4.8,
        2.1 + Math.random() * 3.8
      );
      group.add(shard);
      debris.push(shard);
    }

    return {
      group,
      burst,
      burstMaterial,
      flash,
      shockwave,
      flames,
      smoke,
      smokeMaterial,
      debris,
      time: 0,
      active: false,
    };
  }

  createCrashMotionState() {
    return {
      active: false,
      time: 0,
      forwardSpeed: 0,
      lateralSpeed: 0,
      roll: 0,
      pitch: 0,
      yaw: 0,
      rollVelocity: 0,
      pitchVelocity: 0,
      yawVelocity: 0,
      lift: 0,
      liftVelocity: 0,
    };
  }

  resetCrashMotion() {
    this.crashMotion = this.createCrashMotionState();
  }

  resetCrashEffect() {
    this.crashEffect.active = false;
    this.crashEffect.time = 0;
    this.crashEffect.group.visible = false;
    this.crashEffect.burst.scale.setScalar(1);
    this.crashEffect.burst.rotation.set(0, 0, 0);
    this.crashEffect.burstMaterial.opacity = 0.92;
    this.crashEffect.burstMaterial.color.set(0xffb347);
    this.crashEffect.smoke.position.set(0, 0.48, -0.08);
    this.crashEffect.smoke.scale.setScalar(1);
    this.crashEffect.smokeMaterial.opacity = 0.4;
    this.crashEffect.flash.intensity = 0;
    this.crashEffect.shockwave.scale.setScalar(0.4);
    this.crashEffect.shockwave.material.opacity = 0;
    this.crashEffect.debris.forEach((debris) => {
      debris.position.copy(debris.userData.basePosition);
      debris.rotation.copy(debris.userData.baseRotation);
      debris.scale.copy(debris.userData.baseScale);
      debris.visible = false;
    });

    this.crashEffect.flames.forEach((flame, index) => {
      flame.position.set(index === 1 ? -0.18 : index === 2 ? 0.18 : 0, index === 0 ? 0.22 : index === 1 ? 0.12 : 0.15, index === 0 ? 0.06 : index === 1 ? -0.08 : -0.06);
      flame.scale.setScalar(1);
      flame.material.opacity = 0.78;
    });
  }

  triggerCrashEffect() {
    this.crashEffect.active = true;
    this.crashEffect.time = 0;
    this.crashEffect.group.visible = true;
  }

  updateCrashEffect(delta) {
    if (!this.crashEffect.active) {
      return;
    }

    this.crashEffect.time += delta;
    const t = this.crashEffect.time;
    const burstPulse = Math.exp(-t * 2.8);

    this.crashEffect.burst.scale.setScalar(1.4 + burstPulse * 4.8);
    this.crashEffect.burst.rotation.y += delta * 7.4;
    this.crashEffect.burst.rotation.x += delta * 4.1;
    this.crashEffect.burstMaterial.opacity = Math.max(0, 0.96 - t * 0.92);
    this.crashEffect.flash.intensity = Math.max(0, 7.8 - t * 18);
    this.crashEffect.shockwave.scale.setScalar(0.4 + t * 5.6);
    this.crashEffect.shockwave.material.opacity = Math.max(0, 0.48 - t * 0.82);

    this.crashEffect.flames.forEach((flame, index) => {
      flame.scale.set(
        1.3 + Math.sin(t * 14 + index) * 0.22,
        1.2 + burstPulse * 2.8,
        1.2 + Math.cos(t * 9 + index) * 0.18
      );
      flame.position.y += delta * (0.78 + index * 0.18);
      flame.material.opacity = Math.max(0.14, 0.88 - t * 0.28);
    });

    this.crashEffect.debris.forEach((debris, index) => {
      debris.visible = true;
      debris.position.x += debris.userData.velocity.x * delta;
      debris.position.y += debris.userData.velocity.y * delta;
      debris.position.z += debris.userData.velocity.z * delta;
      debris.rotation.x += delta * debris.userData.spin.x;
      debris.rotation.y += delta * debris.userData.spin.y;
      debris.rotation.z += delta * debris.userData.spin.z;
      debris.userData.velocity.y -= delta * (5.8 + index * 0.3);
    });

    this.crashEffect.smoke.position.y += delta * 0.62;
    this.crashEffect.smoke.scale.setScalar(1.2 + t * 1.7);
    this.crashEffect.smokeMaterial.opacity = Math.max(0, 0.52 - t * 0.2);

    if (t > 2.6) {
      this.crashEffect.active = false;
      this.crashEffect.group.visible = false;
    }
  }

  updateCrashMotion(delta) {
    if (!this.crashMotion.active) {
      return;
    }

    this.crashMotion.time += delta;
    this.player.s += this.crashMotion.forwardSpeed * delta;
    this.player.laneOffset += this.crashMotion.lateralSpeed * delta;
    this.player.targetLaneOffset = this.player.laneOffset;

    this.crashMotion.forwardSpeed *= Math.exp(-delta * 2.6);
    this.crashMotion.lateralSpeed *= Math.exp(-delta * 3.5);
    this.crashMotion.roll += this.crashMotion.rollVelocity * delta;
    this.crashMotion.pitch += this.crashMotion.pitchVelocity * delta;
    this.crashMotion.yaw += this.crashMotion.yawVelocity * delta;
    this.crashMotion.lift += this.crashMotion.liftVelocity * delta;
    this.crashMotion.rollVelocity *= Math.exp(-delta * 2.8);
    this.crashMotion.pitchVelocity *= Math.exp(-delta * 3.1);
    this.crashMotion.yawVelocity *= Math.exp(-delta * 2.3);
    this.crashMotion.liftVelocity -= delta * 3.2;
    this.crashMotion.lift = Math.max(0, this.crashMotion.lift);

    if (this.crashMotion.time > 2.4) {
      this.crashMotion.active = false;
    }
  }

  applyCrashPose() {
    if (!this.crashMotion.active) {
      return;
    }

    this.player.mesh.position.y += this.crashMotion.lift;
    this.player.mesh.rotateZ(this.crashMotion.roll);
    this.player.mesh.rotateX(this.crashMotion.pitch);
    this.player.mesh.rotateY(this.crashMotion.yaw);
  }

  updateCrashOverlay(delta) {
    if (this.state !== "crashed" || this.crashOverlayDelay <= 0) {
      return;
    }

    this.crashOverlayDelay = Math.max(0, this.crashOverlayDelay - delta);
    if (this.crashOverlayDelay === 0) {
      this.hud.showCrash(this.crashDistance);
    }
  }

  handleCrash() {
    if (this.state === "crashed" || this.multiplayer.mode === "multiplayer") {
      return;
    }

    const impactSpin = THREE.MathUtils.clamp(this.player.lateralVelocity * 0.08, -2.2, 2.2);
    this.crashMotion = {
      active: true,
      time: 0,
      forwardSpeed: Math.max(9, this.player.speed * 0.34),
      lateralSpeed: this.player.lateralVelocity * 0.28,
      roll: 0,
      pitch: 0,
      yaw: 0,
      rollVelocity: impactSpin * 0.65 + (this.player.lateralVelocity >= 0 ? -1.7 : 1.7),
      pitchVelocity: -1.2,
      yawVelocity: impactSpin,
      lift: 0.24,
      liftVelocity: 1.7,
    };
    this.state = "crashed";
    this.player.speed = 0;
    this.menuCanResume = false;
    this.crashDistance = this.player.s;
    this.crashOverlayDelay = 0.42;
    this.input.resetState();
    this.lookBehindActive = false;
    this.snapCameraToCurrentView();
    this.hud.hideCrash();
    this.triggerCrashEffect();
    this.hud.setScoreStatus("Saving to local high scores...");
    void this.submitScore();
  }

  async loadLeaderboard() {
    this.hud.setMenuStatus("Loading local high scores...");

    try {
      const leaderboard = await this.leaderboardService.refreshLeaderboard();
      this.hud.renderLeaderboard(leaderboard.entries);
      this.hud.setMenuStatus(
        leaderboard.storage === "server"
          ? "High scores ready."
          : "High scores loaded."
      );
    } catch (error) {
      this.hud.renderLeaderboard([]);
      this.hud.setMenuStatus(error.message);
      this.hud.setScoreStatus("High score saving is unavailable in this session.");
    }
  }

  async submitScore() {
    if (this.scoreSubmitted) {
      return;
    }

    this.scoreSubmitted = true;
    const name = this.capturePlayerName();
    const distance = Math.round(this.player.s);

    if (distance < 1) {
      this.hud.setScoreStatus("Run was too short to log.");
      return;
    }

    this.recordScoreTelemetry(distance);

    try {
      const leaderboard = await this.leaderboardService.submitScore({
        name,
        distance,
        aiEnabled: this.aiEnabled,
        weather: this.weather.label,
      });

      this.hud.renderLeaderboard(leaderboard.entries);
      const rank = leaderboard.realEntries.findIndex(
        (entry) => leaderboard.savedEntry && entry.id === leaderboard.savedEntry.id
      );
      this.hud.setScoreStatus(
        rank >= 0
          ? `Saved to ${leaderboard.storage === "server" ? "high scores" : "browser high scores"} at #${rank + 1}.`
          : `Saved to ${leaderboard.storage === "server" ? "high scores." : "browser high scores."}`
      );
      this.hud.setMenuStatus(
        leaderboard.storage === "server"
          ? "Local high scores updated."
          : "Server save unavailable. Score stored in this browser."
      );
    } catch (error) {
      this.scoreSubmitted = false;
      this.hud.setScoreStatus(error.message);
      this.hud.setMenuStatus("High score save failed.");
    }
  }

  capturePlayerName() {
    const trimmed = this.hud.getPlayerName().replace(/\s+/g, " ").trim();
    const name = trimmed.slice(0, 18) || "Guest";
    this.hud.setPlayerName(name);
    writeStoredValue(PLAYER_NAME_STORAGE_KEY, name);
    return name;
  }

  setAiEnabled(enabled) {
    const nextValue = enabled && this.multiplayer.mode === "solo";
    this.aiEnabled = nextValue;
    this.hud.setAiEnabled(nextValue);
    writeStoredValue(AUTOPILOT_STORAGE_KEY, nextValue ? "1" : "0");
  }

  setVibrationEnabled(enabled) {
    const supported = this.feedbackSystem.isVibrationSupported();
    const nextValue = supported ? Boolean(enabled) : false;
    this.feedbackSystem.setVibrationEnabled(nextValue);
    this.hud.setVibrationEnabled(nextValue, supported);
    writeStoredValue(VIBRATION_STORAGE_KEY, nextValue ? "1" : "0");
    this.hud.setMenuStatus(
      supported
        ? `Vibration ${nextValue ? "enabled" : "disabled"}.`
        : "Vibration is unavailable on this device."
    );
  }

  isFullscreenSupported() {
    return Boolean(
      document.fullscreenEnabled ||
        document.webkitFullscreenEnabled ||
        document.documentElement.requestFullscreen ||
        document.documentElement.webkitRequestFullscreen
    );
  }

  getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  handleFullscreenChange() {
    this.hud.setFullscreenActive(Boolean(this.getFullscreenElement()));
  }

  async toggleFullscreen() {
    if (!this.isFullscreenSupported()) {
      this.hud.setMenuStatus("Fullscreen is unavailable on this device.");
      return;
    }

    void this.feedbackSystem.unlockAudio();

    try {
      if (this.getFullscreenElement()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      }
    } catch (error) {
      this.hud.setMenuStatus("Fullscreen is unavailable on this device.");
    }

    this.handleFullscreenChange();
  }

  setGraphicsPreset(preset) {
    this.applyGraphicsPreset(preset);
  }

  applyGraphicsPreset(preset, { persist = true, silent = false } = {}) {
    const nextPreset = normalizeGraphicsPreset(preset);
    this.graphicsPreset = nextPreset;
    this.graphics = GRAPHICS_PRESETS[nextPreset];
    this.renderer.setPixelRatio(this.getRenderPixelRatio());
    setVehicleFactoryQuality({ dynamicLights: this.graphics.dynamicVehicleLights });
    this.track.setQualityPreset(this.graphics.trackQuality);
    this.trafficSystem.setQualityPreset(nextPreset);
    this.camera.far = this.graphics.cameraFar;
    this.camera.updateProjectionMatrix();
    this.scenerySystem.setQuality({ flockCount: this.graphics.sceneryFlocks });
    this.weatherSystem.setQuality({ particleBudget: this.graphics.particleBudget });
    this.hud.setGraphicsPreset(nextPreset);
    this.hud.setGraphicsPresetStatus(this.getGraphicsPresetStatus());
    this.handleResize();

    if (persist) {
      writeStoredValue(GRAPHICS_PRESET_STORAGE_KEY, nextPreset);
    }

    if (!silent) {
      this.hud.setMenuStatus(
        this.state === "running"
          ? `${this.graphics.label} graphics enabled. City density changes fully apply on the next run.`
          : `${this.graphics.label} graphics enabled.`
      );
    }
  }

  getRenderPixelRatio() {
    const devicePixelRatio = window.devicePixelRatio || 1;
    return Math.max(
      0.75,
      Math.min(devicePixelRatio, this.graphics.maxPixelRatio) * this.graphics.renderScale
    );
  }

  getGraphicsPresetStatus() {
    if (this.graphicsPreset === "high") {
      return "High restores dense city scenery, the farthest draw distance, heavier traffic, and dynamic vehicle lights.";
    }

    if (this.graphicsPreset === "medium") {
      return "Balanced is the default. It keeps draw distance and traffic lighter, strips dense city blocks, and preserves better clarity than Low.";
    }

    return "Low is the leanest preset. It cuts draw distance further, lowers render resolution, minimizes traffic pressure, and disables dynamic vehicle lights.";
  }

  pickNearestLaneTarget(candidateOffset, laneTargets, bounds) {
    const clampedOffset = THREE.MathUtils.clamp(candidateOffset, bounds.right, bounds.left);
    let nearestTarget = laneTargets[0] ?? 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const target of laneTargets) {
      const distance = Math.abs(target - clampedOffset);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestTarget = target;
      }
    }

    return nearestTarget;
  }

  hasLaneTarget(targetOffset, laneTargets) {
    return laneTargets.some((target) => Math.abs(target - targetOffset) < 0.24);
  }

  getOccupiedLaneIndices(laneOffset) {
    const occupiedLaneIndices = [];

    for (let laneIndex = 0; laneIndex < MAIN_LANE_OFFSETS.length; laneIndex += 1) {
      if (Math.abs(MAIN_LANE_OFFSETS[laneIndex] - laneOffset) <= LANE_OCCUPANCY_THRESHOLD) {
        occupiedLaneIndices.push(laneIndex);
      }
    }

    if (!occupiedLaneIndices.length) {
      occupiedLaneIndices.push(this.trafficSystem.getNearestLaneIndex(laneOffset));
    }

    return occupiedLaneIndices;
  }

  getClosestHazard(routeId, occupiedLaneIndices) {
    let closestHazard = null;

    for (const laneIndex of occupiedLaneIndices) {
      const metrics = this.trafficSystem.getLaneMetrics(routeId, laneIndex, this.player.s);
      if (!metrics.aheadVehicle) {
        continue;
      }

      if (!closestHazard || metrics.aheadGap < closestHazard.gap) {
        closestHazard = {
          vehicle: metrics.aheadVehicle,
          gap: metrics.aheadGap,
          laneIndex,
        };
      }
    }

    return closestHazard;
  }

  getTrafficSpeedCap(trafficAhead) {
    if (!trafficAhead?.vehicle) {
      return Number.POSITIVE_INFINITY;
    }

    if (trafficAhead.gap < 9) {
      return Math.max(1, trafficAhead.vehicle.speed - 16);
    }

    if (trafficAhead.gap < 14) {
      return Math.max(4, trafficAhead.vehicle.speed - 10);
    }

    if (trafficAhead.gap < 20) {
      return Math.max(8, trafficAhead.vehicle.speed - 6);
    }

    if (trafficAhead.gap < 32) {
      return Math.max(12, trafficAhead.vehicle.speed - 2);
    }

    if (trafficAhead.gap < 48) {
      return trafficAhead.vehicle.speed + 3;
    }

    return Number.POSITIVE_INFINITY;
  }

  applyPickups(pickups) {
    if (!pickups) {
      return;
    }

    this.player.coins += pickups.coins || 0;
    this.player.nosCharge = THREE.MathUtils.clamp(this.player.nosCharge + (pickups.nosCharge || 0), 0, 72);
  }

  getPursuitLabel() {
    if (this.multiplayer.mode === "multiplayer") {
      return "Off";
    }

    if (!this.pursuitState.active) {
      return "Clear";
    }

    if (this.pursuitState.nearestGap !== null && this.pursuitState.nearestGap < 28) {
      return "Close";
    }

    return "Active";
  }

  getRaceLabel() {
    if (this.isMultiplayerRaceActive()) {
      const countdown = Math.max(0, (this.multiplayer.race.startAt - Date.now()) / 1000);
      if (countdown > 0.05) {
        return `Rolling start ${Math.ceil(countdown)}`;
      }

      if (this.multiplayer.race.finished) {
        return "Race finished";
      }

      return `P${this.multiplayer.position}/${this.multiplayer.playerCount} · ${this.getMultiplayerPowerupLabel()}`;
    }

    if (this.multiplayer.mode === "multiplayer" && this.multiplayer.lobby) {
      return "Online lobby";
    }

    return "Single player";
  }

  getMultiplayerPowerupLabel() {
    const clearReady = this.multiplayer.powerups.clear.cooldown <= 0;
    const turboReady = this.multiplayer.powerups.turbo.cooldown <= 0;
    if (clearReady && turboReady) {
      return "Clear + Turbo ready";
    }
    if (clearReady) {
      return "Clear ready";
    }
    if (turboReady) {
      return "Turbo ready";
    }

    const nextReady = Math.min(this.multiplayer.powerups.clear.cooldown, this.multiplayer.powerups.turbo.cooldown);
    return `Power in ${Math.max(1, Math.ceil(nextReady))}s`;
  }

  resetMultiplayerPowerups() {
    this.multiplayer.powerups.clear.cooldown = 0;
    this.multiplayer.powerups.clear.activeTime = 0;
    this.multiplayer.powerups.turbo.cooldown = 0;
    this.multiplayer.powerups.turbo.activeTime = 0;
  }

  updateMultiplayerPowerups(delta) {
    this.multiplayer.powerups.clear.cooldown = Math.max(0, this.multiplayer.powerups.clear.cooldown - delta);
    this.multiplayer.powerups.clear.activeTime = Math.max(0, this.multiplayer.powerups.clear.activeTime - delta);
    this.multiplayer.powerups.turbo.cooldown = Math.max(0, this.multiplayer.powerups.turbo.cooldown - delta);
    this.multiplayer.powerups.turbo.activeTime = Math.max(0, this.multiplayer.powerups.turbo.activeTime - delta);
  }

  handleMultiplayerPowerupInput() {
    if (this.isMultiplayerRaceCountdownActive()) {
      return;
    }

    if (this.input.consumePowerAction("left")) {
      this.useMultiplayerPowerup("clear");
      return;
    }

    if (this.input.consumePowerAction("right")) {
      this.useMultiplayerPowerup("turbo");
      return;
    }

    if (this.input.consumePowerAction("generic")) {
      const aheadTraffic = this.trafficSystem.getClosestVehicleAhead(
        this.player.route.branchId || "main",
        this.player.s,
        this.player.laneOffset
      );
      if (aheadTraffic && aheadTraffic.gap < 28 && this.multiplayer.powerups.clear.cooldown <= 0) {
        this.useMultiplayerPowerup("clear");
        return;
      }

      if (this.multiplayer.powerups.turbo.cooldown <= 0) {
        this.useMultiplayerPowerup("turbo");
        return;
      }

      this.useMultiplayerPowerup("clear");
    }
  }

  useMultiplayerPowerup(kind) {
    if (this.state !== "running" || !this.isMultiplayerRaceActive()) {
      return false;
    }

    if (kind === "clear") {
      if (this.multiplayer.powerups.clear.cooldown > 0) {
        return false;
      }

      this.multiplayer.powerups.clear.cooldown = 12;
      this.multiplayer.powerups.clear.activeTime = 4.5;
      this.hud.setMultiplayerStatus("Lane clear deployed.");
      this.feedbackSystem.playPassBy(28);
      return true;
    }

    if (kind === "turbo") {
      if (this.multiplayer.powerups.turbo.cooldown > 0) {
        return false;
      }

      this.multiplayer.powerups.turbo.cooldown = 14;
      this.multiplayer.powerups.turbo.activeTime = 1.9;
      this.player.nosCharge = Math.min(72, this.player.nosCharge + 28);
      this.hud.setMultiplayerStatus("Turbo surge deployed.");
      this.feedbackSystem.playNosBurst();
      return true;
    }

    return false;
  }

  getPriorityRaceVehicles() {
    const vehicles = [
      {
        s: this.player.s,
        laneOffset: this.player.laneOffset,
        speed: this.player.speed,
        routeId: this.player.route.branchId || "main",
      },
    ];

    if (this.multiplayer.lastRaceState?.players?.length) {
      for (const playerState of this.multiplayer.lastRaceState.players) {
        if (playerState.id === this.multiplayerClient.clientId) {
          continue;
        }

        vehicles.push({
          s: Number(playerState.s) || 0,
          laneOffset: Number(playerState.laneOffset) || 0,
          speed: Number(playerState.speed) || 0,
          routeId: "main",
        });
      }
    }

    return vehicles;
  }

  isMultiplayerRaceActive() {
    return this.multiplayer.mode === "multiplayer" && this.multiplayer.race.active;
  }

  isMultiplayerRaceCountdownActive() {
    return this.isMultiplayerRaceActive() && Date.now() < this.multiplayer.race.startAt;
  }

  resetMultiplayerRaceState() {
    this.multiplayer.race = {
      active: false,
      startAt: 0,
      targetDistance: 0,
      trackSeed: 0,
      startGrid: [],
      finished: false,
      finishTime: null,
      results: null,
      countdownCleared: false,
    };
    this.multiplayer.sendAccumulator = 0;
    this.multiplayer.position = 1;
    this.multiplayer.playerCount = 1;
    this.resetMultiplayerPowerups();
    this.updateMultiplayerRaceMarkers();
  }

  clearRemotePlayers() {
    for (const remote of this.multiplayer.remotePlayers.values()) {
      this.scene.remove(remote.mesh);
    }
    this.multiplayer.remotePlayers.clear();
  }

  getMultiplayerStartSlot(playerId) {
    return this.multiplayer.race.startGrid.find((slot) => slot.id === playerId) || null;
  }

  createRemotePlayerLabel(name = "Guest", place = 1) {
    if (typeof document === "undefined") {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, 4.2, 0);
    sprite.scale.set(6.4, 1.92, 1);

    const label = {
      canvas,
      context,
      texture,
      sprite,
      textKey: "",
    };
    this.updateRemotePlayerLabel(label, name, place);
    return label;
  }

  updateRemotePlayerLabel(label, name = "Guest", place = 1) {
    if (!label?.context) {
      return;
    }

    const safeName = String(name || "Guest").slice(0, 18);
    const safePlace = Math.max(1, Number(place) || 1);
    const textKey = `${safePlace}:${safeName}`;
    if (label.textKey === textKey) {
      return;
    }

    label.textKey = textKey;
    const { context, canvas, texture } = label;
    context.clearRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(8, 12, 18, 0.78)";
    context.beginPath();
    context.roundRect(8, 10, canvas.width - 16, canvas.height - 20, 24);
    context.fill();
    context.strokeStyle = "rgba(255, 240, 214, 0.42)";
    context.lineWidth = 4;
    context.stroke();

    context.fillStyle = "#ffd166";
    context.font = "bold 28px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`P${safePlace}`, canvas.width * 0.5, 30);

    context.fillStyle = "#f8f4ea";
    context.font = "bold 34px sans-serif";
    context.fillText(safeName, canvas.width * 0.5, 62);
    texture.needsUpdate = true;
  }

  updateRemotePlayers(delta) {
    for (const remote of this.multiplayer.remotePlayers.values()) {
      const predictionSeconds = Math.min((performance.now() - (remote.lastStateAt || performance.now())) / 1000, 0.22);
      const predictedS = remote.state.finished ? remote.state.s : remote.state.s + remote.state.speed * predictionSeconds;
      const predictedLaneOffset = remote.state.finished
        ? remote.state.laneOffset
        : remote.state.laneOffset + remote.laneVelocity * predictionSeconds;
      remote.displayS = THREE.MathUtils.damp(remote.displayS, predictedS, 10.5, delta);
      remote.displayLaneOffset = THREE.MathUtils.damp(remote.displayLaneOffset, predictedLaneOffset, 12, delta);
      remote.mesh.userData.setBoostActive?.(
        !remote.state.finished && remote.state.speed > this.player.baseCruiseSpeed + 10,
        0.3
      );
      this.track.placeAlongTrack(remote.mesh, remote.displayS, remote.displayLaneOffset, 1.05, 0, "main");
    }
  }

  syncMultiplayerPlayerState(delta) {
    this.multiplayer.sendAccumulator += delta;
    if (this.multiplayer.sendAccumulator < MULTIPLAYER_SEND_INTERVAL) {
      return;
    }

    this.multiplayer.sendAccumulator = 0;
    this.multiplayerClient.sendPlayerState({
      s: this.player.s,
      laneOffset: this.player.laneOffset,
      speed: this.player.speed,
      finished: this.multiplayer.race.finished,
      finishTime: this.multiplayer.race.finishTime,
    });
  }

  async handleMultiplayerCreateLobby() {
    this.capturePlayerName();
    void this.feedbackSystem.unlockAudio();
    this.hud.setMultiplayerStatus("Creating lobby...");

    try {
      await this.multiplayerClient.createLobby(this.capturePlayerName());
      await this.requestWaitingLobbies();
    } catch (error) {
      this.hud.setMultiplayerStatus(error.message);
    }
  }

  async handleMultiplayerJoinLobby(joinCode = "") {
    const lobbyCode = String(joinCode || this.hud.getLobbyCode()).trim().toUpperCase();
    if (lobbyCode.length < 4) {
      this.hud.setMultiplayerStatus("Enter a lobby code first.");
      return;
    }

    this.capturePlayerName();
    void this.feedbackSystem.unlockAudio();
    this.hud.setMultiplayerStatus(`Joining ${lobbyCode}...`);

    try {
      await this.multiplayerClient.joinLobby(this.capturePlayerName(), lobbyCode);
      this.hud.setLobbyCode(lobbyCode);
    } catch (error) {
      this.hud.setMultiplayerStatus(error.message);
    }
  }

  async handleMultiplayerToggleReady() {
    void this.feedbackSystem.unlockAudio();
    try {
      await this.multiplayerClient.toggleReady();
    } catch (error) {
      this.hud.setMultiplayerStatus(error.message);
    }
  }

  async handleMultiplayerStartRace() {
    void this.feedbackSystem.unlockAudio();
    try {
      await this.multiplayerClient.startRace();
    } catch (error) {
      this.hud.setMultiplayerStatus(error.message);
    }
  }

  async handleMultiplayerLeaveLobby() {
    try {
      await this.multiplayerClient.leaveLobby();
      this.multiplayer.lobby = null;
      this.multiplayer.lastRaceState = null;
      this.resetMultiplayerRaceState();
      this.clearRemotePlayers();
      this.hud.clearLobbyState();
      this.hud.setMultiplayerStatus("Lobby left.");
      void this.requestWaitingLobbies();
      if (this.state === "running") {
        this.state = "menu";
        this.openMenu({ canResume: false });
      }
    } catch (error) {
      this.hud.setMultiplayerStatus(error.message);
    }
  }

  handleMultiplayerLobbyState(message) {
    if (this.multiplayer.race.active && message.raceStatus !== "running" && !this.multiplayer.race.finished) {
      this.multiplayer.race.active = false;
      this.menuCanResume = false;
      this.state = "menu";
      this.openMenu({ canResume: false });
      this.hud.setMultiplayerStatus("Race ended. Back in lobby.");
    }

    this.multiplayer.lobby = message.lobbyCode ? message : null;
    this.hud.renderLobbyState({
      ...message,
      clientId: this.multiplayerClient.clientId,
    });

    if (!message.lobbyCode) {
      this.hud.setMultiplayerStatus("Host a race or join one below.");
      return;
    }

    const playerCount = message.players.length;
    if (message.raceStatus === "running") {
      this.hud.setMultiplayerStatus(`Race in progress with ${playerCount} drivers.`);
      return;
    }

    if (message.canStart) {
      this.hud.setMultiplayerStatus(`Lobby ${message.lobbyCode} is ready. Host can start any time.`);
      return;
    }

    this.hud.setMultiplayerStatus(`Lobby ${message.lobbyCode}. Waiting for more drivers.`);
  }

  handleMultiplayerWaitingLobbies(message) {
    const lobbies = Array.isArray(message.lobbies) ? message.lobbies : [];
    this.multiplayer.waitingLobbies = lobbies.filter((lobby) => lobby.code !== this.multiplayer.lobby?.lobbyCode);
    this.hud.renderWaitingLobbies(this.multiplayer.waitingLobbies);
  }

  handleMultiplayerRaceStarted(message) {
    this.setAiEnabled(false);
    this.resetMultiplayerRaceState();
    this.multiplayer.race.active = true;
    this.multiplayer.race.startAt = Number(message.startAt) || Date.now();
    this.multiplayer.race.targetDistance = Number(message.targetDistance) || MULTIPLAYER_TARGET_DISTANCE;
    this.multiplayer.race.trackSeed = Number(message.trackSeed) || 1;
    this.multiplayer.race.startGrid = Array.isArray(message.startGrid) ? message.startGrid : [];
    this.multiplayer.race.countdownCleared = false;
    this.multiplayer.lastRaceState = null;

    this.resetRun({
      seed: this.multiplayer.race.trackSeed,
      multiplayer: true,
    });
    const startSlot = this.getMultiplayerStartSlot(this.multiplayerClient.clientId);
    if (startSlot) {
      this.player.s = Number(startSlot.s) || 0;
      this.player.laneOffset = Number(startSlot.laneOffset) || 0;
      this.player.targetLaneOffset = this.player.laneOffset;
      this.player.speed = MULTIPLAYER_ROLLING_SPEED;
      this.playerSample = this.track.placeAlongTrack(
        this.player.mesh,
        this.player.s,
        this.player.laneOffset,
        1.05,
        0,
        this.player.route
      );
    }
    this.lookBehindActive = false;
    this.snapCameraToCurrentView();
    this.hasRunStarted = true;
    this.controlsHintTime = CONTROLS_HINT_DURATION;
    this.hud.setControlsVisible(true);
    this.menuCanResume = false;
    this.state = "running";
    this.hud.hideMenu();
    this.hud.hideTrackingConsent();
    this.hud.setMultiplayerStatus("6 km race. Rolling start.");
    this.recordRunTelemetry("multiplayer", this.multiplayer.race.trackSeed);
    this.clock.getDelta();
  }

  handleMultiplayerRaceState(message) {
    this.multiplayer.lastRaceState = message;
    this.multiplayer.race.targetDistance = Number(message.targetDistance) || this.multiplayer.race.targetDistance;
    this.multiplayer.race.startAt = Number(message.startAt) || this.multiplayer.race.startAt;

    const remoteIds = new Set();
    for (const playerState of message.players) {
      if (playerState.id === this.multiplayerClient.clientId) {
        this.multiplayer.position = playerState.place || 1;
        this.multiplayer.playerCount = message.players.length || 1;
        continue;
      }

      remoteIds.add(playerState.id);
      let remote = this.multiplayer.remotePlayers.get(playerState.id);
      if (!remote) {
        const mesh = createRivalCar(playerState.id);
        const label = this.createRemotePlayerLabel(playerState.name, playerState.place);
        label?.sprite && mesh.add(label.sprite);
        this.scene.add(mesh);
        remote = {
          mesh,
          state: playerState,
          displayS: playerState.s,
          displayLaneOffset: playerState.laneOffset,
          lastStateAt: performance.now(),
          laneVelocity: 0,
          label,
        };
        this.multiplayer.remotePlayers.set(playerState.id, remote);
      }

      const now = performance.now();
      const previousState = remote.state;
      const deltaSeconds = Math.max((now - (remote.lastStateAt || now)) / 1000, 0.001);
      remote.laneVelocity = THREE.MathUtils.clamp(
        ((playerState.laneOffset ?? 0) - (previousState?.laneOffset ?? playerState.laneOffset ?? 0)) / deltaSeconds,
        -10,
        10
      );
      remote.lastStateAt = now;
      remote.state = playerState;
      this.updateRemotePlayerLabel(remote.label, playerState.name, playerState.place);
    }

    for (const [remoteId, remote] of this.multiplayer.remotePlayers.entries()) {
      if (!remoteIds.has(remoteId)) {
        this.scene.remove(remote.mesh);
        this.multiplayer.remotePlayers.delete(remoteId);
      }
    }
  }

  handleMultiplayerRaceFinished(message) {
    this.multiplayer.race.active = false;
    this.multiplayer.race.finished = true;
    this.multiplayer.race.results = message.results || [];

    const placement = this.multiplayer.race.results.find(
      (entry) => entry.id === this.multiplayerClient.clientId
    );
    const resultLabel = placement
      ? `Finished P${placement.place}/${this.multiplayer.race.results.length}.`
      : "Race finished.";

    this.hud.setMultiplayerStatus(`${resultLabel} Back in lobby.`);
    this.menuCanResume = false;
    this.state = "menu";
    this.input.resetState();
    this.clearRemotePlayers();
    this.openMenu({ canResume: false });
  }
}
