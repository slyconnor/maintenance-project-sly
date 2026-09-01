import { QRCode, QRErrorCorrectLevel } from "./qr.js";

/* Maintenance Manager V5.9.0 — Cloudflare Workers + Static Assets + D1
 * Canonical Worker entry point for the existing Cloudflare Worker named "maintenance".
 * Static files live in ./public and are exposed through env.ASSETS.
 * Shared maintenance data lives in the D1 binding env.DB.
 */

const APP_VERSION = "5.9.1";
const DEFAULT_SETTINGS = {
  companyName: "",
  siteName: "Maintenance Manager",
  currency: "GBP",
  defaultPriority: "Medium",
  maxAttachmentMb: 25,
  allowAllFileTypes: true,
  allowedExtensions: "jpg,jpeg,png,webp,gif,pdf,doc,docx,xls,xlsx,csv,txt,rtf,zip,7z",
  requestEmailNotificationsEnabled: false,
  notifyNewRequests: true,
  notifyAssignedEngineer: true,
  notifyLowStock: false,
  notificationProfileIds: [],
  notificationExtraEmails: "",
  notificationFromEmail: "maintenance@project-sly.uk",
  pmWeeklyEmailEnabled: true
};

const DEFAULT_PM_CATEGORIES = [
  { id: "pmcat-mechanical", name: "Mechanical", active: true },
  { id: "pmcat-electrical", name: "Electrical", active: true },
  { id: "pmcat-tooling", name: "Tooling", active: true }
];

