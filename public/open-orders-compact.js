(() => {
  if (typeof renderPurchaseOrders !== "function") return;

  const expandedOpenOrders = new Set();

  function openOrderIdFromCard(card) {
    return card?.querySelector("[data-po-edit]")?.dataset.poEdit
      || card?.querySelector("[data-po-place]")?.dataset.poPlace
      || card?.querySelector("[data-po-download]")?.dataset.poDownload
      || "";
  }

  function openOrderTitle(order) {
    const orderNo = String(order?.orderNo || "Open order").trim();
    const supplier = String(order?.supplier || "No supplier").trim();
    return `${orderNo} ${supplier}`;
  }

  function compactSavedOpenOrders() {
    const list = document.getElementById("poOpenList");
    if (!list || typeof purchaseOrders === "undefined") return;

    list.querySelectorAll(".po-list-card").forEach(card => {
      if (card.dataset.openOrderCompact === "1") return;
      const orderId = openOrderIdFromCard(card);
      const order = purchaseOrders.find(row => String(row?.id || "") === String(orderId));
      if (!order) return;

      card.dataset.openOrderCompact = "1";
      card.dataset.openOrderId = String(orderId);
      card.classList.add("po-open-compact");

      const details = document.createElement("div");
      details.className = "po-open-details";
      while (card.firstChild) details.appendChild(card.firstChild);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "po-open-toggle";
      toggle.dataset.poOpenToggle = String(orderId);
      toggle.innerHTML = `<span class="po-open-toggle-title">${esc(openOrderTitle(order))}</span><span class="po-open-chevron" aria-hidden="true">⌄</span>`;

      const expanded = expandedOpenOrders.has(String(orderId));
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      details.hidden = !expanded;
      card.classList.toggle("is-expanded", expanded);

      const existingHeading = details.querySelector(".po-list-head h3");
      if (existingHeading) existingHeading.hidden = true;
      const place = details.querySelector("[data-po-place]");
      if (place) {
        place.disabled = false;
        place.removeAttribute("title");
      }

      card.append(toggle, details);
    });
  }

  function bindOpenOrderInteractions() {
    const list = document.getElementById("poOpenList");
    if (!list || list.dataset.compactOpenOrdersBound === "1") return;
    list.dataset.compactOpenOrdersBound = "1";

    list.addEventListener("click", async event => {
      const toggle = event.target.closest("[data-po-open-toggle]");
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        const orderId = String(toggle.dataset.poOpenToggle || "");
        const card = toggle.closest(".po-open-compact");
        const details = card?.querySelector(".po-open-details");
        if (!card || !details) return;
        const nextExpanded = details.hidden;
        details.hidden = !nextExpanded;
        card.classList.toggle("is-expanded", nextExpanded);
        toggle.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
        if (nextExpanded) expandedOpenOrders.add(orderId);
        else expandedOpenOrders.delete(orderId);
        return;
      }

      const place = event.target.closest("[data-po-place]");
      if (!place) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const orderId = String(place.dataset.poPlace || "");
      if (!orderId) return;
      const oldText = place.textContent;
      place.disabled = true;
      place.textContent = "Placing…";
      try {
        await saveMutation("/api/purchase-orders", { action: "place", orderId });
        expandedOpenOrders.delete(orderId);
        renderPurchaseOrders();
        if (typeof renderProjects === "function") renderProjects();
      } catch (error) {
        if (typeof showSaveError === "function") showSaveError(error);
        else alert(error?.message || "Could not place order.");
        place.disabled = false;
        place.textContent = oldText;
      }
    }, true);
  }

  const previousRenderPurchaseOrders = renderPurchaseOrders;
  renderPurchaseOrders = function(...args) {
    const result = previousRenderPurchaseOrders.apply(this, args);
    bindOpenOrderInteractions();
    compactSavedOpenOrders();
    return result;
  };

  const style = document.createElement("style");
  style.id = "compactOpenOrderStyles";
  style.textContent = `
    #poOpenList .po-open-compact{padding:0;overflow:hidden}
    #poOpenList .po-open-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;border:0;background:#fff;color:var(--ink);padding:14px 16px;text-align:left;cursor:pointer;font:inherit}
    #poOpenList .po-open-toggle:hover{background:#f8fafc}
    #poOpenList .po-open-toggle-title{font-weight:800;font-size:14px}
    #poOpenList .po-open-chevron{font-size:20px;line-height:1;transition:transform .15s ease;color:var(--muted)}
    #poOpenList .po-open-compact.is-expanded .po-open-chevron{transform:rotate(180deg)}
    #poOpenList .po-open-details{padding:0 16px 16px;border-top:1px solid var(--border)}
    #poOpenList .po-open-details[hidden]{display:none!important}
    #poOpenList .po-open-details>.po-list-head{padding-top:14px}
    #poOpenList .po-open-details>.po-list-head h3[hidden]{display:none!important}
  `;
  document.head.appendChild(style);

  bindOpenOrderInteractions();
  compactSavedOpenOrders();
})();
