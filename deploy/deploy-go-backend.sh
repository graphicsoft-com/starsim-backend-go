#!/usr/bin/env bash
# =============================================================================
# demo.starsim.com — swap the Node backend for the Go backend (Docker override)
# Run ON q-055-l-silver, as user q-055, from anywhere:
#     export GH_TOKEN=...        # GitHub PAT (rotate it afterwards)
#     bash deploy-go-backend.sh
# Strategy: docker-compose.override.yml repoints ONE service to build from
# starsim-go/Dockerfile, giving it a NEW image tag. The original Node image is
# never overwritten, so rollback = delete override + `up -d`.
# =============================================================================
set -euo pipefail

GH_USER="${GH_USER:-moha-osama}"
GH_TOKEN="${GH_TOKEN:?export GH_TOKEN before running (then rotate the token)}"
REPO_HTTPS="github.com/graphicsoft-com/starsim-backend-go.git"
MONO="$HOME/demo.starsim.com/RHA-simulation"
GO_TAG="starsim-go:new"
OVERRIDE="$MONO/docker-compose.override.yml"

c(){ printf '\n\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die(){ printf '\n\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$MONO" ] || die "monorepo not found at $MONO"
command -v docker >/dev/null || die "docker not found"
docker compose version >/dev/null 2>&1 || die "'docker compose' (v2) not available"
cd "$MONO"

# --- 1. clone/update the Go backend INTO the monorepo as starsim-go/ ----------
c "fetching Go backend into $MONO/starsim-go"
if [ -d starsim-go/.git ]; then
  git -C starsim-go remote set-url origin "https://${GH_USER}:${GH_TOKEN}@${REPO_HTTPS}"
  git -C starsim-go fetch --all -p -q
  git -C starsim-go reset --hard '@{upstream}' -q 2>/dev/null || git -C starsim-go pull -q
else
  git clone -q "https://${GH_USER}:${GH_TOKEN}@${REPO_HTTPS}" starsim-go
fi
git -C starsim-go remote set-url origin "https://${REPO_HTTPS}"   # scrub token from .git/config

# --- 2. verify the layout the Dockerfile expects -----------------------------
for f in starsim-go/Dockerfile starsim-go/go.mod client/package.json shared-types shared-utils; do
  [ -e "$f" ] || die "expected path missing: $f (Dockerfile build will fail)"
done
c "layout OK"

# --- 3. pick the backend service --------------------------------------------
c "services in docker-compose.yml:"
mapfile -t SERVICES < <(docker compose config --services 2>/dev/null | sort)
[ "${#SERVICES[@]}" -gt 0 ] || die "could not read services from docker-compose.yml"
printf '   - %s\n' "${SERVICES[@]}"

# heuristic default: a service named like the backend
DEFAULT_SVC=""
for s in "${SERVICES[@]}"; do
  case "$s" in backend|server|app|api|node|web|starsim*|nebo*) DEFAULT_SVC="$s"; break;; esac
done
echo
read -r -p "Which service is the Node backend to replace? [${DEFAULT_SVC}] " SVC
SVC="${SVC:-$DEFAULT_SVC}"
[ -n "$SVC" ] || die "no service chosen"
printf '%s\n' "${SERVICES[@]}" | grep -qx "$SVC" || die "'$SVC' is not a service in this compose project"
c "target service: $SVC"

# show what that service currently looks like (ports/env/volumes are INHERITED)
c "current definition of '$SVC' (these settings are kept):"
docker compose config 2>/dev/null | awk -v s="  $SVC:" '
  $0==s{p=1} p&&/^  [a-zA-Z0-9_-]+:$/&&$0!=s{p=0} p' | sed 's/^/   /' | head -60

# --- 4. write the override ----------------------------------------------------
# Optional client build-time vars — set before running if your prod needs them.
VITE_AUDIO_SERVER_URL="${VITE_AUDIO_SERVER_URL:-}"
VITE_APP_ENV="${VITE_APP_ENV:-live}"
VITE_INSTANCE_NAME="${VITE_INSTANCE_NAME:-demo}"

if [ -f "$OVERRIDE" ]; then
  cp -a "$OVERRIDE" "$OVERRIDE.bak.$(date +%s 2>/dev/null || echo prev)"
  c "backed up existing override -> $OVERRIDE.bak.*"
fi

c "writing $OVERRIDE"
cat > "$OVERRIDE" <<YAML
# Auto-generated: routes '$SVC' to the Go backend (starsim-backend-go).
# Inherits ports/env/volumes/depends_on from docker-compose.yml.
# Rollback:  rm $OVERRIDE && docker compose up -d $SVC
services:
  $SVC:
    image: $GO_TAG
    build:
      context: .
      dockerfile: starsim-go/Dockerfile
      args:
        VITE_AUDIO_SERVER_URL: "${VITE_AUDIO_SERVER_URL}"
        VITE_APP_ENV: "${VITE_APP_ENV}"
        VITE_INSTANCE_NAME: "${VITE_INSTANCE_NAME}"
YAML

# --- 5. build (no disruption until 'up') -------------------------------------
c "building Go image for '$SVC' (old Node image stays intact)"
docker compose build "$SVC"

# --- 6. cutover --------------------------------------------------------------
c "starting Go backend (recreating only '$SVC')"
docker compose up -d "$SVC"

# --- 7. verify ---------------------------------------------------------------
c "waiting for container health"
CID="$(docker compose ps -q "$SVC")"
[ -n "$CID" ] || die "no container id for $SVC after up"
ok=0
for i in $(seq 1 30); do
  st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CID" 2>/dev/null || true)"
  case "$st" in healthy|running) ok=1; break;; exited|dead) break;; esac
  sleep 2
done
echo "   container state: ${st:-unknown}"

# in-container health probe (independent of host port mapping)
if docker exec "$CID" sh -c 'wget -qO- http://localhost:3000/health || curl -sf http://localhost:3000/health' >/dev/null 2>&1; then
  c "OK — /health responding inside the container"
else
  echo "   (could not confirm /health from inside container; check logs)"
fi

echo
docker compose ps "$SVC"
echo
c "recent logs:"; docker compose logs --tail=25 "$SVC"

cat <<DONE

============================================================
 Cutover applied. Verify https://demo.starsim.com loads.
 ROLLBACK (instant, back to Node):
     rm "$OVERRIDE" && docker compose up -d "$SVC"
 Then ROTATE the GitHub token you used.
============================================================
DONE
