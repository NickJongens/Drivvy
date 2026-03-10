function toWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export class MultiplayerClient {
  constructor({ url = toWsUrl() } = {}) {
    this.url = url;
    this.socket = null;
    this.connectPromise = null;
    this.clientId = null;
    this.lobbyCode = null;

    this.onStatus = null;
    this.onLobbyState = null;
    this.onWaitingLobbies = null;
    this.onRaceStarted = null;
    this.onRaceState = null;
    this.onRaceFinished = null;
    this.onError = null;
  }

  async connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.setStatus("Connecting...");

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.setStatus("Connected");
        resolve(socket);
      });

      socket.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });

      socket.addEventListener("close", () => {
        this.setStatus("Disconnected");
        this.socket = null;
        this.connectPromise = null;
      });

      socket.addEventListener("error", () => {
        this.setStatus("Connection failed");
        this.socket = null;
        this.connectPromise = null;
        reject(new Error("Unable to connect to multiplayer server."));
      });
    });

    return this.connectPromise;
  }

  async createLobby(name) {
    await this.connect();
    this.send({ type: "create_lobby", name });
  }

  async joinLobby(name, code) {
    await this.connect();
    this.send({ type: "join_lobby", name, lobbyCode: code });
  }

  async leaveLobby() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.send({ type: "leave_lobby" });
  }

  async toggleReady() {
    await this.connect();
    this.send({ type: "toggle_ready" });
  }

  async startRace() {
    await this.connect();
    this.send({ type: "start_race" });
  }

  async requestWaitingLobbies() {
    await this.connect();
    this.send({ type: "list_lobbies" });
  }

  sendPlayerState(state) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.send({
      type: "player_state",
      state,
    });
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(payload));
  }

  handleMessage(rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch (error) {
      return;
    }

    switch (message.type) {
      case "welcome":
        this.clientId = message.clientId;
        break;
      case "lobby_state":
        this.lobbyCode = message.lobbyCode || null;
        this.onLobbyState?.(message);
        break;
      case "waiting_lobbies":
        this.onWaitingLobbies?.(message);
        break;
      case "race_started":
        this.onRaceStarted?.(message);
        break;
      case "race_state":
        this.onRaceState?.(message);
        break;
      case "race_finished":
        this.onRaceFinished?.(message);
        break;
      case "error":
        this.onError?.(message.message || "Multiplayer error.");
        break;
      default:
        break;
    }
  }

  setStatus(message) {
    this.onStatus?.(message);
  }
}
