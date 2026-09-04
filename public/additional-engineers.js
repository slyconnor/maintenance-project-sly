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

// Dashboard pie charts can be grouped independently by machine category, machine name, or section.
if (typeof renderDashboard === "function" && typeof renderPie === "function") {
  const DASHBOARD_PIE_GROUPS = new Set(["category", "machine", "section"]);
  const dashboardPieLabels = { category: "machine category", machine: "machine name", section: "section" };
  const dashboardPieOptions = `
    <option value="category">Machine category</option>
    <option value="machine">Machine name</option>
    <option value="section">Section</option>
  `;

  const savedPieGroup = key => {
    const value = localStorage.getItem(key);
    return DASHBOARD_PIE_GROUPS.has(value) ? value : "category";
  };

  let hoursPieGroup = savedPieGroup("dashboardHoursPieGroup");
  let spendPieGroup = savedPieGroup("dashboardSpendPieGroup");

  function dashboardPieName(job, group) {
    const machine = typeof machineForJob === "function" ? machineForJob(job) : null;
    if (group === "machine") {
      if (machine) return `${machine.assetId ? `${machine.assetId} · ` : ""}${machine.name || job?.machine || "Unnamed machine"}`;
      return job?.machine || "General work";
    }
    if (group === "section") return job?.section || machine?.section || "Other";
    return typeof jobMachineCategory === "function" ? jobMachineCategory(job) : (machine?.category || (job?.machine ? "Other" : "General work"));
  }

  function dashboardPieRows(group, valueForJob) {
    const grouped = new Map();
    const source = typeof visibleJobs === "function" ? visibleJobs() : (Array.isArray(jobs) ? jobs : []);
    for (const job of source) {
      const value = Number(valueForJob(job)) || 0;
      if (!value) continue;
      const name = dashboardPieName(job, group);
      grouped.set(name, (grouped.get(name) || 0) + value);
    }
    return [...grouped.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name)));
  }

  function ensureDashboardPieSelector(pieId, selectId, storageKey, getGroup, setGroup) {
    const pie = document.getElementById(pieId);
    const panel = pie?.closest(".chart-panel");
    const heading = panel?.querySelector("h2");
    if (!panel || !heading) return;

    let head = panel.querySelector(".dashboard-pie-head");
    if (!head) {
      head = document.createElement("div");
      head.className = "dashboard-pie-head";
      heading.parentElement.insertBefore(head, heading);
      head.appendChild(heading);
    }

    let select = document.getElementById(selectId);
    if (!select) {
      const label = document.createElement("label");
      label.className = "dashboard-pie-picker";
      label.innerHTML = `<span>View by</span><select id="${selectId}" aria-label="Choose pie chart breakdown">${dashboardPieOptions}</select>`;
      head.appendChild(label);
      select = label.querySelector("select");
      select.addEventListener("change", event => {
        const next = String(event.target.value || "");
        if (!DASHBOARD_PIE_GROUPS.has(next)) return;
        setGroup(next);
        localStorage.setItem(storageKey, next);
        renderDashboardPieBreakdowns();
      });
    }
    select.value = getGroup();
  }

  function ensureDashboardPieSelectors() {
    ensureDashboardPieSelector("hoursPie", "hoursPieGroupSelect", "dashboardHoursPieGroup", () => hoursPieGroup, value => { hoursPieGroup = value; });
    ensureDashboardPieSelector("spendPie", "spendPieGroupSelect", "dashboardSpendPieGroup", () => spendPieGroup, value => { spendPieGroup = value; });
  }

  function renderDashboardPieBreakdowns() {
    ensureDashboardPieSelectors();
    const hoursPie = document.getElementById("hoursPie");
    const spendPie = document.getElementById("spendPie");
    if (!hoursPie || !spendPie || typeof workHoursInDashboardPeriod !== "function" || typeof spendInDashboardPeriod !== "function") return;

    const hourRows = dashboardPieRows(hoursPieGroup, workHoursInDashboardPeriod);
    const spendRows = dashboardPieRows(spendPieGroup, spendInDashboardPeriod);
    const hoursHeading = hoursPie.closest(".chart-panel")?.querySelector("h2");
    const spendHeading = spendPie.closest(".chart-panel")?.querySelector("h2");
    if (hoursHeading) hoursHeading.textContent = `Maintenance time by ${dashboardPieLabels[hoursPieGroup]}`;
    if (spendHeading) spendHeading.textContent = `Parts spend by ${dashboardPieLabels[spendPieGroup]}`;
    const hoursSelect = document.getElementById("hoursPieGroupSelect");
    const spendSelect = document.getElementById("spendPieGroupSelect");
    if (hoursSelect) hoursSelect.value = hoursPieGroup;
    if (spendSelect) spendSelect.value = spendPieGroup;
    renderPie(hoursPie, document.getElementById("hoursLegend"), hourRows, value => `${Number(value).toFixed(1)} hrs`);
    renderPie(spendPie, document.getElementById("spendLegend"), spendRows, value => money(value));
  }

  const pieBreakdownRenderDashboard = renderDashboard;
  renderDashboard = function(...args) {
    const result = pieBreakdownRenderDashboard.apply(this, args);
    renderDashboardPieBreakdowns();
    return result;
  };

  const dashboardPieStyle = document.createElement("style");
  dashboardPieStyle.id = "dashboardPieBreakdownStyles";
  dashboardPieStyle.textContent = `
    .dashboard-pie-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:2px}
    .dashboard-pie-head h2{margin:0}
    .dashboard-pie-picker{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap}
    .dashboard-pie-picker select{border:1px solid var(--border);background:#fff;color:var(--ink);border-radius:7px;padding:6px 8px;font:inherit;font-weight:700;max-width:180px}
    @media(max-width:720px){.dashboard-pie-head{align-items:flex-start;flex-direction:column}.dashboard-pie-picker{width:100%;justify-content:space-between}.dashboard-pie-picker select{max-width:65%}}
  `;
  document.head.appendChild(dashboardPieStyle);
  ensureDashboardPieSelectors();
  if (typeof jobs !== "undefined" && typeof machines !== "undefined") renderDashboardPieBreakdowns();
}

// Saved open-order cards: show the PO number and supplier together in the title.
if (typeof renderPurchaseOrders === "function") {
  const originalRenderPurchaseOrdersForTitles = renderPurchaseOrders;

  function formatSavedOpenOrderTitles() {
    const list = document.getElementById("poOpenList");
    if (!list || typeof purchaseOrders === "undefined") return;

    list.querySelectorAll(".po-list-card").forEach(card => {
      const id = card.querySelector("[data-po-edit]")?.dataset.poEdit
        || card.querySelector("[data-po-place]")?.dataset.poPlace
        || card.querySelector("[data-po-download]")?.dataset.poDownload;
      const order = purchaseOrders.find(row => String(row?.id || "") === String(id || ""));
      if (!order) return;

      const heading = card.querySelector(".po-list-head h3");
      const meta = card.querySelector(".po-meta");
      const orderNo = String(order.orderNo || "Open order").trim();
      const supplier = String(order.supplier || "No supplier").trim();
      if (heading) heading.textContent = `${orderNo} ${supplier}`;
      if (meta) meta.textContent = `Updated ${purchaseOrderDate(order.updatedAt || order.createdAt)}`;
    });
  }

  renderPurchaseOrders = function(...args) {
    const result = originalRenderPurchaseOrdersForTitles.apply(this, args);
    formatSavedOpenOrderTitles();
    return result;
  };

  formatSavedOpenOrderTitles();
}
