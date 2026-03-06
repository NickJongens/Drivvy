const FEATURED_NAME = "Nick Jongens";
const FEATURED_GAP_METRES = 6;
const DEFAULT_LIMIT = 10;
const CACHE_KEY = "drivvy.highscores.cache";

export class LeaderboardService {
  constructor({ endpoint = "/api/highscores" } = {}) {
    this.endpoint = endpoint;
  }

  async refreshLeaderboard(limit = DEFAULT_LIMIT) {
    try {
      const remoteScores = await this.fetchScores();
      const mergedScores = this.mergeScores(remoteScores, this.readCachedScores());
      this.writeCachedScores(mergedScores);
      return {
        ...this.buildLeaderboard(mergedScores, limit),
        storage: "server",
      };
    } catch (error) {
      const cachedScores = this.readCachedScores();
      if (cachedScores.length) {
        return {
          ...this.buildLeaderboard(cachedScores, limit),
          storage: "browser",
        };
      }

      throw error;
    }
  }

  async submitScore({ name, distance, aiEnabled, weather }) {
    const normalizedEntry = this.normalizeEntry({
      name,
      distance,
      aiEnabled,
      weather,
      createdAt: new Date().toISOString(),
    });

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: normalizedEntry.name,
          distance: normalizedEntry.distance,
          aiEnabled: normalizedEntry.aiEnabled,
          weather: normalizedEntry.weather,
        }),
      });

      const data = await this.readJson(response, "High score save failed.");
      if (!response.ok) {
        throw new Error(data.error || `High score save failed with status ${response.status}.`);
      }

      const mergedScores = this.mergeScores(data.scores ?? [], this.readCachedScores());
      this.writeCachedScores(mergedScores);
      return {
        ...this.buildLeaderboard(mergedScores, DEFAULT_LIMIT, data.savedEntry ?? normalizedEntry),
        storage: "server",
      };
    } catch (error) {
      const fallbackScores = this.mergeScores(this.readCachedScores(), [normalizedEntry]);
      this.writeCachedScores(fallbackScores);
      return {
        ...this.buildLeaderboard(fallbackScores, DEFAULT_LIMIT, normalizedEntry),
        storage: "browser",
      };
    }
  }

  async fetchScores() {
    const response = await fetch(this.endpoint, { cache: "no-store" });
    const data = await this.readJson(response, "High score fetch failed.");
    if (!response.ok) {
      throw new Error(data.error || `High score fetch failed with status ${response.status}.`);
    }

    return Array.isArray(data.scores) ? data.scores : [];
  }

  buildLeaderboard(scores, limit = DEFAULT_LIMIT, savedEntry = null) {
    const realEntries = scores
      .map((entry) => this.normalizeEntry(entry))
      .filter(Boolean)
      .sort((entryA, entryB) => this.compareEntries(entryA, entryB))
      .slice(0, limit);

    const featuredEntry = {
      id: "house-best-nick-jongens",
      name: FEATURED_NAME,
      distance: (realEntries[0]?.distance ?? 0) + FEATURED_GAP_METRES,
      aiEnabled: false,
      weather: "Clear",
      createdAt: null,
      badge: "House Best",
      isPinned: true,
    };

    return {
      entries: [featuredEntry, ...realEntries],
      realEntries,
      savedEntry: savedEntry ? this.normalizeEntry(savedEntry) : null,
    };
  }

  normalizeEntry(entry) {
    if (!entry) {
      return null;
    }

    return {
      id: String(entry.id ?? `${entry.name || "guest"}-${entry.distance || 0}-${entry.createdAt || entry.created_at || ""}`),
      name: this.normalizeName(entry.name),
      distance: Math.max(0, Math.round(Number(entry.distance) || 0)),
      aiEnabled: Boolean(entry.aiEnabled ?? entry.aiMode ?? entry.ai_mode),
      weather: (entry.weather || "Clear").toString().slice(0, 24),
      createdAt: entry.createdAt || entry.created_at || new Date(0).toISOString(),
      badge: entry.badge || "",
      isPinned: Boolean(entry.isPinned),
    };
  }

  mergeScores(primaryScores, secondaryScores) {
    const mergedById = new Map();

    for (const entry of [...primaryScores, ...secondaryScores]) {
      const normalizedEntry = this.normalizeEntry(entry);
      if (!normalizedEntry) {
        continue;
      }

      mergedById.set(normalizedEntry.id, normalizedEntry);
    }

    return [...mergedById.values()].sort((entryA, entryB) => this.compareEntries(entryA, entryB));
  }

  normalizeName(name) {
    const trimmed = (name || "").trim().replace(/\s+/g, " ");
    return trimmed.slice(0, 18) || "Guest";
  }

  compareEntries(entryA, entryB) {
    if (entryB.distance !== entryA.distance) {
      return entryB.distance - entryA.distance;
    }

    return new Date(entryA.createdAt).getTime() - new Date(entryB.createdAt).getTime();
  }

  async readJson(response, fallbackMessage) {
    try {
      return await response.json();
    } catch (error) {
      throw new Error(fallbackMessage);
    }
  }

  readCachedScores() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  writeCachedScores(scores) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(scores.slice(0, 50)));
    } catch (error) {
      return;
    }
  }
}