const DEFAULT_STATE = {
  version: 5.9,
  settings: { ...DEFAULT_SETTINGS },
  profiles: [],
  sections: ["Smokeshield"],
  archivedSections: [],
  machines: [],
  partCatalog: [{ id: "p-anvil", name: "Anvil", partNo: "", active: true, stockTracked: false, currentStock: 0, minStock: 0, binLocation: "", preferredSupplier: "", reorderQty: 1 }],
  suppliers: [],
  archivedSuppliers: [],
  jobs: [],
  stockOrders: [],
  stockTransactions: [],
  preventiveCategories: DEFAULT_PM_CATEGORIES.map((item) => ({ ...item })),
  preventiveSchedules: [],
  preventiveHistory: [],
  pmDigestLog: []
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

function cleanFilename(value) {
  const name = String(value || "file")
    .replace(/[\r\n]/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return (name || "file").slice(0, 180);
}

function contentDispositionFilename(filename) {
  const safe = cleanFilename(filename).replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(cleanFilename(filename));
  return `filename="${safe}"; filename*=UTF-8''${encoded}`;
}

function attachmentTypeAllowed(entityType) {
  return entityType === "job" || entityType === "machine";
}

function safeInlineContentType(contentType) {
  const type = String(contentType || "").toLowerCase();
  return [
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
    "image/avif", "image/heic", "image/heif", "application/pdf"
  ].includes(type);
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
      return {
        ok: false,
        response: json({
          error: "Admin access requires the Cloudflare login method and an approved admin email.",
          code: "ADMIN_ACCESS_REQUIRED",
          identity: {
            email: identity.email || null,
            loginMethod: identity.idpType || (identity.serviceToken ? "service-token" : "unknown")
          }
        }, 403)
      };
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

function normalizeSettings(input) {
  const s = input && typeof input === "object" ? input : {};
  const currency = ["GBP", "EUR", "USD", "CAD", "AUD"].includes(String(s.currency || "").toUpperCase()) ? String(s.currency).toUpperCase() : DEFAULT_SETTINGS.currency;
  const priority = ["Low", "Medium", "High"].includes(String(s.defaultPriority || "")) ? String(s.defaultPriority) : DEFAULT_SETTINGS.defaultPriority;
  const maxAttachmentMb = Math.max(1, Math.min(95, Number(s.maxAttachmentMb) || DEFAULT_SETTINGS.maxAttachmentMb));
  return {
    companyName: String(s.companyName || "").trim().slice(0, 100),
    siteName: String(s.siteName || DEFAULT_SETTINGS.siteName).trim().slice(0, 100) || DEFAULT_SETTINGS.siteName,
    currency,
    defaultPriority: priority,
    maxAttachmentMb,
    allowAllFileTypes: s.allowAllFileTypes !== false,
    allowedExtensions: String(s.allowedExtensions || DEFAULT_SETTINGS.allowedExtensions).toLowerCase().replace(/[^a-z0-9,._-]/g, "").slice(0, 500),
    requestEmailNotificationsEnabled: s.requestEmailNotificationsEnabled === true,
    notifyNewRequests: s.notifyNewRequests !== false,
    notifyAssignedEngineer: s.notifyAssignedEngineer !== false,
    notifyLowStock: s.notifyLowStock === true,
    notificationProfileIds: Array.isArray(s.notificationProfileIds) ? [...new Set(s.notificationProfileIds.map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 100) : [],
    notificationExtraEmails: String(s.notificationExtraEmails || "").replace(/;/g, ",").slice(0, 2000),
    notificationFromEmail: validEmail(s.notificationFromEmail) ? cleanEmail(s.notificationFromEmail) : cleanEmail(DEFAULT_SETTINGS.notificationFromEmail),
    pmWeeklyEmailEnabled: s.pmWeeklyEmailEnabled !== false
  };
}

function attachmentLimitBytes(state) {
  return Math.floor(normalizeSettings(state?.settings).maxAttachmentMb * 1024 * 1024);
}

function attachmentExtensionAllowed(fileName, state) {
  const settings = normalizeSettings(state?.settings);
  if (settings.allowAllFileTypes) return true;
  const extension = String(fileName || "").toLowerCase().split(".").pop();
  const allowed = settings.allowedExtensions.split(",").map((x) => x.trim().replace(/^\./, "")).filter(Boolean);
  return Boolean(extension && allowed.includes(extension));
}

function normalizeCatalogPart(part) {
  const p = part && typeof part === "object" ? part : {};
  return {
    ...p,
    id: String(p.id || `p-${slug(p.name || "part")}-${Date.now()}`),
    name: String(p.name || "").trim(),
    partNo: String(p.partNo || "").trim(),
    active: p.active !== false,
    stockTracked: p.stockTracked === true,
    currentStock: Number.isFinite(Number(p.currentStock)) ? Number(p.currentStock) : 0,
    minStock: Math.max(0, Number.isFinite(Number(p.minStock)) ? Number(p.minStock) : 0),
    binLocation: String(p.binLocation || "").trim(),
    preferredSupplier: String(p.preferredSupplier || "").trim(),
    reorderQty: Math.max(1, Number.isFinite(Number(p.reorderQty)) ? Number(p.reorderQty) : 1)
  };
}

function cleanDateOnly(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizePreventiveCategory(category) {
  const value = category && typeof category === "object" ? category : {};
  const name = String(value.name || "").trim().slice(0, 80);
  return {
    id: String(value.id || crypto.randomUUID()).trim(),
    name,
    active: value.active !== false,
    createdAt: String(value.createdAt || new Date().toISOString()),
    updatedAt: String(value.updatedAt || value.createdAt || new Date().toISOString())
  };
}

function normalizePreventiveSchedule(schedule) {
  const p = schedule && typeof schedule === "object" ? schedule : {};
  const nextDueDate = cleanDateOnly(p.nextDueDate || p.startDate);
  const intervalUnit = ["day", "week", "month", "year"].includes(String(p.intervalUnit || "")) ? String(p.intervalUnit) : "month";
  const intervalValue = Math.max(1, Math.min(365, Number.parseInt(p.intervalValue, 10) || 1));
  const anchorDay = Math.max(1, Math.min(31, Number(p.anchorDay) || Number(nextDueDate.slice(8, 10)) || 1));
  return {
    id: String(p.id || crypto.randomUUID()),
    title: String(p.title || "").trim().slice(0, 160),
    description: String(p.description || "").trim().slice(0, 4000),
    categoryId: String(p.categoryId || "").trim(),
    section: String(p.section || "").trim().slice(0, 100),
    machineId: String(p.machineId || "").trim(),
    machineName: String(p.machineName || "").trim().slice(0, 160),
    machineAssetId: String(p.machineAssetId || "").trim().slice(0, 100),
    location: String(p.location || "").trim().slice(0, 300),
    intervalValue,
    intervalUnit,
    nextDueDate,
    anchorDay,
    assignedProfileIds: Array.isArray(p.assignedProfileIds) ? [...new Set(p.assignedProfileIds.map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 100) : [],
    active: p.active !== false,
    createdAt: String(p.createdAt || new Date().toISOString()),
    updatedAt: String(p.updatedAt || p.createdAt || new Date().toISOString())
  };
}

function normalizePreventiveHistory(row) {
  const h = row && typeof row === "object" ? row : {};
  return {
    id: String(h.id || crypto.randomUUID()),
    scheduleId: String(h.scheduleId || ""),
    title: String(h.title || "").slice(0, 160),
    dueDate: cleanDateOnly(h.dueDate),
    completedAt: String(h.completedAt || new Date().toISOString()),
    completedByEmail: cleanEmail(h.completedByEmail),
    completedByName: String(h.completedByName || "").slice(0, 160),
    notes: String(h.notes || "").slice(0, 2000),
    categoryId: String(h.categoryId || "").trim(),
    categoryName: String(h.categoryName || "").trim().slice(0, 80),
    machineId: String(h.machineId || ""),
    machineName: String(h.machineName || "").slice(0, 160),
    machineAssetId: String(h.machineAssetId || "").slice(0, 100),
    section: String(h.section || "").slice(0, 100),
    location: String(h.location || "").slice(0, 300),
    assignedProfileIds: Array.isArray(h.assignedProfileIds) ? [...new Set(h.assignedProfileIds.map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 100) : []
  };
}

function normalizeState(input) {
  const s = input && typeof input === "object" ? input : {};
  return {
    version: 5.9,
    settings: normalizeSettings(s.settings),
    profiles: Array.isArray(s.profiles) ? s.profiles : [],
    sections: Array.isArray(s.sections) ? s.sections : ["Smokeshield"],
    archivedSections: Array.isArray(s.archivedSections) ? s.archivedSections : [],
    machines: Array.isArray(s.machines) ? s.machines : [],
    partCatalog: Array.isArray(s.partCatalog) ? s.partCatalog.map(normalizeCatalogPart) : [normalizeCatalogPart({ id: "p-anvil", name: "Anvil", partNo: "", active: true })],
    suppliers: Array.isArray(s.suppliers) ? s.suppliers : [],
    archivedSuppliers: Array.isArray(s.archivedSuppliers) ? s.archivedSuppliers : [],
    jobs: Array.isArray(s.jobs) ? s.jobs : [],
    stockOrders: Array.isArray(s.stockOrders) ? s.stockOrders : [],
    stockTransactions: Array.isArray(s.stockTransactions) ? s.stockTransactions.slice(-2500) : [],
    preventiveCategories: (Array.isArray(s.preventiveCategories) ? s.preventiveCategories : DEFAULT_PM_CATEGORIES)
      .map(normalizePreventiveCategory)
      .filter((item, index, rows) => item.name && item.id && rows.findIndex((other) => String(other.id) === String(item.id)) === index),
    preventiveSchedules: Array.isArray(s.preventiveSchedules) ? s.preventiveSchedules.map(normalizePreventiveSchedule) : [],
    preventiveHistory: Array.isArray(s.preventiveHistory) ? s.preventiveHistory.map(normalizePreventiveHistory).slice(-2500) : [],
    pmDigestLog: Array.isArray(s.pmDigestLog) ? s.pmDigestLog.slice(-1000) : []
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
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('job', 'machine')),
    entity_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    uploaded_by TEXT,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id, uploaded_at)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operator_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    issue TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepting', 'accepted')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    claimed_at TEXT,
    accepted_at TEXT,
    accepted_by TEXT,
    assigned_profile_id TEXT,
    assigned_profile_name TEXT,
    linked_job_no TEXT
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_operator_requests_status ON operator_requests(status, created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_operator_requests_machine ON operator_requests(machine_id, created_at DESC)").run();
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

function catalogPartForUsage(state, usage) {
  const partId = String(usage?.partId || "").trim();
  if (partId) {
    const byId = (state.partCatalog || []).find((p) => p.id === partId);
    if (byId) return byId;
  }
  const name = String(usage?.name || "").trim().toLowerCase();
  return name ? (state.partCatalog || []).find((p) => String(p.name || "").trim().toLowerCase() === name) || null : null;
}

function usageQty(value) {
  const qty = Number(value);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

function aggregateJobStockUsage(state, job) {
  const map = new Map();
  for (const usage of job?.parts || []) {
    const part = catalogPartForUsage(state, usage);
    if (!part) continue;
    const qty = usageQty(usage.qty);
    const rawApplied = Number(usage.stockAppliedQty);
    const applied = Number.isFinite(rawApplied) ? Math.max(0, Math.min(qty, rawApplied)) : 0;
    const current = map.get(part.id) || { part, qty: 0, applied: 0 };
    current.qty += qty;
    current.applied += applied;
    map.set(part.id, current);
  }
  return map;
}

function distributeAppliedStock(state, job, appliedByPart) {
  const remaining = new Map(appliedByPart);
  for (const usage of job.parts || []) {
    const part = catalogPartForUsage(state, usage);
    const qty = usageQty(usage.qty);
    if (!part || !part.stockTracked) {
      usage.stockAppliedQty = 0;
      continue;
    }
    const left = Math.max(0, Number(remaining.get(part.id)) || 0);
    const applied = Math.min(qty, left);
    usage.stockAppliedQty = applied;
    remaining.set(part.id, left - applied);
  }
}

function applyJobStockChanges(state, oldJob, newJob) {
  const movements = [];
  const oldUsage = aggregateJobStockUsage(state, oldJob);
  const newUsage = aggregateJobStockUsage(state, newJob);
  const keys = new Set([...oldUsage.keys(), ...newUsage.keys()]);
  const desiredApplied = new Map();

  for (const partId of keys) {
    const oldRec = oldUsage.get(partId) || { qty: 0, applied: 0, part: null };
    const newRec = newUsage.get(partId) || { qty: 0, applied: 0, part: oldRec.part };
    const part = newRec.part || oldRec.part || (state.partCatalog || []).find((p) => p.id === partId);
    if (!part || !part.stockTracked) {
      desiredApplied.set(partId, 0);
      continue;
    }

    // A newly enabled stock count is an as-of-now figure. Legacy job quantities have
    // stockAppliedQty = 0, so simply editing an old job does not deduct them again.
    const deltaQty = newRec.qty - oldRec.qty;
    const nextApplied = Math.max(0, Math.min(newRec.qty, oldRec.applied + deltaQty));
    const stockDelta = nextApplied - oldRec.applied;
    part.currentStock = (Number(part.currentStock) || 0) - stockDelta;
    if (stockDelta !== 0) movements.push({ part, qty: -stockDelta });
    desiredApplied.set(partId, nextApplied);
  }

  distributeAppliedStock(state, newJob, desiredApplied);
  return movements;
}

function restoreJobStock(state, job) {
  const movements = [];
  const usage = aggregateJobStockUsage(state, job);
  for (const { part, applied } of usage.values()) {
    if (!part || !part.stockTracked || applied <= 0) continue;
    part.currentStock = (Number(part.currentStock) || 0) + applied;
    movements.push({ part, qty: applied });
  }
  return movements;
}

function resetHistoricalStockBaseline(state, part) {
  for (const job of state.jobs || []) {
    for (const usage of job.parts || []) {
      const linked = catalogPartForUsage(state, usage);
      if (linked?.id === part.id) usage.stockAppliedQty = 0;
    }
  }
}


function cleanDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/);
  return match ? `${match[1]}T${match[2]}` : "";
}

function pushStockTransaction(state, tx) {
  state.stockTransactions = Array.isArray(state.stockTransactions) ? state.stockTransactions : [];
  const row = {
    id: String(tx.id || crypto.randomUUID()),
    createdAt: String(tx.createdAt || new Date().toISOString()),
    partId: String(tx.partId || ""),
    type: String(tx.type || "adjustment"),
    qty: Number(tx.qty) || 0,
    balanceAfter: Number.isFinite(Number(tx.balanceAfter)) ? Number(tx.balanceAfter) : null,
    jobNo: String(tx.jobNo || ""),
    orderId: String(tx.orderId || ""),
    supplier: String(tx.supplier || ""),
    note: String(tx.note || "").slice(0, 300),
    actor: String(tx.actor || "").slice(0, 180)
  };
  state.stockTransactions.push(row);
  if (state.stockTransactions.length > 2500) state.stockTransactions = state.stockTransactions.slice(-2500);
  return row;
}

function orderRemaining(order) {
  return Math.max(0, (Number(order?.orderedQty) || 0) - (Number(order?.receivedQty) || 0));
}

function validateJob(state, job, originalJobNo = "") {
  const out = { ...job };
  out.jobNo = String(out.jobNo || "").trim();
  out.title = String(out.title || "").trim();
  out.section = String(out.section || "").trim();
  out.machineId = String(out.machineId || "").trim();
  out.machine = String(out.machine || "").trim();
  out.assigned = String(out.assigned || "").trim();
  out.timeEntries = Array.isArray(out.timeEntries) ? out.timeEntries : [];
  out.parts = Array.isArray(out.parts) ? out.parts.map((usage) => {
    const raw = usage && typeof usage === "object" ? { ...usage } : {};
    const matched = catalogPartForUsage(state, raw);
    const qty = Math.max(1, Number(raw.qty) || 1);
    return {
      ...raw,
      partId: matched?.id || String(raw.partId || "").trim(),
      name: matched?.name || String(raw.name || "").trim(),
      partNo: matched?.partNo || String(raw.partNo || "").trim(),
      qty,
      unitPrice: Math.max(0, Number(raw.unitPrice) || 0),
      supplier: String(raw.supplier || "").trim(),
      date: String(raw.date || "").trim()
    };
  }) : [];

  if (!out.jobNo || !out.title || !out.section || !out.machine || !out.assigned || !out.raised) {
    throw new Error("Job number, title, section, machine, assigned engineer and date raised are required.");
  }
  if ((state.jobs || []).some((j) => String(j.jobNo).toLowerCase() === out.jobNo.toLowerCase() && String(j.jobNo) !== String(originalJobNo))) {
    throw new Error("That job number already exists.");
  }
  let selectedMachine = out.machineId ? (state.machines || []).find((m) => String(m.id) === out.machineId) : null;
  if (!selectedMachine) {
    const legacyMatches = (state.machines || []).filter((m) => m.name === out.machine && (!out.section || m.section === out.section));
    if (legacyMatches.length === 1) selectedMachine = legacyMatches[0];
  }
  if (!selectedMachine) throw new Error("Select a valid machine. Jobs are linked by the machine asset ID so identical machine names are supported.");
  if (out.section && selectedMachine.section !== out.section) throw new Error("The selected machine does not belong to the selected section.");
  out.machineId = String(selectedMachine.id);
  out.machine = selectedMachine.name;
  out.section = selectedMachine.section;
  if (!(state.profiles || []).some((p) => p.name === out.assigned)) {
    throw new Error("The assigned engineer profile does not exist.");
  }
  out.downtimeStopped = out.downtimeStopped === true;
  out.downtimeStart = cleanDateTime(out.downtimeStart);
  out.downtimeEnd = cleanDateTime(out.downtimeEnd);
  if (out.downtimeStopped && !out.downtimeStart) throw new Error("Enter when the machine downtime started.");
  if (!out.downtimeStopped) { out.downtimeStart = ""; out.downtimeEnd = ""; }
  if (out.downtimeStart && out.downtimeEnd && new Date(out.downtimeEnd).getTime() < new Date(out.downtimeStart).getTime()) throw new Error("Downtime end cannot be before downtime start.");
  out.hours = out.timeEntries.reduce((sum, t) => sum + (Number(t.hours) || 0), 0);
  return out;
}

function attachmentEntityExists(state, entityType, entityId) {
  if (entityType === "job") return (state.jobs || []).some((job) => String(job.jobNo) === String(entityId));
  if (entityType === "machine") return (state.machines || []).some((machine) => String(machine.id) === String(entityId));
  return false;
}

async function attachmentRows(env, entityType, entityId) {
  await ensureSchema(env);
  const result = await env.DB.prepare(`SELECT id, entity_type, entity_id, file_name, label, content_type, size_bytes, uploaded_by, uploaded_at, updated_at
    FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC, file_name COLLATE NOCASE`)
    .bind(entityType, entityId).all();
  return (result.results || []).map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fileName: row.file_name,
    label: row.label || "",
    contentType: row.content_type || "application/octet-stream",
    sizeBytes: Number(row.size_bytes) || 0,
    uploadedBy: row.uploaded_by || "",
    uploadedAt: row.uploaded_at || "",
    updatedAt: row.updated_at || row.uploaded_at || ""
  }));
}

async function getAttachmentRow(env, id) {
  await ensureSchema(env);
  return await env.DB.prepare(`SELECT id, entity_type, entity_id, object_key, file_name, label, content_type, size_bytes, uploaded_by, uploaded_at, updated_at
    FROM attachments WHERE id = ?`).bind(id).first();
}

async function deleteEntityAttachments(env, entityType, entityId) {
  await ensureSchema(env);
  const result = await env.DB.prepare("SELECT object_key FROM attachments WHERE entity_type = ? AND entity_id = ?")
    .bind(entityType, entityId).all();
  const rows = result.results || [];
  if (env.ATTACHMENTS) {
    for (const row of rows) {
      try { await env.ATTACHMENTS.delete(row.object_key); } catch (_) {}
    }
  }
  await env.DB.prepare("DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?").bind(entityType, entityId).run();
  return rows.length;
}

async function moveJobAttachments(env, oldJobNo, newJobNo) {
  if (!oldJobNo || !newJobNo || oldJobNo === newJobNo) return;
  await ensureSchema(env);
  await env.DB.prepare("UPDATE attachments SET entity_id = ?, updated_at = datetime('now') WHERE entity_type = 'job' AND entity_id = ?")
    .bind(newJobNo, oldJobNo).run();
}

async function logAttachmentAudit(env, identity, action, detail) {
  try {
    await env.DB.prepare("INSERT INTO audit_log (created_at, actor_email, action, detail_json) VALUES (datetime('now'), ?, ?, ?)")
      .bind(identity?.email || "unknown", action, JSON.stringify(detail || {})).run();
  } catch (_) {}
}

function requestReference(id) {
  return `REQ-${String(Number(id) || 0).padStart(6, "0")}`;
}

function cleanOperatorName(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanIssue(value) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, 2000);
}


function emailHtmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function notificationExtraEmailList(settings) {
  return String(settings?.notificationExtraEmails || "")
    .split(/[\n,;]+/)
    .map(cleanEmail)
    .filter(validEmail);
}

function notificationTeamRecipients(state) {
  const settings = normalizeSettings(state?.settings);
  const selected = new Set(settings.notificationProfileIds || []);
  const profileEmails = (state?.profiles || [])
    .filter((profile) => profile.active !== false && selected.has(String(profile.id || "")))
    .map((profile) => cleanEmail(profile.email))
    .filter(validEmail);
  return [...new Set([...profileEmails, ...notificationExtraEmailList(settings)])].slice(0, 50);
}

async function sendMaintenanceEmail(env, state, { to = [], subject = "Maintenance notification", text = "", html = "" } = {}) {
  const settings = normalizeSettings(state?.settings);
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).map(cleanEmail).filter(validEmail))].slice(0, 50);
  if (!env.EMAIL || typeof env.EMAIL.send !== "function") {
    return { ok: false, configured: false, sent: 0, message: "Cloudflare Email binding is not configured yet." };
  }
  if (!recipients.length) {
    return { ok: false, configured: true, sent: 0, message: "No notification recipients are selected." };
  }
  const from = cleanEmail(settings.notificationFromEmail);
  if (!validEmail(from)) {
    return { ok: false, configured: true, sent: 0, message: "Set a valid notification From email in Admin Settings." };
  }
  try {
    await env.EMAIL.send({
      to: recipients.length === 1 ? recipients[0] : recipients,
      from: { email: from, name: settings.siteName || "Maintenance Manager" },
      subject: String(subject || "Maintenance notification").slice(0, 250),
      text: String(text || "").slice(0, 50000),
      html: String(html || "").slice(0, 100000)
    });
    return { ok: true, configured: true, sent: recipients.length, message: `Email sent to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}.` };
  } catch (error) {
    return { ok: false, configured: true, sent: 0, message: `Email could not be sent: ${error?.message || error}` };
  }
}

