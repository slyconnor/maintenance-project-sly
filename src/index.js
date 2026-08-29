/* Maintenance Manager V5.1 — Cloudflare Workers + Static Assets + D1
 * Canonical Worker entry point for the existing Cloudflare Worker named "maintenance".
 * Static files live in ./public and are exposed through env.ASSETS.
 * Shared maintenance data lives in the D1 binding env.DB.
 */

const APP_VERSION = "5.1.0";

const DEFAULT_STATE = {
  version: 5.1,
  profiles: [],
  sections: ["Smokeshield"],
  machines: [],
  partCatalog: [{ id: "p-anvil", name: "Anvil", partNo: "" }],
  suppliers: [],
  jobs: []
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `item-${Date.now()}`;
}

function cookieValue(cookieHeader, name) {
  const parts = String(cookieHeader || "").split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return part.slice(idx + 1).trim();
  }
  return "";
}

async function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(base64));
  } catch (_) {
    return null;
  }
}

async function getIdentity(request, env) {
  const fallbackEmail = cleanEmail(request.headers.get("cf-access-authenticated-user-email"));
  const cookieHeader = request.headers.get("cookie") || "";
  const accessCookie = cookieValue(cookieHeader, "CF_Authorization");
  const assertion = request.headers.get("cf-access-jwt-assertion") || "";
  const token = accessCookie || assertion;
  const payload = await decodeJwtPayload(token);
  let identity = null;

  // Access documents the full-identity endpoint on the team *.cloudflareaccess.com domain.
  // Deriving that domain from the already-validated Access JWT avoids hard-coding a team name.
  const issuer = String(payload?.iss || "").replace(/\/$/, "");
  const identityUrls = [];
  if (/^https:\/\/[^/]+\.cloudflareaccess\.com$/i.test(issuer)) {
    identityUrls.push(`${issuer}/cdn-cgi/access/get-identity`);
  }
  // Fallback for Access configurations where the protected hostname exposes the endpoint too.
  try {
    const u = new URL(request.url);
    identityUrls.push(`${u.origin}/cdn-cgi/access/get-identity`);
  } catch (_) {}

  if (accessCookie) {
    for (const identityUrl of [...new Set(identityUrls)]) {
      try {
        const response = await fetch(identityUrl, {
          headers: { cookie: `CF_Authorization=${accessCookie}`, accept: "application/json" }
        });
        if (response.ok) {
          identity = await response.json();
          break;
        }
      } catch (_) {}
    }
  }

  const email = cleanEmail(identity?.email || fallbackEmail);
  const serviceToken = Boolean(identity?.service_token_status) || (!email && Boolean(assertion));
  const idpType = String(identity?.idp?.type || "").toLowerCase();
  return {
    email,
    idpType,
    serviceToken,
    raw: identity,
    tokenPayload: payload
  };
}

function adminEmails(env) {
  return String(env.ADMIN_EMAILS || "")
    .split(",")
    .map(cleanEmail)
    .filter(Boolean);
}

function isCloudflareLogin(identity) {
  return identity.idpType === "cloudflare";
}

function isAdmin(identity, env) {
  if (!identity.email || !isCloudflareLogin(identity)) return false;
  const admins = adminEmails(env);
  return admins.length > 0 && admins.includes(identity.email);
}

async function requireUser(request, env, { human = false, admin = false } = {}) {
  if (env.DEV_BYPASS_ACCESS === "1") {
    return { ok: true, identity: { email: "dev@example.invalid", idpType: admin ? "cloudflare" : "dev", serviceToken: false, raw: null } };
  }

  const identity = await getIdentity(request, env);
  if (admin) {
    if (!isAdmin(identity, env)) {
      return { ok: false, response: json({ error: "Admin access requires the Cloudflare login method and an approved admin email." }, 403) };
    }
    return { ok: true, identity };
  }

  if (human && !identity.email) {
    return { ok: false, response: json({ error: "A signed-in engineer is required for this action." }, 403) };
  }

  if (!identity.email && !identity.serviceToken) {
    return { ok: false, response: json({ error: "Cloudflare Access authentication is required." }, 401) };
  }

  return { ok: true, identity };
}

