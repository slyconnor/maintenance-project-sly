const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

let jobs = [];
let machines = [];
let sections = [];
let archivedSections = [];
let partCatalog = [];
let suppliers = [];
let archivedSuppliers = [];
let profiles = [];
let sharedRevision = 0;
let signedInIdentity = null;

const now = new Date();
let selectedYear = now.getFullYear();
let selectedMonth = now.getMonth();
let selectedMachineId = null;
let selectedProfileId = "all"; // Cloudflare login proves access; profile choice is only a filter.
let machineDetailTab = "overview";
let partRowCounter = 0;
let timeRowCounter = 0;
let editingJobNo = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const money = n => new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP",minimumFractionDigits:2}).format(Number(n)||0);
const shortMoney = n => new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP",maximumFractionDigits:0}).format(Number(n)||0);
const fmtDate = d => d ? new Date(d+"T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const partTotal = p => (Number(p.qty)||0)*(Number(p.unitPrice)||0);
const jobPartsCost = j => (j.parts||[]).reduce((a,p)=>a+partTotal(p),0);
const jobHours = j => Array.isArray(j.timeEntries) ? j.timeEntries.reduce((a,t)=>a+(Number(t.hours)||0),0) : Number(j.hours)||0;
const machineForJob = j => machines.find(m=>m.name===j.machine) || null;
const machineLabel = j => { const m=machineForJob(j); return m ? `${m.assetId} · ${m.name}` : j.machine; };
const selectedPrefix = () => `${selectedYear}-${String(selectedMonth+1).padStart(2,"0")}`;
const inSelectedMonth = d => Boolean(d && d.startsWith(selectedPrefix()));
const partsThisMonth = j => (j.parts||[]).filter(p=>inSelectedMonth(p.date));
const spendThisMonth = j => partsThisMonth(j).reduce((a,p)=>a+partTotal(p),0);
const activeProfiles = () => profiles.filter(p=>p.active!==false);
const isSectionArchived = name => archivedSections.includes(name);
const isSupplierArchived = name => archivedSuppliers.includes(name);
const isMachineArchived = machine => String(machine?.status || "Active").toLowerCase() === "archived";
const activeSections = () => sections.filter(s=>!isSectionArchived(s));
const activeSuppliers = () => suppliers.filter(s=>!isSupplierArchived(s));
const activeParts = () => partCatalog.filter(p=>p.active!==false);
const selectedProfile = () => profiles.find(p=>p.id===selectedProfileId) || null;
const selectedProfileName = () => selectedProfile()?.name || null;
const visibleJobs = () => selectedProfileId === "all" ? jobs : jobs.filter(j=>j.assigned===selectedProfileName());
const profileContext = () => selectedProfileId === "all" ? "All Jobs" : selectedProfileName() || "All Jobs";
const selectedMonthJobs = () => visibleJobs().filter(j => inSelectedMonth(j.raised) || (!["Completed","Cancelled"].includes(j.status) && j.raised < `${selectedPrefix()}-32`) || inSelectedMonth(j.completed) || (j.parts||[]).some(p=>inSelectedMonth(p.date)) || (j.timeEntries||[]).some(t=>inSelectedMonth(t.date)));
const workHoursThisMonth = j => Array.isArray(j.timeEntries) ? j.timeEntries.filter(t=>inSelectedMonth(t.date)).reduce((a,t)=>a+(Number(t.hours)||0),0) : 0;

function inferSection(machineName) {
  return machines.find(m => m.name === machineName)?.section || "General";
}

function applySharedState(payload) {
  const state = payload?.state || payload || {};
  jobs = Array.isArray(state.jobs) ? state.jobs : [];
  machines = Array.isArray(state.machines) ? state.machines : [];
  sections = Array.isArray(state.sections) ? state.sections : [];
  archivedSections = Array.isArray(state.archivedSections) ? state.archivedSections : [];
  partCatalog = Array.isArray(state.partCatalog) ? state.partCatalog : [];
  suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  archivedSuppliers = Array.isArray(state.archivedSuppliers) ? state.archivedSuppliers : [];
  profiles = Array.isArray(state.profiles) ? state.profiles : [];
  if (Number.isFinite(Number(payload?.revision))) sharedRevision = Number(payload.revision);
  if (payload?.identity) signedInIdentity = payload.identity;
  if (!selectedMachineId || !machines.some(m=>m.id===selectedMachineId)) selectedMachineId = machines[0]?.id || null;
  if (selectedProfileId !== "all" && !profiles.some(p=>p.id===selectedProfileId && p.active!==false)) selectedProfileId = "all";
}

async function api(path, options={}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers||{}) },
    ...options
  });
  let data={};
  try { data=await response.json(); } catch {}
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}

async function refreshSharedState({render=true}={}) {
  const payload = await api("/api/state", { method:"GET", headers:{accept:"application/json"} });
  applySharedState(payload);
  if (render) renderAll();
  return payload;
}

async function saveMutation(path, body, {render=true}={}) {
  const payload = await api(path, { method:"POST", body:JSON.stringify(body) });
  if (payload.state) applySharedState(payload);
  if (render) renderAll();
  return payload;
}

function showSaveError(error) {
  console.error(error);
  alert(error?.message || "The shared database could not be updated. Please try again.");
}

function uniquePush(list, value) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  const existing = list.find(x => String(x).toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  list.push(clean);
  list.sort((a,b)=>a.localeCompare(b));
  return clean;
}

function nextJobNumber() {
  const year = selectedYear;
  const rx = new RegExp(`^JOB-${year}-(\\d+)$`,"i");
  const nums = jobs.map(j => Number(String(j.jobNo||"").match(rx)?.[1])).filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `JOB-${year}-${String(next).padStart(4,"0")}`;
}

function buildTabs() {
  const start = Math.min(selectedYear-1, now.getFullYear()-1);
  const ys = [start,start+1,start+2];
  if (!ys.includes(selectedYear)) ys.push(selectedYear);
  $("#yearSelect").innerHTML = [...new Set(ys)].sort().map(y=>`<option ${y===selectedYear?"selected":""}>${y}</option>`).join("");
  $("#monthTabs").innerHTML = MONTHS.map((m,i)=>`<button class="${i===selectedMonth?"active":""}" data-month="${i}">${m}</button>`).join("");
}

