import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const HIGH_SCORES_PATH = path.join(DATA_DIR, "highscores.json");
const STATS_PATH = path.join(DATA_DIR, "stats.json");
const MAX_SCORES = 250;
const MULTIPLAYER_TARGET_DISTANCE = 10000;
const MULTIPLAYER_COUNTDOWN_MS = 5000;
const FEATURED_NAME = "Nick Jongens";
const MAX_TRACKED_VISITORS = 250;
const MAX_RECENT_EVENTS = 200;
const STATS_API_KEY = String(process.env.DRIVVY_STATS_API_KEY || process.env.STATS_API_KEY || "").trim();

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
]);

const webSocketClients = new Map();
const lobbies = new Map();
const trackedVisitors = new Map();
const recentRuns = [];
const recentScores = [];
const API_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
};

function send(response, statusCode, contentType, body, skipBody = false, extraHeaders = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": bytes.length,
    "Cache-Control": contentType.includes("json") ? "no-store" : "public, max-age=0",
    ...extraHeaders,
  });

  if (!skipBody) {
    response.end(bytes);
    return;
  }

  response.end();
}

function sendJson(response, statusCode, payload, skipBody = false, extraHeaders = {}) {
  send(
    response,
    statusCode,
    "application/json; charset=utf-8",
    JSON.stringify(payload, null, 2),
    skipBody,
    extraHeaders
  );
}

function sendText(response, statusCode, text, skipBody = false, extraHeaders = {}) {
  send(response, statusCode, "text/plain; charset=utf-8", text, skipBody, extraHeaders);
}

function sendApiJson(response, statusCode, payload, skipBody = false) {
  sendJson(response, statusCode, payload, skipBody, API_HEADERS);
}

function sendApiText(response, statusCode, text, skipBody = false) {
  sendText(response, statusCode, text, skipBody, API_HEADERS);
}

async function ensureHighScoresFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(HIGH_SCORES_PATH);
  } catch (error) {
    await fs.writeFile(HIGH_SCORES_PATH, JSON.stringify({ scores: [] }, null, 2), "utf8");
  }
}

async function readHighScores() {
  await ensureHighScoresFile();

  try {
    const raw = await fs.readFile(HIGH_SCORES_PATH, "utf8");
    if (!raw.trim()) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.scores) ? parsed.scores : [];
  } catch (error) {
    return [];
  }
}

async function writeHighScores(scores) {
  await ensureHighScoresFile();
  await fs.writeFile(HIGH_SCORES_PATH, JSON.stringify({ scores }, null, 2), "utf8");
}

function createEmptyStatsStore() {
  return {
    totals: {
      trackedSessions: 0,
      playRuns: 0,
      scoreEvents: 0,
    },
    updatedAt: null,
  };
}

async function ensureStatsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(STATS_PATH);
  } catch (error) {
    await fs.writeFile(STATS_PATH, JSON.stringify(createEmptyStatsStore(), null, 2), "utf8");
  }
}

async function readStatsStore() {
  await ensureStatsFile();

  try {
    const raw = await fs.readFile(STATS_PATH, "utf8");
    if (!raw.trim()) {
      return createEmptyStatsStore();
    }

    const parsed = JSON.parse(raw);
    return {
      totals: {
        trackedSessions: Math.max(0, Number(parsed?.totals?.trackedSessions) || 0),
        playRuns: Math.max(0, Number(parsed?.totals?.playRuns) || 0),
        scoreEvents: Math.max(0, Number(parsed?.totals?.scoreEvents) || 0),
      },
      updatedAt: parsed?.updatedAt || null,
    };
  } catch (error) {
    return createEmptyStatsStore();
  }
}

async function updateStatsStore(mutator) {
  const store = await readStatsStore();
  const nextStore = mutator ? mutator(store) || store : store;
  nextStore.updatedAt = new Date().toISOString();
  await fs.writeFile(STATS_PATH, JSON.stringify(nextStore, null, 2), "utf8");
  return nextStore;
}

function normalizeName(name) {
  const trimmed = String(name || "").trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 18) || "Guest";
}