async function sendNewRequestNotification(env, state, requestInfo, origin) {
  const settings = normalizeSettings(state?.settings);
  if (!settings.requestEmailNotificationsEnabled || !settings.notifyNewRequests) return { ok: true, skipped: true, sent: 0, message: "New-request email notifications are disabled." };
  const recipients = notificationTeamRecipients(state);
  const machine = requestInfo.machine || {};
  const requestNo = requestReference(requestInfo.id);
  const link = `${origin}/?view=requests`;
  const subject = `[Maintenance Request] ${machine.assetId || "Machine"} · ${machine.name || "Issue reported"}`;
  const text = `${requestNo}\nMachine: ${machine.assetId || ""} · ${machine.name || ""}\nLocation: ${machine.location || machine.section || ""}\nReported by: ${requestInfo.operatorName}\n\nIssue:\n${requestInfo.issue}\n\nOpen requests: ${link}`;
  const html = `<h2>New maintenance request</h2><p><strong>${emailHtmlEscape(requestNo)}</strong></p><p><strong>Machine:</strong> ${emailHtmlEscape(machine.assetId || "")} · ${emailHtmlEscape(machine.name || "")}${machine.location || machine.section ? `<br><strong>Location:</strong> ${emailHtmlEscape(machine.location || machine.section || "")}` : ""}<br><strong>Reported by:</strong> ${emailHtmlEscape(requestInfo.operatorName)}</p><p><strong>Issue</strong><br>${emailHtmlEscape(requestInfo.issue).replace(/\n/g, "<br>")}</p><p><a href="${emailHtmlEscape(link)}">Open Maintenance Requests</a></p>`;
  return sendMaintenanceEmail(env, state, { to: recipients, subject, text, html });
}

async function sendAssignedEngineerNotification(env, state, { profile, requestRow, jobNo, machine, origin }) {
  const settings = normalizeSettings(state?.settings);
  if (!settings.requestEmailNotificationsEnabled || !settings.notifyAssignedEngineer) return { ok: true, skipped: true, sent: 0, message: "Assigned-engineer emails are disabled." };
  const email = cleanEmail(profile?.email);
  if (!validEmail(email)) return { ok: false, skipped: true, sent: 0, message: "The assigned engineer does not have a valid email address." };
  const requestNo = requestReference(requestRow.id);
  const link = `${origin}/?view=requests`;
  const subject = `[Job Assigned] ${jobNo} · ${machine?.assetId || machine?.name || "Maintenance"}`;
  const text = `A maintenance request has been accepted and assigned to you.\n\nJob: ${jobNo}\nRequest: ${requestNo}\nMachine: ${machine?.assetId || ""} · ${machine?.name || ""}\nOperator: ${cleanOperatorName(requestRow.operator_name)}\n\nIssue:\n${cleanIssue(requestRow.issue)}\n\nOpen Maintenance Manager: ${link}`;
  const html = `<h2>Maintenance job assigned to you</h2><p><strong>Job:</strong> ${emailHtmlEscape(jobNo)}<br><strong>Request:</strong> ${emailHtmlEscape(requestNo)}<br><strong>Machine:</strong> ${emailHtmlEscape(machine?.assetId || "")} · ${emailHtmlEscape(machine?.name || "")}<br><strong>Operator:</strong> ${emailHtmlEscape(cleanOperatorName(requestRow.operator_name))}</p><p><strong>Issue</strong><br>${emailHtmlEscape(cleanIssue(requestRow.issue)).replace(/\n/g, "<br>")}</p><p><a href="${emailHtmlEscape(link)}">Open Maintenance Manager</a></p>`;
  return sendMaintenanceEmail(env, state, { to: [email], subject, text, html });
}

function lowStockTransitions(beforeStock, state) {
  const alerts = [];
  for (const part of state?.partCatalog || []) {
    if (!part.stockTracked) continue;
    const before = Number(beforeStock.get(part.id));
    if (!Number.isFinite(before)) continue;
    const after = Number(part.currentStock) || 0;
    const min = Math.max(0, Number(part.minStock) || 0);
    if (before > min && after <= min) {
      alerts.push({ id: part.id, name: part.name || "Part", partNo: part.partNo || "", currentStock: after, minStock: min, binLocation: part.binLocation || "" });
    }
  }
  return alerts;
}

async function sendLowStockNotification(env, state, alerts, origin) {
  const settings = normalizeSettings(state?.settings);
  if (!settings.requestEmailNotificationsEnabled || !settings.notifyLowStock || !Array.isArray(alerts) || !alerts.length) return { ok: true, skipped: true, sent: 0, message: "Low-stock emails are disabled or no part crossed its minimum." };
  const recipients = notificationTeamRecipients(state);
  const link = `${origin}/?view=parts`;
  const lines = alerts.map((part) => `${part.name}${part.partNo ? ` (${part.partNo})` : ""}: ${part.currentStock} remaining; minimum ${part.minStock}${part.binLocation ? `; ${part.binLocation}` : ""}`);
  const subject = alerts.length === 1 ? `[Low Stock] ${alerts[0].name}` : `[Low Stock] ${alerts.length} parts need attention`;
  const text = `The following tracked part${alerts.length === 1 ? " has" : "s have"} reached or fallen below minimum stock:\n\n${lines.join("\n")}\n\nOpen Parts Stock Control: ${link}`;
  const html = `<h2>Low stock alert</h2><p>The following tracked part${alerts.length === 1 ? " has" : "s have"} reached or fallen below minimum stock.</p><ul>${alerts.map((part) => `<li><strong>${emailHtmlEscape(part.name)}</strong>${part.partNo ? ` (${emailHtmlEscape(part.partNo)})` : ""}: ${emailHtmlEscape(part.currentStock)} remaining; minimum ${emailHtmlEscape(part.minStock)}${part.binLocation ? ` · ${emailHtmlEscape(part.binLocation)}` : ""}</li>`).join("")}</ul><p><a href="${emailHtmlEscape(link)}">Open Parts Stock Control</a></p>`;
  return sendMaintenanceEmail(env, state, { to: recipients, subject, text, html });
}

function utcDateFromDateOnly(value) {
  const clean = cleanDateOnly(value);
  if (!clean) return null;
  const [year, month, day] = clean.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDateOnly(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function todayUtcDateOnly(timestamp = Date.now()) {
  return utcDateOnly(new Date(timestamp));
}

function addPreventiveInterval(dateValue, intervalValue, intervalUnit, anchorDay = 1) {
  const source = utcDateFromDateOnly(dateValue);
  if (!source) return "";
  const amount = Math.max(1, Number.parseInt(intervalValue, 10) || 1);
  const unit = ["day", "week", "month", "year"].includes(intervalUnit) ? intervalUnit : "month";
  if (unit === "day" || unit === "week") {
    source.setUTCDate(source.getUTCDate() + amount * (unit === "week" ? 7 : 1));
    return utcDateOnly(source);
  }
  if (unit === "month") {
    const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + amount, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(Math.max(1, Number(anchorDay) || 1), lastDay));
    return utcDateOnly(target);
  }
  const target = new Date(Date.UTC(source.getUTCFullYear() + amount, source.getUTCMonth(), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(Math.max(1, Number(anchorDay) || 1), lastDay));
  return utcDateOnly(target);
}

function preventiveWeekRange(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const midnight = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = midnight.getUTCDay() || 7;
  const start = new Date(midnight);
  start.setUTCDate(start.getUTCDate() - (day - 1));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: utcDateOnly(start), end: utcDateOnly(end) };
}

function preventiveFrequencyLabel(schedule) {
  const n = Math.max(1, Number(schedule?.intervalValue) || 1);
  const unit = String(schedule?.intervalUnit || "month");
  if (n === 1) return `Every ${unit}`;
  return `Every ${n} ${unit}s`;
}

function preventiveLocationLabel(state, schedule) {
  const machine = schedule?.machineId ? (state?.machines || []).find((m) => String(m.id) === String(schedule.machineId)) : null;
  if (machine) return `${machine.assetId || ""}${machine.assetId ? " · " : ""}${machine.name || "Machine"}${machine.section ? ` · ${machine.section}` : ""}`;
  return schedule?.location || schedule?.section || "Site-wide";
}

function preventiveAssignedProfiles(state, schedule) {
  const ids = new Set(schedule?.assignedProfileIds || []);
  return (state?.profiles || []).filter((p) => p.active !== false && ids.has(String(p.id || "")));
}

function preventiveCategoryName(state, schedule) {
  const id = String(schedule?.categoryId || "").trim();
  if (!id) return "Uncategorised";
  return (state?.preventiveCategories || []).find((item) => String(item.id) === id)?.name || "Uncategorised";
}

function preventiveHumanDate(value) {
  const date = utcDateFromDateOnly(value);
  return date ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date) : value;
}