function renderProfileSelector() {
  if (selectedProfileId !== "all" && !activeProfiles().some(p=>p.id===selectedProfileId)) selectedProfileId = "all";
  const options = [`<option value="all">All Jobs</option>`, ...activeProfiles().map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`)].join("");
  $("#profileSelect").innerHTML = options;
  $("#profileSelect").value = selectedProfileId;
}

function statusPill(s) { return `<span class="pill s-${esc(String(s).toLowerCase().replaceAll(" ","-"))}">${esc(s)}</span>`; }
function priorityPill(p) { return `<span class="pill p-${esc(String(p).toLowerCase())}">${esc(p)}</span>`; }
function machineCell(j) { const m=machineForJob(j); return `<strong class="cell-main">${esc(m?.assetId || "No asset ID")} · ${esc(j.machine)}</strong><span class="cell-sub">${esc(j.section || inferSection(j.machine))}${m?.location?` · ${esc(m.location)}`:""}</span>`; }
function jobRow(j, withCompleted=true, withPin=true, monthScope=false) {
  return `<tr><td><button type="button" class="job-link" data-edit-job="${esc(j.jobNo)}" title="Open / edit job">${esc(j.jobNo)}</button></td><td>${esc(j.title)}</td><td>${machineCell(j)}</td><td>${priorityPill(j.priority)}</td><td>${statusPill(j.status)}</td><td>${fmtDate(j.raised)}</td><td>${fmtDate(j.target)}</td>${withCompleted?`<td>${fmtDate(j.completed)}</td>`:""}<td>${(monthScope?workHoursThisMonth(j):jobHours(j)).toFixed(1)}</td>${withCompleted?`<td>${money(monthScope?spendThisMonth(j):jobPartsCost(j))}</td>`:""}<td>${esc(j.assigned||"—")}</td>${withPin?`<td><button class="pin-btn" data-pin="${esc(j.jobNo)}" title="Pin/unpin">${j.pinned?"📌":"○"}</button></td>`:""}</tr>`;
}

function renderPie(el, legendEl, rows, format) {
  const colors = ["#2f7eea","#36ae68","#f2a01f","#7959d7","#e05b53","#5aa6a6"];
  const total = rows.reduce((a,r)=>a+r.value,0);
  let acc = 0;
  const stops = [];
  rows.forEach((r,i)=>{
    const start = total ? acc/total*100 : 0;
    acc += r.value;
    const end = total ? acc/total*100 : 0;
    stops.push(`${colors[i%colors.length]} ${start}% ${end}%`);
  });
  el.style.background = rows.length ? `conic-gradient(${stops.join(",")})` : "#e7ebf1";
  legendEl.innerHTML = rows.length ? rows.map((r,i)=>`<div class="legend-row"><span class="swatch" style="background:${colors[i%colors.length]}"></span><span>${esc(r.name)}</span><strong>${format(r.value)}</strong></div>`).join("") : `<span class="empty-note">No data for this month.</span>`;
}

function renderDashboard() {
  const base = visibleJobs();
  const monthJobs = selectedMonthJobs();
  const raised = base.filter(j=>inSelectedMonth(j.raised));
  const open = base.filter(j=>!["Completed","Cancelled"].includes(j.status));
  const hours = monthJobs.reduce((a,j)=>a+workHoursThisMonth(j),0);
  const spend = base.reduce((a,j)=>a+spendThisMonth(j),0);
  $("#monthTitle").textContent = `${FULL_MONTHS[selectedMonth]} ${selectedYear}`;
  $("#dashboardSubtitle").textContent = selectedProfileId === "all" ? "Overview of maintenance activity for the whole team this month." : `Showing only jobs and activity assigned to ${profileContext()}.`;
  $("#sideMonthLabel").textContent = `${FULL_MONTHS[selectedMonth]} ${selectedYear} · ${profileContext()}`;
  $("#kpiJobs").textContent = raised.length;
  $("#kpiOpen").textContent = open.length;
  $("#kpiHours").textContent = hours.toFixed(1);
  $("#kpiSpend").textContent = shortMoney(spend);
  $("#sideSpend").textContent = shortMoney(spend);
  $("#sideHours").textContent = hours.toFixed(1);
  $("#openBadge").textContent = open.length;

  const cats = [...new Set(machines.map(m=>m.category || "Other"))];
  const hourRows = cats.map(c=>({name:c,value:base.filter(j=>machines.find(m=>m.name===j.machine)?.category===c).reduce((a,j)=>a+workHoursThisMonth(j),0)})).filter(x=>x.value>0);
  const spendRows = cats.map(c=>({name:c,value:base.filter(j=>machines.find(m=>m.name===j.machine)?.category===c).reduce((a,j)=>a+spendThisMonth(j),0)})).filter(x=>x.value>0);
  renderPie($("#hoursPie"),$("#hoursLegend"),hourRows,v=>`${v.toFixed(1)} hrs`);
  renderPie($("#spendPie"),$("#spendLegend"),spendRows,v=>money(v));

  const pinned = base.filter(j=>j.pinned && !["Completed","Cancelled"].includes(j.status));
  $("#pinnedJobsBody").innerHTML = pinned.length ? pinned.map(j=>jobRow(j,false,false,true)).join("") : `<tr><td colspan="10">No pinned jobs for ${esc(profileContext())}.</td></tr>`;
  renderMonthTable();
}

function renderMonthTable() {
  let rows = selectedMonthJobs();
  const sf = $("#statusFilter").value, pf = $("#priorityFilter").value, q = $("#jobSearch").value.trim().toLowerCase();
  if (sf !== "all") rows = rows.filter(j=>j.status===sf);
  if (pf !== "all") rows = rows.filter(j=>j.priority===pf);
  if (q) rows = rows.filter(j=>[j.jobNo,j.title,j.machine,j.section,j.assigned].join(" ").toLowerCase().includes(q));
  $("#jobsTableTitle").textContent = `${FULL_MONTHS[selectedMonth]} Jobs`;
  $("#monthJobsBody").innerHTML = rows.length ? rows.map(j=>jobRow(j,true,true,true)).join("") : `<tr><td colspan="12">No jobs match these filters.</td></tr>`;
  bindPins();
  bindJobEditors();
}

function renderOpen() {
  const rows = visibleJobs().filter(j=>!["Completed","Cancelled"].includes(j.status));
  $("#openSubtitle").textContent = selectedProfileId === "all" ? "All outstanding work, including jobs carried over from earlier months." : `Outstanding work assigned to ${profileContext()}.`;
  $("#openJobsBody").innerHTML = rows.length ? rows.map(j=>jobRow(j,false,false)).join("") : `<tr><td colspan="9">No open jobs for ${esc(profileContext())}.</td></tr>`;
}

function renderAllJobs() {
  const rows = [...visibleJobs()].sort((a,b)=>b.raised.localeCompare(a.raised));
  $("#allJobsTitle").textContent = selectedProfileId === "all" ? "All Jobs" : `${profileContext()} · Jobs`;
  $("#jobsSubtitle").textContent = selectedProfileId === "all" ? "Full maintenance job register." : `Only jobs assigned to ${profileContext()} are shown.`;
  $("#allJobsBody").innerHTML = rows.length ? rows.map(j=>jobRow(j,true,true)).join("") : `<tr><td colspan="12">No jobs for ${esc(profileContext())}.</td></tr>`;
  bindPins();
}

function machineStats(machine) {
  const mj = visibleJobs().filter(j=>j.machine===machine.name);
  return {jobs:mj.length,open:mj.filter(j=>!["Completed","Cancelled"].includes(j.status)).length,hours:mj.reduce((a,j)=>a+jobHours(j),0),spend:mj.reduce((a,j)=>a+jobPartsCost(j),0)};
}

function machineHistoryTable(history, emptyText) {
  return `<div class="table-wrap"><table><thead><tr><th>Job</th><th>Title</th><th>Engineer</th><th>Status</th><th>Raised</th><th>Completed</th><th>Hours</th><th>Parts Cost</th></tr></thead><tbody>${history.length?history.map(j=>`<tr><td><button type="button" class="job-link" data-edit-job="${esc(j.jobNo)}">${esc(j.jobNo)}</button></td><td>${esc(j.title)}</td><td>${esc(j.assigned||"—")}</td><td>${statusPill(j.status)}</td><td>${fmtDate(j.raised)}</td><td>${fmtDate(j.completed)}</td><td>${jobHours(j).toFixed(1)}</td><td>${money(jobPartsCost(j))}</td></tr>`).join(""):`<tr><td colspan="8">${esc(emptyText)}</td></tr>`}</tbody></table></div>`;
}

function renderMachines() {
  $("#machinesSubtitle").textContent = selectedProfileId === "all" ? "Select a machine to see its maintenance overview and full job history." : `Machine figures are filtered to work assigned to ${profileContext()}.`;
  $("#machineList").innerHTML = machines.map(m=>{
    const s = machineStats(m);
    return `<button class="machine-item ${m.id===selectedMachineId?"active":""}" data-machine="${esc(m.id)}"><strong>${esc(m.assetId)} · ${esc(m.name)}</strong><span>${esc(m.section)} · ${esc(m.category)} · ${s.jobs} jobs · ${money(s.spend)} parts</span></button>`;
  }).join("");
  const m = machines.find(x=>x.id===selectedMachineId) || machines[0];
  if (!m) { $("#machineDetail").innerHTML = "<p>No machines added yet.</p>"; return; }
  selectedMachineId = m.id;
  const stats = machineStats(m);
  const history = visibleJobs().filter(j=>j.machine===m.name).sort((a,b)=>b.raised.localeCompare(a.raised));
  const recent = history.slice(0,5);
  const overviewContent = `<div class="machine-meta"><div class="meta-box"><small>Asset ID</small><strong>${esc(m.assetId)}</strong></div><div class="meta-box"><small>Section</small><strong>${esc(m.section)}</strong></div><div class="meta-box"><small>Location</small><strong>${esc(m.location||"—")}</strong></div><div class="meta-box"><small>Purchase cost</small><strong>${m.purchaseCost!=null?money(m.purchaseCost):"Unknown"}</strong></div><div class="meta-box"><small>Make / Model</small><strong>${esc([m.make,m.model].filter(Boolean).join(" · ")||"—")}</strong></div><div class="meta-box"><small>Serial number</small><strong>${esc(m.serialNumber||"—")}</strong></div><div class="meta-box"><small>Purchase date</small><strong>${fmtDate(m.purchaseDate)}</strong></div><div class="meta-box"><small>Install date</small><strong>${fmtDate(m.installDate)}</strong></div></div>${m.notes?`<div class="machine-notes"><strong>Machine notes</strong><p>${esc(m.notes)}</p></div>`:""}<div class="metric-strip"><div class="mini-metric"><span>Maintenance jobs</span><strong>${stats.jobs}</strong></div><div class="mini-metric"><span>Open jobs</span><strong>${stats.open}</strong></div><div class="mini-metric"><span>Maintenance hours</span><strong>${stats.hours.toFixed(1)}</strong></div><div class="mini-metric"><span>Parts spend</span><strong>${money(stats.spend)}</strong></div></div><div class="machine-overview-note">${selectedProfileId === "all" ? "These figures use the machine’s full recorded maintenance history." : `These figures currently show only ${esc(profileContext())}’s assigned work.`}</div><h3 class="subheading">Recent jobs</h3>${machineHistoryTable(recent, "No jobs recorded for this machine.")}`;
  const historyContent = `<div class="history-heading"><div><h3>Job history</h3><p>${history.length} recorded job${history.length===1?"":"s"} for ${esc(profileContext())}.</p></div></div>${machineHistoryTable(history, "No job history for this machine and profile.")}`;
  $("#machineDetail").innerHTML = `<div class="machine-head"><div><h2>${esc(m.name)}</h2><p><strong>${esc(m.assetId)}</strong> · ${esc(m.section)} · ${esc(m.category)} · ${esc(m.status||"Active")}</p></div><div class="machine-head-actions"><strong>${m.purchaseCost!=null?money(m.purchaseCost):"Cost unknown"}</strong><button type="button" class="btn secondary compact" data-edit-machine="${esc(m.id)}">Edit Machine</button></div></div><div class="machine-tabs"><button type="button" class="${machineDetailTab==="overview"?"active":""}" data-machine-tab="overview">Overview</button><button type="button" class="${machineDetailTab==="history"?"active":""}" data-machine-tab="history">Job History (${history.length})</button></div>${machineDetailTab==="history"?historyContent:overviewContent}`;
  $$('[data-machine]').forEach(b=>b.addEventListener('click',()=>{selectedMachineId=b.dataset.machine;machineDetailTab="overview";renderMachines();}));
  $$('[data-machine-tab]').forEach(b=>b.addEventListener('click',()=>{machineDetailTab=b.dataset.machineTab;renderMachines();}));
  $$('[data-edit-machine]').forEach(b=>b.addEventListener('click',()=>openMachineDialog('',b.dataset.editMachine)));
  bindJobEditors();
}

function renderParts() {
  $("#partsSubtitle").textContent = selectedProfileId === "all" ? "Parts usage, dates, suppliers and costs recorded through maintenance jobs." : `Parts used on jobs assigned to ${profileContext()}.`;
  const parts = visibleJobs().flatMap(j=>(j.parts||[]).map(p=>({...p,jobNo:j.jobNo,machine:j.machine,section:j.section||inferSection(j.machine)}))).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  $("#partsBody").innerHTML = parts.length ? parts.map(p=>`<tr><td>${fmtDate(p.date)}</td><td>${esc(p.name)}</td><td>${esc(p.partNo||"—")}</td><td>${Number(p.qty)||0}</td><td>${money(p.unitPrice)}</td><td>${money(partTotal(p))}</td><td>${esc(p.supplier||"—")}</td><td><button type="button" class="job-link" data-edit-job="${esc(p.jobNo)}">${esc(p.jobNo)}</button></td><td>${esc((machines.find(m=>m.name===p.machine)?.assetId||"—") + " · " + p.machine)}</td></tr>`).join("") : `<tr><td colspan="9">No parts recorded for ${esc(profileContext())}.</td></tr>`;
}

function reportData() {
  const base = visibleJobs();
  const monthJobs = selectedMonthJobs();
  const parts = base.flatMap(j=>partsThisMonth(j).map(p=>({...p,job:j})));
  const time = base.flatMap(j=>(j.timeEntries||[]).filter(t=>inSelectedMonth(t.date)).map(t=>({...t,job:j})));
  const spend = parts.reduce((a,x)=>a+partTotal(x),0);
  const hours = time.reduce((a,x)=>a+(Number(x.hours)||0),0);
  return {base,monthJobs,parts,time,spend,hours,raised:base.filter(j=>inSelectedMonth(j.raised)).length,completed:base.filter(j=>inSelectedMonth(j.completed)).length,open:base.filter(j=>!["Completed","Cancelled"].includes(j.status)).length};
}

function renderReports() {
  const r = reportData();
  $("#reportsSubtitle").textContent = selectedProfileId === "all" ? "Generate a whole-team PDF or Excel report for the selected month." : `Generate a monthly PDF or Excel report for ${profileContext()} only.`;
  $("#reportMonth").textContent = `${FULL_MONTHS[selectedMonth]} ${selectedYear} · ${profileContext()}`;
  $("#reportSummary").textContent = `${r.raised} jobs raised, ${r.completed} completed, ${r.open} currently open, ${r.hours.toFixed(1)} maintenance hours logged in this month and ${money(r.spend)} of parts used in this month.`;
  const jobsRows = r.monthJobs.map(j=>`<tr><td>${esc(j.jobNo)}</td><td>${esc(j.title)}</td><td>${esc(machineLabel(j))}</td><td>${esc(j.assigned||"—")}</td><td>${esc(j.status)}</td><td>${fmtDate(j.raised)}</td><td>${fmtDate(j.completed)}</td><td>${workHoursThisMonth(j).toFixed(1)}</td><td>${money(spendThisMonth(j))}</td></tr>`).join("");
  const partsRows = r.parts.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.job.jobNo)}</td><td>${esc(machineLabel(x.job))}</td><td>${esc(x.name)}</td><td>${Number(x.qty)||0}</td><td>${money(x.unitPrice)}</td><td>${money(partTotal(x))}</td><td>${esc(x.supplier||"—")}</td></tr>`).join("");
  const timeRows = r.time.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.job.jobNo)}</td><td>${esc(x.job.assigned||"—")}</td><td>${esc(machineLabel(x.job))}</td><td>${Number(x.hours||0).toFixed(2)}</td></tr>`).join("");
  $("#reportPreview").innerHTML = `<div class="print-report-head"><div><h2>Monthly Maintenance Report</h2><p>${esc(FULL_MONTHS[selectedMonth])} ${selectedYear} · ${esc(profileContext())}</p></div><span>Generated ${esc(new Date().toLocaleString("en-GB"))}</span></div><div class="report-kpis"><div><span>Jobs raised</span><strong>${r.raised}</strong></div><div><span>Completed</span><strong>${r.completed}</strong></div><div><span>Open now</span><strong>${r.open}</strong></div><div><span>Hours this month</span><strong>${r.hours.toFixed(1)}</strong></div><div><span>Parts spend</span><strong>${money(r.spend)}</strong></div></div><h3>Jobs in / carried through this month</h3><div class="table-wrap"><table><thead><tr><th>Job</th><th>Title</th><th>Asset / Machine</th><th>Engineer</th><th>Status</th><th>Raised</th><th>Completed</th><th>Month hours</th><th>Month parts</th></tr></thead><tbody>${jobsRows||`<tr><td colspan="9">No jobs for this report.</td></tr>`}</tbody></table></div><h3>Time entries</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Job</th><th>Engineer</th><th>Asset / Machine</th><th>Hours</th></tr></thead><tbody>${timeRows||`<tr><td colspan="5">No time entries this month.</td></tr>`}</tbody></table></div><h3>Parts used</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Job</th><th>Asset / Machine</th><th>Part</th><th>Qty</th><th>Unit price</th><th>Total</th><th>Supplier</th></tr></thead><tbody>${partsRows||`<tr><td colspan="8">No parts used this month.</td></tr>`}</tbody></table></div>`;
}

function renderTeam() {
  const visibleProfiles = activeProfiles();
  $("#teamGrid").innerHTML = visibleProfiles.map(p=>{
    const pj = jobs.filter(j=>j.assigned===p.name);
    const open = pj.filter(j=>!["Completed","Cancelled"].includes(j.status)).length;
    return `<article class="team-card ${selectedProfileId===p.id?"selected-profile-card":""}"><div class="avatar">${esc(p.name.split(" ").map(x=>x[0]).join(""))}</div><h3>${esc(p.name)}</h3><p>Engineer profile</p><div class="profile-card-stats"><strong>${pj.length} jobs</strong><span>${open} open</span></div><button type="button" class="btn secondary compact" data-view-profile="${esc(p.id)}">View this profile</button></article>`;
  }).join("");
  $$('[data-view-profile]').forEach(b=>b.addEventListener('click',()=>{selectedProfileId=b.dataset.viewProfile;renderAll();switchView("dashboard");}));
}


function machineUsageCount(machine) { return jobs.filter(j=>j.machine===machine.name).length; }
function sectionUsageCount(name) { return machines.filter(m=>m.section===name).length + jobs.filter(j=>j.section===name).length; }
function supplierUsageCount(name) { return jobs.reduce((n,j)=>n+(j.parts||[]).filter(p=>p.supplier===name).length,0); }
function partUsageCount(part) { return jobs.reduce((n,j)=>n+(j.parts||[]).filter(p=>p.name===part.name).length,0); }
function manageActions(entity, key, archived, used, edit=true) {
  const keyAttr = entity === "machine" || entity === "part" ? `data-id="${esc(key)}"` : `data-key="${esc(key)}"`;
  return `<div class="manage-actions">${edit?`<button type="button" class="btn secondary compact" data-master-action="edit" data-entity="${entity}" ${keyAttr}>Edit</button>`:""}<button type="button" class="btn secondary compact" data-master-action="${archived?"reactivate":"archive"}" data-entity="${entity}" ${keyAttr}>${archived?"Reactivate":"Archive"}</button><button type="button" class="btn danger compact" data-master-action="delete" data-entity="${entity}" ${keyAttr} ${used?`disabled title="Used in maintenance history — archive instead"`:""}>Delete</button></div>`;
}
function renderManageData() {
  const machineRows=[...machines].sort((a,b)=>String(a.assetId).localeCompare(String(b.assetId))).map(m=>{const used=machineUsageCount(m);const archived=isMachineArchived(m);return `<div class="manage-row"><div><strong>${esc(m.assetId)} · ${esc(m.name)}</strong><span>${esc(m.section)} · ${esc(m.location||"No location")} · ${used} job${used===1?"":"s"}</span></div><div class="manage-row-right"><span class="status-chip ${archived?"archived":"active"}">${archived?"Archived":"Active"}</span>${manageActions("machine",m.id,archived,used,true)}</div></div>`;}).join("");
  $("#manageMachinesList").innerHTML=machineRows||`<p class="empty-note">No machines yet.</p>`;
  $("#manageSectionsList").innerHTML=[...sections].sort().map(name=>{const used=sectionUsageCount(name);const archived=isSectionArchived(name);return `<div class="manage-row"><div><strong>${esc(name)}</strong><span>${used} linked machine/job reference${used===1?"":"s"}</span></div><div class="manage-row-right"><span class="status-chip ${archived?"archived":"active"}">${archived?"Archived":"Active"}</span>${manageActions("section",name,archived,used,true)}</div></div>`;}).join("")||`<p class="empty-note">No sections yet.</p>`;
  $("#managePartsList").innerHTML=[...partCatalog].sort((a,b)=>a.name.localeCompare(b.name)).map(part=>{const used=partUsageCount(part);const archived=part.active===false;return `<div class="manage-row"><div><strong>${esc(part.name)}</strong><span>${esc(part.partNo||"No part number")} · ${used} historical use${used===1?"":"s"}</span></div><div class="manage-row-right"><span class="status-chip ${archived?"archived":"active"}">${archived?"Archived":"Active"}</span>${manageActions("part",part.id,archived,used,true)}</div></div>`;}).join("")||`<p class="empty-note">No saved parts yet.</p>`;
  $("#manageSuppliersList").innerHTML=[...suppliers].sort().map(name=>{const used=supplierUsageCount(name);const archived=isSupplierArchived(name);return `<div class="manage-row"><div><strong>${esc(name)}</strong><span>${used} historical purchase record${used===1?"":"s"}</span></div><div class="manage-row-right"><span class="status-chip ${archived?"archived":"active"}">${archived?"Archived":"Active"}</span>${manageActions("supplier",name,archived,used,true)}</div></div>`;}).join("")||`<p class="empty-note">No suppliers yet.</p>`;
}

async function masterMutation(body, successMessage="") {
  try {
    const payload=await saveMutation("/api/master-data",body,{render:false});
    if(payload.state) applySharedState(payload);
    renderAll();
    if(successMessage) alert(successMessage);
    return payload;
  } catch(error){ showSaveError(error); return null; }
}

async function handleMasterAction(button) {
  const entity=button.dataset.entity, action=button.dataset.masterAction, id=button.dataset.id, key=button.dataset.key;
  if(action==="edit") {
    if(entity==="machine") { openMachineDialog("",id); return; }
    if(entity==="section") {
      const name=prompt("Rename section:",key); if(!name?.trim()||name.trim()===key)return;
      await masterMutation({entity,action:"update",key,name:name.trim()}); return;
    }
    if(entity==="supplier") {
      const name=prompt("Rename supplier:",key); if(!name?.trim()||name.trim()===key)return;
      await masterMutation({entity,action:"update",key,name:name.trim()}); return;
    }
    if(entity==="part") {
      const part=partCatalog.find(p=>p.id===id); if(!part)return;
      const name=prompt("Part name:",part.name); if(!name?.trim())return;
      const partNo=prompt("Part number (optional):",part.partNo||""); if(partNo===null)return;
      await masterMutation({entity,action:"update",id,name:name.trim(),partNo:partNo.trim()}); return;
    }
  }
  if(action==="delete" && !confirm("Permanently delete this unused item? This cannot be undone.")) return;
  if(action==="archive" && !confirm("Archive this item? It will disappear from new-job pick lists but remain in historical jobs.")) return;
  await masterMutation({entity,action,id,key});
}

function sectionOptions(selected="") {
  const list = activeSections();
  if (selected && sections.includes(selected) && !list.includes(selected)) list.unshift(selected);
  return `<option value="">Select section…</option>${list.map(s=>`<option value="${esc(s)}" ${s===selected?"selected":""}>${esc(s)}${isSectionArchived(s)?" (archived)":""}</option>`).join("")}<option value="__add_section__">＋ Add new section…</option>`;
}
function renderSectionSelects() {
  const jobCurrent = $("#jobSectionSelect")?.value || "";
  const machineCurrent = $("#machineSectionSelect")?.value || "";
  if ($("#jobSectionSelect")) $("#jobSectionSelect").innerHTML = sectionOptions(jobCurrent);
  if ($("#machineSectionSelect")) $("#machineSectionSelect").innerHTML = sectionOptions(machineCurrent);
}
function renderMachineSelect(section, selected="") {
  const select = $("#jobMachineSelect");
  if (!select) return;
  const list = machines.filter(m=>m.section===section && (!isMachineArchived(m) || m.name===selected));
  select.innerHTML = section ? `<option value="">Select machine…</option>${list.map(m=>`<option value="${esc(m.name)}" ${m.name===selected?"selected":""}>${esc(m.assetId)} · ${esc(m.name)}${isMachineArchived(m)?" (archived)":""}</option>`).join("")}<option value="__add_machine__">＋ Add new machine in ${esc(section)}…</option>` : `<option value="">Select a section first…</option>`;
  select.disabled = !section;
}
function renderAssignedSelect(selected="") {
  const list = activeProfiles();
  const selectedProfileRecord = profiles.find(p=>p.name===selected);
  const options = [...list];
  if (selectedProfileRecord && !options.some(p=>p.id===selectedProfileRecord.id)) options.unshift(selectedProfileRecord);
  $("#jobAssignedSelect").innerHTML = options.length ? `<option value="">Select engineer…</option>${options.map(p=>`<option value="${esc(p.name)}" ${p.name===selected?"selected":""}>${esc(p.name)}${p.active===false?" (inactive)":""}</option>`).join("")}` : `<option value="">No active profiles</option>`;
}

async function addSectionInteractive(selectEl, onAdded) {
  const name = prompt("New section name (for example: Smokeshield):");
  if (!name?.trim()) { selectEl.value=""; return; }
  try {
    const payload = await saveMutation("/api/catalog", {type:"section", value:name.trim()}, {render:false});
    const saved = payload.value || name.trim();
    renderSectionSelects();
    selectEl.value = saved;
    onAdded?.(saved);
  } catch (error) { selectEl.value=""; showSaveError(error); }
}

async function quickAddMachine(section) {
  const assetRaw = prompt(`Asset / machine ID for the new machine in ${section} (for example RM-124):`);
  if (!assetRaw?.trim()) return null;
  const assetId = assetRaw.trim();
  if (machines.some(m=>String(m.assetId).toLowerCase()===assetId.toLowerCase())) { alert("That asset ID already exists."); return null; }
  const name = prompt(`Machine / equipment name for ${assetId}:`);
  if (!name?.trim()) return null;
  const clean = name.trim();
  const existing = machines.find(m=>m.name.toLowerCase()===clean.toLowerCase());
  if (existing) { alert(`${existing.name} already exists with asset ID ${existing.assetId}.`); return existing.name; }
  try {
    const machine = {assetId,name:clean,section,category:section,location:"",purchaseCost:null,status:"Active"};
    const payload = await saveMutation("/api/machines", {machine}, {render:false});
    selectedMachineId = payload.machineId || machines.find(m=>m.assetId===assetId)?.id || null;
    renderMachines();
    return clean;
  } catch (error) { showSaveError(error); return null; }
}

function partOptions(selected="") {
  const list = activeParts();
  const selectedPart = partCatalog.find(p=>p.id===selected);
  if (selectedPart && !list.some(p=>p.id===selectedPart.id)) list.unshift(selectedPart);
  const sorted = [...list].sort((a,b)=>a.name.localeCompare(b.name));
  return `<option value="">Select part…</option>${sorted.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?"selected":""}>${esc(p.name)}${p.partNo?` — ${esc(p.partNo)}`:""}${p.active===false?" (archived)":""}</option>`).join("")}<option value="__add_part__">＋ Add new part…</option>`;
}
function supplierOptions(selected="") {
  const list = activeSuppliers();
  if (selected && suppliers.includes(selected) && !list.includes(selected)) list.unshift(selected);
  return `<option value="">Select supplier…</option>${list.map(s=>`<option value="${esc(s)}" ${s===selected?"selected":""}>${esc(s)}${isSupplierArchived(s)?" (archived)":""}</option>`).join("")}<option value="__add_supplier__">＋ Add new supplier…</option>`;
}