function normalizeScoreEntry(payload) {
  return {
    id: crypto.randomUUID(),
    name: normalizeName(payload?.name),
    distance: Math.max(0, Math.round(Number(payload?.distance) || 0)),
    aiEnabled: Boolean(payload?.aiEnabled),
    weather: String(payload?.weather || "Clear").slice(0, 24),
    createdAt: new Date().toISOString(),
  };
}

function normalizeSessionId(sessionId) {
  return String(sessionId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function normalizeEventMode(mode) {
  return mode === "multiplayer" ? "multiplayer" : "solo";
}

function clampLimit(value, fallback = 10, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, parsed));
}

function getStatsApiKeyCandidate(request, url) {
  const authHeader = String(request.headers.authorization || "");
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return String(
    request.headers["x-api-key"] ||
      url.searchParams.get("apiKey") ||
      url.searchParams.get("api_key") ||
      ""
  ).trim();
}

function isStatsAuthorized(request, url) {
  if (!STATS_API_KEY) {
    return true;
  }

  return getStatsApiKeyCandidate(request, url) === STATS_API_KEY;
}

function getClientIp(request) {
  const forwardedFor = String(request.headers["cf-connecting-ip"] || request.headers["x-forwarded-for"] || "")
    .split(",")
    .map((part) => part.trim())
    .find(Boolean);
  return forwardedFor || request.socket.remoteAddress || "";
}

function pushRecentEvent(list, event) {
  list.unshift(event);
  if (list.length > MAX_RECENT_EVENTS) {
    list.length = MAX_RECENT_EVENTS;
  }
}

function upsertTrackedVisitor(request, payload = {}) {
  const sessionId = normalizeSessionId(payload.sessionId);
  if (!sessionId) {
    return null;
  }

  const now = new Date().toISOString();
  const visitor = trackedVisitors.get(sessionId) || {
    sessionId,
    firstSeenAt: now,
    lastSeenAt: now,
    ipAddress: getClientIp(request),
    userAgent: String(request.headers["user-agent"] || "").slice(0, 320),
    referrer: String(payload.referrer || "").slice(0, 320),
    pagePath: String(payload.path || "/").slice(0, 120),
    viewport: String(payload.viewport || "").slice(0, 40),
    screen: String(payload.screen || "").slice(0, 40),
    playRuns: 0,
    scoreEvents: 0,
  };

  visitor.lastSeenAt = now;
  visitor.ipAddress = getClientIp(request);
  visitor.userAgent = String(request.headers["user-agent"] || visitor.userAgent || "").slice(0, 320);
  visitor.referrer = String(payload.referrer || visitor.referrer || "").slice(0, 320);
  visitor.pagePath = String(payload.path || visitor.pagePath || "/").slice(0, 120);
  visitor.viewport = String(payload.viewport || visitor.viewport || "").slice(0, 40);
  visitor.screen = String(payload.screen || visitor.screen || "").slice(0, 40);
  trackedVisitors.set(sessionId, visitor);

  if (trackedVisitors.size > MAX_TRACKED_VISITORS) {
    const oldestSession = [...trackedVisitors.values()]
      .sort((visitorA, visitorB) => new Date(visitorA.lastSeenAt).getTime() - new Date(visitorB.lastSeenAt).getTime())[0]
      ?.sessionId;
    if (oldestSession) {
      trackedVisitors.delete(oldestSession);
    }
  }

  return { visitor, isNew: visitor.firstSeenAt === now };
}