async function sendWeeklyPreventiveDigest(env, { origin = "", timestamp = Date.now(), force = false, actorEmail = "scheduled@maintenance.invalid" } = {}) {
  const current = await getState(env);
  const state = current.state;
  const settings = normalizeSettings(state.settings);
  if (settings.pmWeeklyEmailEnabled === false) return { ok: true, skipped: true, message: "Weekly preventive-maintenance emails are disabled.", results: [] };
  const { start, end } = preventiveWeekRange(timestamp);
  const effectiveOrigin = String(origin || env.APP_URL || "https://maintenance.project-sly.uk").replace(/\/$/, "");
  const link = `${effectiveOrigin}/?view=preventive`;
  const logged = new Set((state.pmDigestLog || []).map((row) => `${row.weekStart}|${row.profileId}`));
  const schedules = (state.preventiveSchedules || []).filter((schedule) => schedule.active !== false && cleanDateOnly(schedule.nextDueDate));
  const results = [];
  const successful = [];

  for (const profile of (state.profiles || []).filter((p) => p.active !== false && validEmail(p.email))) {
    const key = `${start}|${profile.id}`;
    if (!force && logged.has(key)) continue;
    const tasks = schedules
      .filter((schedule) => (schedule.assignedProfileIds || []).includes(String(profile.id)) && schedule.nextDueDate <= end)
      .sort((a, b) => String(a.nextDueDate).localeCompare(String(b.nextDueDate)) || String(a.title).localeCompare(String(b.title)));
    if (!tasks.length) continue;
    const overdue = tasks.filter((task) => task.nextDueDate < start);
    const thisWeek = tasks.filter((task) => task.nextDueDate >= start && task.nextDueDate <= end);
    const subject = `[PM] ${tasks.length} job${tasks.length === 1 ? "" : "s"} for week of ${preventiveHumanDate(start)}`;
    const textLines = [
      `Hi ${profile.name || "Engineer"},`,
      "",
      `These are your preventive-maintenance jobs for ${preventiveHumanDate(start)} to ${preventiveHumanDate(end)}.`,
      ...(overdue.length ? ["", `OVERDUE (${overdue.length})`, ...overdue.map((task) => `- ${preventiveHumanDate(task.nextDueDate)} · ${task.title} · ${preventiveCategoryName(state, task)} · ${preventiveLocationLabel(state, task)}`)] : []),
      ...(thisWeek.length ? ["", `DUE THIS WEEK (${thisWeek.length})`, ...thisWeek.map((task) => `- ${preventiveHumanDate(task.nextDueDate)} · ${task.title} · ${preventiveCategoryName(state, task)} · ${preventiveLocationLabel(state, task)}`)] : []),
      "",
      `Open Preventive Maintenance: ${link}`
    ];
    const sectionHtml = (heading, rows) => rows.length ? `<h3>${heading}</h3><ul>${rows.map((task) => `<li><strong>${emailHtmlEscape(task.title)}</strong> — due ${emailHtmlEscape(preventiveHumanDate(task.nextDueDate))}<br>${emailHtmlEscape(preventiveCategoryName(state, task))} · ${emailHtmlEscape(preventiveLocationLabel(state, task))} · ${emailHtmlEscape(preventiveFrequencyLabel(task))}</li>`).join("")}</ul>` : "";
    const html = `<h2>Your preventive-maintenance jobs this week</h2><p>Hi ${emailHtmlEscape(profile.name || "Engineer")},</p><p>These are your planned jobs for <strong>${emailHtmlEscape(preventiveHumanDate(start))}</strong> to <strong>${emailHtmlEscape(preventiveHumanDate(end))}</strong>.</p>${sectionHtml("Overdue", overdue)}${sectionHtml("Due this week", thisWeek)}<p><a href="${emailHtmlEscape(link)}">Open Preventive Maintenance</a></p>`;
    const email = await sendMaintenanceEmail(env, state, { to: [profile.email], subject, text: textLines.join("\n"), html });
    results.push({ profileId: profile.id, profileName: profile.name, email: profile.email, taskCount: tasks.length, overdueCount: overdue.length, ...email });
    if (email.ok) successful.push({ weekStart: start, weekEnd: end, profileId: String(profile.id), sentAt: new Date().toISOString(), taskCount: tasks.length, manual: force === true });
  }

  if (successful.length) {
    await mutateState(env, { email: actorEmail }, "preventive.weekly-email", async (next) => {
      next.pmDigestLog = Array.isArray(next.pmDigestLog) ? next.pmDigestLog : [];
      for (const row of successful) {
        const existing = next.pmDigestLog.find((item) => item.weekStart === row.weekStart && String(item.profileId) === row.profileId);
        if (existing) Object.assign(existing, row);
        else next.pmDigestLog.push(row);
      }
      next.pmDigestLog = next.pmDigestLog.slice(-1000);
      return { weekStart: start, weekEnd: end, sent: successful.length };
    });
  }

  return { ok: results.every((row) => row.ok !== false), weekStart: start, weekEnd: end, sentEmails: successful.length, results };
}

async function getOperatorRequest(env, id) {
  await ensureSchema(env);
  return await env.DB.prepare(`SELECT id, machine_id, operator_name, issue, status, created_at, claimed_at, accepted_at, accepted_by, assigned_profile_id, assigned_profile_name, linked_job_no
    FROM operator_requests WHERE id = ?`).bind(Number(id)).first();
}

function operatorRequestJson(row, state) {
  const machine = (state.machines || []).find((item) => String(item.id) === String(row.machine_id));
  return {
    id: Number(row.id),
    requestNo: requestReference(row.id),
    machineId: row.machine_id,
    machine: machine ? { id: machine.id, assetId: machine.assetId || "", name: machine.name || "", section: machine.section || "", location: machine.location || "" } : null,
    operatorName: row.operator_name || "",
    issue: row.issue || "",
    status: row.status || "pending",
    createdAt: row.created_at || "",
    acceptedAt: row.accepted_at || "",
    acceptedBy: row.accepted_by || "",
    assignedProfileId: row.assigned_profile_id || "",
    assignedProfileName: row.assigned_profile_name || "",
    linkedJobNo: row.linked_job_no || ""
  };
}

async function listOperatorRequests(env, state) {
  await ensureSchema(env);
  // If a Worker invocation died midway through an accept, make the request available again.
  await env.DB.prepare("UPDATE operator_requests SET status = 'pending', claimed_at = NULL WHERE status = 'accepting' AND claimed_at < datetime('now', '-5 minutes')").run();
  const result = await env.DB.prepare(`SELECT id, machine_id, operator_name, issue, status, created_at, claimed_at, accepted_at, accepted_by, assigned_profile_id, assigned_profile_name, linked_job_no
    FROM operator_requests
    WHERE status IN ('pending', 'accepting') OR (status = 'accepted' AND accepted_at >= datetime('now', '-90 days'))
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'accepting' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 250`).all();
  return (result.results || []).map((row) => operatorRequestJson(row, state));
}

