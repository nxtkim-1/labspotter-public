# Use LabSpotter live on your phone, privately (Tailscale)

Status: NOT YET TRIED ON A REAL PHONE OR LAPTOP. These steps follow Tailscale's own docs; nothing here has been verified on your devices.

Why: a phone camera only works on https (or localhost). Tailscale Serve gives your laptop a private https address that only your own signed-in devices can open. It is not public. Never use `tailscale funnel` (that one is public).

Sources: https://tailscale.com/docs/features/tailscale-serve , https://tailscale.com/docs/how-to/set-up-https-certificates

## Which laptop
You have a MacBook Air M2 (8 GB) and a Windows laptop (Core Ultra 9, 32 GB). The real analysis needs about 3 GB RAM plus the model download (about 1.5 GB), so the Windows laptop is the roomier host. run_local.sh is a bash script: on Windows use WSL or Git Bash (not tested). On the Mac it should run as is (not tested).

## One-time setup (you do this, 10 minutes)
1. Install Tailscale on the laptop and on the phone (tailscale.com/download). Sign in on both with the SAME account (free plan).
2. In the Tailscale admin console, DNS page: turn MagicDNS on. Under HTTPS Certificates choose Enable HTTPS. Heads up from Tailscale: enabling it publishes your device names in a public certificate log. Pick a plain device name first if that matters to you.
3. On the laptop, in a terminal, start the app (it listens on this laptop only):
   bash ./run_local.sh
   It prints where it is running (port 8765 by default) and keeps the session token in a file; it never prints the token.
4. In a second terminal on the laptop:
   tailscale serve --bg 8765
   It prints your private https address, like https://your-laptop.your-tailnet.ts.net
5. On the phone (Tailscale app on, same account) open that address in Safari. Allow the camera when asked. Type the session token when the page asks (read it from the token file on the laptop, not from chat).

To stop sharing: `tailscale serve reset`.

## If it does not work
- The address will not open: check the phone's Tailscale app shows Connected and the laptop is awake.
- Camera button missing: the page is not on https. Use the https address, not an IP.
- Slow first result: the first analysis downloads the model. Later ones take about 25 to 45 seconds on a laptop CPU. The quick Meta look appears sooner when a Meta key is set on the laptop.