function compareEntries(entryA, entryB) {
  if (entryB.distance !== entryA.distance) {
    return entryB.distance - entryA.distance;
  }

  return new Date(entryA.createdAt).getTime() - new Date(entryB.createdAt).getTime();
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function handleHighScores(request, response) {
  const skipBody = request.method === "HEAD";

  if (request.method === "GET" || request.method === "HEAD") {
    sendApiJson(response, 200, { scores: await readHighScores() }, skipBody);
    return;
  }

  if (request.method !== "POST") {
    sendApiJson(response, 405, { error: "Method Not Allowed" }, skipBody);
    return;
  }

  let payload;
  try {
    payload = JSON.parse((await readRequestBody(request)) || "{}");
  } catch (error) {
    sendApiJson(response, 400, { error: "Invalid JSON body." });
    return;
  }

  const savedEntry = normalizeScoreEntry(payload);
  const scores = [...(await readHighScores()), savedEntry].sort(compareEntries).slice(0, MAX_SCORES);
  await writeHighScores(scores);
  sendApiJson(response, 200, { ok: true, savedEntry, scores });
}

function buildFeaturedLeaderboardEntry(scores) {
  if (scores.some((entry) => normalizeName(entry.name) === FEATURED_NAME)) {
    return null;
  }

  const topDistance = scores[0]?.distance ?? 0;
  const secondDistance = scores[1]?.distance ?? 0;
  let distance = 1480;

  if (topDistance > 0 && secondDistance > 0) {
    const gap = Math.max(4, Math.round(Math.max(topDistance - secondDistance, 10) * 0.55));
    distance = Math.max(secondDistance, topDistance - gap);
  } else if (topDistance > 0) {
    distance = Math.max(24, topDistance - Math.max(12, Math.round(topDistance * 0.04)));
  }

  return {
    id: "featured-nick-jongens",
    name: FEATURED_NAME,
    distance,
    createdAt: new Date(0).toISOString(),
    badge: "",
    isPinned: false,
  };
}

async function handleLeaderboards(request, response, url) {
  const skipBody = request.method === "HEAD";
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendApiJson(response, 405, { error: "Method Not Allowed" }, skipBody);
    return;
  }

  const limit = clampLimit(url.searchParams.get("limit"), 10, 50);
  const scores = (await readHighScores()).sort(compareEntries);
  sendApiJson(
    response,
    200,
    {
      featured: buildFeaturedLeaderboardEntry(scores),
      scores: scores.slice(0, limit),
      total: scores.length,
    },
    skipBody
  );
}

async function handleTelemetrySession(request, response) {
  if (request.method !== "POST") {
    sendApiJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse((await readRequestBody(request)) || "{}");
  } catch (error) {
    sendApiJson(response, 400, { error: "Invalid JSON body." });
    return;
  }

  if (!payload?.consent) {
    sendApiJson(response, 200, { ok: true, tracked: false });
    return;
  }

  const trackedResult = upsertTrackedVisitor(request, payload);
  if (!trackedResult) {
    sendApiJson(response, 400, { error: "A valid sessionId is required." });
    return;
  }

  if (trackedResult.isNew) {
    await updateStatsStore((store) => {
      store.totals.trackedSessions += 1;
      return store;
    });
  }

  sendApiJson(response, 200, {
    ok: true,
    tracked: true,
    sessionId: trackedResult.visitor.sessionId,
    isNew: trackedResult.isNew,
  });
}

async function handleTelemetryRun(request, response) {
  if (request.method !== "POST") {
    sendApiJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse((await readRequestBody(request)) || "{}");
  } catch (error) {
    sendApiJson(response, 400, { error: "Invalid JSON body." });
    return;
  }

  if (!payload?.consent) {
    sendApiJson(response, 200, { ok: true, tracked: false });
    return;
  }

  const trackedResult = upsertTrackedVisitor(request, payload);
  if (!trackedResult) {
    sendApiJson(response, 400, { error: "A valid sessionId is required." });
    return;
  }

  trackedResult.visitor.playRuns += 1;
  pushRecentEvent(recentRuns, {
    sessionId: trackedResult.visitor.sessionId,
    name: normalizeName(payload.name),
    mode: normalizeEventMode(payload.mode),
    trackSeed: Number(payload.trackSeed) || 0,
    startedAt: new Date().toISOString(),
    ipAddress: trackedResult.visitor.ipAddress,
    userAgent: trackedResult.visitor.userAgent,
  });

  await updateStatsStore((store) => {
    if (trackedResult.isNew) {
      store.totals.trackedSessions += 1;
    }
    store.totals.playRuns += 1;
    return store;
  });

  sendApiJson(response, 200, { ok: true, tracked: true });
}