function normalizeState(input) {
  const s = input && typeof input === "object" ? input : {};
  return {
    version: 5.1,
    profiles: Array.isArray(s.profiles) ? s.profiles : [],
    sections: Array.isArray(s.sections) ? s.sections : ["Smokeshield"],
    machines: Array.isArray(s.machines) ? s.machines : [],
    partCatalog: Array.isArray(s.partCatalog) ? s.partCatalog : [{ id: "p-anvil", name: "Anvil", partNo: "" }],
    suppliers: Array.isArray(s.suppliers) ? s.suppliers : [],
    jobs: Array.isArray(s.jobs) ? s.jobs : []
  };
}


let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  if (!env.DB) throw new Error("D1 binding DB is missing. Bind maintenance-project-sly-db to this Worker using the variable name DB.");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 1,
    state_json TEXT NOT NULL,
    updated_at TEXT,
    updated_by TEXT
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    actor_email TEXT,
    action TEXT NOT NULL,
    detail_json TEXT
  )`).run();
  schemaReady = true;
}

async function getState(env) {
  await ensureSchema(env);
  let row;
  try {
    row = await env.DB.prepare("SELECT revision, state_json, updated_at, updated_by FROM app_state WHERE id = 1").first();
  } catch (error) {
    throw new Error(`Database not ready. Check the D1 binding named DB. ${error?.message || error}`);
  }

  if (!row) {
    const initial = JSON.stringify(DEFAULT_STATE);
    await env.DB.prepare("INSERT INTO app_state (id, revision, state_json, updated_at, updated_by) VALUES (1, 1, ?, datetime('now'), 'system')")
      .bind(initial)
      .run();
    return { revision: 1, state: structuredClone(DEFAULT_STATE), updatedAt: null, updatedBy: "system" };
  }

  let state;
  try { state = normalizeState(JSON.parse(row.state_json)); }
  catch { state = structuredClone(DEFAULT_STATE); }
  return { revision: Number(row.revision) || 1, state, updatedAt: row.updated_at || null, updatedBy: row.updated_by || null };
}

async function mutateState(env, identity, action, mutator) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await getState(env);
    const next = structuredClone(current.state);
    const result = await mutator(next, current);
    const serialized = JSON.stringify(normalizeState(next));
    const update = await env.DB.prepare(
      "UPDATE app_state SET state_json = ?, revision = revision + 1, updated_at = datetime('now'), updated_by = ? WHERE id = 1 AND revision = ?"
    ).bind(serialized, identity?.email || (identity?.serviceToken ? "service-token" : "unknown"), current.revision).run();

    if ((update.meta?.changes || 0) === 1) {
      const revision = current.revision + 1;
      try {
        await env.DB.prepare("INSERT INTO audit_log (created_at, actor_email, action, detail_json) VALUES (datetime('now'), ?, ?, ?)")
          .bind(identity?.email || (identity?.serviceToken ? "service-token" : "unknown"), action, JSON.stringify(result ?? {}))
          .run();
      } catch (_) {}
      return { revision, state: next, result };
    }
  }
  throw new Error("The shared data changed several times while saving. Please try again.");
}

function nextJobNumber(state, year) {
  const y = Number(year) || new Date().getFullYear();
  const rx = new RegExp(`^JOB-${y}-(\\d+)$`, "i");
  let max = 0;
  for (const job of state.jobs || []) {
    const match = String(job.jobNo || "").match(rx);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return `JOB-${y}-${String(max + 1).padStart(4, "0")}`;
}

function ensureUniqueString(list, value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  const existing = list.find((x) => String(x).toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  list.push(clean);
  list.sort((a, b) => String(a).localeCompare(String(b)));
  return clean;
}

function validateJob(state, job, originalJobNo = "") {
  const out = { ...job };
  out.jobNo = String(out.jobNo || "").trim();
  out.title = String(out.title || "").trim();
  out.section = String(out.section || "").trim();
  out.machine = String(out.machine || "").trim();
  out.assigned = String(out.assigned || "").trim();
  out.timeEntries = Array.isArray(out.timeEntries) ? out.timeEntries : [];
  out.parts = Array.isArray(out.parts) ? out.parts : [];

  if (!out.jobNo || !out.title || !out.section || !out.machine || !out.assigned || !out.raised) {
    throw new Error("Job number, title, section, machine, assigned engineer and date raised are required.");
  }
  if ((state.jobs || []).some((j) => String(j.jobNo).toLowerCase() === out.jobNo.toLowerCase() && String(j.jobNo) !== String(originalJobNo))) {
    throw new Error("That job number already exists.");
  }
  if (!(state.machines || []).some((m) => m.name === out.machine && m.section === out.section)) {
    throw new Error("The selected machine does not belong to the selected section.");
  }
  if (!(state.profiles || []).some((p) => p.name === out.assigned)) {
    throw new Error("The assigned engineer profile does not exist.");
  }
  out.hours = out.timeEntries.reduce((sum, t) => sum + (Number(t.hours) || 0), 0);
  return out;
}

async function syncAccessPolicy(env, state) {
  const token = String(env.CF_API_TOKEN || "").trim();
  const accountId = String(env.CF_ACCOUNT_ID || "").trim();
  const policyId = String(env.CF_ACCESS_POLICY_ID || "").trim();
  const appId = String(env.CF_ACCESS_APP_ID || "").trim();
  const scope = String(env.CF_ACCESS_POLICY_SCOPE || "reusable").toLowerCase();
  const admins = adminEmails(env);
  if (!token || !accountId || !policyId || !admins.length || (scope === "app" && !appId)) {
    return { ok: false, configured: false, message: "Cloudflare policy sync is not fully configured yet. Set the API token/account/policy details and ADMIN_EMAILS first. The profile is saved in D1, but its Access email must be added manually until then." };
  }

  const base = "https://api.cloudflare.com/client/v4";
  const path = scope === "app"
    ? `/accounts/${encodeURIComponent(accountId)}/access/apps/${encodeURIComponent(appId)}/policies/${encodeURIComponent(policyId)}`
    : `/accounts/${encodeURIComponent(accountId)}/access/policies/${encodeURIComponent(policyId)}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  try {
    const currentResponse = await fetch(base + path, { headers });
    const currentPayload = await currentResponse.json();
    if (!currentResponse.ok || !currentPayload?.success) throw new Error(currentPayload?.errors?.[0]?.message || "Could not read Access policy");
    const current = currentPayload.result;

    const activeEmails = [...new Set([
      ...(state.profiles || []).filter((p) => p.active !== false).map((p) => cleanEmail(p.email)).filter(validEmail),
      ...admins
    ])];
    if (!activeEmails.length) {
      return { ok: false, configured: true, message: "Access sync skipped because there are no active profile/admin emails." };
    }

    const body = {
      name: current.name || "Maintenance Users",
      decision: current.decision || "allow",
      include: [
        ...(Array.isArray(current.include) ? current.include.filter((rule) => !rule?.email) : []),
        ...activeEmails.map((email) => ({ email: { email } }))
      ],
      exclude: Array.isArray(current.exclude) ? current.exclude : [],
      require: Array.isArray(current.require) ? current.require : [],
      session_duration: current.session_duration || "24h"
    };
    if (Number.isFinite(Number(current.precedence))) body.precedence = Number(current.precedence);

    const updateResponse = await fetch(base + path, { method: "PUT", headers, body: JSON.stringify(body) });
    const updatePayload = await updateResponse.json();
    if (!updateResponse.ok || !updatePayload?.success) throw new Error(updatePayload?.errors?.[0]?.message || "Could not update Access policy");
    return { ok: true, configured: true, message: `Cloudflare Access allow-list synced for ${activeEmails.length} active email${activeEmails.length === 1 ? "" : "s"}.` };
  } catch (error) {
    return { ok: false, configured: true, message: `Profile saved, but Cloudflare Access sync failed: ${error?.message || error}` };
  }
}


