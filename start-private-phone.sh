#!/bin/bash
# Starts LabSpotter on THIS computer only (127.0.0.1) and prints the two Tailscale steps.
# It does NOT run tailscale for you and never uses `tailscale funnel` (public). NOT YET RUN ON A REAL LAPTOP OR PHONE.
cd "$(dirname "$0")" || exit 1
command -v tailscale >/dev/null || echo "Note: tailscale is not installed or not on PATH. Install it first: https://tailscale.com/download"
echo "After the app says it is running, open a SECOND terminal and run:"
echo "    tailscale serve --bg ${LABSPOTTER_PORT:-8765}"
echo "Then open the https address it prints on your phone (Tailscale on, same account). Stop sharing with: tailscale serve reset"
echo
exec bash ./run_local.sh "$@"