async function handleTelemetryScore(request, response) {
  if (request.method !== "POST") {
    sendApiJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse((await readRequestBody(request)) || "{}");
  } catch (error) {
    sendApiJson(response, 400, { error: "Invalid JSON body." });
    return;
  }

  if (!payload?.consent) {
    sendApiJson(response, 200, { ok: true, tracked: false });
    return;
  }

  const trackedResult = upsertTrackedVisitor(request, payload);
  if (!trackedResult) {
    sendApiJson(response, 400, { error: "A valid sessionId is required." });
    return;
  }

  trackedResult.visitor.scoreEvents += 1;
  pushRecentEvent(recentScores, {
    sessionId: trackedResult.visitor.sessionId,
    mode: normalizeEventMode(payload.mode),
    distance: Math.max(0, Math.round(Number(payload.distance) || 0)),
    weather: String(payload.weather || "Clear").slice(0, 24),
    aiEnabled: Boolean(payload.aiEnabled),
    createdAt: new Date().toISOString(),
  });

  await updateStatsStore((store) => {
    if (trackedResult.isNew) {
      store.totals.trackedSessions += 1;
    }
    store.totals.scoreEvents += 1;
    return store;
  });

  sendApiJson(response, 200, { ok: true, tracked: true });
}

async function handleStatsSummary(request, response, url) {
  const skipBody = request.method === "HEAD";
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendApiJson(response, 405, { error: "Method Not Allowed" }, skipBody);
    return;
  }

  if (!isStatsAuthorized(request, url)) {
    sendApiJson(response, 401, { error: "Stats API key required." }, skipBody);
    return;
  }

  const scores = await readHighScores();
  const stats = await readStatsStore();
  const limit = clampLimit(url.searchParams.get("limit"), 12, 100);
  const uniqueIps = new Set([...trackedVisitors.values()].map((visitor) => visitor.ipAddress).filter(Boolean)).size;

  sendApiJson(
    response,
    200,
    {
      publicByDefault: !STATS_API_KEY,
      requiresApiKey: Boolean(STATS_API_KEY),
      generatedAt: new Date().toISOString(),
      totals: {
        trackedSessions: stats.totals.trackedSessions,
        playRuns: stats.totals.playRuns,
        scoreEvents: stats.totals.scoreEvents,
        leaderboardEntries: scores.length,
        visitorsInMemory: trackedVisitors.size,
        uniqueIpsInMemory: uniqueIps,
      },
      recentRuns: recentRuns.slice(0, limit),
      recentScores: recentScores.slice(0, Math.min(limit, 20)),
    },
    skipBody
  );
}

async function handleStatsVisitors(request, response, url) {
  const skipBody = request.method === "HEAD";
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendApiJson(response, 405, { error: "Method Not Allowed" }, skipBody);
    return;
  }

  if (!isStatsAuthorized(request, url)) {
    sendApiJson(response, 401, { error: "Stats API key required." }, skipBody);
    return;
  }

  const limit = clampLimit(url.searchParams.get("limit"), 50, 250);
  const visitors = [...trackedVisitors.values()]
    .sort((visitorA, visitorB) => new Date(visitorB.lastSeenAt).getTime() - new Date(visitorA.lastSeenAt).getTime())
    .slice(0, limit);

  sendApiJson(
    response,
    200,
    {
      publicByDefault: !STATS_API_KEY,
      requiresApiKey: Boolean(STATS_API_KEY),
      count: visitors.length,
      visitors,
    },
    skipBody
  );
}

function resolveFilePath(pathname) {
  const trimmed = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalized = path.normalize(trimmed);

  if (
    normalized.startsWith("..") ||
    normalized === "" ||
    normalized === "server-error.log" ||
    normalized === "data" ||
    normalized.startsWith(`data${path.sep}`)
  ) {
    return null;
  }

  return path.join(ROOT, normalized);
}