async function handlePublicRequest(request, env) {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const action = String(url.searchParams.get("api") || "");
  try {
    if (method === "GET" && action === "machine") {
      const machineId = String(url.searchParams.get("machine") || "").trim();
      if (!machineId) return json({ error: "This QR code does not contain a machine." }, 400);
      const current = await getState(env);
      const machine = (current.state.machines || []).find((item) => String(item.id) === machineId);
      if (!machine || String(machine.status || "Active").toLowerCase() === "archived") return json({ error: "This machine is no longer available for operator requests." }, 404);
      return json({
        machine: { id: machine.id, assetId: machine.assetId || "", name: machine.name || "", section: machine.section || "", location: machine.location || "" },
        siteName: normalizeSettings(current.state.settings).siteName,
        companyName: normalizeSettings(current.state.settings).companyName
      });
    }

    if (method === "POST" && action === "submit") {
      const body = await bodyJson(request);
      // Hidden honeypot used by the public form. Humans never fill it.
      if (String(body.website || "").trim()) return json({ ok: true, requestNo: "REQ-SUBMITTED" });
      const machineId = String(body.machineId || "").trim();
      const operatorName = cleanOperatorName(body.operatorName);
      const issue = cleanIssue(body.issue);
      if (operatorName.length < 2) return json({ error: "Enter your name." }, 400);
      if (issue.length < 3) return json({ error: "Describe the maintenance issue." }, 400);
      const current = await getState(env);
      const machine = (current.state.machines || []).find((item) => String(item.id) === machineId);
      if (!machine || String(machine.status || "Active").toLowerCase() === "archived") return json({ error: "This machine is no longer available for operator requests." }, 404);
      await ensureSchema(env);
      const duplicate = await env.DB.prepare(`SELECT id FROM operator_requests
        WHERE machine_id = ? AND lower(operator_name) = lower(?) AND issue = ? AND created_at >= datetime('now', '-45 seconds')
        ORDER BY id DESC LIMIT 1`).bind(machineId, operatorName, issue).first();
      if (duplicate?.id) return json({ ok: true, requestNo: requestReference(duplicate.id), duplicate: true });
      const recent = await env.DB.prepare(`SELECT count(*) AS total FROM operator_requests WHERE machine_id = ? AND created_at >= datetime('now', '-10 minutes')`).bind(machineId).first();
      if (Number(recent?.total || 0) >= 10) return json({ error: "Too many requests have just been submitted for this machine. Please tell maintenance directly if the issue is urgent." }, 429);
      const inserted = await env.DB.prepare(`INSERT INTO operator_requests (machine_id, operator_name, issue, status, created_at)
        VALUES (?, ?, ?, 'pending', datetime('now'))`).bind(machineId, operatorName, issue).run();
      const id = Number(inserted.meta?.last_row_id || 0);
      const notification = await sendNewRequestNotification(env, current.state, { id, machine, operatorName, issue }, url.origin);
      return json({ ok: true, requestNo: requestReference(id), machine: { assetId: machine.assetId || "", name: machine.name || "" }, notification }, 201);
    }
    return json({ error: "Operator request route not found." }, 404);
  } catch (error) {
    return json({ error: error?.message || String(error) }, 400);
  }
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

async function handleApi(request, env, routeOverride = "") {
  const method = request.method.toUpperCase();
  const pathname = new URL(request.url).pathname;
  const parts = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const route = routeOverride || parts.join("/");

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
      const current = database.ready ? await getState(env) : { state: normalizeState(DEFAULT_STATE) };
      return json({
        ok: database.ready,
        version: APP_VERSION,
        worker: "maintenance",
        database,
        adminEmailsConfigured: adminEmails(env).length > 0,
        attachmentStorage: {
          configured: Boolean(env.ATTACHMENTS),
          maxFileBytes: attachmentLimitBytes(current.state),
          allowAllFileTypes: normalizeSettings(current.state.settings).allowAllFileTypes
        },
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

    if (method === "GET" && route === "attachments") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const url = new URL(request.url);
      const entityType = String(url.searchParams.get("entityType") || "").toLowerCase();
      const entityId = String(url.searchParams.get("entityId") || "").trim();
      if (!attachmentTypeAllowed(entityType) || !entityId) return json({ error: "A valid attachment entity is required." }, 400);
      const current = await getState(env);
      if (!attachmentEntityExists(current.state, entityType, entityId)) return json({ error: `${entityType === "job" ? "Job" : "Machine"} not found.` }, 404);
      return json({
        attachments: await attachmentRows(env, entityType, entityId),
        storageConfigured: Boolean(env.ATTACHMENTS),
        maxFileBytes: attachmentLimitBytes(current.state),
        allowAllFileTypes: normalizeSettings(current.state.settings).allowAllFileTypes,
        allowedExtensions: normalizeSettings(current.state.settings).allowedExtensions
      });
    }

    if (method === "POST" && route === "attachments") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      if (!env.ATTACHMENTS) return json({ error: "Attachment storage is not configured yet. Create the R2 bucket and bind it as ATTACHMENTS." }, 503);
      const form = await request.formData();
      const entityType = String(form.get("entityType") || "").toLowerCase();
      const entityId = String(form.get("entityId") || "").trim();
      const label = String(form.get("label") || "").trim().slice(0, 200);
      const file = form.get("file");
      if (!attachmentTypeAllowed(entityType) || !entityId) return json({ error: "A valid attachment entity is required." }, 400);
      if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Choose a file to upload." }, 400);
      const size = Number(file.size) || 0;
      if (size <= 0) return json({ error: "The selected file is empty." }, 400);
      const current = await getState(env);
      const maxFileBytes = attachmentLimitBytes(current.state);
      const maxFileMb = normalizeSettings(current.state.settings).maxAttachmentMb;
      if (size > maxFileBytes) return json({ error: `Each attachment must be ${maxFileMb} MB or smaller.` }, 413);
      if (!attachmentExtensionAllowed(file.name, current.state)) return json({ error: "That file type is not allowed by the Admin attachment settings." }, 415);
      if (!attachmentEntityExists(current.state, entityType, entityId)) return json({ error: `${entityType === "job" ? "Job" : "Machine"} not found. Save it before uploading files.` }, 404);

      const id = crypto.randomUUID();
      const fileName = cleanFilename(file.name || "file");
      const contentType = String(file.type || "application/octet-stream").slice(0, 150);
      const objectKey = `${entityType}/${encodeURIComponent(entityId)}/${Date.now()}-${id}-${fileName}`;
      await env.ATTACHMENTS.put(objectKey, file, {
        httpMetadata: { contentType },
        customMetadata: {
          attachmentId: id,
          entityType,
          entityId: entityId.slice(0, 180),
          uploadedBy: String(auth.identity.email || "").slice(0, 180)
        }
      });
      try {
        await env.DB.prepare(`INSERT INTO attachments
          (id, entity_type, entity_id, object_key, file_name, label, content_type, size_bytes, uploaded_by, uploaded_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
          .bind(id, entityType, entityId, objectKey, fileName, label, contentType, size, auth.identity.email || "").run();
      } catch (error) {
        try { await env.ATTACHMENTS.delete(objectKey); } catch (_) {}
        throw error;
      }
      await logAttachmentAudit(env, auth.identity, "attachment.upload", { id, entityType, entityId, fileName, sizeBytes: size });
      return json({ ok: true, attachment: (await attachmentRows(env, entityType, entityId)).find((item) => item.id === id) || { id, fileName } });
    }

    if (method === "POST" && route === "attachments/update") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const id = String(body.id || "").trim();
      const label = String(body.label || "").trim().slice(0, 200);
      if (!id) return json({ error: "Attachment ID is required." }, 400);
      const row = await getAttachmentRow(env, id);
      if (!row) return json({ error: "Attachment not found." }, 404);
      await env.DB.prepare("UPDATE attachments SET label = ?, updated_at = datetime('now') WHERE id = ?").bind(label, id).run();
      await logAttachmentAudit(env, auth.identity, "attachment.update", { id, label });
      return json({ ok: true, id, label });
    }

    if (method === "POST" && route === "attachments/delete") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const id = String(body.id || "").trim();
      if (!id) return json({ error: "Attachment ID is required." }, 400);
      const row = await getAttachmentRow(env, id);
      if (!row) return json({ error: "Attachment not found." }, 404);
      if (env.ATTACHMENTS) await env.ATTACHMENTS.delete(row.object_key);
      await env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(id).run();
      await logAttachmentAudit(env, auth.identity, "attachment.delete", { id, entityType: row.entity_type, entityId: row.entity_id, fileName: row.file_name });
      return json({ ok: true, id, deleted: true });
    }

    if (method === "GET" && route === "attachments/file") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      if (!env.ATTACHMENTS) return json({ error: "Attachment storage is not configured." }, 503);
      const url = new URL(request.url);
      const id = String(url.searchParams.get("id") || "").trim();
      const forceDownload = url.searchParams.get("download") === "1";
      const row = await getAttachmentRow(env, id);
      if (!row) return json({ error: "Attachment not found." }, 404);
      const current = await getState(env);
      if (!attachmentEntityExists(current.state, row.entity_type, row.entity_id)) return json({ error: "The linked job or machine no longer exists." }, 404);
      const object = await env.ATTACHMENTS.get(row.object_key);
      if (!object) return json({ error: "The stored file could not be found." }, 404);
      const contentType = row.content_type || "application/octet-stream";
      const disposition = !forceDownload && safeInlineContentType(contentType) ? "inline" : "attachment";
      const headers = new Headers({
        "content-type": contentType,
        "content-disposition": `${disposition}; ${contentDispositionFilename(row.file_name)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin"
      });
      if (Number(row.size_bytes) > 0) headers.set("content-length", String(row.size_bytes));
      return new Response(object.body, { status: 200, headers });
    }

    if (method === "GET" && route === "requests") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const current = await getState(env);
      const requests = await listOperatorRequests(env, current.state);
      return json({
        requests,
        pendingCount: requests.filter((item) => item.status === "pending" || item.status === "accepting").length
      });
    }

    if (method === "POST" && route === "requests/accept") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const id = Number(body.id);
      const assignedProfileId = String(body.assignedProfileId || "").trim();
      if (!Number.isInteger(id) || id <= 0) return json({ error: "Request ID is required." }, 400);
      if (!assignedProfileId) return json({ error: "Choose an engineer to assign this request to." }, 400);

      const current = await getState(env);
      const requestRow = await getOperatorRequest(env, id);
      if (!requestRow) return json({ error: "Operator request not found." }, 404);
      if (requestRow.status === "accepted") {
        return json({ ok: true, alreadyAccepted: true, linkedJobNo: requestRow.linked_job_no || "", state: current.state, requests: await listOperatorRequests(env, current.state) });
      }
      const machine = (current.state.machines || []).find((item) => String(item.id) === String(requestRow.machine_id));
      if (!machine) return json({ error: "The machine linked to this request no longer exists." }, 400);
      const profile = (current.state.profiles || []).find((item) => String(item.id) === assignedProfileId && item.active !== false);
      if (!profile) return json({ error: "Choose an active engineer." }, 400);

      const claim = await env.DB.prepare(`UPDATE operator_requests SET status = 'accepting', claimed_at = datetime('now')
        WHERE id = ? AND status = 'pending'`).bind(id).run();
      if ((claim.meta?.changes || 0) !== 1) {
        const latest = await getOperatorRequest(env, id);
        if (latest?.status === "accepted") return json({ ok: true, alreadyAccepted: true, linkedJobNo: latest.linked_job_no || "", state: current.state, requests: await listOperatorRequests(env, current.state) });
        return json({ error: "Another engineer is accepting this request. Refresh the Requests page." }, 409);
      }

      let outcome;
      try {
        outcome = await mutateState(env, auth.identity, "operator-request.accept", async (state) => {
          const existing = (state.jobs || []).find((job) => Number(job.sourceRequestId) === id);
          if (existing) return { jobNo: existing.jobNo, requestId: id, existing: true };
          const liveMachine = (state.machines || []).find((item) => String(item.id) === String(requestRow.machine_id));
          const liveProfile = (state.profiles || []).find((item) => String(item.id) === assignedProfileId && item.active !== false);
          if (!liveMachine) throw new Error("The machine linked to this request no longer exists.");
          if (!liveProfile) throw new Error("The selected engineer is no longer active.");
          const raised = new Date().toISOString().slice(0, 10);
          const shortIssue = cleanIssue(requestRow.issue).replace(/\s+/g, " ");
          const title = shortIssue.length > 90 ? `${shortIssue.slice(0, 87)}…` : shortIssue;
          const job = validateJob(state, {
            jobNo: nextJobNumber(state, new Date().getFullYear()),
            title: title || `Operator request - ${liveMachine.name}`,
            description: `Operator: ${cleanOperatorName(requestRow.operator_name)}\n\nReported issue:\n${cleanIssue(requestRow.issue)}`,
            section: liveMachine.section,
            machineId: liveMachine.id,
            machine: liveMachine.name,
            assigned: liveProfile.name,
            priority: normalizeSettings(state.settings).defaultPriority,
            status: "Open",
            raised,
            target: "",
            completed: "",
            pinned: false,
            timeEntries: [],
            parts: [],
            notes: `Created from ${requestReference(id)}.`,
            sourceRequestId: id,
            sourceOperatorName: cleanOperatorName(requestRow.operator_name)
          });
          state.jobs.push(job);
          return { jobNo: job.jobNo, requestId: id, assignedProfileId: liveProfile.id, assignedProfileName: liveProfile.name };
        });
      } catch (error) {
        try { await env.DB.prepare("UPDATE operator_requests SET status = 'pending', claimed_at = NULL WHERE id = ? AND status = 'accepting'").bind(id).run(); } catch (_) {}
        throw error;
      }

      await env.DB.prepare(`UPDATE operator_requests
        SET status = 'accepted', accepted_at = datetime('now'), accepted_by = ?, assigned_profile_id = ?, assigned_profile_name = ?, linked_job_no = ?, claimed_at = NULL
        WHERE id = ?`).bind(auth.identity.email || "", assignedProfileId, outcome.result?.assignedProfileName || profile.name, outcome.result?.jobNo || "", id).run();
      const notification = await sendAssignedEngineerNotification(env, outcome.state, {
        profile,
        requestRow,
        jobNo: outcome.result?.jobNo || "",
        machine,
        origin: new URL(request.url).origin
      });
      const requests = await listOperatorRequests(env, outcome.state);
      return json({ ok: true, revision: outcome.revision, state: outcome.state, requests, linkedJobNo: outcome.result?.jobNo || "", requestNo: requestReference(id), notification });
    }

    if (method === "GET" && route === "search") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const q = String(new URL(request.url).searchParams.get("q") || "").trim().toLowerCase().slice(0, 100);
      if (q.length < 2) return json({ attachments: [] });
      await ensureSchema(env);
      const pattern = `%${q}%`;
      const result = await env.DB.prepare(`SELECT id, entity_type, entity_id, file_name, label, content_type, uploaded_at
        FROM attachments WHERE lower(file_name) LIKE ? OR lower(label) LIKE ?
        ORDER BY uploaded_at DESC LIMIT 8`).bind(pattern, pattern).all();
      return json({ attachments: (result.results || []).map((row) => ({
        id: row.id, entityType: row.entity_type, entityId: row.entity_id, fileName: row.file_name, label: row.label || "", contentType: row.content_type || "", uploadedAt: row.uploaded_at || ""
      })) });
    }

    if (method === "GET" && route === "machines/qr") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const url = new URL(request.url);
      const id = String(url.searchParams.get("id") || "").trim();
      const current = await getState(env);
      const machine = current.state.machines.find((item) => String(item.id) === id);
      if (!machine) return json({ error: "Machine not found." }, 404);
      const destination = `${url.origin}/request?machine=${encodeURIComponent(machine.id)}`;
      const qr = new QRCode(-1, QRErrorCorrectLevel.M);
      qr.addData(destination);
      qr.make();
      const quiet = 4;
      const count = qr.getModuleCount();
      const size = count + quiet * 2;
      let path = "";
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
        }
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="640" height="640" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="black"/></svg>`;
      const headers = new Headers({ "content-type": "image/svg+xml; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
      if (url.searchParams.get("download") === "1") headers.set("content-disposition", `attachment; ${contentDispositionFilename(`${machine.assetId || "machine"}-qr.svg`)}`);
      return new Response(svg, { status: 200, headers });
    }

    if (method === "GET" && route === "next-job-number") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const current = await getState(env);
      const year = Number(new URL(request.url).searchParams.get("year")) || new Date().getFullYear();
      return json({ jobNo: nextJobNumber(current.state, year) });
    }

    if (method === "POST" && route === "preventive") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const action = String(body.action || "").toLowerCase();
      const outcome = await mutateState(env, auth.identity, `preventive.${action}`, async (state) => {
        state.preventiveCategories = Array.isArray(state.preventiveCategories) && state.preventiveCategories.length
          ? state.preventiveCategories.map(normalizePreventiveCategory)
          : DEFAULT_PM_CATEGORIES.map((item) => normalizePreventiveCategory(item));
        state.preventiveSchedules = Array.isArray(state.preventiveSchedules) ? state.preventiveSchedules : [];
        state.preventiveHistory = Array.isArray(state.preventiveHistory) ? state.preventiveHistory : [];

        if (action === "category-add" || action === "category-rename" || action === "category-toggle") {
          if (!isAdmin(auth.identity, env)) throw new Error("Only an admin can manage preventive-maintenance categories.");
          if (action === "category-add") {
            const name = String(body.name || "").trim().slice(0, 80);
            if (!name) throw new Error("Enter a category name.");
            if (state.preventiveCategories.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new Error("That preventive-maintenance category already exists.");
            const category = normalizePreventiveCategory({ id: crypto.randomUUID(), name, active: true });
            state.preventiveCategories.push(category);
            return { action, category };
          }
          const id = String(body.id || "").trim();
          const category = state.preventiveCategories.find((item) => String(item.id) === id);
          if (!category) throw new Error("Preventive-maintenance category not found.");
          if (action === "category-rename") {
            const name = String(body.name || "").trim().slice(0, 80);
            if (!name) throw new Error("Enter a category name.");
            if (state.preventiveCategories.some((item) => String(item.id) !== id && item.name.toLowerCase() === name.toLowerCase())) throw new Error("That preventive-maintenance category already exists.");
            category.name = name;
            category.updatedAt = new Date().toISOString();
            return { action, category };
          }
          const nextActive = body.active === true;
          if (!nextActive && category.active !== false && state.preventiveCategories.filter((item) => item.active !== false).length <= 1) {
            throw new Error("Keep at least one preventive-maintenance category active.");
          }
          category.active = nextActive;
          category.updatedAt = new Date().toISOString();
          return { action, category };
        }

        if (action === "create" || action === "update") {
          const raw = body.schedule && typeof body.schedule === "object" ? body.schedule : {};
          const existingIndex = action === "update" ? state.preventiveSchedules.findIndex((item) => String(item.id) === String(raw.id || body.id || "")) : -1;
          if (action === "update" && existingIndex < 0) throw new Error("Preventive-maintenance schedule not found.");
          const existing = existingIndex >= 0 ? state.preventiveSchedules[existingIndex] : null;
          const title = String(raw.title || "").trim();
          const nextDueDate = cleanDateOnly(raw.nextDueDate);
          const intervalValue = Math.max(1, Math.min(365, Number.parseInt(raw.intervalValue, 10) || 1));
          const intervalUnit = ["day", "week", "month", "year"].includes(String(raw.intervalUnit || "")) ? String(raw.intervalUnit) : "month";
          const assignedProfileIds = [...new Set((Array.isArray(raw.assignedProfileIds) ? raw.assignedProfileIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
          const categoryId = String(raw.categoryId || "").trim();
          if (!title) throw new Error("Enter a preventive-maintenance job title.");
          if (!nextDueDate) throw new Error("Enter the first / next due date.");
          if (!categoryId) throw new Error("Choose a preventive-maintenance category.");
          const selectedCategory = state.preventiveCategories.find((item) => String(item.id) === categoryId);
          if (!selectedCategory) throw new Error("The selected preventive-maintenance category could not be found.");
          if (selectedCategory.active === false && String(existing?.categoryId || "") !== categoryId) throw new Error("The selected preventive-maintenance category is archived.");
          if (!assignedProfileIds.length) throw new Error("Assign this preventive-maintenance job to at least one engineer.");
          for (const profileId of assignedProfileIds) {
            if (!(state.profiles || []).some((profile) => String(profile.id) === profileId && profile.active !== false)) throw new Error("One of the assigned engineer profiles is no longer active.");
          }
          let machine = null;
          const machineId = String(raw.machineId || "").trim();
          if (machineId) {
            machine = (state.machines || []).find((item) => String(item.id) === machineId);
            if (!machine) throw new Error("The selected machine could not be found.");
          }
          const row = normalizePreventiveSchedule({
            ...existing,
            ...raw,
            id: existing?.id || raw.id || crypto.randomUUID(),
            title,
            categoryId,
            nextDueDate,
            intervalValue,
            intervalUnit,
            anchorDay: Number(nextDueDate.slice(8, 10)),
            machineId: machine?.id || "",
            machineName: machine?.name || "",
            machineAssetId: machine?.assetId || "",
            section: machine?.section || String(raw.section || "").trim(),
            location: String(raw.location || "").trim(),
            assignedProfileIds,
            active: raw.active !== false,
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          if (existingIndex >= 0) state.preventiveSchedules[existingIndex] = row;
          else state.preventiveSchedules.push(row);
          return { id: row.id, action, title: row.title, nextDueDate: row.nextDueDate };
        }

        if (action === "complete") {
          const id = String(body.id || "").trim();
          const schedule = state.preventiveSchedules.find((item) => String(item.id) === id);
          if (!schedule) throw new Error("Preventive-maintenance schedule not found.");
          if (!schedule.nextDueDate) throw new Error("This schedule does not have a valid due date.");
          const dueDate = schedule.nextDueDate;
          const profile = (state.profiles || []).find((item) => cleanEmail(item.email) === cleanEmail(auth.identity.email));
          const history = normalizePreventiveHistory({
            id: crypto.randomUUID(),
            scheduleId: schedule.id,
            title: schedule.title,
            dueDate,
            completedAt: new Date().toISOString(),
            completedByEmail: auth.identity.email || "",
            completedByName: profile?.name || auth.identity.email || "Engineer",
            notes: String(body.notes || "").trim(),
            categoryId: schedule.categoryId,
            categoryName: preventiveCategoryName(state, schedule),
            machineId: schedule.machineId,
            machineName: schedule.machineName,
            machineAssetId: schedule.machineAssetId,
            section: schedule.section,
            location: schedule.location,
            assignedProfileIds: schedule.assignedProfileIds
          });
          state.preventiveHistory.push(history);
          if (state.preventiveHistory.length > 2500) state.preventiveHistory = state.preventiveHistory.slice(-2500);
          // Keep the planned cadence, but if this check was completed late, roll forward
          // until the next due date is after today instead of leaving it immediately overdue.
          const completedDate = todayUtcDateOnly();
          let nextDueDate = addPreventiveInterval(schedule.nextDueDate, schedule.intervalValue, schedule.intervalUnit, schedule.anchorDay);
          let guard = 0;
          while (nextDueDate && nextDueDate <= completedDate && guard < 1000) {
            nextDueDate = addPreventiveInterval(nextDueDate, schedule.intervalValue, schedule.intervalUnit, schedule.anchorDay);
            guard += 1;
          }
          schedule.nextDueDate = nextDueDate;
          schedule.updatedAt = new Date().toISOString();
          return { id: schedule.id, title: schedule.title, completedDueDate: dueDate, nextDueDate: schedule.nextDueDate, historyId: history.id };
        }

        if (action === "toggle") {
          const schedule = state.preventiveSchedules.find((item) => String(item.id) === String(body.id || ""));
          if (!schedule) throw new Error("Preventive-maintenance schedule not found.");
          schedule.active = body.active === true;
          schedule.updatedAt = new Date().toISOString();
          return { id: schedule.id, active: schedule.active };
        }

        if (action === "delete") {
          const id = String(body.id || "").trim();
          const index = state.preventiveSchedules.findIndex((item) => String(item.id) === id);
          if (index < 0) throw new Error("Preventive-maintenance schedule not found.");
          const [deleted] = state.preventiveSchedules.splice(index, 1);
          return { id: deleted.id, deleted: true, title: deleted.title };
        }

        throw new Error("Unknown preventive-maintenance action.");
      });
      return json({ ok: true, revision: outcome.revision, state: outcome.state, ...outcome.result });
    }

    if (method === "POST" && route === "preventive/send-weekly") {
      const auth = await requireUser(request, env, { admin: true });
      if (!auth.ok) return auth.response;
      const result = await sendWeeklyPreventiveDigest(env, {
        origin: new URL(request.url).origin,
        timestamp: Date.now(),
        force: true,
        actorEmail: auth.identity.email || "admin"
      });
      const current = await getState(env);
      return json({ ok: result.ok, result, revision: current.revision, state: current.state }, result.ok ? 200 : 400);
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
            state.partCatalog.push(normalizeCatalogPart({ id: `p-${slug(name)}-${Date.now()}`, name, partNo: String(p.partNo || "").trim(), active: true }));
          }
          if (p.supplier) ensureUniqueString(state.suppliers, p.supplier);
        }

        const original = String(body.originalJobNo || "");
        const idx = original ? state.jobs.findIndex((j) => j.jobNo === original) : -1;
        const oldJob = idx >= 0 ? state.jobs[idx] : null;
        const beforeStock = new Map((state.partCatalog || []).filter((part) => part.stockTracked).map((part) => [part.id, Number(part.currentStock) || 0]));
        const stockMovements = applyJobStockChanges(state, oldJob, job);
        if (idx >= 0) state.jobs[idx] = job;
        else state.jobs.push(job);
        for (const movement of stockMovements) pushStockTransaction(state, { partId: movement.part.id, type: movement.qty < 0 ? "job-use" : "job-return", qty: movement.qty, balanceAfter: movement.part.currentStock, jobNo: job.jobNo, note: movement.qty < 0 ? "Used on maintenance job" : "Returned after job edit" });
        return { jobNo: job.jobNo, lowStockAlerts: lowStockTransitions(beforeStock, state) };
      });
      const originalJobNo = String(body.originalJobNo || "").trim();
      if (originalJobNo && outcome.result?.jobNo && originalJobNo !== outcome.result.jobNo) {
        try { await moveJobAttachments(env, originalJobNo, outcome.result.jobNo); } catch (_) {}
      }
      const notification = await sendLowStockNotification(env, outcome.state, outcome.result?.lowStockAlerts || [], new URL(request.url).origin);
      return json({ ok: true, revision: outcome.revision, state: outcome.state, notification, ...outcome.result });
    }

    if (method === "POST" && route === "jobs/delete") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const jobNo = String(body.jobNo || "").trim();
      if (!jobNo) return json({ error: "Job number is required." }, 400);
      const outcome = await mutateState(env, auth.identity, "job.delete", async (state) => {
        const idx = state.jobs.findIndex((j) => j.jobNo === jobNo);
        if (idx < 0) throw new Error("Job not found.");
        const movements = restoreJobStock(state, state.jobs[idx]);
        const [deleted] = state.jobs.splice(idx, 1);
        for (const movement of movements) pushStockTransaction(state, { partId: movement.part.id, type: "job-return", qty: movement.qty, balanceAfter: movement.part.currentStock, jobNo: deleted.jobNo, note: "Stock returned because job was deleted" });
        return { jobNo: deleted.jobNo, deleted: true };
      });
      let deletedAttachments = 0;
      try { deletedAttachments = await deleteEntityAttachments(env, "job", jobNo); } catch (_) {}
      return json({ ok: true, revision: outcome.revision, state: outcome.state, deletedAttachments, ...outcome.result });
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


    if (method === "POST" && route === "stock/orders") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const action = String(body.action || "").toLowerCase();
      const outcome = await mutateState(env, auth.identity, `stock.order.${action}`, async (state) => {
        state.stockOrders = Array.isArray(state.stockOrders) ? state.stockOrders : [];
        state.stockTransactions = Array.isArray(state.stockTransactions) ? state.stockTransactions : [];
        if (action === "order") {
          const part = (state.partCatalog || []).find((p) => String(p.id) === String(body.partId || ""));
          if (!part) throw new Error("Part not found.");
          if (!part.stockTracked) throw new Error("Enable stock tracking before ordering this part.");
          const orderedQty = Number(body.qty);
          if (!Number.isFinite(orderedQty) || orderedQty <= 0) throw new Error("Order quantity must be greater than zero.");
          const supplier = String(body.supplier || part.preferredSupplier || "").trim();
          if (supplier) ensureUniqueString(state.suppliers, supplier);
          part.preferredSupplier = supplier || String(part.preferredSupplier || "");
          part.reorderQty = Math.max(1, Number(body.reorderQty || part.reorderQty || orderedQty) || 1);
          const order = {
            id: `ord-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
            partId: part.id,
            partName: part.name,
            partNo: part.partNo || "",
            supplier,
            orderedQty,
            receivedQty: 0,
            orderedAt: new Date().toISOString(),
            expectedDate: String(body.expectedDate || "").trim(),
            note: String(body.note || "").trim().slice(0, 300),
            status: "Ordered",
            orderedBy: auth.identity.email || ""
          };
          state.stockOrders.push(order);
          return { order };
        }
        const order = state.stockOrders.find((o) => String(o.id) === String(body.orderId || ""));
        if (!order) throw new Error("Stock order not found.");
        const part = (state.partCatalog || []).find((p) => String(p.id) === String(order.partId));
        if (!part) throw new Error("The ordered part no longer exists.");
        if (action === "receive") {
          if (["Received", "Cancelled"].includes(String(order.status))) throw new Error("This order is already closed.");
          const remaining = orderRemaining(order);
          const qty = body.qty === undefined || body.qty === "" ? remaining : Number(body.qty);
          if (!Number.isFinite(qty) || qty <= 0 || qty > remaining) throw new Error(`Receive between 0 and ${remaining} units.`);
          part.currentStock = (Number(part.currentStock) || 0) + qty;
          order.receivedQty = (Number(order.receivedQty) || 0) + qty;
          order.lastReceivedAt = new Date().toISOString();
          order.status = orderRemaining(order) <= 0 ? "Received" : "Part received";
          pushStockTransaction(state, { partId: part.id, type: "receipt", qty, balanceAfter: part.currentStock, orderId: order.id, supplier: order.supplier || "", note: "Stock order received", actor: auth.identity.email || "" });
          return { order, receivedQty: qty, currentStock: part.currentStock };
        }
        if (action === "cancel") {
          if (String(order.status) === "Received") throw new Error("A fully received order cannot be cancelled.");
          order.status = "Cancelled";
          order.cancelledAt = new Date().toISOString();
          order.cancelledBy = auth.identity.email || "";
          return { order };
        }
        throw new Error("Unknown stock order action.");
      });
      return json({ ok: true, revision: outcome.revision, state: outcome.state, ...outcome.result });
    }

    if (method === "POST" && route === "machines") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const machine = { ...(body.machine || {}) };
      machine.assetId = String(machine.assetId || "").trim();
      machine.assetNumber = String(machine.assetNumber || "").trim().slice(0, 100);
      machine.name = String(machine.name || "").trim();
      machine.section = String(machine.section || "").trim();
      machine.manufacturer = String(machine.manufacturer || machine.make || "").trim().slice(0, 160);
      machine.make = machine.manufacturer;
      if (!machine.assetId || !machine.name || !machine.section) return json({ error: "Machine number, machine name and section are required." }, 400);
      const outcome = await mutateState(env, auth.identity, "machine.create", async (state) => {
        if (state.machines.some((m) => String(m.assetId).toLowerCase() === machine.assetId.toLowerCase())) throw new Error("That machine number already exists.");
        if (machine.assetNumber && state.machines.some((m) => String(m.assetNumber || "").toLowerCase() === machine.assetNumber.toLowerCase())) throw new Error("That asset number already exists.");
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
          state.archivedSections = (state.archivedSections || []).filter((s) => s !== value);
          return { value };
        }
        if (type === "supplier") {
          const value = ensureUniqueString(state.suppliers, body.value);
          if (!value) throw new Error("Supplier name is required.");
          state.archivedSuppliers = (state.archivedSuppliers || []).filter((s) => s !== value);
          return { value };
        }
        if (type === "part") {
          const name = String(body.name || "").trim();
          if (!name) throw new Error("Part name is required.");
          let part = state.partCatalog.find((p) => String(p.name).toLowerCase() === name.toLowerCase());
          if (!part) {
            part = normalizeCatalogPart({ id: `p-${slug(name)}-${Date.now()}`, name, partNo: String(body.partNo || "").trim(), active: true });
            state.partCatalog.push(part);
          } else {
            part.active = true;
          }
          return { part };
        }
        throw new Error("Unknown catalog type.");
      });
      return json({ ok: true, revision: outcome.revision, state: outcome.state, ...outcome.result });
    }

    if (route === "master-data" && method === "POST") {
      const auth = await requireUser(request, env, { human: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const entity = String(body.entity || "");
      const action = String(body.action || "");
      const outcome = await mutateState(env, auth.identity, `master.${entity}.${action}`, async (state) => {
        state.archivedSections = Array.isArray(state.archivedSections) ? state.archivedSections : [];
        state.archivedSuppliers = Array.isArray(state.archivedSuppliers) ? state.archivedSuppliers : [];

        if (entity === "machine") {
          const machine = state.machines.find((m) => m.id === body.id);
          if (!machine) throw new Error("Machine not found.");
          if (action === "update") {
            const oldName = machine.name;
            const oldSection = machine.section;
            const next = { ...(body.machine || {}) };
            const assetId = String(next.assetId || "").trim();
            const assetNumber = String(next.assetNumber || "").trim().slice(0, 100);
            const name = String(next.name || "").trim();
            const section = String(next.section || "").trim();
            const manufacturer = String(next.manufacturer || next.make || "").trim().slice(0, 160);
            if (!assetId || !name || !section) throw new Error("Machine number, machine name and section are required.");
            if (state.machines.some((m) => m.id !== machine.id && String(m.assetId).toLowerCase() === assetId.toLowerCase())) throw new Error("That machine number already exists.");
            if (assetNumber && state.machines.some((m) => m.id !== machine.id && String(m.assetNumber || "").toLowerCase() === assetNumber.toLowerCase())) throw new Error("That asset number already exists.");
            ensureUniqueString(state.sections, section);
            Object.assign(machine, {
              assetId,
              assetNumber,
              name,
              section,
              category: String(next.category || section).trim() || section,
              location: String(next.location || "").trim(),
              manufacturer,
              make: manufacturer,
              model: String(next.model || "").trim(),
              serialNumber: String(next.serialNumber || "").trim(),
              purchaseDate: String(next.purchaseDate || "").trim(),
              installDate: String(next.installDate || "").trim(),
              purchaseCost: next.purchaseCost === "" || next.purchaseCost == null ? null : Math.max(0, Number(next.purchaseCost) || 0),
              notes: String(next.notes || "").trim()
            });
            for (const job of state.jobs) {
              const linkedById = String(job.machineId || "") === String(machine.id);
              const legacyLinked = !job.machineId && job.machine === oldName && (!job.section || job.section === oldSection);
              if (linkedById || legacyLinked) {
                job.machineId = machine.id;
                job.machine = name;
                job.section = section;
              }
            }
            return { id: machine.id, name: machine.name };
          }
          if (action === "archive") { machine.status = "Archived"; return { id: machine.id, status: machine.status }; }
          if (action === "reactivate") { machine.status = "Active"; return { id: machine.id, status: machine.status }; }
          if (action === "delete") {
            if (state.jobs.some((j) => String(j.machineId || "") === String(machine.id) || (!j.machineId && j.machine === machine.name && (!j.section || j.section === machine.section)))) throw new Error("This machine has job history, so it cannot be permanently deleted. Archive it instead.");
            state.machines = state.machines.filter((m) => m.id !== machine.id);
            return { id: machine.id, deleted: true };
          }
        }

        if (entity === "section") {
          const oldName = String(body.key || "").trim();
          if (!state.sections.includes(oldName)) throw new Error("Section not found.");
          if (action === "update") {
            const name = String(body.name || "").trim();
            if (!name) throw new Error("Section name is required.");
            if (state.sections.some((s) => s !== oldName && s.toLowerCase() === name.toLowerCase())) throw new Error("That section already exists.");
            state.sections = state.sections.map((s) => s === oldName ? name : s).sort((a,b)=>a.localeCompare(b));
            state.archivedSections = state.archivedSections.map((s) => s === oldName ? name : s);
            for (const machine of state.machines) if (machine.section === oldName) machine.section = name;
            for (const job of state.jobs) if (job.section === oldName) job.section = name;
            return { oldName, name };
          }
          if (action === "archive") {
            if (!state.archivedSections.includes(oldName)) state.archivedSections.push(oldName);
            return { name: oldName, archived: true };
          }
          if (action === "reactivate") {
            state.archivedSections = state.archivedSections.filter((s) => s !== oldName);
            return { name: oldName, archived: false };
          }
          if (action === "delete") {
            if (state.machines.some((m) => m.section === oldName) || state.jobs.some((j) => j.section === oldName)) throw new Error("This section is already used by machines or jobs, so it cannot be permanently deleted. Archive it instead.");
            state.sections = state.sections.filter((s) => s !== oldName);
            state.archivedSections = state.archivedSections.filter((s) => s !== oldName);
            return { name: oldName, deleted: true };
          }
        }

        if (entity === "supplier") {
          const oldName = String(body.key || "").trim();
          if (!state.suppliers.includes(oldName)) throw new Error("Supplier not found.");
          if (action === "update") {
            const name = String(body.name || "").trim();
            if (!name) throw new Error("Supplier name is required.");
            if (state.suppliers.some((s) => s !== oldName && s.toLowerCase() === name.toLowerCase())) throw new Error("That supplier already exists.");
            state.suppliers = state.suppliers.map((s) => s === oldName ? name : s).sort((a,b)=>a.localeCompare(b));
            state.archivedSuppliers = state.archivedSuppliers.map((s) => s === oldName ? name : s);
            for (const job of state.jobs) for (const part of (job.parts || [])) if (part.supplier === oldName) part.supplier = name;
            return { oldName, name };
          }
          if (action === "archive") {
            if (!state.archivedSuppliers.includes(oldName)) state.archivedSuppliers.push(oldName);
            return { name: oldName, archived: true };
          }
          if (action === "reactivate") {
            state.archivedSuppliers = state.archivedSuppliers.filter((s) => s !== oldName);
            return { name: oldName, archived: false };
          }
          if (action === "delete") {
            const used = state.jobs.some((j) => (j.parts || []).some((p) => p.supplier === oldName));
            if (used) throw new Error("This supplier appears in historical parts records, so it cannot be permanently deleted. Archive it instead.");
            state.suppliers = state.suppliers.filter((s) => s !== oldName);
            state.archivedSuppliers = state.archivedSuppliers.filter((s) => s !== oldName);
            return { name: oldName, deleted: true };
          }
        }

        if (entity === "part") {
          const part = state.partCatalog.find((p) => p.id === body.id);
          if (!part) throw new Error("Part not found.");
          if (action === "update") {
            const oldName = part.name;
            const oldPartNo = part.partNo || "";
            const name = String(body.name || "").trim();
            const partNo = String(body.partNo || "").trim();
            if (!name) throw new Error("Part name is required.");
            if (state.partCatalog.some((p) => p.id !== part.id && String(p.name).toLowerCase() === name.toLowerCase())) throw new Error("That part name already exists.");
            const wasTracked = part.stockTracked === true;
            const previousStock = Number(part.currentStock) || 0;
            const stockTracked = body.stockTracked === undefined ? wasTracked : Boolean(body.stockTracked);
            const currentStock = body.currentStock === undefined ? previousStock : Number(body.currentStock);
            const minStock = body.minStock === undefined ? (Number(part.minStock) || 0) : Number(body.minStock);
            if (!Number.isFinite(currentStock)) throw new Error("Current stock must be a number.");
            if (!Number.isFinite(minStock) || minStock < 0) throw new Error("Minimum stock must be zero or more.");
            part.name = name;
            part.partNo = partNo;
            part.stockTracked = stockTracked;
            part.currentStock = currentStock;
            part.minStock = Math.max(0, minStock);
            part.binLocation = body.binLocation === undefined ? String(part.binLocation || "").trim() : String(body.binLocation || "").trim();
            part.preferredSupplier = body.preferredSupplier === undefined ? String(part.preferredSupplier || "").trim() : String(body.preferredSupplier || "").trim();
            part.reorderQty = body.reorderQty === undefined ? Math.max(1, Number(part.reorderQty) || 1) : Math.max(1, Number(body.reorderQty) || 1);
            if (part.preferredSupplier) ensureUniqueString(state.suppliers, part.preferredSupplier);
            if (!wasTracked && stockTracked) resetHistoricalStockBaseline(state, part);
            if (wasTracked && stockTracked && currentStock !== previousStock) pushStockTransaction(state, { partId: part.id, type: "adjustment", qty: currentStock - previousStock, balanceAfter: currentStock, note: "Manual stock count adjustment" });
            for (const job of state.jobs) {
              for (const used of (job.parts || [])) {
                if (used.name === oldName) {
                  used.name = name;
                  used.partNo = partNo;
                }
              }
            }
            return { id: part.id, name };
          }
          if (action === "archive") { part.active = false; return { id: part.id, active: false }; }
          if (action === "reactivate") { part.active = true; return { id: part.id, active: true }; }
          if (action === "delete") {
            const used = state.jobs.some((j) => (j.parts || []).some((p) => p.name === part.name));
            if (used) throw new Error("This part appears in historical jobs, so it cannot be permanently deleted. Archive it instead.");
            state.partCatalog = state.partCatalog.filter((p) => p.id !== part.id);
            return { id: part.id, deleted: true };
          }
        }

        throw new Error("Unknown master-data action.");
      });
      let deletedAttachments = 0;
      if (entity === "machine" && action === "delete" && outcome.result?.id) {
        try { deletedAttachments = await deleteEntityAttachments(env, "machine", outcome.result.id); } catch (_) {}
      }
      return json({ ok: true, revision: outcome.revision, state: outcome.state, deletedAttachments, ...outcome.result });
    }

    if (route === "admin/profiles" && method === "GET") {
      const auth = await requireUser(request, env, { admin: true });
      if (!auth.ok) return auth.response;
      const current = await getState(env);
      return json({
        profiles: current.state.profiles,
        jobs: current.state.jobs,
        settings: current.state.settings,
        revision: current.revision,
        identity: { email: auth.identity.email, loginMethod: auth.identity.idpType },
        accessSyncConfigured: Boolean(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_ACCESS_POLICY_ID && String(env.ADMIN_EMAILS||"").trim()),
        emailBindingConfigured: Boolean(env.EMAIL && typeof env.EMAIL.send === "function")
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
        if (action === "delete") {
          const p = state.profiles.find((x) => x.id === body.id);
          if (!p) throw new Error("Profile not found.");
          const assignedJobs = state.jobs.filter((job) => job.assigned === p.name).length;
          const preventiveSchedules = (state.preventiveSchedules || []).filter((schedule) => (schedule.assignedProfileIds || []).includes(String(p.id))).length;
          if (assignedJobs || preventiveSchedules) {
            const reasons = [];
            if (assignedJobs) reasons.push(`${assignedJobs} maintenance job${assignedJobs === 1 ? "" : "s"}`);
            if (preventiveSchedules) reasons.push(`${preventiveSchedules} preventive schedule${preventiveSchedules === 1 ? "" : "s"}`);
            throw new Error(`This profile is still linked to ${reasons.join(" and ")}, so it cannot be permanently deleted. Deactivate it instead.`);
          }
          state.profiles = state.profiles.filter((x) => x.id !== p.id);
          return { id: p.id, deleted: true };
        }
        throw new Error("Unknown profile action.");
      });
      const accessSync = await syncAccessPolicy(env, outcome.state);
      return json({ ok: true, profiles: outcome.state.profiles, jobs: outcome.state.jobs, revision: outcome.revision, accessSync });
    }

    if (route === "admin/settings" && method === "POST") {
      const auth = await requireUser(request, env, { admin: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const outcome = await mutateState(env, auth.identity, "settings.update", async (state) => {
        const next = normalizeSettings(body.settings || {});
        state.settings = next;
        return { settings: next };
      });
      return json({ ok: true, revision: outcome.revision, settings: outcome.state.settings, state: outcome.state });
    }

    if (route === "admin/test-email" && method === "POST") {
      const auth = await requireUser(request, env, { admin: true });
      if (!auth.ok) return auth.response;
      const body = await bodyJson(request);
      const current = await getState(env);
      const testState = { ...current.state, settings: body.settings ? normalizeSettings(body.settings) : current.state.settings };
      const recipients = notificationTeamRecipients(testState);
      const settings = normalizeSettings(testState.settings);
      const link = `${new URL(request.url).origin}/?view=requests`;
      const emailTest = await sendMaintenanceEmail(env, testState, {
        to: recipients,
        subject: `${settings.siteName || "Maintenance Manager"} email test`,
        text: `This is a test notification from ${settings.siteName || "Maintenance Manager"}.

If you received this, Cloudflare Email Service and the selected notification recipient are configured correctly.

Open Maintenance Manager: ${link}`,
        html: `<h2>Email notifications are working</h2><p>This is a test notification from <strong>${emailHtmlEscape(settings.siteName || "Maintenance Manager")}</strong>.</p><p>If you received this, Cloudflare Email Service and this notification recipient are configured correctly.</p><p><a href="${emailHtmlEscape(link)}">Open Maintenance Manager</a></p>`
      });
      return json({ ok: emailTest.ok, emailTest, ...(emailTest.ok ? {} : { error: emailTest.message }) }, emailTest.ok ? 200 : 400);
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

async function fetchStaticAsset(env, request, pathname) {
  if (!env.ASSETS) {
    return new Response("Static asset binding ASSETS is missing.", { status: 500 });
  }
  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname;
  assetUrl.search = "";
  return withVersion(await env.ASSETS.fetch(new Request(assetUrl.toString(), {
    method: "GET",
    headers: { accept: request.headers.get("accept") || "*/*" }
  })));
}

export default {
  async scheduled(controller, env) {
    try {
      await sendWeeklyPreventiveDigest(env, {
        timestamp: Number(controller?.scheduledTime) || Date.now(),
        origin: env.APP_URL || "https://maintenance.project-sly.uk",
        force: false,
        actorEmail: "scheduled@maintenance.invalid"
      });
    } catch (error) {
      console.error("Preventive-maintenance weekly email failed", error);
      throw error;
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // Public operator request endpoint. Cloudflare Access should have a narrowly scoped
    // Bypass application for the exact /request path. All page assets and form API calls
    // stay on this path via query strings, so the rest of the maintenance site remains protected.
    if (url.pathname === "/request/") {
      const target = new URL("/request", url);
      return Response.redirect(target.toString(), 302);
    }
    if (url.pathname === "/request") {
      const asset = url.searchParams.get("asset");
      if (request.method === "GET" && asset === "css") return fetchStaticAsset(env, request, "/styles.css");
      if (request.method === "GET" && asset === "js") return fetchStaticAsset(env, request, "/request.js");
      if (url.searchParams.get("api")) return withVersion(await handlePublicRequest(request, env));
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Operator request route not found." }, 404);
      return fetchStaticAsset(env, request, "/request.html");
    }

    // Canonical Admin entry point. Keeping the HTML, CSS, JavaScript and Admin API on
    // the exact /admin path avoids mixed Cloudflare Access sessions when a normal
    // engineer is already signed in and then switches to the stricter Admin app.
    if (url.pathname === "/admin.html" || url.pathname === "/admin/") {
      const target = new URL("/admin", url);
      return Response.redirect(target.toString(), 302);
    }

    if (url.pathname === "/admin") {
      const asset = url.searchParams.get("asset");
      if (request.method === "GET" && asset === "css") return fetchStaticAsset(env, request, "/styles.css");
      if (request.method === "GET" && asset === "js") return fetchStaticAsset(env, request, "/admin.js");

      const adminApi = url.searchParams.get("api");
      if (adminApi === "profiles") return withVersion(await handleApi(request, env, "admin/profiles"));
      if (adminApi === "settings") return withVersion(await handleApi(request, env, "admin/settings"));
      if (adminApi === "test-email") return withVersion(await handleApi(request, env, "admin/test-email"));
      if (adminApi === "sync-access") return withVersion(await handleApi(request, env, "admin/sync-access"));

      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "Admin route not found." }, 404);
      }
      return fetchStaticAsset(env, request, "/admin.html");
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return withVersion(await handleApi(request, env));
    }

    // If an approved admin deliberately chooses the Cloudflare identity provider on the
    // main Access login screen, send them straight to the canonical Admin path.
    // An explicit ?view=... link is an escape hatch so notification links can open the normal maintenance UI.
    if ((url.pathname === "/" || url.pathname === "/index.html") && !url.searchParams.get("view")) {
      try {
        const identity = await getIdentity(request, env);
        if (isAdmin(identity, env)) {
          const target = new URL("/admin", url);
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
