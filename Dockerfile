# ─── Stage 1: Build React client ─────────────────────────────────────────────
# Build context is THIS directory (self-contained). The client + its workspace
# deps (shared-types, shared-utils) and the root package files were copied in.
FROM node:22-alpine AS node-builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY shared-types/ ./shared-types/
COPY shared-utils/ ./shared-utils/
COPY client/ ./client/
RUN npm install --ignore-scripts
ARG VITE_AUDIO_SERVER_URL
ENV VITE_AUDIO_SERVER_URL=$VITE_AUDIO_SERVER_URL
ARG VITE_APP_ENV
ENV VITE_APP_ENV=$VITE_APP_ENV
ARG VITE_INSTANCE_NAME
ENV VITE_INSTANCE_NAME=$VITE_INSTANCE_NAME
RUN npm run build:client


# ─── Stage 2: Build Go binary ────────────────────────────────────────────────
FROM golang:1.25-alpine AS go-builder
WORKDIR /app
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
# Copy only the Go source (keeps the client out of the Go build layer)
COPY main.go routes.go ./
COPY config/ ./config/
COPY db/ ./db/
COPY engine/ ./engine/
COPY handlers/ ./handlers/
COPY logger/ ./logger/
COPY middleware/ ./middleware/
COPY models/ ./models/
COPY services/ ./services/
COPY static/ ./static/
COPY tts/ ./tts/
COPY ttsconfig/ ./ttsconfig/
COPY websocket/ ./websocket/
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags "-s -w" -o starsim .


# ─── Stage 3: Production ──────────────────────────────────────────────────────
# Debian (glibc) base — required for the Piper native binary (musl cannot run it).
FROM debian:bookworm-slim AS production
WORKDIR /app

# Piper dynamically links libespeak-ng1.
RUN apt-get update && apt-get install -y wget ca-certificates libespeak-ng1 --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/assets/piper/voices \
    && wget -qO /tmp/piper.tar.gz \
        "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" \
    && tar -xzf /tmp/piper.tar.gz -C /tmp \
    && cp -r /tmp/piper/. /app/assets/piper/ \
    && find /app/assets/piper -maxdepth 1 -name "*.so*" -exec cp {} /usr/local/lib/ \; \
    && ldconfig \
    && chmod +x /app/assets/piper/piper \
    && rm -rf /tmp/piper.tar.gz /tmp/piper

COPY --from=node-builder /app/client/dist ./client/dist
COPY --from=go-builder   /app/starsim ./starsim
# Bundled assets (Piper voices can also be supplied via a docker-compose volume)
COPY assets/ ./assets/

ENV PORT=3000 \
    PIPER_BIN=/app/assets/piper/piper \
    PIPER_VOICES_DIR=/app/assets/piper/voices \
    CLIENT_DIST_PATH=/app/client/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["./starsim"]