async function serveStatic(request, response, pathname) {
  const skipBody = request.method === "HEAD";
  const filePath = resolveFilePath(pathname);
  if (!filePath) {
    sendText(response, 400, "Bad Request", skipBody);
    return;
  }

  let resolvedPath = filePath;
  try {
    const stats = await fs.stat(resolvedPath);
    if (stats.isDirectory()) {
      resolvedPath = path.join(resolvedPath, "index.html");
    }
  } catch (error) {
    sendText(response, 404, "Not Found", skipBody);
    return;
  }

  try {
    const bytes = await fs.readFile(resolvedPath);
    send(
      response,
      200,
      CONTENT_TYPES.get(path.extname(resolvedPath).toLowerCase()) || "application/octet-stream",
      bytes,
      skipBody
    );
  } catch (error) {
    sendText(response, 404, "Not Found", skipBody);
  }
}

function createLobbyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (lobbies.has(code));

  return code;
}

function buildPlayerSnapshot(client) {
  return {
    id: client.id,
    name: client.name,
    ready: client.ready,
    finished: Boolean(client.raceState?.finished),
    finishTime: client.raceState?.finishTime ?? null,
    progress: client.raceState?.s ?? 0,
  };
}

function buildLobbyState(lobby) {
  const players = [...lobby.players.values()].map(buildPlayerSnapshot);

  return {
    type: "lobby_state",
    lobbyCode: lobby.code,
    ownerId: lobby.ownerId,
    raceStatus: lobby.race.status,
    players,
    canStart: players.length >= 2,
  };
}

function buildRaceState(lobby) {
  const players = [...lobby.players.values()]
    .map((client) => ({
      id: client.id,
      name: client.name,
      s: client.raceState?.s ?? 0,
      laneOffset: client.raceState?.laneOffset ?? 0,
      speed: client.raceState?.speed ?? 0,
      finished: Boolean(client.raceState?.finished),
      finishTime: client.raceState?.finishTime ?? null,
    }))
    .sort((playerA, playerB) => {
      if (playerA.finished !== playerB.finished) {
        return Number(playerB.finished) - Number(playerA.finished);
      }

      if (playerA.finished && playerB.finished) {
        return (playerA.finishTime ?? Number.MAX_SAFE_INTEGER) - (playerB.finishTime ?? Number.MAX_SAFE_INTEGER);
      }

      return playerB.s - playerA.s;
    })
    .map((player, index) => ({ ...player, place: index + 1 }));

  return {
    type: "race_state",
    lobbyCode: lobby.code,
    targetDistance: lobby.race.targetDistance,
    startAt: lobby.race.startAt,
    players,
  };
}

function sendWsMessage(socket, payload) {
  if (socket.destroyed || !socket.writable) {
    return;
  }

  const json = Buffer.from(JSON.stringify(payload), "utf8");
  let header;

  if (json.length < 126) {
    header = Buffer.from([0x81, json.length]);
  } else if (json.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(json.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(json.length), 2);
  }

  socket.write(Buffer.concat([header, json]));
}

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const isMasked = (secondByte & 0x80) === 0x80;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    const maskLength = isMasked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;
    if (offset + frameLength > buffer.length) {
      break;
    }

    if (opcode === 0x8) {
      messages.push({ close: true });
      offset += frameLength;
      continue;
    }

    let payload = buffer.slice(offset + headerLength + maskLength, offset + frameLength);
    if (isMasked) {
      const mask = buffer.slice(offset + headerLength, offset + headerLength + 4);
      const decoded = Buffer.alloc(payload.length);
      for (let index = 0; index < payload.length; index += 1) {
        decoded[index] = payload[index] ^ mask[index % 4];
      }
      payload = decoded;
    }

    if (opcode === 0x1) {
      messages.push({ text: payload.toString("utf8") });
    }

    offset += frameLength;
  }

  return {
    messages,
    rest: buffer.slice(offset),
  };
}

function broadcastLobbyState(lobby) {
  const payload = buildLobbyState(lobby);
  for (const client of lobby.players.values()) {
    sendWsMessage(client.socket, payload);
  }
}