function addPartRow(data={}) {
  partRowCounter += 1;
  const row = document.createElement("div");
  row.className = "part-entry";
  row.dataset.partRow = String(partRowCounter);
  row.innerHTML = `<div class="part-entry-head"><strong>Part ${partRowCounter}</strong><button type="button" class="remove-part-btn" title="Remove part">Remove</button></div><div class="part-entry-grid"><label>Part<select class="part-select">${partOptions(data.partId||"")}</select></label><label>Part number<input class="part-number" value="${esc(data.partNo||"")}" readonly placeholder="From saved part" /></label><label>Quantity<input class="part-qty" type="number" min="1" step="1" value="${Number(data.qty)||1}" /></label><label>Unit price (£)<input class="part-price" type="number" min="0" step="0.01" value="${data.unitPrice!==undefined?esc(data.unitPrice):""}" placeholder="Enter price paid" /></label><label>Supplier<select class="supplier-select">${supplierOptions(data.supplier||"")}</select></label><label>Date used / fitted<input class="part-date" type="date" value="${esc(data.date||defaultFormDate())}" /></label></div><div class="price-note">Price is entered manually for every use; previous prices are never overwritten.</div>`;
  $("#partsEditor").appendChild(row);
  const selected = partCatalog.find(p=>p.id===data.partId);
  if (selected) row.querySelector('.part-number').value = selected.partNo || "";
}

