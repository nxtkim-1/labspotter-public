#!/bin/bash
# LabSpotter on your iPhone, same Wi-Fi as this Mac.
# What this does: checks what's needed, then starts the backend so your phone can reach it.
# NOT YET RUN ON A REAL MAC OR PHONE - tested for its checks and messages only.
cd "$(dirname "$0")" || { echo "Cannot find the package folder."; exit 1; }
fail=0
command -v python3 >/dev/null || { echo "MISSING: python3 - install from python.org, then run this again."; fail=1; }
command -v ffmpeg  >/dev/null || { echo "MISSING: ffmpeg - install with: brew install ffmpeg"; fail=1; }
if command -v python3 >/dev/null; then
python3 - <<'PYEOF'
import importlib.util, sys
missing = [m for m in ("torch", "transformers", "PIL", "numpy", "sklearn") if not importlib.util.find_spec(m)]
if missing:
    print("MISSING python packages: " + ", ".join(missing))
    print("Install them with: pip3 install -r requirements.txt")
    print("(first analyze also downloads about 1.5 GB of model weights)")
    sys.exit(1)
print("python dependencies present")
PYEOF
[ $? -ne 0 ] && fail=1
fi
[ "$fail" = 1 ] && { echo; echo "Fix the items above, then double-click this file again."; exit 1; }
IP=$(ipconfig getifaddr en0 2>/dev/null)
if [ -z "$IP" ]; then
    echo "Could not detect this Mac's Wi-Fi address (ipconfig en0 gave nothing)."
    echo "Connect the Mac to Wi-Fi and try again, or find the address in System Settings > Wi-Fi."
    exit 1
fi
echo "Starting the backend. Anyone on this Wi-Fi can see the page, but the API stays locked without the session token - still, use your home network only."
echo
echo "On your iPhone, open:  http://$IP:8765/"
echo
echo "The app will ask for a session token. It is printed below the moment the server starts (look for 'Session token') - type it into the app once. It changes every launch."
echo
echo "Keep this window open while using the app. Close it to stop."
exec python3 server.py --host 0.0.0.0 --port 8765
