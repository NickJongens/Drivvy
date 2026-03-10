export class InputController {
  constructor(targetElement) {
    this.gamepadDeadzone = 0.18;
    this.targetElement = targetElement;
    this.keyState = {
      accelerate: false,
      left: false,
      right: false,
      brake: false,
      boost: false,
    };
    this.pointerState = {
      accelerate: false,
      brake: false,
    };
    this.mouseX = 0;
    this.mouseActiveUntil = 0;
    this.activeGamepadIndex = null;
    this.gamepadState = {
      connected: false,
      steer: 0,
      throttle: 0,
      brake: 0,
      boost: 0,
      menuPressed: false,
      menuHeld: false,
    };

    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleGamepadConnected = this.handleGamepadConnected.bind(this);
    this.handleGamepadDisconnected = this.handleGamepadDisconnected.bind(this);

    targetElement.addEventListener("mousemove", this.handleMouseMove);
    targetElement.addEventListener("mouseleave", this.handleMouseLeave);
    targetElement.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);
    targetElement.addEventListener("contextmenu", this.handleContextMenu);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("gamepadconnected", this.handleGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
  }

  getSteeringTarget(bounds) {
    const leftLimit = typeof bounds === "number" ? bounds : bounds.left;
    const rightLimit = typeof bounds === "number" ? -bounds : bounds.right;
    const keyboard = Number(this.keyState.left) - Number(this.keyState.right);
    if (keyboard !== 0) {
      return keyboard > 0 ? leftLimit : rightLimit;
    }

    if (Math.abs(this.gamepadState.steer) > 0.001) {
      return this.gamepadState.steer > 0
        ? this.gamepadState.steer * leftLimit
        : this.gamepadState.steer * Math.abs(rightLimit);
    }

    if (performance.now() < this.mouseActiveUntil) {
      if (this.mouseX < 0) {
        return -this.mouseX * leftLimit;
      }

      return -this.mouseX * Math.abs(rightLimit);
    }

    return 0;
  }

  getThrottle() {
    return Math.max(
      this.keyState.accelerate || this.pointerState.accelerate ? 1 : 0,
      this.gamepadState.throttle
    );
  }

  getBrake() {
    return Math.max(this.keyState.brake || this.pointerState.brake ? 1 : 0, this.gamepadState.brake);
  }

  getBoost() {
    return Math.max(this.keyState.boost ? 1 : 0, this.gamepadState.boost);
  }

  consumeMenuPress() {
    if (!this.gamepadState.menuPressed) {
      return false;
    }

    this.gamepadState.menuPressed = false;
    return true;
  }

  hasThrottleInput() {
    return this.getThrottle() > 0;
  }

  hasManualSteer() {
    return (
      this.keyState.left ||
      this.keyState.right ||
      Math.abs(this.gamepadState.steer) > 0.001 ||
      performance.now() < this.mouseActiveUntil
    );
  }

  resetState() {
    this.keyState.accelerate = false;
    this.keyState.left = false;
    this.keyState.right = false;
    this.keyState.brake = false;
    this.keyState.boost = false;
    this.pointerState.accelerate = false;
    this.pointerState.brake = false;
    this.mouseActiveUntil = 0;
    this.mouseX = 0;
  }

  update() {
    this.updateGamepadState();
  }

  handleMouseMove(event) {
    const bounds = this.targetElement.getBoundingClientRect();
    const normalized = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
    this.mouseX = Math.max(-1, Math.min(1, normalized));
    this.mouseActiveUntil = performance.now() + 1400;
  }

  handleMouseLeave() {
    this.mouseActiveUntil = 0;
  }

  handlePointerDown(event) {
    if (event.button === 0) {
      event.preventDefault();
      this.pointerState.accelerate = true;
    }

    if (event.button === 2) {
      event.preventDefault();
      this.pointerState.brake = true;
    }
  }

  handlePointerUp(event) {
    if (event.button === 0) {
      this.pointerState.accelerate = false;
    }

    if (event.button === 2) {
      this.pointerState.brake = false;
    }
  }

  handleContextMenu(event) {
    event.preventDefault();
  }

  handleKeyDown(event) {
    if (this.isTypingTarget(event)) {
      this.resetState();
      return;
    }

    if (this.isControlKey(event.key)) {
      event.preventDefault();
    }
    this.setKey(event.key, true);
  }

  handleKeyUp(event) {
    if (this.isTypingTarget(event)) {
      return;
    }

    if (this.isControlKey(event.key)) {
      event.preventDefault();
    }
    this.setKey(event.key, false);
  }

  isTypingTarget(event) {
    const target = event.target instanceof Element ? event.target : document.activeElement;
    if (!(target instanceof Element)) {
      return false;
    }

    if (target.closest("[contenteditable='true']")) {
      return true;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return !target.readOnly && !target.disabled;
    }

    return false;
  }

  handleGamepadConnected(event) {
    if (typeof event.gamepad?.index === "number") {
      this.activeGamepadIndex = event.gamepad.index;
    }
  }

  handleGamepadDisconnected(event) {
    if (event.gamepad?.index === this.activeGamepadIndex) {
      this.activeGamepadIndex = null;
    }
    this.gamepadState.connected = false;
    this.gamepadState.steer = 0;
    this.gamepadState.throttle = 0;
    this.gamepadState.brake = 0;
    this.gamepadState.boost = 0;
    this.gamepadState.menuPressed = false;
    this.gamepadState.menuHeld = false;
  }

  updateGamepadState() {
    const getGamepads = navigator.getGamepads || navigator.webkitGetGamepads;
    if (typeof getGamepads !== "function") {
      this.handleGamepadDisconnected({});
      return;
    }

    const pads = Array.from(getGamepads.call(navigator) || []).filter(Boolean);
    if (!pads.length) {
      this.handleGamepadDisconnected({});
      return;
    }

    let activePad = pads.find((pad) => pad.index === this.activeGamepadIndex) || null;
    const signalledPad = pads.find((pad) => this.gamepadHasSignal(pad));
    if (signalledPad) {
      activePad = signalledPad;
    } else if (!activePad) {
      activePad = pads[0];
    }

    if (!activePad) {
      this.handleGamepadDisconnected({});
      return;
    }

    this.activeGamepadIndex = activePad.index;

    const axisSteer = -this.normalizeAxis(activePad.axes?.[0] ?? 0);
    const dpadSteer = this.getButtonValue(activePad, 14) - this.getButtonValue(activePad, 15);
    const steer = Math.abs(axisSteer) > 0.001 ? axisSteer : dpadSteer;
    const throttle = Math.max(
      this.getButtonValue(activePad, 7),
      this.getButtonValue(activePad, 0),
      this.getButtonValue(activePad, 12)
    );
    const brake = Math.max(
      this.getButtonValue(activePad, 6),
      this.getButtonValue(activePad, 1),
      this.getButtonValue(activePad, 13)
    );
    const boost = Math.max(
      this.getButtonValue(activePad, 2),
      this.getButtonValue(activePad, 3),
      this.getButtonValue(activePad, 4),
      this.getButtonValue(activePad, 5)
    );
    const menuDown = [8, 9, 16].some((index) => this.getButtonValue(activePad, index) > 0.5);

    this.gamepadState.connected = true;
    this.gamepadState.steer = Math.max(-1, Math.min(1, steer));
    this.gamepadState.throttle = Math.max(0, Math.min(1, throttle));
    this.gamepadState.brake = Math.max(0, Math.min(1, brake));
    this.gamepadState.boost = Math.max(0, Math.min(1, boost));
    this.gamepadState.menuPressed = menuDown && !this.gamepadState.menuHeld;
    this.gamepadState.menuHeld = menuDown;
  }

  gamepadHasSignal(gamepad) {
    const steerSignal = Math.abs(this.normalizeAxis(gamepad.axes?.[0] ?? 0)) > 0.001;
    const buttonSignal = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16].some(
      (index) => this.getButtonValue(gamepad, index) > 0.18
    );
    return steerSignal || buttonSignal;
  }

  normalizeAxis(value) {
    const absValue = Math.abs(value);
    if (absValue < this.gamepadDeadzone) {
      return 0;
    }

    const scaled = (absValue - this.gamepadDeadzone) / (1 - this.gamepadDeadzone);
    return Math.sign(value) * Math.min(1, scaled);
  }

  getButtonValue(gamepad, index) {
    const button = gamepad.buttons?.[index];
    if (!button) {
      return 0;
    }

    if (typeof button.value === "number") {
      return button.value;
    }

    return button.pressed ? 1 : 0;
  }

  setKey(key, nextValue) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "w" || key === "ArrowUp") {
      this.keyState.accelerate = nextValue;
    }

    if (lowerKey === "a" || key === "ArrowLeft") {
      this.keyState.left = nextValue;
    }

    if (lowerKey === "d" || key === "ArrowRight") {
      this.keyState.right = nextValue;
    }

    if (lowerKey === "s" || key === "ArrowDown") {
      this.keyState.brake = nextValue;
    }

    if (key === " " || key === "Spacebar" || lowerKey === "shift") {
      this.keyState.boost = nextValue;
    }
  }

  isControlKey(key) {
    const lowerKey = key.toLowerCase();
    return (
      lowerKey === "w" ||
      lowerKey === "a" ||
      lowerKey === "d" ||
      lowerKey === "s" ||
      lowerKey === "shift" ||
      key === " " ||
      key === "Spacebar" ||
      key === "ArrowUp" ||
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "ArrowDown"
    );
  }
}
