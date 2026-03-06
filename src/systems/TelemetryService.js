async function readJson(response, fallbackMessage) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(fallbackMessage);
  }
}

export class TelemetryService {
  constructor({ basePath = "/api/telemetry" } = {}) {
    this.basePath = basePath.replace(/\/+$/, "");
  }

  async registerSession({ sessionId, consent }) {
    if (!consent || !sessionId) {
      return { tracked: false };
    }

    return this.postJson("/session", {
      consent: true,
      sessionId,
      path: window.location.pathname,
      referrer: document.referrer || "",
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    });
  }

  async recordRun({ sessionId, consent, mode = "solo", trackSeed = 0 }) {
    if (!consent || !sessionId) {
      return { tracked: false };
    }

    return this.postJson("/run", {
      consent: true,
      sessionId,
      mode,
      trackSeed,
    });
  }

  async recordScore({ sessionId, consent, distance, mode = "solo", weather = "Clear", aiEnabled = false }) {
    if (!consent || !sessionId) {
      return { tracked: false };
    }

    return this.postJson("/score", {
      consent: true,
      sessionId,
      distance,
      mode,
      weather,
      aiEnabled,
    });
  }

  async postJson(pathname, payload) {
    const response = await fetch(`${this.basePath}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await readJson(response, "Telemetry request failed.");
    if (!response.ok) {
      throw new Error(data.error || `Telemetry request failed with status ${response.status}.`);
    }

    return data;
  }
}