function broadcastRaceState(lobby) {
  const payload = buildRaceState(lobby);
  for (const client of lobby.players.values()) {
    sendWsMessage(client.socket, payload);
  }
}

function finishRaceIfComplete(lobby) {
  const players = [...lobby.players.values()];
  if (!players.length || !players.every((client) => client.raceState?.finished)) {
    return;
  }

  lobby.race.status = "finished";
  const results = buildRaceState(lobby).players.map(({ id, name, finishTime, place }) => ({
    id,
    name,
    finishTime,
    place,
  }));
  for (const client of lobby.players.values()) {
    client.ready = false;
  }

  const payload = {
    type: "race_finished",
    lobbyCode: lobby.code,
    results,
  };

  for (const client of lobby.players.values()) {
    sendWsMessage(client.socket, payload);
  }

  broadcastLobbyState(lobby);
}

function removeClientFromLobby(client) {
  if (!client.lobbyCode) {
    return;
  }

  const lobby = lobbies.get(client.lobbyCode);
  if (!lobby) {
    client.lobbyCode = null;
    return;
  }

  lobby.players.delete(client.id);
  client.lobbyCode = null;
  client.ready = false;
  client.raceState = null;

  if (!lobby.players.size) {
    lobbies.delete(lobby.code);
    return;
  }

  if (!lobby.players.has(lobby.ownerId)) {
    lobby.ownerId = lobby.players.keys().next().value;
  }

  if (lobby.race.status === "running" && lobby.players.size < 2) {
    lobby.race.status = "lobby";
  }

  broadcastLobbyState(lobby);
  if (lobby.race.status === "running") {
    broadcastRaceState(lobby);
  }
}

function ensureLobby(client) {
  if (!client.lobbyCode) {
    return null;
  }

  return lobbies.get(client.lobbyCode) || null;
}

function handleWsPayload(client, payload) {
  switch (payload.type) {
    case "create_lobby": {
      removeClientFromLobby(client);
      const code = createLobbyCode();
      const lobby = {
        code,
        ownerId: client.id,
        players: new Map(),
        race: {
          status: "lobby",
          startAt: null,
          targetDistance: MULTIPLAYER_TARGET_DISTANCE,
          trackSeed: null,
        },
      };
      client.name = normalizeName(payload.name);
      client.ready = false;
      client.raceState = null;
      client.lobbyCode = code;
      lobby.players.set(client.id, client);
      lobbies.set(code, lobby);
      broadcastLobbyState(lobby);
      break;
    }

    case "join_lobby": {
      removeClientFromLobby(client);
      const lobbyCode = String(payload.lobbyCode || "").trim().toUpperCase();
      const lobby = lobbies.get(lobbyCode);
      if (!lobby) {
        sendWsMessage(client.socket, { type: "error", message: "Lobby not found." });
        break;
      }

      if (lobby.race.status === "running") {
        sendWsMessage(client.socket, { type: "error", message: "Race already in progress." });
        break;
      }

      client.name = normalizeName(payload.name);
      client.ready = false;
      client.raceState = null;
      client.lobbyCode = lobby.code;
      lobby.players.set(client.id, client);
      broadcastLobbyState(lobby);
      break;
    }

    case "leave_lobby":
      removeClientFromLobby(client);
      break;

    case "toggle_ready": {
      const lobby = ensureLobby(client);
      if (!lobby || lobby.race.status !== "lobby") {
        break;
      }

      client.ready = !client.ready;
      broadcastLobbyState(lobby);
      break;
    }

    case "start_race": {
      const lobby = ensureLobby(client);
      if (!lobby) {
        break;
      }

      if (lobby.ownerId !== client.id) {
        sendWsMessage(client.socket, { type: "error", message: "Only the lobby host can start the race." });
        break;
      }

      const players = [...lobby.players.values()];
      if (players.length < 2) {
        sendWsMessage(client.socket, { type: "error", message: "At least two drivers are required." });
        break;
      }

      lobby.race = {
        status: "running",
        startAt: Date.now() + MULTIPLAYER_COUNTDOWN_MS,
        targetDistance: MULTIPLAYER_TARGET_DISTANCE,
        trackSeed: Math.floor(Math.random() * 0xffffffff),
      };

      for (const player of players) {
        player.ready = false;
        player.raceState = {
          s: 0,
          laneOffset: 0,
          speed: 0,
          finished: false,
          finishTime: null,
        };
      }

      const payloadToSend = {
        type: "race_started",
        lobbyCode: lobby.code,
        startAt: lobby.race.startAt,
        targetDistance: lobby.race.targetDistance,
        trackSeed: lobby.race.trackSeed,
      };

      for (const player of players) {
        sendWsMessage(player.socket, payloadToSend);
      }

      broadcastLobbyState(lobby);
      break;
    }

    case "player_state": {
      const lobby = ensureLobby(client);
      if (!lobby || lobby.race.status !== "running" || !payload.state) {
        break;
      }

      const nextState = payload.state;
      const finished = Boolean(nextState.finished);
      const existingFinishTime = client.raceState?.finishTime ?? null;
      client.raceState = {
        s: Math.max(0, Number(nextState.s) || 0),
        laneOffset: Math.max(-20, Math.min(20, Number(nextState.laneOffset) || 0)),
        speed: Math.max(0, Number(nextState.speed) || 0),
        finished,
        finishTime: finished ? existingFinishTime || Number(nextState.finishTime) || Date.now() : null,
      };

      broadcastRaceState(lobby);
      finishRaceIfComplete(lobby);
      break;
    }

    default:
      break;
  }
}

