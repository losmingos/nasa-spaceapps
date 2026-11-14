#!/bin/sh
# Forward the Vite dev server (port 5173) to a Meta Quest over USB.
# Usage: sh scripts/quest-usb.sh   (run `npm run dev` separately)
set -u
PORT="${PORT:-5173}"

if ! command -v adb >/dev/null 2>&1; then
  echo "ERROR: adb not found on PATH. Install: winget install --id Google.PlatformTools -e" >&2
  echo "       (then open a new terminal)" >&2
  exit 1
fi

adb start-server >/dev/null 2>&1
devices=$(adb devices | tr -d '\r' | sed '1d' | grep -v '^[[:space:]]*$')
echo "adb devices:"
echo "${devices:-  (none)}"

if [ -z "$devices" ]; then
  echo "WARN: no device. Plug in the Quest via USB, enable Developer Mode (Meta Horizon app)," >&2
  echo "      put the headset on and accept 'Allow USB debugging'." >&2
  exit 1
fi
if echo "$devices" | grep -q 'unauthorized'; then
  echo "WARN: device unauthorized. Put the headset on and accept 'Allow USB debugging'" >&2
  echo "      (tick 'Always allow from this computer'), then re-run." >&2
  exit 1
fi
if ! echo "$devices" | grep -q '[[:space:]]device$'; then
  echo "WARN: no device in 'device' state (offline?). Replug the cable and re-run." >&2
  exit 1
fi

adb reverse "tcp:$PORT" "tcp:$PORT" || { echo "ERROR: adb reverse failed" >&2; exit 1; }
adb reverse --list
echo "Open http://localhost:$PORT/vr-test in Quest Browser"
