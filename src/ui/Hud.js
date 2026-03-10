export class Hud {
  constructor({
    speed,
    distance,
    weather,
    lane,
    nos,
    nosFill,
    coins,
    pursuit,
    race,
    assist,
    overlay,
    crashMessage,
    scoreStatus,
    restartButton,
    menuButton,
    menuOverlay,
    accessibilityOverlay,
    accessibilityNamePanel,
    accessibilityQuestionPanel,
    accessibilitySetupPanel,
    onboardingNameInput,
    accessibilityNameContinueButton,
    accessibilityYesButton,
    accessibilityNoButton,
    accessibilityContinueButton,
    accessibilityContrastButton,
    accessibilityColorButton,
    menuPlayButton,
    menuNewRunButton,
    playerNameInput,
    leaderboardList,
    menuStatus,
    accessibilityReviewButton,
    accessibilityStatus,
    highContrastButton,
    colorAssistButton,
    aiToggleButton,
    secretPanel,
    secretTrigger,
    menuSoloTab,
    menuMultiplayerTab,
    menuOptionsTab,
    soloMenuPanel,
    multiplayerMenuPanel,
    optionsMenuPanel,
    multiplayerStatus,
    lobbyCodeInput,
    multiplayerLobbyCard,
    multiplayerLobbyCode,
    multiplayerPlayerList,
    multiplayerWaitingList,
    multiplayerCreateButton,
    multiplayerJoinButton,
    multiplayerRefreshButton,
    multiplayerReadyButton,
    multiplayerStartButton,
    multiplayerLeaveButton,
    leftIndicator,
    rightIndicator,
    menuTrigger,
    fullscreenToggle,
    controlsPanel,
    graphicsPresetSelect,
    graphicsPresetStatus,
    vibrationToggleButton,
    trackingConsent,
    trackingStatus,
    trackingAcceptButton,
    trackingDeclineButton,
  }) {
    this.speed = speed;
    this.distance = distance;
    this.weather = weather;
    this.lane = lane;
    this.nos = nos;
    this.nosFill = nosFill;
    this.coins = coins;
    this.pursuit = pursuit;
    this.race = race;
    this.assist = assist;
    this.overlay = overlay;
    this.crashMessage = crashMessage;
    this.scoreStatus = scoreStatus;
    this.restartButton = restartButton;
    this.menuButton = menuButton;
    this.menuOverlay = menuOverlay;
    this.accessibilityOverlay = accessibilityOverlay;
    this.accessibilityNamePanel = accessibilityNamePanel;
    this.accessibilityQuestionPanel = accessibilityQuestionPanel;
    this.accessibilitySetupPanel = accessibilitySetupPanel;
    this.onboardingNameInput = onboardingNameInput;
    this.accessibilityNameContinueButton = accessibilityNameContinueButton;
    this.accessibilityYesButton = accessibilityYesButton;
    this.accessibilityNoButton = accessibilityNoButton;
    this.accessibilityContinueButton = accessibilityContinueButton;
    this.accessibilityContrastButton = accessibilityContrastButton;
    this.accessibilityColorButton = accessibilityColorButton;
    this.menuPlayButton = menuPlayButton;
    this.menuNewRunButton = menuNewRunButton;
    this.playerNameInput = playerNameInput;
    this.leaderboardList = leaderboardList;
    this.menuStatus = menuStatus;
    this.accessibilityReviewButton = accessibilityReviewButton;
    this.accessibilityStatus = accessibilityStatus;
    this.highContrastButton = highContrastButton;
    this.colorAssistButton = colorAssistButton;
    this.aiToggleButton = aiToggleButton;
    this.secretPanel = secretPanel;
    this.secretTrigger = secretTrigger;
    this.menuSoloTab = menuSoloTab;
    this.menuMultiplayerTab = menuMultiplayerTab;
    this.menuOptionsTab = menuOptionsTab;
    this.soloMenuPanel = soloMenuPanel;
    this.multiplayerMenuPanel = multiplayerMenuPanel;
    this.optionsMenuPanel = optionsMenuPanel;
    this.multiplayerStatus = multiplayerStatus;
    this.lobbyCodeInput = lobbyCodeInput;
    this.multiplayerLobbyCard = multiplayerLobbyCard;
    this.multiplayerLobbyCode = multiplayerLobbyCode;
    this.multiplayerPlayerList = multiplayerPlayerList;
    this.multiplayerWaitingList = multiplayerWaitingList;
    this.multiplayerCreateButton = multiplayerCreateButton;
    this.multiplayerJoinButton = multiplayerJoinButton;
    this.multiplayerRefreshButton = multiplayerRefreshButton;
    this.multiplayerReadyButton = multiplayerReadyButton;
    this.multiplayerStartButton = multiplayerStartButton;
    this.multiplayerLeaveButton = multiplayerLeaveButton;
    this.leftIndicator = leftIndicator;
    this.rightIndicator = rightIndicator;
    this.menuTrigger = menuTrigger;
    this.fullscreenToggle = fullscreenToggle;
    this.controlsPanel = controlsPanel;
    this.graphicsPresetSelect = graphicsPresetSelect;
    this.graphicsPresetStatus = graphicsPresetStatus;
    this.vibrationToggleButton = vibrationToggleButton;
    this.trackingConsent = trackingConsent;
    this.trackingStatus = trackingStatus;
    this.trackingAcceptButton = trackingAcceptButton;
    this.trackingDeclineButton = trackingDeclineButton;

    this.aiEnabled = false;
    this.secretUnlocked = false;
    this.secretTapCount = 0;
    this.menuMode = "solo";

    this.handleSecretTrigger = this.handleSecretTrigger.bind(this);
    this.handleAiToggle = this.handleAiToggle.bind(this);
    this.handleModeButton = this.handleModeButton.bind(this);
    this.handleGraphicsPresetChange = this.handleGraphicsPresetChange.bind(this);

    this.secretTrigger?.addEventListener("click", this.handleSecretTrigger);
    this.aiToggleButton?.addEventListener("click", this.handleAiToggle);
    this.menuSoloTab?.addEventListener("click", this.handleModeButton);
    this.menuMultiplayerTab?.addEventListener("click", this.handleModeButton);
    this.menuOptionsTab?.addEventListener("click", this.handleModeButton);
    this.graphicsPresetSelect?.addEventListener("change", this.handleGraphicsPresetChange);
    this.trackingAcceptButton?.addEventListener("click", () => this.onTrackingConsent?.("accepted"));
    this.trackingDeclineButton?.addEventListener("click", () => this.onTrackingConsent?.("declined"));
    this.clearLobbyState();
    this.setMenuMode("solo");
  }

  update({
    speed,
    distance,
    weather,
    lane,
    nos = 0,
    coins = 0,
    pursuit = "Clear",
    race = "Solo",
    assist,
  }) {
    if (this.speed) {
      this.speed.textContent = `${Math.round(speed * 3.6)} km/h`;
    }
    if (this.distance) {
      const roundedDistance = Math.max(0, distance);
      this.distance.textContent =
        roundedDistance >= 1000
          ? `${(roundedDistance / 1000).toFixed(1)} km`
          : `${Math.round(roundedDistance)} m`;
    }
    if (this.weather) {
      this.weather.textContent = weather;
    }
    if (this.lane) {
      this.lane.textContent = lane;
    }
    if (this.nos) {
      if (nos >= 55) {
        this.nos.textContent = "Full";
      } else if (nos >= 22) {
        this.nos.textContent = "Ready";
      } else if (nos > 1) {
        this.nos.textContent = "Low";
      } else {
        this.nos.textContent = "Empty";
      }
    }
    if (this.nosFill) {
      this.nosFill.style.width = `${Math.max(0, Math.min(100, nos))}%`;
    }
    if (this.coins) {
      this.coins.textContent = `${Math.round(coins)}`;
    }
    if (this.pursuit) {
      this.pursuit.textContent = pursuit;
    }
    if (this.race) {
      this.race.textContent = race;
    }
    if (this.assist) {
      this.assist.textContent = assist;
    }
  }

  updateTurnIndicator(signalDirection, blinkOn) {
    if (!this.leftIndicator || !this.rightIndicator) {
      return;
    }

    this.leftIndicator.classList.toggle("is-active", signalDirection < 0 && blinkOn);
    this.rightIndicator.classList.toggle("is-active", signalDirection > 0 && blinkOn);
  }

  showCrash(distance) {
    this.crashMessage.textContent = `You lasted ${Math.round(distance)} m. Press Enter, Space, R, or restart to hit the road again.`;
    this.overlay.classList.remove("is-hidden");
  }

  hideCrash() {
    this.overlay.classList.add("is-hidden");
  }

  setScoreStatus(message) {
    this.scoreStatus.textContent = message;
  }

  showAccessibilityPrompt({ step = "name" } = {}) {
    this.accessibilityOverlay?.classList.remove("is-hidden");
    this.setAccessibilityPromptStep(step);
  }

  hideAccessibilityPrompt() {
    this.accessibilityOverlay?.classList.add("is-hidden");
  }

  isAccessibilityPromptVisible() {
    if (!this.accessibilityOverlay) {
      return false;
    }

    return !this.accessibilityOverlay.classList.contains("is-hidden");
  }

  setAccessibilityPromptStep(step) {
    this.accessibilityNamePanel?.classList.toggle("is-hidden", step !== "name");
    this.accessibilityQuestionPanel?.classList.toggle("is-hidden", step !== "question");
    this.accessibilitySetupPanel?.classList.toggle("is-hidden", step !== "setup");
  }

  showMenu({ canResume = false, aiEnabled = false, mode = this.menuMode } = {}) {
    this.menuPlayButton.textContent = canResume ? "Resume" : "Drive";
    this.menuNewRunButton.classList.toggle("is-hidden", !canResume);
    this.menuOverlay.classList.remove("is-hidden");
    this.setAiEnabled(aiEnabled);
    this.setMenuMode(mode);
    this.renderSecretPanel();
  }

  hideMenu() {
    this.menuOverlay.classList.add("is-hidden");
  }

  isMenuVisible() {
    return !this.menuOverlay.classList.contains("is-hidden");
  }

  setMenuStatus(message) {
    this.menuStatus.textContent = message;
  }

  setControlsVisible(visible) {
    this.controlsPanel?.classList.toggle("is-hidden-by-timer", !visible);
  }

  showTrackingConsent() {
    this.trackingConsent?.classList.remove("is-hidden");
  }

  hideTrackingConsent() {
    this.trackingConsent?.classList.add("is-hidden");
  }

  setTrackingStatus(message) {
    if (this.trackingStatus) {
      this.trackingStatus.textContent = message;
    }
  }

  setAccessibilityStatus(message) {
    if (this.accessibilityStatus) {
      this.accessibilityStatus.textContent = message;
    }
  }

  setFullscreenAvailable(available) {
    if (this.fullscreenToggle) {
      this.fullscreenToggle.disabled = !available;
    }
  }

  setFullscreenActive(active) {
    if (!this.fullscreenToggle) {
      return;
    }

    this.fullscreenToggle.textContent = active ? "Fullscreen: On" : "Fullscreen: Off";
    this.fullscreenToggle.setAttribute("aria-pressed", active ? "true" : "false");
  }

  setAiEnabled(enabled) {
    this.aiEnabled = enabled;
    if (!this.aiToggleButton) {
      return;
    }

    this.aiToggleButton.dataset.enabled = enabled ? "true" : "false";
    this.aiToggleButton.textContent = enabled ? "Drive Assist: On" : "Drive Assist: Off";
  }

  setGraphicsPreset(preset) {
    if (this.graphicsPresetSelect) {
      this.graphicsPresetSelect.value = preset;
    }
  }

  setGraphicsPresetStatus(message) {
    if (this.graphicsPresetStatus) {
      this.graphicsPresetStatus.textContent = message;
    }
  }

  setVibrationEnabled(enabled, supported = true) {
    if (!this.vibrationToggleButton) {
      return;
    }

    if (!supported) {
      this.vibrationToggleButton.disabled = true;
      this.vibrationToggleButton.textContent = "Vibration: Unavailable";
      return;
    }

    this.vibrationToggleButton.disabled = false;
    this.vibrationToggleButton.textContent = enabled ? "Vibration: On" : "Vibration: Off";
  }

  setAccessibilitySettings({ highContrast = false, colorAssist = false } = {}) {
    const highContrastLabel = highContrast ? "High Contrast: On" : "High Contrast: Off";
    const colorAssistLabel = colorAssist ? "Color Assist: On" : "Color Assist: Off";
    if (this.highContrastButton) {
      this.highContrastButton.textContent = highContrastLabel;
    }
    if (this.colorAssistButton) {
      this.colorAssistButton.textContent = colorAssistLabel;
    }
    if (this.accessibilityContrastButton) {
      this.accessibilityContrastButton.textContent = highContrastLabel;
    }
    if (this.accessibilityColorButton) {
      this.accessibilityColorButton.textContent = colorAssistLabel;
    }
  }

  unlockSecretMenu() {
    this.secretUnlocked = true;
    this.renderSecretPanel();
  }

  renderSecretPanel() {
    if (!this.secretPanel) {
      return;
    }

    this.secretPanel.classList.toggle("is-hidden", !this.secretUnlocked || this.menuMode !== "options");
  }

  setMenuMode(mode) {
    if (mode === "multiplayer") {
      this.menuMode = "multiplayer";
    } else if (mode === "options") {
      this.menuMode = "options";
    } else {
      this.menuMode = "solo";
    }

    this.menuSoloTab?.classList.toggle("is-active", this.menuMode === "solo");
    this.menuMultiplayerTab?.classList.toggle("is-active", this.menuMode === "multiplayer");
    this.menuOptionsTab?.classList.toggle("is-active", this.menuMode === "options");
    this.soloMenuPanel?.classList.toggle("is-hidden", this.menuMode !== "solo");
    this.multiplayerMenuPanel?.classList.toggle("is-hidden", this.menuMode !== "multiplayer");
    this.optionsMenuPanel?.classList.toggle("is-hidden", this.menuMode !== "options");
    this.renderSecretPanel();
  }

  getPlayerName() {
    return this.playerNameInput.value.trim();
  }

  setPlayerName(name) {
    this.playerNameInput.value = name || "";
    if (this.onboardingNameInput) {
      this.onboardingNameInput.value = name || "";
    }
  }

  focusNameInput() {
    this.playerNameInput.focus();
    this.playerNameInput.select();
  }

  getOnboardingName() {
    return this.onboardingNameInput?.value.trim() || "";
  }

  focusOnboardingNameInput() {
    this.onboardingNameInput?.focus();
    this.onboardingNameInput?.select();
  }

  getLobbyCode() {
    return (this.lobbyCodeInput?.value || "").trim().toUpperCase();
  }

  setLobbyCode(code) {
    if (this.lobbyCodeInput) {
      this.lobbyCodeInput.value = code || "";
    }
    if (this.multiplayerLobbyCode) {
      this.multiplayerLobbyCode.textContent = code || "------";
    }
  }

  setMultiplayerStatus(message) {
    if (this.multiplayerStatus) {
      this.multiplayerStatus.textContent = message;
    }
  }

  clearLobbyState() {
    this.setLobbyCode("");
    this.multiplayerLobbyCard?.classList.add("is-hidden");
    if (this.multiplayerPlayerList) {
      this.multiplayerPlayerList.innerHTML = "";
    }
    if (this.multiplayerReadyButton) {
      this.multiplayerReadyButton.textContent = "Ready: Off";
      this.multiplayerReadyButton.disabled = true;
    }
    if (this.multiplayerStartButton) {
      this.multiplayerStartButton.disabled = true;
    }
    if (this.multiplayerLeaveButton) {
      this.multiplayerLeaveButton.disabled = true;
    }
  }

  renderWaitingLobbies(lobbies = []) {
    if (!this.multiplayerWaitingList) {
      return;
    }

    this.multiplayerWaitingList.innerHTML = "";
    if (!lobbies.length) {
      const empty = document.createElement("li");
      empty.className = "multiplayer-waiting-empty";
      empty.textContent = "No open races right now.";
      this.multiplayerWaitingList.appendChild(empty);
      return;
    }

    for (const lobby of lobbies) {
      const row = document.createElement("li");
      row.className = "multiplayer-waiting";

      const meta = document.createElement("div");
      meta.className = "multiplayer-waiting__meta";

      const title = document.createElement("strong");
      title.textContent = lobby.code;

      const detail = document.createElement("span");
      detail.textContent = `${lobby.hostName} · ${lobby.playerCount} driver${lobby.playerCount === 1 ? "" : "s"}`;

      meta.append(title, detail);

      const joinButton = document.createElement("button");
      joinButton.type = "button";
      joinButton.className = "ghost-button";
      joinButton.textContent = "Join";
      joinButton.addEventListener("click", () => {
        this.setLobbyCode(lobby.code);
        this.onWaitingLobbyJoin?.(lobby.code);
      });

      row.append(meta, joinButton);
      this.multiplayerWaitingList.appendChild(row);
    }
  }

  renderLobbyState({ lobbyCode, players = [], ownerId, canStart, raceStatus, clientId }) {
    this.setLobbyCode(lobbyCode || "");

    if (!lobbyCode) {
      this.clearLobbyState();
      return;
    }

    this.multiplayerLobbyCard?.classList.remove("is-hidden");
    if (this.multiplayerPlayerList) {
      this.multiplayerPlayerList.innerHTML = "";
      for (const player of players) {
        const row = document.createElement("li");
        row.className = "multiplayer-player";

        const name = document.createElement("div");
        name.className = "multiplayer-player__name";
        name.textContent = player.name;

        if (player.id === clientId) {
          const you = document.createElement("span");
          you.className = "multiplayer-player__you";
          you.textContent = "You";
          name.appendChild(you);
        }

        const status = document.createElement("span");
        status.className = "multiplayer-player__status";

        const tags = [];
        if (player.id === ownerId) {
          tags.push("Host");
        }
        if (raceStatus === "running") {
          tags.push(player.finished ? "Finished" : "Racing");
        } else {
          tags.push(player.ready ? "Ready" : "Waiting");
        }
        status.textContent = tags.join(" / ");

        row.append(name, status);
        this.multiplayerPlayerList.appendChild(row);
      }
    }

    const localPlayer = players.find((player) => player.id === clientId);
    const isHost = ownerId === clientId;

    if (this.multiplayerReadyButton) {
      this.multiplayerReadyButton.disabled = raceStatus !== "lobby";
      this.multiplayerReadyButton.textContent = localPlayer?.ready ? "Ready: On" : "Ready: Off";
    }
    if (this.multiplayerStartButton) {
      this.multiplayerStartButton.disabled = !isHost || !canStart || raceStatus !== "lobby";
    }
    if (this.multiplayerLeaveButton) {
      this.multiplayerLeaveButton.disabled = false;
    }
  }

  renderLeaderboard(entries) {
    this.leaderboardList.innerHTML = "";
    const topEntries = entries.slice(0, 3);

    if (!topEntries.length) {
      const row = document.createElement("li");
      row.className = "leaderboard-row leaderboard-row--empty";
      row.textContent = "No runs logged yet.";
      this.leaderboardList.appendChild(row);
      return;
    }

    let displayRank = 1;
    topEntries.forEach((entry) => {
      const row = document.createElement("li");
      row.className = "leaderboard-row";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = `#${displayRank}`;

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = entry.name;

      const distance = document.createElement("span");
      distance.className = "leaderboard-distance";
      distance.textContent = `${Math.round(entry.distance)} m`;

      row.append(rank, name, distance);

      const badgeText = entry.badge || (entry.aiEnabled ? "AI" : "");
      if (badgeText) {
        const badge = document.createElement("span");
        badge.className = "leaderboard-badge";
        badge.textContent = badgeText;
        row.appendChild(badge);
      }

      this.leaderboardList.appendChild(row);
      displayRank += 1;
    });
  }

  setRestartHandler(handler) {
    this.restartButton.addEventListener("click", handler);
  }

  setMainMenuHandler(handler) {
    this.menuButton.addEventListener("click", handler);
  }

  setMenuPlayHandler(handler) {
    this.menuPlayButton.addEventListener("click", handler);
  }

  setMenuNewRunHandler(handler) {
    this.menuNewRunButton.addEventListener("click", handler);
  }

  setMenuOpenHandler(handler) {
    this.menuTrigger.addEventListener("click", handler);
  }

  setAccessibilityPromptYesHandler(handler) {
    this.accessibilityYesButton?.addEventListener("click", handler);
  }

  setAccessibilityNameContinueHandler(handler) {
    this.accessibilityNameContinueButton?.addEventListener("click", handler);
  }

  setAccessibilityPromptNoHandler(handler) {
    this.accessibilityNoButton?.addEventListener("click", handler);
  }

  setAccessibilityPromptContinueHandler(handler) {
    this.accessibilityContinueButton?.addEventListener("click", handler);
  }

  setAccessibilityReviewHandler(handler) {
    this.accessibilityReviewButton?.addEventListener("click", handler);
  }

  setHighContrastHandler(handler) {
    this.highContrastButton?.addEventListener("click", handler);
    this.accessibilityContrastButton?.addEventListener("click", handler);
  }

  setColorAssistHandler(handler) {
    this.colorAssistButton?.addEventListener("click", handler);
    this.accessibilityColorButton?.addEventListener("click", handler);
  }

  setFullscreenHandler(handler) {
    this.fullscreenToggle?.addEventListener("click", handler);
  }

  setMenuModeHandler(handler) {
    this.onMenuModeChange = handler;
  }

  setAiToggleHandler(handler) {
    this.onAiToggle = handler;
  }

  setSecretUnlockHandler(handler) {
    this.onSecretUnlock = handler;
  }

  setMultiplayerCreateHandler(handler) {
    this.multiplayerCreateButton?.addEventListener("click", handler);
  }

  setMultiplayerJoinHandler(handler) {
    this.multiplayerJoinButton?.addEventListener("click", handler);
  }

  setMultiplayerRefreshHandler(handler) {
    this.multiplayerRefreshButton?.addEventListener("click", handler);
  }

  setWaitingLobbyJoinHandler(handler) {
    this.onWaitingLobbyJoin = handler;
  }

  setMultiplayerReadyHandler(handler) {
    this.multiplayerReadyButton?.addEventListener("click", handler);
  }

  setMultiplayerStartHandler(handler) {
    this.multiplayerStartButton?.addEventListener("click", handler);
  }

  setMultiplayerLeaveHandler(handler) {
    this.multiplayerLeaveButton?.addEventListener("click", handler);
  }

  setTrackingConsentHandler(handler) {
    this.onTrackingConsent = handler;
  }

  setVibrationToggleHandler(handler) {
    this.vibrationToggleButton?.addEventListener("click", handler);
  }

  setGraphicsPresetHandler(handler) {
    this.onGraphicsPresetChange = handler;
  }

  handleSecretTrigger() {
    if (this.secretUnlocked) {
      return;
    }

    this.secretTapCount += 1;
    if (this.secretTapCount >= 5) {
      this.unlockSecretMenu();
      if (typeof this.onSecretUnlock === "function") {
        this.onSecretUnlock();
      }
    }
  }

  handleAiToggle() {
    const nextValue = this.aiToggleButton?.dataset.enabled !== "true";
    if (typeof this.onAiToggle === "function") {
      this.onAiToggle(nextValue);
    }
  }

  handleModeButton(event) {
    const mode = event.currentTarget?.dataset.mode || "solo";
    this.setMenuMode(mode);
    if (typeof this.onMenuModeChange === "function") {
      this.onMenuModeChange(mode);
    }
  }

  handleGraphicsPresetChange(event) {
    const preset = event.currentTarget?.value || "low";
    if (typeof this.onGraphicsPresetChange === "function") {
      this.onGraphicsPresetChange(preset);
    }
  }
}