async function bodyJson(request) {
  try { return await request.json(); }
  catch { return {}; }
}

async function handleApi(request, env) {
  const method = request.method.toUpperCase();
  const pathname = new URL(request.url).pathname;
  const parts = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const route = parts.join("/");

  try {
    if (method === "GET" && route === "health") {
      const auth = await requireUser(request, env);
      if (!auth.ok) return auth.response;
      let database = { bound: Boolean(env.DB), ready: false, error: null };
      if (env.DB) {
        try {
          await ensureSchema(env);
          database.ready = true;
        } catch (error) {
          database.error = error?.message || String(error);
        }
      }
      return json({
        ok: database.ready,
        version: APP_VERSION,
        worker: "maintenance",
        database,
        adminEmailsConfigured: adminEmails(env).length > 0,
        identity: {
          email: auth.identity.email || null,
          loginMethod: auth.identity.idpType || (auth.identity.serviceToken ? "service-token" : "unknown"),
          serviceToken: auth.identity.serviceToken,
          cloudflareLogin: isCloudflareLogin(auth.identity),
          admin: isAdmin(auth.identity, env)
        }
      }, database.ready ? 200 : 503);
    }

    if (method === "GET" && route === "session") {
      const auth = await requireUser(request, env);
      if (!auth.ok) return auth.response;
      return json({
        email: auth.identity.email || null,
        loginMethod: auth.identity.idpType || (auth.identity.serviceToken ? "service-token" : "unknown"),
        serviceToken: auth.identity.serviceToken,
        cloudflareLogin: isCloudflareLogin(auth.identity),
        admin: isAdmin(auth.identity, env)
      });
    }

    if (method === "GET" && route === "state") {
      const auth = await requireUser(request, env);
      if (!auth.ok) return auth.response;
      const current = await getState(env);
      return json({
        ...current,
        identity: {
          email: auth.identity.email || null,
          loginMethod: auth.identity.idpType || (auth.identity.serviceToken ? "service-token" : "unknown"),
          serviceToken: auth.identity.serviceToken,
          cloudflareLogin: isCloudflareLogin(auth.identity),
          admin: isAdmin(auth.identity, env)
        }
      });
    }

    if (method === "GET" && route === "next-job-number") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const current = await getState(env);
      const year = Number(new URL(request.url).searchParams.get("year")) || new Date().getFullYear();
      return json({ jobNo: nextJobNumber(current.state, year) });
    }

    if (method === "POST" && route === "jobs") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const outcome = await mutateState(env, auth.identity, body.originalJobNo ? "job.update" : "job.create", async (state) => {
        let job = { ...(body.job || {}) };
        if (!String(job.jobNo || "").trim()) job.jobNo = nextJobNumber(state, new Date(job.raised || Date.now()).getFullYear());
        job = validateJob(state, job, String(body.originalJobNo || ""));

        ensureUniqueString(state.sections, job.section);
        for (const p of job.parts || []) {
          const name = String(p.name || "").trim();
          if (name && !state.partCatalog.some((x) => String(x.name).toLowerCase() === name.toLowerCase())) {
            state.partCatalog.push({ id: `p-${slug(name)}-${Date.now()}`, name, partNo: String(p.partNo || "").trim() });
          }
          if (p.supplier) ensureUniqueString(state.suppliers, p.supplier);
        }

        const original = String(body.originalJobNo || "");
        const idx = original ? state.jobs.findIndex((j) => j.jobNo === original) : -1;
        if (idx >= 0) state.jobs[idx] = job;
        else state.jobs.push(job);
        return { jobNo: job.jobNo };
      });
      return json({ ok: true, revision: outcome.revision, state: outcome.state, ...outcome.result });
    }

    if (method === "POST" && route === "jobs/pin") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const outcome = await mutateState(env, auth.identity, "job.pin", async (state) => {
        const job = state.jobs.find((j) => j.jobNo === body.jobNo);
        if (!job) throw new Error("Job not found.");
        job.pinned = Boolean(body.pinned);
        return { jobNo: job.jobNo, pinned: job.pinned };
      });
      return json({ ok: true, revision: outcome.revision, state: outcome.state });
    }

    if (method === "POST" && route === "machines") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const machine = { ...(body.machine || {}) };
      machine.assetId = String(machine.assetId || "").trim();
      machine.name = String(machine.name || "").trim();
      machine.section = String(machine.section || "").trim();
      if (!machine.assetId || !machine.name || !machine.section) return json({ error: "Asset ID, machine name and section are required." }, 400);
      const outcome = await mutateState(env, auth.identity, "machine.create", async (state) => {
        if (state.machines.some((m) => String(m.assetId).toLowerCase() === machine.assetId.toLowerCase())) throw new Error("That asset ID already exists.");
        if (state.machines.some((m) => String(m.name).toLowerCase() === machine.name.toLowerCase())) throw new Error("A machine with that name already exists.");
        ensureUniqueString(state.sections, machine.section);
        machine.id = machine.id || `m-${slug(machine.assetId)}-${Date.now()}`;
        machine.status = machine.status || "Active";
        state.machines.push(machine);
        return { machineId: machine.id };
      });
      return json({ ok: true, revision: outcome.revision, state: outcome.state, ...outcome.result });
    }

    if (method === "POST" && route === "catalog") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const type = String(body.type || "");
      const outcome = await mutateState(env, auth.identity, `catalog.${type}`, async (state) => {
        if (type === "section") {
          const value = ensureUniqueString(state.sections, body.value);
          if (!value) throw new Error("Section name is required.");
          return { value };
        }
        if (type === "supplier") {
          const value = ensureUniqueString(state.suppliers, body.value);
          if (!value) throw new Error("Supplier name is required.");
          return { value };
        }
        if (type === "part") {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Part name is required.");
          let part = state.partCatalog.find((p) => String(p.name).toLowerCase() === name.toLowerCase());
          if (!part) {
            part = { id: `p-${slug(name)}-${Date.now()}`, name, partNo: String(body.partNo || "").trim() };
            state.partCatalog.push(part);
          }
          return { part };
        }
        throw new Error("Unknown catalog type.");
      });
      return json({ ok: true, revision: outcome.revision, state: outcome.state, ...outcome.result });
    }

    if (route === "admin/profiles" && method === "GET") {
      const auth = await requireUser(request, env, { admin: true });
      if (!auth.ok) return auth.response;
      const current = await getState(env);
      return json({
        profiles: current.state.profiles,
        jobs: current.state.jobs,
        revision: current.revision,
        identity: { email: auth.identity.email, loginMethod: auth.identity.idpType },
        accessSyncConfigured: Boolean(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_ACCESS_POLICY_ID && String(env.ADMIN_EMAILS||"").trim())
      });
    }

    if (route === "admin/profiles" && method === "POST") {
      const auth = await requireUser(request, env, { admin: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const action = String(body.action || "");
      const outcome = await mutateState(env, auth.identity, `profile.${action}`, async (state) => {
        if (action === "create") {
          const name = String(body.name || "").trim();
          const email = cleanEmail(body.email);
          if (!name || !validEmail(email)) throw new Error("A name and valid email are required.");
          if (state.profiles.some((p) => String(p.name).toLowerCase() === name.toLowerCase())) throw new Error("That profile name already exists.");
          if (state.profiles.some((p) => cleanEmail(p.email) === email)) throw new Error("That email is already used by another profile.");
          let id = slug(name), suffix = 2;
          while (state.profiles.some((p) => p.id === id)) id = `${slug(name)}-${suffix++}`;
          state.profiles.push({ id, name, email, active: true });
          return { id };
        }
        if (action === "email") {
          const p = state.profiles.find((x) => x.id === body.id);
          if (!p) throw new Error("Profile not found.");
          const email = cleanEmail(body.email);
          if (!validEmail(email)) throw new Error("Enter a valid email address.");
          if (state.profiles.some((x) => x.id !== p.id && cleanEmail(x.email) === email)) throw new Error("That email is already used by another profile.");
          p.email = email;
          return { id: p.id };
        }
        if (action === "toggle") {
          const p = state.profiles.find((x) => x.id === body.id);
          if (!p) throw new Error("Profile not found.");
          p.active = p.active === false;
          return { id: p.id, active: p.active };
        }
        throw new Error("Unknown profile action.");
      });
      const accessSync = await syncAccessPolicy(env, outcome.state);
      return json({ ok: true, profiles: outcome.state.profiles, jobs: outcome.state.jobs, revision: outcome.revision, accessSync });
    }

    if (route === "admin/sync-access" && method === "POST") {
      const auth = await requireUser(request, env, { admin: true });
      if (!auth.ok) return auth.response;
      const current = await getState(env);
      const accessSync = await syncAccessPolicy(env, current.state);
      return json({ ok: accessSync.ok, accessSync }, accessSync.ok ? 200 : 400);
    }

    return json({ error: "API route not found." }, 404);
  } catch (error) {
    return json({ error: error?.message || String(error) }, 400);
  }
}


function withVersion(response) {
  const out = new Response(response.body, response);
  out.headers.set("x-maintenance-version", APP_VERSION);
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return withVersion(await handleApi(request, env));
    }

    // If an approved admin deliberately chooses the Cloudflare identity provider on the
    // main Access login screen, send them straight to Admin. ?view=dashboard is an escape
    // hatch so an admin can still inspect the normal whole-team dashboard when wanted.
    if ((url.pathname === "/" || url.pathname === "/index.html") && url.searchParams.get("view") !== "dashboard") {
      try {
        const identity = await getIdentity(request, env);
        if (isAdmin(identity, env)) {
          const target = new URL("/admin.html", url);
          return Response.redirect(target.toString(), 302);
        }
      } catch (_) {}
    }

    if (!env.ASSETS) {
      return new Response("Static asset binding ASSETS is missing.", { status: 500 });
    }
    return withVersion(await env.ASSETS.fetch(request));
  }
};
