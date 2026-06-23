# Starsim — Go Backend

A complete Go rewrite of the Starsim / Nebo AI Room Simulation Platform backend
(originally Node.js/Express/TypeScript). The React/Vite frontend in `../client`
is **unchanged** — this server is a drop-in replacement that preserves every
HTTP route, Socket.IO event, MongoDB collection/field name, and the structured
JSON log shape.

## Tech stack

- **HTTP**: Gin
- **WebSocket**: `zishang520/socket.io/v2` — speaks the Socket.IO v4 protocol the
  unchanged `socket.io-client@4` frontend uses. (The spec suggested
  `googollee/go-socket.io`, but that library only speaks older protocol versions;
  `zishang520` was chosen because frontend compatibility is the binding constraint.)
- **MongoDB**: official `mongo-driver`
- **Scheduler**: `robfig/cron/v3`
- **Logging**: `zerolog` (JSON: `level`, `timestamp`, `message` + flattened meta)
- **S3/MinIO**: AWS SDK Go v2 (path-style)
- **TTS**: Piper native binary via `os/exec`; XTTS via HTTP proxy

## Layout

```
config/     env loading            db/         mongo singleton
logger/     zerolog wrapper        models/     BSON structs (exact field names)
engine/     conversation loop, state, prompts, LLM client, TTS-ack coordination
services/   alerts, nebo, openmrs, minio, triggers, day orchestrator, scheduler,
            schedule bridge, room/resident/character/note seeds + CRUD, seed_data
ttsconfig/  per-room TTS provider store          websocket/  Socket.IO hub + handlers
handlers/   Gin HTTP handlers                    middleware/ cors, logger, rate limit, recovery
tts/        Piper synthesis + XTTS proxy         static/     React client serving + SPA fallback
main.go     bootstrap + graceful shutdown        routes.go   route registration
```

## Build & run

```bash
go build ./...        # zero errors
go vet ./...          # zero warnings
go test ./...         # unit tests for the trickiest ports

# run (needs a reachable MongoDB)
MONGO_URI="mongodb://localhost:27017/starsim" PORT=3000 go run .
```

## Environment variables

Same `.env` format as the Node app. Recognized keys: `MONGO_URI`,
`DEEPINFRA_API_KEY`, `OPEN_AI_BASE_URL`, `PUBLIC_BASE_URL`, `XTTS_BASE_URL`,
`PORT`, `INSTANCE_NAME`, `TTS_MODE`, `RUN_SCHEDULER`, `SILENT_MODE_TURN_DELAY_MS`,
`GOOGLE_CHAT_WEBHOOK_URL`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
`S3_BUCKET_NAME`, `NEBO_API_KEY`, `OPENMRS_USERNAME`, `OPENMRS_PASSWORD`, `APP_ENV`,
`DISABLE_RATE_LIMIT`, `VOICES_DIR`, `PIPER_BIN`, `PIPER_VOICES_DIR`, `TZ_CRON`,
`FACILITY_NAME`, `START_ALL`, `LOG_LEVEL`, `CLIENT_DIST_PATH`.

`TTS_MODE=disabled` runs silent mode (turns advance without waiting for TTS).

## Docker

The Dockerfile is multi-stage (Node build of `client/` → Go build → Debian slim
with the Piper binary). Build from the **repo root** so the client sources are in
context:

```bash
docker build -f starsim-go/Dockerfile -t starsim-go .
```

It drops into the existing `docker-compose.yml` in place of the Node image.

## Notes on fidelity

- Roles are `clinician` / `patient`; the conversation starts with the clinician
  and alternates strictly (even turns clinician, odd patient), unbounded until a
  stop signal or `[END_SIMULATION]` token.
- LLM: DeepInfra OpenAI-compatible chat completions, model
  `meta-llama/Llama-4-Maverick-17B-128E-Instruct-Turbo`, `max_tokens=150`,
  `temperature=0.8`, last-20-message history window, connection-error retry with
  linear 2s/4s/6s backoff.
- Seed data (6 rooms, 12 characters, 6 residents) is ported verbatim and only
  inserted when a collection/document is missing — safe against the existing DB.
