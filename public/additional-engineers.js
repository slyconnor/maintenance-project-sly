(() => {
  const FIELD_ID = "jobAdditionalEngineersField";
  const LIST_ID = "jobAdditionalEngineersList";

  function normaliseNames(value) {
    const rows = Array.isArray(value) ? value : (typeof value === "string" ? value.split(",") : []);
    return [...new Set(rows.map(name => String(name || "").trim()).filter(Boolean))];
  }

  function selectedAdditionalEngineers() {
    const list = document.getElementById(LIST_ID);
    if (!list) return [];
    return [...list.querySelectorAll('input[type="checkbox"]:checked')]
      .map(input => String(input.value || "").trim())
      .filter(Boolean);
  }

  function ensureField() {
    const form = document.getElementById("jobForm");
    if (!form) return null;
    let field = document.getElementById(FIELD_ID);
    if (field) return field;

    field = document.createElement("label");
    field.id = FIELD_ID;
    field.className = "span-2 additional-engineers-field";
    field.innerHTML = `
      <span>Additional engineers (optional)</span>
      <div id="${LIST_ID}" class="additional-engineers-list"></div>
      <small class="field-help">Select any other engineers who are helping with this job.</small>
    `;

    const assignedLabel = document.getElementById("jobAssignedSelect")?.closest("label");
    if (assignedLabel?.parentElement) assignedLabel.parentElement.insertBefore(field, assignedLabel.nextSibling);
    else form.querySelector(".form-grid")?.appendChild(field);
    return field;
  }

  function renderAdditionalEngineers(selected = null) {
    ensureField();
    const list = document.getElementById(LIST_ID);
    if (!list) return;

    const keep = normaliseNames(selected === null ? selectedAdditionalEngineers() : selected);
    const primary = String(document.getElementById("jobAssignedSelect")?.value || "").trim();
    const active = typeof activeProfiles === "function" ? activeProfiles() : [];
    const allProfiles = typeof profiles !== "undefined" && Array.isArray(profiles) ? profiles : active;
    const rows = [...active];

    for (const name of keep) {
      const existing = allProfiles.find(profile => String(profile?.name || "") === name);
      if (existing && !rows.some(profile => String(profile?.name || "") === name)) rows.push(existing);
    }

    const byName = new Map();
    for (const profile of rows) {
      const name = String(profile?.name || "").trim();
      if (!name || name === primary || byName.has(name)) continue;
      byName.set(name, profile);
    }

    if (!byName.size) {
      list.innerHTML = `<span class="additional-engineers-empty">No other active engineers available.</span>`;
      return;
    }

    list.innerHTML = [...byName.entries()].map(([name, profile]) => `
      <label class="additional-engineer-option">
        <input type="checkbox" value="${esc(name)}" ${keep.includes(name) ? "checked" : ""} />
        <span>${esc(name)}${profile?.active === false ? " (inactive)" : ""}</span>
      </label>
    `).join("");
  }

  function currentJobAdditionalEngineers() {
    if (typeof editingJobNo === "undefined" || !editingJobNo || typeof jobs === "undefined") return [];
    const job = jobs.find(row => String(row?.jobNo || "") === String(editingJobNo));
    return normaliseNames(job?.additionalEngineers);
  }

  function refreshForOpenJob() {
    renderAdditionalEngineers(currentJobAdditionalEngineers());
  }

  ensureField();
  renderAdditionalEngineers([]);

  const assigned = document.getElementById("jobAssignedSelect");
  assigned?.addEventListener("change", () => renderAdditionalEngineers(null));

  const dialog = document.getElementById("jobDialog");
  if (dialog) {
    new MutationObserver(() => {
      if (dialog.hasAttribute("open")) queueMicrotask(refreshForOpenJob);
    }).observe(dialog, { attributes: true, attributeFilter: ["open"] });
  }

  if (typeof saveMutation === "function") {
    const originalSaveMutation = saveMutation;
    saveMutation = async function(path, body, options = {}) {
      if (path === "/api/jobs" && body?.job) {
        const primary = String(body.job.assigned || "").trim();
        const extras = selectedAdditionalEngineers().filter(name => name !== primary);
        body = { ...body, job: { ...body.job, additionalEngineers: extras } };
      }
      return originalSaveMutation(path, body, options);
    };
  }

  const style = document.createElement("style");
  style.textContent = `
    .additional-engineers-field{align-self:start}
    .additional-engineers-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:7px;padding:10px;border:1px solid #d7dde7;border-radius:10px;background:#f8fafc}
    .additional-engineer-option{display:inline-flex!important;align-items:center;gap:6px;width:auto!important;margin:0!important;padding:6px 9px;border:1px solid #d7dde7;border-radius:999px;background:#fff;cursor:pointer;font-weight:600}
    .additional-engineer-option input{width:auto!important;margin:0}
    .additional-engineers-empty{font-size:.88rem;color:#667085}
  `;
  document.head.appendChild(style);
})();
