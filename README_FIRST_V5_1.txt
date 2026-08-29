MAINTENANCE MANAGER V5.1 — READ THIS FIRST
==========================================

V5.1 fixes the deployment problem found in V5.

V5 was packaged like a Cloudflare Pages Advanced Mode project. Your existing
"maintenance" project is a Cloudflare Worker using Static Assets, so Cloudflare
was correctly treating _worker.js as an ordinary static file.

V5.1 is a real Workers Static Assets project:

  src/index.js       = Worker/API runtime
  public/            = website files
  wrangler.jsonc     = Worker + Static Assets configuration
  migrations/        = D1 schema record for future maintenance
  raspberry-pi/      = optional read-only kiosk helper

IMPORTANT
---------
Do NOT drag-and-drop this ZIP as a normal static deployment.
The correct next deployment method is Cloudflare Workers Builds connected to a
GitHub/GitLab repository, or Wrangler from a computer.

Because you are working mainly from a phone, the recommended route is:

  Existing Cloudflare Worker "maintenance"
      -> Settings
      -> Builds
      -> Connect GitHub
      -> connect a repository containing this project

ONE VALUE STILL NEEDS TO BE FILLED IN
-------------------------------------
Open wrangler.jsonc and replace:

  daa25a9f-dea5-4dcd-836d-600e5104eed3

with the UUID / Database ID of your existing D1 database:

  maintenance-project-sly-db

This is intentionally left as a placeholder because a D1 database UUID is
account-specific and should never be guessed.

After V5.1 is deployed, add this Runtime Variable in Cloudflare:

  ADMIN_EMAILS = your approved Cloudflare-admin email address

The Worker now FAILS CLOSED if ADMIN_EMAILS is missing: normal engineers can
still use the maintenance site, but Cloudflare-login users will not be treated
as Admin until the variable is configured.

WHAT V5.1 DOES
--------------
* Shared D1 storage: no localStorage/sessionStorage.
* All engineers see the same jobs, machines, parts, profiles and time entries.
* Any authenticated human engineer can edit any job, including completed jobs.
* Job numbers default to JOB-YYYY-#### and can be changed if unique.
* Section -> machine selection and saved catalog values reduce typing mistakes.
* Parts keep a dated per-use price; choosing a saved part never reuses an old price.
* Machines have a separate Asset ID and full job history.
* Profile selector is a view/filter only; main dashboard defaults to All Jobs.
* Raspberry Pi page is read-only and shows all current-month work.
* Admin profile records store Name + Email.
* Main-site Cloudflare login can redirect an approved admin directly to /admin.html.
* OTP users remain on the ordinary maintenance dashboard.
* /api/health reports V5.1 runtime/database status after deployment.

SECURITY CHANGE FROM V5
-----------------------
V5 accidentally treated any Cloudflare-IDP user as Admin when ADMIN_EMAILS was
blank. V5.1 deliberately removes that fallback. Admin API routes now require:

  1. Cloudflare Access authentication,
  2. Cloudflare as the actual login method, AND
  3. the authenticated email to exist in ADMIN_EMAILS.

The separate Cloudflare Access application protecting /admin.html should remain
in place as a second layer of protection.