function refreshAllPartRowOptions() {
  $$('.part-entry').forEach(row=>{
    const partSel = row.querySelector('.part-select');
    const supplierSel = row.querySelector('.supplier-select');
    const p = partSel.value, s = supplierSel.value;
    partSel.innerHTML = partOptions(p);
    supplierSel.innerHTML = supplierOptions(s);
  });
}

function collectPartsFromEditor() {
  const result = [];
  for (const row of $$('.part-entry')) {
    const partId = row.querySelector('.part-select').value;
    if (!partId || partId.startsWith('__')) continue;
    const catalogPart = partCatalog.find(p=>p.id===partId);
    if (!catalogPart) continue;
    const priceRaw = row.querySelector('.part-price').value;
    if (priceRaw === "") { alert(`Enter the current price for ${catalogPart.name}.`); row.querySelector('.part-price').focus(); return null; }
    const qty = Math.max(1, Number(row.querySelector('.part-qty').value)||1);
    const unitPrice = Math.max(0, Number(priceRaw)||0);
    const supplier = row.querySelector('.supplier-select').value;
    const date = row.querySelector('.part-date').value;
    result.push({name:catalogPart.name,partNo:catalogPart.partNo||"",qty,unitPrice,supplier,date});
  }
  return result;
}

function addTimeRow(data={}) {
  timeRowCounter += 1;
  const row=document.createElement("div");
  row.className="time-entry";
  row.innerHTML=`<div class="time-entry-head"><strong>Time ${timeRowCounter}</strong><button type="button" class="remove-time-btn">Remove</button></div><div class="time-entry-grid"><label>Date worked<input class="time-date" type="date" value="${esc(data.date||defaultFormDate())}" /></label><label>Hours<input class="time-hours" type="number" min="0" step="0.25" value="${data.hours!==undefined?esc(data.hours):""}" placeholder="e.g. 1.5" /></label></div>`;
  $("#timeEditor").appendChild(row);
}

