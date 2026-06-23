#!/usr/bin/env bash
# Install the Piper binary + the 12 voice models the app maps to characters.
# Idempotent: skips files that already exist. Run from anywhere.
#   bash assets/piper/install-piper.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"          # .../assets/piper
VOICES="$HERE/voices"
mkdir -p "$VOICES"

# --- 1. native binary (bundled libs; rpath $ORIGIN, no system espeak needed) --
if [ ! -x "$HERE/piper" ]; then
  echo "[piper] downloading binary"
  curl -sL --max-time 180 \
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" \
    -o /tmp/piper.tgz
  tmp="$(mktemp -d)"; tar -xzf /tmp/piper.tgz -C "$tmp"
  cp -r "$tmp"/piper/. "$HERE"/; chmod +x "$HERE/piper"; rm -rf "$tmp" /tmp/piper.tgz
fi

# --- 2. voice models (must match tts/piper.go CharacterVoiceMap) --------------
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US"
IDS="en_US-lessac-high en_US-hfc_female-medium en_US-amy-medium en_US-kristin-medium \
en_US-ljspeech-high en_US-lessac-medium en_US-ryan-high en_US-joe-medium \
en_US-norman-medium en_US-bryce-medium en_US-hfc_male-medium en_US-ryan-medium"
for id in $IDS; do
  rest=${id#en_US-}; quality=${rest##*-}; name=${rest%-*}
  for ext in onnx onnx.json; do
    [ -f "$VOICES/$id.$ext" ] && continue
    echo "[piper] fetching $id.$ext"
    curl -sfL --retry 3 --max-time 300 "$BASE/$name/$quality/$id.$ext" -o "$VOICES/$id.$ext"
  done
done
echo "[piper] done: $(ls "$VOICES"/*.onnx | wc -l) voices in $VOICES"
