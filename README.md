# Drivvy

Procedural Three.js browser racing game with a Docker-first Node server, local file-backed high scores, multiplayer lobbies, and consent-gated telemetry.

![Drivvy screenshot](https://github.com/NickJongens/Drivvy/blob/main/Screenshot.jpg?raw=1)

## Run With Docker

Published image:

```bash
docker pull ghcr.io/nickjongens/drivvy:latest
```

GHCR package: [github.com/NickJongens/Drivvy/pkgs/container/drivvy](https://github.com/NickJongens/Drivvy/pkgs/container/drivvy)

Build the image:

```bash
docker build -t drivvy .
```

Run it on port `8080` with persistent local data:

```bash
docker run --rm -p 8080:8080 -v drivvy-data:/app/data ghcr.io/nickjongens/drivvy:latest
```

Open `http://localhost:8080`.

## Optional Stats API Key

Stats routes are public by default. To require a key for stats access, set `DRIVVY_STATS_API_KEY` when starting the container:

```bash
docker run --rm -p 8080:8080 -e DRIVVY_STATS_API_KEY=replace-me -v drivvy-data:/app/data ghcr.io/nickjongens/drivvy:latest
```

When that env var is present, send either:

- `X-API-Key: replace-me`
- `Authorization: Bearer replace-me`
- `?apiKey=replace-me`

This protection applies to the stats endpoints, not the in-game high-score flow.

## Data Storage

Persistent files are written under `/app/data`:

- `data/highscores.json`
- `data/stats.json`

In-memory visitor details such as IP address and browser user-agent are not persisted and are only recorded when a player has accepted tracking.

## Privacy And Tracking

The landing page shows a privacy prompt. If a player accepts:

- a consent cookie is stored
- a session cookie is stored
- play runs can be counted
- in-memory visitor details such as IP address and browser user-agent can be recorded for telemetry

If a player declines, Drivvy does not record those telemetry details for that browser.

## API

Public gameplay endpoints:

- `GET /api/highscores`
- `POST /api/highscores`
- `GET /api/leaderboards?limit=10`

Consent-gated telemetry write endpoints used by the browser client:

- `POST /api/telemetry/session`
- `POST /api/telemetry/run`
- `POST /api/telemetry/score`

Stats endpoints for automation and reporting:

- `GET /api/stats`
- `GET /api/stats/visitors`

Example:

```bash
curl http://localhost:8080/api/leaderboards
curl -H "X-API-Key: replace-me" http://localhost:8080/api/stats
```

## Multiplayer

Multiplayer uses the built-in WebSocket endpoint at `/ws`.

- Open the menu and switch to `Multiplayer`
- Create or join a 6-character lobby
- The host starts once every driver is ready

## Controls

- Mouse: steer
- Left click or `W` / Up Arrow: accelerate
- Right click or `S` / Down Arrow: brake
- `A` / `D` or Left / Right Arrow: steer
- `Shift` or `Space`: NOS
- `C`: cockpit view
- Hold `V`: look behind

## Hosting Notes

Drivvy is ready to sit behind a reverse proxy or Cloudflare Tunnel. Expose the container on an internal port and publish only the proxy/tunnel endpoint externally.