function collectTimeEntries() {
  const result=[];
  for (const row of $$('.time-entry')) {
    const date=row.querySelector('.time-date').value;
    const raw=row.querySelector('.time-hours').value;
    if (raw==="") continue;
    if (!date) { alert("Choose a date for each time entry."); row.querySelector('.time-date').focus(); return null; }
    const hours=Number(raw);
    if (!Number.isFinite(hours) || hours<0) { alert("Time must be zero or more hours."); row.querySelector('.time-hours').focus(); return null; }
    result.push({date,hours});
  }
  return result;
}

function defaultFormDate() {
  const today = new Date();
  if (today.getFullYear()===selectedYear && today.getMonth()===selectedMonth) return `${selectedYear}-${String(selectedMonth+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  return `${selectedYear}-${String(selectedMonth+1).padStart(2,"0")}-01`;
}

function renderPickLists() {
  renderSectionSelects();
  renderAssignedSelect();
  const currentSection = $("#jobSectionSelect")?.value || "";
  renderMachineSelect(currentSection,$("#jobMachineSelect")?.value || "");
  refreshAllPartRowOptions();
}

function renderAll() {
  buildTabs();
  renderProfileSelector();
  renderDashboard();
  renderOpen();
  renderAllJobs();
  renderMachines();
  renderParts();
  renderManageData();
  renderReports();
  renderTeam();
  renderPickLists();
  bindMonthTabs();
  bindJobEditors();
}

function bindJobEditors() {
  $$('[data-edit-job]').forEach(b=>{
    if (b.dataset.editBound) return;
    b.dataset.editBound="1";
    b.addEventListener('click',()=>openJob(b.dataset.editJob));
  });
}

function bindPins() {
  $$('[data-pin]').forEach(b=>{
    if (b.dataset.pinBound) return;
    b.dataset.pinBound="1";
    b.addEventListener('click',async()=>{
      const j = jobs.find(x=>x.jobNo===b.dataset.pin);
      if (!j) return;
      try { await saveMutation("/api/jobs/pin", {jobNo:j.jobNo,pinned:!j.pinned}); }
      catch (error) { showSaveError(error); }
    });
  });
}
function bindMonthTabs() {
  $$('[data-month]').forEach(b=>b.addEventListener('click',()=>{selectedMonth=Number(b.dataset.month);renderAll();}));
}
function switchView(name) {
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`#${name}View`)?.classList.add('active');
  $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===name));
  if (name==='reports') renderReports();
}