function acceptWebSocket(request, socket) {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "",
      "",
    ].join("\r\n")
  );

  const client = {
    id: crypto.randomUUID(),
    socket,
    buffer: Buffer.alloc(0),
    name: "Guest",
    ready: false,
    lobbyCode: null,
    raceState: null,
  };
  webSocketClients.set(socket, client);
  sendWsMessage(socket, { type: "welcome", clientId: client.id });

  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    const { messages, rest } = decodeFrames(client.buffer);
    client.buffer = rest;

    for (const message of messages) {
      if (message.close) {
        socket.end();
        return;
      }

      if (!message.text) {
        continue;
      }

      try {
        handleWsPayload(client, JSON.parse(message.text));
      } catch (error) {
        sendWsMessage(socket, { type: "error", message: "Invalid multiplayer payload." });
      }
    }
  });

  socket.on("close", () => {
    removeClientFromLobby(client);
    webSocketClients.delete(socket);
  });

  socket.on("end", () => {
    removeClientFromLobby(client);
    webSocketClients.delete(socket);
  });

  socket.on("error", () => {
    removeClientFromLobby(client);
    webSocketClients.delete(socket);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `localhost:${PORT}`}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith("/api/") && request.method === "OPTIONS") {
      response.writeHead(204, API_HEADERS);
      response.end();
      return;
    }

    if (pathname === "/api/highscores") {
      await handleHighScores(request, response);
      return;
    }

    if (pathname === "/api/leaderboards") {
      await handleLeaderboards(request, response, url);
      return;
    }

    if (pathname === "/api/telemetry/session") {
      await handleTelemetrySession(request, response);
      return;
    }

    if (pathname === "/api/telemetry/run") {
      await handleTelemetryRun(request, response);
      return;
    }

    if (pathname === "/api/telemetry/score") {
      await handleTelemetryScore(request, response);
      return;
    }

    if (pathname === "/api/stats") {
      await handleStatsSummary(request, response, url);
      return;
    }

    if (pathname === "/api/stats/visitors") {
      await handleStatsVisitors(request, response, url);
      return;
    }

    await serveStatic(request, response, pathname);
  } catch (error) {
    if (pathname.startsWith("/api/")) {
      sendApiJson(response, 500, { error: error.message || "Internal Server Error" });
      return;
    }

    sendJson(response, 500, { error: error.message || "Internal Server Error" });
  }
});

server.on("upgrade", (request, socket) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `localhost:${PORT}`}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  acceptWebSocket(request, socket);
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}/`);
});
