import baseWorker from "./index.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function cookieValue(cookieHeader, name) {
  for (const part of String(cookieHeader || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return "";
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(base64));
  } catch (_) {
    return null;
  }
}

function signedInEmail(request) {
  const headerEmail = String(request.headers.get("cf-access-authenticated-user-email") || "").trim().toLowerCase();
  if (headerEmail) return headerEmail;
  const assertion = request.headers.get("cf-access-jwt-assertion") || "";
  const cookie = cookieValue(request.headers.get("cookie") || "", "CF_Authorization");
  const payload = decodeJwtPayload(assertion || cookie);
  return String(payload?.email || "").trim().toLowerCase();
}

async function placeSavedPurchaseOrder(request, env, body) {
  const email = signedInEmail(request);
  if (!email) return json({ error: "A signed-in engineer is required for this action." }, 403);

  const orderId = String(body.orderId || "").trim();
  if (!orderId) return json({ error: "Order not found." }, 400);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const row = await env.DB.prepare("SELECT revision, state_json FROM app_state WHERE id = 1").first();
    if (!row?.state_json) return baseWorker.fetch(request, env);

    let state;
    try { state = JSON.parse(row.state_json); }
    catch { return baseWorker.fetch(request, env); }

    const orders = Array.isArray(state.purchaseOrders) ? state.purchaseOrders : [];
    const order = orders.find(item => String(item?.id || "") === orderId);
    if (!order) return json({ error: "Order not found." }, 400);
    if (String(order.status || "") === "Ordered") return json({ error: "This order has already been placed." }, 400);

    const stamp = new Date().toISOString();
    order.status = "Ordered";
    order.orderedAt = stamp;
    order.orderedBy = email;
    order.updatedAt = stamp;

    const revision = Number(row.revision) || 1;
    const update = await env.DB.prepare(
      "UPDATE app_state SET state_json = ?, revision = revision + 1, updated_at = datetime('now'), updated_by = ? WHERE id = 1 AND revision = ?"
    ).bind(JSON.stringify(state), email, revision).run();

    if ((update.meta?.changes || 0) === 1) {
      return json({ ok: true, revision: revision + 1, state, order });
    }
  }

  return json({ error: "The maintenance data changed while placing the order. Please try again." }, 409);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/purchase-orders") {
      let body = null;
      try { body = await request.clone().json(); } catch (_) {}
      if (String(body?.action || "").toLowerCase() === "place" && String(body?.orderId || "").trim()) {
        return placeSavedPurchaseOrder(request, env, body);
      }
    }
    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === "function") return baseWorker.scheduled(controller, env, ctx);
  }
};
