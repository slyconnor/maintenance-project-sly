RASPBERRY PI DISPLAY — V5 SHARED DATABASE SETUP
================================================

Target site:
  https://maintenance.project-sly.uk

The Pi display is read-only and uses the SAME Cloudflare D1 data as the normal
maintenance dashboard. It does not have an engineer profile and does not store
maintenance data locally.

Recommended authentication:
1. In Cloudflare Zero Trust -> Access -> Service Auth, create a dedicated
   Service Token named something like:
     Workshop Maintenance Display 01
2. Add a Service Auth policy that lets ONLY that token reach the maintenance
   application/display. Keep normal engineer/Admin policies unchanged.
3. Never put the token secret in pi.html or browser JavaScript.

PI FILES
--------
Copy pi_proxy.py to:
  /opt/maintenance-display/pi_proxy.py

Create this root-only file:
  /etc/maintenance-display.env

Contents:
  MM_SITE_URL=https://maintenance.project-sly.uk
  CF_ACCESS_CLIENT_ID=YOUR_DISPLAY_CLIENT_ID
  CF_ACCESS_CLIENT_SECRET=YOUR_DISPLAY_CLIENT_SECRET

Protect it:
  sudo chown root:root /etc/maintenance-display.env
  sudo chmod 600 /etc/maintenance-display.env

Install maintenance-display-proxy.service.example as a systemd service, adjusting
User/paths if required, then enable/start it.

The local proxy listens only on:
  http://127.0.0.1:8787

Configure Chromium to launch:
  http://127.0.0.1:8787/pi.html

The proxy attaches Cloudflare Service Token headers server-side for BOTH the
static display page and its /api/state request. Chromium never receives the
Cloudflare Client Secret.

V5 pi.html:
- always shows the real current month
- always shows the whole team's current-month/carried work
- refreshes shared D1 data automatically
- contains no edit controls

The exact Chromium executable/autostart method varies between Raspberry Pi OS
releases, so maintenance-display.desktop.example is intentionally a template.
