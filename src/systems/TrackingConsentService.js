const TRACKING_CONSENT_COOKIE = "drivvy_tracking_consent";
const TRACKING_SESSION_COOKIE = "drivvy_tracking_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function readCookie(name) {
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return "";
}

function writeCookie(name, value, maxAge = COOKIE_MAX_AGE) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

function clearCookie(name) {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function createSessionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class TrackingConsentService {
  getChoice() {
    const choice = readCookie(TRACKING_CONSENT_COOKIE);
    return choice === "accepted" || choice === "declined" ? choice : null;
  }

  hasAccepted() {
    return this.getChoice() === "accepted";
  }

  setChoice(choice) {
    const normalizedChoice = choice === "accepted" ? "accepted" : "declined";
    writeCookie(TRACKING_CONSENT_COOKIE, normalizedChoice);

    if (normalizedChoice === "accepted") {
      return this.ensureSessionId();
    }

    clearCookie(TRACKING_SESSION_COOKIE);
    return "";
  }

  ensureSessionId() {
    let sessionId = readCookie(TRACKING_SESSION_COOKIE);
    if (!sessionId) {
      sessionId = createSessionId();
      writeCookie(TRACKING_SESSION_COOKIE, sessionId);
    }

    return sessionId;
  }

  getSessionId() {
    return this.hasAccepted() ? this.ensureSessionId() : "";
  }
}