function xmlEsc(v) { return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c])); }
function excelCell(v,type="String") { return `<Cell><Data ss:Type="${type}">${xmlEsc(v)}</Data></Cell>`; }
function excelRow(values) { return `<Row>${values.map(v=>excelCell(v.value ?? v, v.type || "String")).join("")}</Row>`; }
function excelSheet(name, rows) { return `<Worksheet ss:Name="${xmlEsc(name)}"><Table>${rows.join("")}</Table></Worksheet>`; }
function downloadExcelReport() {
  const r = reportData();
  const summary = [
    excelRow(["Monthly Maintenance Report",`${FULL_MONTHS[selectedMonth]} ${selectedYear}`]),
    excelRow(["Profile",profileContext()]),
    excelRow(["Generated",new Date().toLocaleString("en-GB")]),
    excelRow(["Jobs raised",{value:r.raised,type:"Number"}]), excelRow(["Completed",{value:r.completed,type:"Number"}]), excelRow(["Open now",{value:r.open,type:"Number"}]),
    excelRow(["Hours this month",{value:r.hours,type:"Number"}]), excelRow(["Parts spend GBP",{value:r.spend.toFixed(2),type:"Number"}])
  ];
  const jobsRows=[excelRow(["Job No","Title","Description","Section","Asset ID","Machine","Priority","Status","Date Raised","Target Date","Completion Date","Hours This Month","Lifetime Hours","Assigned To","Pinned","Parts This Month GBP","Lifetime Parts GBP"])];
  r.monthJobs.forEach(j=>{const m=machineForJob(j);jobsRows.push(excelRow([j.jobNo,j.title,j.description||"",j.section||inferSection(j.machine),m?.assetId||"",j.machine,j.priority,j.status,j.raised||"",j.target||"",j.completed||"",{value:workHoursThisMonth(j),type:"Number"},{value:jobHours(j),type:"Number"},j.assigned||"",j.pinned?"Yes":"No",{value:spendThisMonth(j).toFixed(2),type:"Number"},{value:jobPartsCost(j).toFixed(2),type:"Number"}]))});
  const timeRows=[excelRow(["Date","Job No","Engineer","Asset ID","Machine","Hours"])];
  r.time.forEach(x=>{const m=machineForJob(x.job);timeRows.push(excelRow([x.date,x.job.jobNo,x.job.assigned||"",m?.assetId||"",x.job.machine,{value:Number(x.hours)||0,type:"Number"}]))});
  const partRows=[excelRow(["Date","Job No","Section","Asset ID","Machine","Part Name","Part No","Qty","Unit Price GBP","Total GBP","Supplier"])];
  r.parts.forEach(x=>{const m=machineForJob(x.job);partRows.push(excelRow([x.date,x.job.jobNo,x.job.section||inferSection(x.job.machine),m?.assetId||"",x.job.machine,x.name,x.partNo||"",{value:Number(x.qty)||0,type:"Number"},{value:Number(x.unitPrice)||0,type:"Number"},{value:partTotal(x),type:"Number"},x.supplier||""]))});
  const xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${excelSheet("Summary",summary)}${excelSheet("Jobs",jobsRows)}${excelSheet("Time Entries",timeRows)}${excelSheet("Parts",partRows)}</Workbook>`;
  const blob=new Blob([xml],{type:"application/vnd.ms-excel;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  const profileSlug=selectedProfileId==="all"?"all-jobs":profileContext().toLowerCase().replace(/[^a-z0-9]+/g,"-");
  a.download=`maintenance-report-${profileSlug}-${selectedYear}-${String(selectedMonth+1).padStart(2,"0")}.xls`; a.click(); URL.revokeObjectURL(a.href);
}

// Navigation and filters
$("#mainNav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)switchView(b.dataset.view);});
$("#reportsBtn").addEventListener("click",()=>switchView("reports"));
$$('[data-nav]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.nav)));
$("#yearSelect").addEventListener("change",e=>{selectedYear=Number(e.target.value);renderAll();});
$("#profileSelect").addEventListener("change",e=>{
  selectedProfileId = e.target.value;
  machineDetailTab = "overview";
  renderAll();
});
["#statusFilter","#priorityFilter"].forEach(s=>$(s).addEventListener("change",renderMonthTable));
$("#jobSearch").addEventListener("input",renderMonthTable);

// Add / edit job form. Engineer profiles are filters, not permissions: any engineer can edit any job.
const jobDialog = $("#jobDialog");
function catalogPartId(part) {
  let found=partCatalog.find(p=>p.name.toLowerCase()===String(part.name||"").toLowerCase());
  if (!found && part.name) { found={id:`p${Date.now()}-${partCatalog.length}`,name:part.name,partNo:part.partNo||""}; partCatalog.push(found); }
  return found?.id || "";
}
async function openJob(jobNo=null) {
  const form=$("#jobForm");
  form.reset();
  editingJobNo=jobNo;
  const job=jobNo?jobs.find(j=>j.jobNo===jobNo):null;
  renderSectionSelects();
  $("#partsEditor").innerHTML=""; partRowCounter=0;
  $("#timeEditor").innerHTML=""; timeRowCounter=0;
  if (job) {
    $("#jobDialogTitle").textContent=`Edit ${job.jobNo}`;
    $("#jobDialogSubtitle").textContent="Any engineer can update this job, including completed jobs. Job number can also be changed.";
    $("#jobSubmitBtn").textContent="Save Changes";
    form.elements.jobNo.value=job.jobNo;
    form.elements.title.value=job.title||"";
    form.elements.description.value=job.description||"";
    form.elements.priority.value=job.priority||"Medium";
    form.elements.status.value=job.status||"Open";
    form.elements.raised.value=job.raised||"";
    form.elements.target.value=job.target||"";
    form.elements.completed.value=job.completed||"";
    form.elements.notes.value=job.notes||"";
    form.elements.pinned.checked=Boolean(job.pinned);
    $("#jobSectionSelect").value=job.section||inferSection(job.machine);
    renderMachineSelect($("#jobSectionSelect").value,job.machine);
    renderAssignedSelect(job.assigned||"");
    (job.timeEntries||[]).forEach(t=>addTimeRow(t));
    if (!(job.timeEntries||[]).length) addTimeRow({date:job.raised||defaultFormDate()});
    (job.parts||[]).forEach(p=>addPartRow({partId:catalogPartId(p),partNo:p.partNo||"",qty:p.qty,unitPrice:p.unitPrice,supplier:p.supplier,date:p.date}));
    if (!(job.parts||[]).length) addPartRow({date:job.raised||defaultFormDate()});
  } else {
    $("#jobDialogTitle").textContent="Add maintenance job";
    $("#jobDialogSubtitle").textContent="Job number is created automatically but can be changed before saving.";
    $("#jobSubmitBtn").textContent="Save Job";
    renderAssignedSelect(selectedProfileId === "all" ? "" : profileContext());
    renderMachineSelect("");
    try {
      const next = await api(`/api/next-job-number?year=${encodeURIComponent(selectedYear)}`, {method:"GET",headers:{accept:"application/json"}});
      form.elements.jobNo.value=next.jobNo || nextJobNumber();
    } catch { form.elements.jobNo.value=nextJobNumber(); }
    form.elements.raised.value=defaultFormDate();
    addTimeRow({date:defaultFormDate()});
    addPartRow({date:defaultFormDate()});
  }
  jobDialog.showModal();
}
$("#newJobBtn").addEventListener("click",()=>openJob());
$$('[data-new-job]').forEach(b=>b.addEventListener('click',()=>openJob()));
$$('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>{editingJobNo=null;jobDialog.close();}));

$("#jobSectionSelect").addEventListener("change",async e=>{
  if (e.target.value === "__add_section__") await addSectionInteractive(e.target,section=>renderMachineSelect(section));
  else renderMachineSelect(e.target.value);
});
$("#jobMachineSelect").addEventListener("change",async e=>{
  if (e.target.value !== "__add_machine__") return;
  const section = $("#jobSectionSelect").value;
  const added = await quickAddMachine(section);
  renderMachineSelect(section,added||"");
});

$("#addTimeRowBtn").addEventListener("click",()=>addTimeRow({date:$("#jobForm").elements.raised.value||defaultFormDate()}));
$("#timeEditor").addEventListener("click",e=>{ const b=e.target.closest('.remove-time-btn'); if(b)b.closest('.time-entry').remove(); });
$("#addPartRowBtn").addEventListener("click",()=>addPartRow({date:$("#jobForm").elements.raised.value || defaultFormDate()}));
$("#partsEditor").addEventListener("click",e=>{ const remove=e.target.closest('.remove-part-btn'); if(remove)remove.closest('.part-entry').remove(); });
$("#partsEditor").addEventListener("change",async e=>{
  const row=e.target.closest('.part-entry'); if(!row)return;
  if (e.target.classList.contains('part-select')) {
    if (e.target.value === "__add_part__") {
      const name=prompt("New part name (for example: Anvil):"); if(!name?.trim()){e.target.value="";return;}
      const clean=name.trim(); let part=partCatalog.find(p=>p.name.toLowerCase()===clean.toLowerCase());
      if(!part){
        const partNo=prompt("Part number (optional):")||"";
        try { const payload=await saveMutation("/api/catalog",{type:"part",name:clean,partNo:partNo.trim()},{render:false}); part=payload.part; }
        catch(error){ e.target.value=""; showSaveError(error); return; }
      }
      refreshAllPartRowOptions(); row.querySelector('.part-select').value=part.id; row.querySelector('.part-number').value=part.partNo||"";
    } else { const part=partCatalog.find(p=>p.id===e.target.value);row.querySelector('.part-number').value=part?.partNo||"";row.querySelector('.part-price').value=""; }
  }
  if (e.target.classList.contains('supplier-select') && e.target.value === "__add_supplier__") {
    const name=prompt("New supplier name:");if(!name?.trim()){e.target.value="";return;}
    try { const payload=await saveMutation("/api/catalog",{type:"supplier",value:name.trim()},{render:false}); const saved=payload.value||name.trim();refreshAllPartRowOptions();row.querySelector('.supplier-select').value=saved; }
    catch(error){e.target.value="";showSaveError(error);}
  }
});

$("#jobForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const fd=new FormData(e.currentTarget),obj=Object.fromEntries(fd.entries());
  const cleanNo=String(obj.jobNo||"").trim();
  if (jobs.some(j=>j.jobNo!==editingJobNo && j.jobNo.toLowerCase()===cleanNo.toLowerCase())) { alert("That job number already exists."); e.currentTarget.elements.jobNo.focus(); return; }
  if (!obj.section || !obj.machine || String(obj.machine).startsWith('__')) { alert("Select a section and machine."); return; }
  const timeEntries=collectTimeEntries(); if(timeEntries===null)return;
  const parts=collectPartsFromEditor(); if(parts===null)return;
  const updated={jobNo:cleanNo,title:obj.title,description:obj.description,section:obj.section,machine:obj.machine,priority:obj.priority,status:obj.status,raised:obj.raised,target:obj.target,completed:obj.completed,hours:timeEntries.reduce((a,t)=>a+(Number(t.hours)||0),0),timeEntries,notes:obj.notes,assigned:obj.assigned,pinned:fd.has("pinned"),parts};
  const originalJobNo=editingJobNo;
  const submit=$("#jobSubmitBtn"); submit.disabled=true; submit.textContent="Saving…";
  try {
    await saveMutation("/api/jobs",{job:updated,originalJobNo});
    editingJobNo=null; jobDialog.close();
  } catch(error){ showSaveError(error); }
  finally { submit.disabled=false; submit.textContent=editingJobNo?"Save Changes":"Save Job"; }
});

// Add / edit machine form. All authenticated maintenance users can maintain machine details.
const machineDialog = $("#machineDialog");
function openMachineDialog(preselect="", machineId="") {
  const form=$("#machineForm");
  form.reset();
  form.elements.machineId.value=machineId||"";
  const existing=machineId?machines.find(m=>m.id===machineId):null;
  renderSectionSelects();
  if(existing){
    $("#machineDialogTitle").textContent=`Edit ${existing.assetId} · ${existing.name}`;
    $("#machineDialogSubtitle").textContent="Changes are shared immediately. Renaming the machine also updates linked job history.";
    form.elements.assetId.value=existing.assetId||"";
    form.elements.name.value=existing.name||"";
    form.elements.section.value=existing.section||"";
    form.elements.category.value=existing.category||existing.section||"";
    form.elements.location.value=existing.location||"";
    form.elements.purchaseCost.value=existing.purchaseCost??"";
    form.elements.make.value=existing.make||"";
    form.elements.model.value=existing.model||"";
    form.elements.serialNumber.value=existing.serialNumber||"";
    form.elements.purchaseDate.value=existing.purchaseDate||"";
    form.elements.installDate.value=existing.installDate||"";
    form.elements.notes.value=existing.notes||"";
    $("#machineSaveBtn").textContent="Save Changes";
  } else {
    $("#machineDialogTitle").textContent="Add machine";
    $("#machineDialogSubtitle").textContent="Machine details are shared with the whole maintenance team.";
    if (preselect) $("#machineSectionSelect").value = preselect;
    $("#machineSaveBtn").textContent="Save Machine";
  }
  machineDialog.showModal();
}
$("#addMachineBtn").addEventListener("click",()=>openMachineDialog());
$("#manageAddMachineBtn").addEventListener("click",()=>openMachineDialog());
$$('[data-close-machine]').forEach(b=>b.addEventListener('click',()=>machineDialog.close()));
$("#machineSectionSelect").addEventListener("change",async e=>{
  if (e.target.value === "__add_section__") await addSectionInteractive(e.target);
});
$("#machineForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const o = Object.fromEntries(new FormData(e.currentTarget).entries());
  if (!o.section || o.section.startsWith('__')) { alert("Select a section."); return; }
  const id=String(o.machineId||"");
  const assetId=String(o.assetId||"").trim(),name=String(o.name||"").trim();
  if (machines.some(m=>m.id!==id && String(m.assetId).toLowerCase()===assetId.toLowerCase())) { alert("That asset ID already exists."); return; }
  if (machines.some(m=>m.id!==id && m.name.toLowerCase()===name.toLowerCase())) { alert("A machine with that name already exists."); return; }
  const machine = {assetId,name,section:o.section,category:o.category,location:o.location,purchaseCost:o.purchaseCost===""?null:Number(o.purchaseCost),make:o.make,model:o.model,serialNumber:o.serialNumber,purchaseDate:o.purchaseDate,installDate:o.installDate,notes:o.notes};
  const submit=$("#machineSaveBtn"); submit.disabled=true; submit.textContent="Saving…";
  try {
    if(id){
      const result=await masterMutation({entity:"machine",action:"update",id,machine});
      if(!result)return;
      selectedMachineId=id;
    } else {
      const payload=await saveMutation("/api/machines",{machine},{render:false});
      if(payload.state)applySharedState(payload);
      selectedMachineId=payload.machineId||machines.find(m=>m.assetId===assetId)?.id||selectedMachineId;
      renderAll();
    }
    machineDialog.close();
  } catch(error){showSaveError(error);}
  finally { submit.disabled=false; submit.textContent=id?"Save Changes":"Save Machine"; }
});

$("#manageAddSectionBtn").addEventListener("click",async()=>{
  const name=prompt("New section name:"); if(!name?.trim())return;
  try{await saveMutation("/api/catalog",{type:"section",value:name.trim()});}catch(error){showSaveError(error);}
});
$("#manageAddSupplierBtn").addEventListener("click",async()=>{
  const name=prompt("New supplier name:"); if(!name?.trim())return;
  try{await saveMutation("/api/catalog",{type:"supplier",value:name.trim()});}catch(error){showSaveError(error);}
});
$("#manageAddPartBtn").addEventListener("click",async()=>{
  const name=prompt("New part name:"); if(!name?.trim())return;
  const partNo=prompt("Part number (optional):")||"";
  try{await saveMutation("/api/catalog",{type:"part",name:name.trim(),partNo:partNo.trim()});}catch(error){showSaveError(error);}
});
$("#dataView").addEventListener("click",e=>{
  const button=e.target.closest('[data-master-action]');
  if(button) handleMasterAction(button);
});

$("#downloadExcelBtn").addEventListener("click",downloadExcelReport);
$("#printReportBtn").addEventListener("click",()=>window.print());

async function initializeApp(){
  try {
    const payload=await refreshSharedState({render:false});
    const identity=payload.identity||{};
    const params=new URLSearchParams(location.search);
    if(identity.cloudflareLogin && identity.admin && params.get("view")!=="dashboard") {
      location.replace("/admin");
      return;
    }
    renderAll();
  } catch(error) {
    console.error(error);
    document.body.innerHTML=`<main style="max-width:760px;margin:60px auto;font-family:system-ui;padding:24px"><h1>Maintenance Manager</h1><p>The shared database could not be loaded.</p><pre style="white-space:pre-wrap;background:#f4f5f7;padding:16px;border-radius:10px">${esc(error.message||error)}</pre><p>Check that the Worker has a D1 binding named DB, then reload this page. Tables are created automatically on first use.</p></main>`;
  }
}
window.addEventListener("focus",()=>{ if(!jobDialog.open && !machineDialog.open) refreshSharedState().catch(()=>{}); });
initializeApp();
