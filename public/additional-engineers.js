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

    field = document.createElement("div");
    field.id = FIELD_ID;
    field.className = "span-2 additional-engineers-field";
    field.innerHTML = `
      <span class="additional-engineers-title">Additional engineers (optional)</span>
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
    .additional-engineers-title{display:block;font-weight:600}
    .additional-engineers-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:7px;padding:10px;border:1px solid #d7dde7;border-radius:10px;background:#f8fafc}
    .additional-engineer-option{display:inline-flex!important;align-items:center;gap:6px;width:auto!important;margin:0!important;padding:6px 9px;border:1px solid #d7dde7;border-radius:999px;background:#fff;cursor:pointer;font-weight:600}
    .additional-engineer-option input{width:auto!important;margin:0}
    .additional-engineers-empty{font-size:.88rem;color:#667085}
  `;
  document.head.appendChild(style);
})();

// Keep the purchase requisition part code beside the part name in the PDF description.
if (typeof purchaseRequisitionDescription === "function") {
  purchaseRequisitionDescription = function(line) {
    const name = String(line?.partName || "").trim();
    const code = String(line?.partCode || "").trim();
    return code ? `${name}. Part code: ${code}` : name;
  };
}

// Dashboard job lists: newest raised jobs first.
function newestJobFirst(a, b) {
  const byRaised = String(b?.raised || "").localeCompare(String(a?.raised || ""));
  if (byRaised) return byRaised;
  return String(b?.jobNo || "").localeCompare(String(a?.jobNo || ""), undefined, { numeric: true, sensitivity: "base" });
}

if (typeof renderMonthTable === "function") {
  renderMonthTable = function() {
    let rows = selectedDashboardJobs().slice().sort(newestJobFirst);
    const sf = $("#statusFilter").value, pf = $("#priorityFilter").value, q = $("#jobSearch").value.trim().toLowerCase();
    if (sf !== "all") rows = rows.filter(j => j.status === sf);
    if (pf !== "all") rows = rows.filter(j => j.priority === pf);
    if (q) rows = rows.filter(j => [j.jobNo,j.title,j.machine,j.section,j.assigned].join(" ").toLowerCase().includes(q));
    $("#jobsTableTitle").textContent = dashboardPeriod === "all" ? "All Jobs" : dashboardPeriod === "year" ? `${selectedYear} Jobs` : `${FULL_MONTHS[selectedMonth]} Jobs`;
    $("#monthJobsBody").innerHTML = rows.length ? rows.map(j => jobRow(j,true,true,true)).join("") : `<tr><td colspan="12">No jobs match these filters.</td></tr>`;
    bindPins();
    bindJobEditors();
  };
}

if (typeof renderDashboard === "function") {
  const originalRenderDashboard = renderDashboard;
  renderDashboard = function(...args) {
    const result = originalRenderDashboard.apply(this, args);
    const body = $("#pinnedJobsBody");
    if (body && typeof jobs !== "undefined") {
      const rows = [...body.querySelectorAll("tr")];
      if (rows.length > 1) {
        const jobForRow = row => {
          const jobNo = String(row.querySelector("td strong")?.textContent || "").replace("📌", "").trim();
          return jobs.find(job => String(job?.jobNo || "") === jobNo) || null;
        };
        rows.sort((a,b) => {
          const jobA = jobForRow(a), jobB = jobForRow(b);
          if (!jobA || !jobB) return 0;
          return newestJobFirst(jobA, jobB);
        });
        rows.forEach(row => body.appendChild(row));
      }
    }
    return result;
  };
}

// Show the formatted total in the middle of every shared pie chart.
if (typeof renderPie === "function") {
  renderPie = function(el, legendEl, rows, format) {
    if (!el || !legendEl) return;
    const colors = ["#2f7eea","#36ae68","#f2a01f","#7959d7","#e05b53","#5aa6a6"];
    const total = (rows || []).reduce((sum, row) => sum + (Number(row?.value) || 0), 0);
    let acc = 0;
    const stops = [];
    (rows || []).forEach((row, index) => {
      const value = Number(row?.value) || 0;
      const start = total ? acc / total * 100 : 0;
      acc += value;
      const end = total ? acc / total * 100 : 0;
      stops.push(`${colors[index % colors.length]} ${start}% ${end}%`);
    });
    el.style.background = rows?.length ? `conic-gradient(${stops.join(",")})` : "#e7ebf1";
    el.style.position = "relative";
    el.innerHTML = `<div class="pie-total-center"><span>Total</span><strong>${esc(format(total))}</strong></div>`;
    legendEl.innerHTML = rows?.length ? rows.map((row,index)=>`<div class="legend-row"><span class="swatch" style="background:${colors[index%colors.length]}"></span><span>${esc(row.name)}</span><strong>${format(row.value)}</strong></div>`).join("") : `<span class="empty-note">No data for this period.</span>`;
  };

  const pieTotalStyle = document.createElement("style");
  pieTotalStyle.id = "pieTotalStyles";
  pieTotalStyle.textContent = `
    .pie:after{z-index:1}
    .pie-total-center{position:absolute;top:50%;left:50%;width:52%;aspect-ratio:1;transform:translate(-50%,-50%);z-index:2;border-radius:50%;background:var(--panel,var(--card,#fff));display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-shadow:0 0 0 1px rgba(15,23,42,.04);pointer-events:none;padding:6px;box-sizing:border-box}
    .pie-total-center span{font-size:.72rem;line-height:1;color:#667085;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    .pie-total-center strong{display:block;margin-top:4px;font-size:clamp(.78rem,1.6vw,1.15rem);line-height:1.15;color:#182230;max-width:100%;overflow-wrap:anywhere}
  `;
  document.head.appendChild(pieTotalStyle);
}
