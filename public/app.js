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
let operatorRequests = [];
let stockOrders = [];
let purchaseOrders = [];
let projects = [];
let stockPurchasingTab = "needs";
let stockTransactions = [];
let preventiveCategories = [];
let preventiveSchedules = [];
let preventiveHistory = [];
let sharedRevision = 0;
let signedInIdentity = null;
let appSettings = {
  companyName: "",
  siteName: "Maintenance Manager",
  currency: "GBP",
  defaultPriority: "Medium",
  maxAttachmentMb: 25,
  allowAllFileTypes: true,
  allowedExtensions: "jpg,jpeg,png,webp,gif,pdf,doc,docx,xls,xlsx,csv,txt,rtf,zip,7z"
};

const now = new Date();
let selectedYear = now.getFullYear();
let selectedMonth = now.getMonth();
let selectedMachineId = null;
let selectedProfileId = "all"; // Cloudflare login proves access; profile choice is only a filter.
let machineDetailTab = "overview";
let partRowCounter = 0;
let orderedPartRowCounter = 0;
let timeRowCounter = 0;
let editingJobNo = null;
let pendingJobFiles = [];
let editingStockPartId = null;
let stockTrackingTouched = false;
let downtimeRangeMode = "selected-month";
let downtimeCustomStart = "";
let downtimeCustomEnd = "";
let machineSearchQuery = "";
let machineSectionFilter = "all";
let machineStatusFilter = "all";
let selectedPmCategory = "all";
let editingPurchaseOrderId = null;
let orderedPurchaseSearchQuery = "";
let editingProjectId = null;
let editingPartUsageRef = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const money = n => new Intl.NumberFormat("en-GB",{style:"currency",currency:appSettings.currency||"GBP",minimumFractionDigits:2}).format(Number(n)||0);
const shortMoney = n => new Intl.NumberFormat("en-GB",{style:"currency",currency:appSettings.currency||"GBP",maximumFractionDigits:0}).format(Number(n)||0);
const currencySymbol = () => ({GBP:"£",EUR:"€",USD:"$",CAD:"C$",AUD:"A$"}[appSettings.currency] || appSettings.currency || "£");
const maxAttachmentBytes = () => Math.max(1,Number(appSettings.maxAttachmentMb)||25)*1024*1024;
const attachmentPolicyText = () => appSettings.allowAllFileTypes ? `Maximum ${Number(appSettings.maxAttachmentMb)||25} MB per file. Any file type is allowed.` : `Maximum ${Number(appSettings.maxAttachmentMb)||25} MB per file. Allowed: ${appSettings.allowedExtensions||"configured extensions"}.`;
const attachmentAccept = () => appSettings.allowAllFileTypes ? "" : String(appSettings.allowedExtensions||"").split(",").map(x=>x.trim().replace(/^\./,"")).filter(Boolean).map(x=>`.${x}`).join(",");
const fileAllowedClient = file => {
  if(appSettings.allowAllFileTypes)return true;
  const ext=String(file?.name||"").toLowerCase().split(".").pop();
  const allowed=String(appSettings.allowedExtensions||"").split(",").map(x=>x.trim().toLowerCase().replace(/^\./,"")).filter(Boolean);
  return Boolean(ext&&allowed.includes(ext));
};
const fmtDate = d => d ? new Date(d+"T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const partTotal = p => (Number(p.qty)||0)*(Number(p.unitPrice)||0);
const partOrderedQty = p => Math.max(0, Number(p?.orderedQty)||0);
const partOrderedTotal = p => partOrderedQty(p)*(Number(p?.unitPrice)||0);
const jobPartsCost = j => (j.parts||[]).reduce((a,p)=>a+partTotal(p),0);
const jobHours = j => Array.isArray(j.timeEntries) ? j.timeEntries.reduce((a,t)=>a+(Number(t.hours)||0),0) : Number(j.hours)||0;
const machineForJob = j => machines.find(m=>String(m.id)===String(j?.machineId||"")) || machines.find(m=>m.name===j?.machine && (!j?.section || m.section===j.section)) || machines.find(m=>m.name===j?.machine) || null;
const machineLabel = j => { const m=machineForJob(j); return m ? `${m.assetId} · ${m.name}` : j?.machine || "Unknown machine"; };
const jobBelongsToMachine = (j,machine) => Boolean(machine && (String(j?.machineId||"")===String(machine.id) || (!j?.machineId && j?.machine===machine.name && (!j?.section || j.section===machine.section))));
const selectedPrefix = () => `${selectedYear}-${String(selectedMonth+1).padStart(2,"0")}`;
const inSelectedMonth = d => Boolean(d && d.startsWith(selectedPrefix()));
const partsThisMonth = j => (j.parts||[]).filter(p=>inSelectedMonth(p.date));
const spendThisMonth = j => partsThisMonth(j).reduce((a,p)=>a+partTotal(p),0);
const orderedSpendThisMonth = j => partsThisMonth(j).reduce((a,p)=>a+partOrderedTotal(p),0);
const activeProfiles = () => profiles.filter(p=>p.active!==false);
const isSectionArchived = name => archivedSections.includes(name);
const isSupplierArchived = name => archivedSuppliers.includes(name);
const isMachineArchived = machine => String(machine?.status || "Active").toLowerCase() === "archived";
const activeSections = () => sections.filter(s=>!isSectionArchived(s));
const activeSuppliers = () => suppliers.filter(s=>!isSupplierArchived(s));
const activeParts = () => partCatalog.filter(p=>p.active!==false);
const activeProjects = () => projects.filter(project=>String(project.status||"Active")!=="Archived");
const projectForId = id => projects.find(project=>String(project.id)===String(id||"")) || null;
const projectLabel = id => { const project=projectForId(id); return project ? `${project.code?`${project.code} · `:""}${project.name}` : ""; };

const stockTrackedParts = () => partCatalog.filter(p=>p.active!==false && p.stockTracked===true);
const lowStockParts = () => stockTrackedParts().filter(p=>(Number(p.currentStock)||0) <= (Number(p.minStock)||0));
const stockStatus = p => {
  if(p?.stockTracked!==true) return {label:"Not tracked",className:"stock-off"};
  const current=Number(p.currentStock)||0, min=Math.max(0,Number(p.minStock)||0);
  if(current<=0) return {label:"Out of stock",className:"stock-out"};
  if(current<=min) return {label:"Low stock",className:"stock-low"};
  return {label:"In stock",className:"stock-ok"};
};
const stockNumber = value => Number.isInteger(Number(value)) ? String(Number(value)) : String(Number(value)||0);
const trueFlag = value => value === true || value === 1 || String(value).toLowerCase() === "true" || String(value) === "1";
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
  partCatalog = Array.isArray(state.partCatalog) ? state.partCatalog.map(p=>({
    ...p,
    active:p.active!==false,
    stockTracked:trueFlag(p.stockTracked),
    currentStock:Number.isFinite(Number(p.currentStock))?Number(p.currentStock):0,
    minStock:Math.max(0,Number.isFinite(Number(p.minStock))?Number(p.minStock):0),
    binLocation:String(p.binLocation||""),
    preferredSupplier:String(p.preferredSupplier||""),
    reorderQty:Math.max(1,Number.isFinite(Number(p.reorderQty))?Number(p.reorderQty):1)
  })) : [];
  suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  archivedSuppliers = Array.isArray(state.archivedSuppliers) ? state.archivedSuppliers : [];
  profiles = Array.isArray(state.profiles) ? state.profiles : [];
  stockOrders = Array.isArray(state.stockOrders) ? state.stockOrders : [];
  purchaseOrders = Array.isArray(state.purchaseOrders) ? state.purchaseOrders : [];
  projects = Array.isArray(state.projects) ? state.projects : [];
  stockTransactions = Array.isArray(state.stockTransactions) ? state.stockTransactions : [];
  preventiveCategories = Array.isArray(state.preventiveCategories) && state.preventiveCategories.length ? state.preventiveCategories : [
    {id:"pmcat-mechanical",name:"Mechanical",active:true},
    {id:"pmcat-electrical",name:"Electrical",active:true},
    {id:"pmcat-tooling",name:"Tooling",active:true}
  ];
  preventiveSchedules = Array.isArray(state.preventiveSchedules) ? state.preventiveSchedules : [];
  preventiveHistory = Array.isArray(state.preventiveHistory) ? state.preventiveHistory : [];
  appSettings = { ...appSettings, ...(state.settings && typeof state.settings === "object" ? state.settings : {}) };
  if (Number.isFinite(Number(payload?.revision))) sharedRevision = Number(payload.revision);
  if (payload?.identity) signedInIdentity = payload.identity;
  if (!selectedMachineId || !machines.some(m=>m.id===selectedMachineId)) selectedMachineId = machines[0]?.id || null;
  if (selectedProfileId !== "all" && !profiles.some(p=>p.id===selectedProfileId && p.active!==false)) selectedProfileId = "all";
}

function applyUiSettings() {
  const siteName=String(appSettings.siteName||"Maintenance Manager").trim()||"Maintenance Manager";
  const companyName=String(appSettings.companyName||"").trim();
  document.title=companyName?`${siteName} · ${companyName}`:siteName;
  const words=siteName.split(/\s+/);
  if($("#brandTitle")) $("#brandTitle").textContent=words.shift()||"Maintenance";
  if($("#brandSubtitle")) $("#brandSubtitle").textContent=(words.join(" ")||companyName||"Manager");
  const purpleIcon=document.querySelector(".kpi-icon.purple"); if(purpleIcon)purpleIcon.textContent=currencySymbol();
  if($("#purchaseCostLabel")) $("#purchaseCostLabel").textContent=`Purchase cost (${currencySymbol()})`;
  if($("#jobAttachmentHelp")) $("#jobAttachmentHelp").textContent=`Attach multiple photos, manuals, documents or any other permitted file type. ${attachmentPolicyText()}`;
  const accept=attachmentAccept();
  [$("#jobAttachmentInput"),$("#machineAttachmentInput")].forEach(input=>{if(input){if(accept)input.setAttribute("accept",accept);else input.removeAttribute("accept");}});
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

async function refreshOperatorRequests({render=true}={}) {
  try {
    const payload = await api("/api/requests", { method:"GET", headers:{accept:"application/json"} });
    operatorRequests = Array.isArray(payload.requests) ? payload.requests : [];
    if (render) renderAll();
    return payload;
  } catch (error) {
    console.warn("Could not load operator requests", error);
    if (render) renderRequests();
    return { requests: operatorRequests, error };
  }
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

function formatBytes(bytes) {
  const n=Number(bytes)||0;
  if(n<1024)return `${n} B`;
  if(n<1024*1024)return `${(n/1024).toFixed(n<10240?1:0)} KB`;
  return `${(n/(1024*1024)).toFixed(n<10*1024*1024?1:0)} MB`;
}

function attachmentDate(value) {
  if(!value)return "";
  const d=new Date(String(value).replace(" ","T")+(/Z$|[+-]\d\d:\d\d$/.test(String(value))?"":"Z"));
  return Number.isNaN(d.getTime())?String(value):d.toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
}

function attachmentFileUrl(id, download=false) {
  return `/api/attachments/file?id=${encodeURIComponent(id)}${download?"&download=1":""}`;
}

function attachmentIcon(contentType, fileName) {
  const type=String(contentType||"").toLowerCase();
  const ext=String(fileName||"").split(".").pop().toLowerCase();
  if(type.startsWith("image/"))return "🖼️";
  if(type==="application/pdf"||ext==="pdf")return "📕";
  if(["doc","docx","odt","rtf"].includes(ext))return "📘";
  if(["xls","xlsx","csv","ods"].includes(ext))return "📊";
  if(["zip","rar","7z","tar","gz"].includes(ext))return "🗜️";
  if(type.startsWith("video/"))return "🎬";
  if(type.startsWith("audio/"))return "🎵";
  return "📎";
}

function attachmentRowsHtml(items) {
  if(!items.length)return `<p class="empty-note attachment-empty">No photos or files attached yet.</p>`;
  return items.map(a=>{
    const image=String(a.contentType||"").toLowerCase().startsWith("image/") && !["image/svg+xml"].includes(String(a.contentType||"").toLowerCase());
    const preview=image?`<a class="attachment-thumb" href="${attachmentFileUrl(a.id)}" target="_blank" rel="noopener"><img src="${attachmentFileUrl(a.id)}" alt="${esc(a.fileName)}" loading="lazy" /></a>`:`<div class="attachment-icon">${attachmentIcon(a.contentType,a.fileName)}</div>`;
    return `<div class="attachment-row">${preview}<div class="attachment-info"><strong>${esc(a.label||a.fileName)}</strong>${a.label?`<span>${esc(a.fileName)}</span>`:""}<span>${formatBytes(a.sizeBytes)}${a.uploadedBy?` · ${esc(a.uploadedBy)}`:""}${a.uploadedAt?` · ${esc(attachmentDate(a.uploadedAt))}`:""}</span></div><div class="attachment-actions"><a class="btn secondary compact" href="${attachmentFileUrl(a.id)}" target="_blank" rel="noopener">Open</a><a class="btn secondary compact" href="${attachmentFileUrl(a.id,true)}">Download</a><button type="button" class="btn secondary compact" data-attachment-edit="${esc(a.id)}" data-label="${esc(a.label||"")}">Description</button><button type="button" class="btn danger compact" data-attachment-delete="${esc(a.id)}" data-name="${esc(a.fileName)}">Delete</button></div></div>`;
  }).join("");
}

async function uploadAttachment(entityType, entityId, file, label="") {
  if(!file)throw new Error("Choose a file to upload.");
  if(file.size>maxAttachmentBytes())throw new Error(`${file.name} is larger than ${Number(appSettings.maxAttachmentMb)||25} MB.`);
  if(!fileAllowedClient(file))throw new Error(`${file.name} is not an allowed file type.`);
  const body=new FormData();
  body.append("entityType",entityType);
  body.append("entityId",entityId);
  body.append("label",label);
  body.append("file",file,file.name);
  const response=await fetch("/api/attachments",{method:"POST",credentials:"same-origin",body});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw new Error(data?.error||`Upload failed (${response.status})`);
  return data;
}

async function loadAttachments(entityType, entityId, listEl, statusEl=null) {
  if(!listEl)return null;
  listEl.innerHTML=`<p class="empty-note">Loading files…</p>`;
  try{
    const data=await api(`/api/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,{method:"GET",headers:{accept:"application/json"}});
    listEl.innerHTML=attachmentRowsHtml(data.attachments||[]);
    if(statusEl){
      statusEl.textContent=data.storageConfigured?`${(data.attachments||[]).length} attachment${(data.attachments||[]).length===1?"":"s"}. Any signed-in maintenance user can add or delete files.`:"File storage is not configured yet.";
      statusEl.classList.toggle("attachment-error",!data.storageConfigured);
    }
    listEl.onclick=async e=>{
      const del=e.target.closest("[data-attachment-delete]");
      const edit=e.target.closest("[data-attachment-edit]");
      if(del){
        if(!confirm(`Delete ${del.dataset.name||"this file"}? This cannot be undone.`))return;
        del.disabled=true;
        try{await saveMutation("/api/attachments/delete",{id:del.dataset.attachmentDelete},{render:false});await loadAttachments(entityType,entityId,listEl,statusEl);}catch(error){showSaveError(error);del.disabled=false;}
      }
      if(edit){
        const label=prompt("File description (leave blank to show just the filename):",edit.dataset.label||"");
        if(label===null)return;
        try{await saveMutation("/api/attachments/update",{id:edit.dataset.attachmentEdit,label:label.trim()},{render:false});await loadAttachments(entityType,entityId,listEl,statusEl);}catch(error){showSaveError(error);}
      }
    };
    return data;
  }catch(error){
    listEl.innerHTML=`<p class="attachment-error">${esc(error.message||error)}</p>`;
    if(statusEl)statusEl.textContent="";
    return null;
  }
}

function addPendingJobFiles(fileList) {
  const added=[];
  for(const file of [...(fileList||[])]){
    if(file.size>maxAttachmentBytes()){alert(`${file.name} is larger than ${Number(appSettings.maxAttachmentMb)||25} MB and was not added.`);continue;}
    if(!fileAllowedClient(file)){alert(`${file.name} is not an allowed file type and was not added.`);continue;}
    pendingJobFiles.push(file);added.push(file);
  }
  renderPendingJobFiles();
  return added;
}

function renderPendingJobFiles() {
  const el=$("#jobPendingFiles");
  if(!el)return;
  el.innerHTML=pendingJobFiles.length?`<div class="pending-file-title">Selected to upload:</div>${pendingJobFiles.map((f,i)=>`<div class="pending-file"><span>📎 ${esc(f.name)} · ${formatBytes(f.size)}</span><button type="button" data-remove-pending="${i}" aria-label="Remove ${esc(f.name)}">×</button></div>`).join("")}`:"";
  const upload=$("#jobUploadAttachmentsBtn");
  if(upload){upload.disabled=!pendingJobFiles.length||!editingJobNo;upload.textContent=editingJobNo?"Upload selected":"Uploads after Save Job";}
}

async function uploadPendingJobFiles(jobNo) {
  if(!pendingJobFiles.length)return true;
  const status=$("#jobAttachmentStatus");
  const files=[...pendingJobFiles];
  let uploaded=0;
  for(const file of files){
    if(status)status.textContent=`Uploading ${uploaded+1} of ${files.length}: ${file.name}…`;
    await uploadAttachment("job",jobNo,file);
    uploaded+=1;
  }
  pendingJobFiles=[];
  renderPendingJobFiles();
  if(status)status.textContent=`Uploaded ${uploaded} file${uploaded===1?"":"s"}.`;
  await loadAttachments("job",jobNo,$("#jobAttachmentsList"),status);
  return true;
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


function localDateTimeValue(date=new Date()) {
  const pad=n=>String(n).padStart(2,"0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function parseLocalDateTime(value){const d=value?new Date(value):null;return d&&Number.isFinite(d.getTime())?d:null;}
function formatDurationMinutes(minutes){const n=Math.max(0,Math.round(Number(minutes)||0));const d=Math.floor(n/1440),h=Math.floor((n%1440)/60),m=n%60;return [d?`${d}d`:"",h?`${h}h`:"",`${m}m`].filter(Boolean).join(" ");}
function jobDowntimeMinutes(job,start,end){
  if(job?.downtimeStopped!==true||!job.downtimeStart)return 0;
  const ds=parseLocalDateTime(job.downtimeStart),de=parseLocalDateTime(job.downtimeEnd)||new Date();
  if(!ds)return 0;
  const from=Math.max(ds.getTime(),start.getTime()),to=Math.min(de.getTime(),end.getTime());
  return Math.max(0,(to-from)/60000);
}
function downtimeRange(){
  const n=new Date(); let start,end,label;
  if(downtimeRangeMode==="this-month"){start=new Date(n.getFullYear(),n.getMonth(),1);end=new Date(n.getFullYear(),n.getMonth()+1,1);label=`${FULL_MONTHS[n.getMonth()]} ${n.getFullYear()}`;}
  else if(downtimeRangeMode==="last-month"){start=new Date(n.getFullYear(),n.getMonth()-1,1);end=new Date(n.getFullYear(),n.getMonth(),1);label=`${FULL_MONTHS[start.getMonth()]} ${start.getFullYear()}`;}
  else if(downtimeRangeMode==="this-year"){start=new Date(n.getFullYear(),0,1);end=new Date(n.getFullYear()+1,0,1);label=String(n.getFullYear());}
  else if(downtimeRangeMode==="custom"){
    const s=downtimeCustomStart?new Date(`${downtimeCustomStart}T00:00:00`):new Date(n.getFullYear(),n.getMonth(),1);
    const e=downtimeCustomEnd?new Date(`${downtimeCustomEnd}T23:59:59`):new Date();
    start=s;end=e;label=`${fmtDate(downtimeCustomStart)} – ${fmtDate(downtimeCustomEnd)}`;
  } else {start=new Date(selectedYear,selectedMonth,1);end=new Date(selectedYear,selectedMonth+1,1);label=`${FULL_MONTHS[selectedMonth]} ${selectedYear}`;}
  return {start,end,label};
}
function currentDownJobs(){return jobs.filter(j=>j.downtimeStopped===true&&j.downtimeStart&&!j.downtimeEnd);}
function ensureV58Ui(){
  if(document.getElementById("downtimeView"))return;
  const style=document.createElement("style");style.id="v58Styles";style.textContent=`
  #mainNav .nav-item[data-view="openOrders"],#mainNav .nav-item[data-view="ordered"],#mainNav .nav-item[data-view="projects"],#mainNav .nav-item[data-view="preventive"],#mainNav .nav-item[data-view="downtime"]{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:12px!important;text-align:left!important}#mainNav .nav-item[data-view="openOrders"]>span:first-child,#mainNav .nav-item[data-view="ordered"]>span:first-child,#mainNav .nav-item[data-view="projects"]>span:first-child,#mainNav .nav-item[data-view="preventive"]>span:first-child,#mainNav .nav-item[data-view="downtime"]>span:first-child{display:inline-flex!important;align-items:center;justify-content:center;width:22px!important;min-width:22px!important;flex:0 0 22px!important;text-align:center}#mainNav .nav-item[data-view="openOrders"]>span:last-child,#mainNav .nav-item[data-view="ordered"]>span:last-child,#mainNav .nav-item[data-view="projects"]>span:last-child,#mainNav .nav-item[data-view="preventive"]>span:last-child,#mainNav .nav-item[data-view="downtime"]>span:last-child{margin:0!important;flex:0 1 auto!important;text-align:left!important}
  .v58-card{background:var(--card,#fff);border:1px solid #e2e7ef;border-radius:16px;padding:18px;margin:16px 0}.v58-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.v58-kpi{border:1px solid #e2e7ef;border-radius:12px;padding:14px}.v58-kpi span{display:block;color:#667085;font-size:.82rem}.v58-kpi strong{display:block;font-size:1.35rem;margin-top:6px}.v58-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.v58-pie-wrap{display:grid;grid-template-columns:180px 1fr;gap:18px;align-items:center}.v58-pie{width:180px;height:180px;border-radius:50%;background:#e7ebf1}.v58-controls{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.v58-controls label{display:grid;gap:5px;font-size:.82rem}.v58-controls select,.v58-controls input{padding:9px 10px;border:1px solid #cfd6e1;border-radius:8px;background:#fff}.machine-list-controls{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:9px;margin:0 0 10px;min-width:0}.machine-list-controls .machine-search-wrap{grid-column:1/-1;min-width:0}.machine-list-controls input,.machine-list-controls select{width:100%;min-width:0;padding:10px 11px;border:1px solid #cfd6e1;border-radius:9px;background:var(--card,#fff);font:inherit;color:inherit}.machine-download-qrs{grid-column:1/-1;width:100%}.machines-layout>*{min-width:0}.machine-list-panel,.machine-detail{min-width:0}.machine-list-count{font-size:.78rem;color:#667085;margin:0 0 9px}.machine-list-empty{padding:18px 12px;text-align:center;color:#667085;border:1px dashed #cfd6e1;border-radius:10px}.v58-down{border-left:4px solid #d92d20}.v58-down-list{display:grid;gap:10px}.v58-down-row{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid #f1c7c2;background:#fff7f6;border-radius:10px;padding:12px}.v58-order-tabs{display:grid;grid-template-columns:1fr;gap:16px}.stock-order-nav{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.stock-order-tab{border:1px solid #cfd6e1;background:#fff;color:#344054;border-radius:999px;padding:9px 13px;font:inherit;font-weight:700;cursor:pointer}.stock-order-tab.active{background:#101828;color:#fff;border-color:#101828}.stock-order-tab span{opacity:.72;font-size:.78rem;margin-left:5px}.stock-order-panel[hidden]{display:none}.v58-status{font-weight:700}.v58-status.ordered{color:#175cd3}.v58-status.received{color:#067647}.v58-status.cancelled{color:#667085}.v58-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.v58-downtime-editor{border:1px solid #e2e7ef;border-radius:12px;padding:14px;margin:14px 0}.v58-inline-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.v58-mini-note{font-size:.82rem;color:#667085}.v58-table-actions{display:flex;gap:6px;flex-wrap:wrap}.v58-alert{background:#fff5f4;border:1px solid #fecdca}.v58-order-card{margin-top:20px}.machine-tooling-editor{grid-column:1/-1;border:1px solid #dfe4ec;border-radius:12px;padding:14px;background:var(--card,#fff)}.machine-tooling-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}.machine-tooling-head small{display:block;color:#667085;margin-top:3px}.machine-tooling-rows{display:grid;gap:9px}.machine-tooling-row{display:grid;grid-template-columns:minmax(160px,.7fr) minmax(220px,1.3fr) auto;gap:8px;align-items:end}.machine-tooling-row label{min-width:0}.machine-tooling-row input{width:100%;min-width:0}.machine-tooling-empty{color:#667085;font-size:.82rem;padding:5px 0}.machine-tooling-overview{margin:14px 0;border:1px solid #e2e7ef;border-radius:12px;padding:14px}.machine-tooling-overview h3{margin:0 0 10px}.machine-tooling-list{display:grid;gap:8px}.machine-tooling-item{padding:9px 10px;border:1px solid #e6eaf0;border-radius:9px}.machine-tooling-item small{display:block;color:#667085;margin-top:3px}.job-ordered-parts-section{margin:18px 0 22px;padding:14px;border:1px solid #dfe4ec;border-radius:12px;background:var(--card,#fff)}.job-ordered-parts-section h3{margin:0 0 6px}.job-ordered-parts-section>p{margin:0 0 12px;color:#667085;font-size:.86rem}.job-ordered-parts-section .price-note{margin-top:8px}
  @media(max-width:900px){.v58-grid{grid-template-columns:1fr 1fr}.v58-two{grid-template-columns:1fr}.v58-pie-wrap{grid-template-columns:140px 1fr}.v58-pie{width:140px;height:140px}.v58-form-grid{grid-template-columns:1fr}.machine-list-controls{grid-template-columns:1fr 1fr}.machine-list-controls .machine-search-wrap{grid-column:1/-1}}@media(max-width:520px){.v58-grid{grid-template-columns:1fr}.v58-pie-wrap{grid-template-columns:1fr}.v58-pie{margin:auto}.machine-list-controls{grid-template-columns:1fr}.machine-list-controls .machine-search-wrap{grid-column:auto}.machine-tooling-head{align-items:flex-start}.machine-tooling-row{grid-template-columns:1fr}.machine-tooling-row button{width:100%}}}
  `;document.head.appendChild(style);
  const nav=document.getElementById("mainNav");if(nav){const b=document.createElement("button");b.type="button";b.className="nav-item";b.dataset.view="downtime";b.innerHTML=`<span>⏱</span><span>Downtime</span>`;const report=nav.querySelector('[data-view="reports"]');nav.insertBefore(b,report||null);}
  const main=document.querySelector("main")||document.body;const reference=document.getElementById("reportsView");const viewParent=reference?.parentNode||main;const view=document.createElement("section");view.id="downtimeView";view.className="view";view.innerHTML=`<div class="view-head"><div><h1>Downtime</h1><p id="downtimeSubtitle">Production downtime by section and machine.</p></div></div><div class="v58-card"><div class="v58-controls"><label>Range<select id="downtimeRangeMode"><option value="selected-month">Selected month</option><option value="this-month">This month</option><option value="last-month">Last month</option><option value="this-year">This year</option><option value="custom">Custom dates</option></select></label><label class="v58-custom-date" hidden>From<input id="downtimeCustomStart" type="date"></label><label class="v58-custom-date" hidden>To<input id="downtimeCustomEnd" type="date"></label><button type="button" class="btn secondary compact" id="downtimeRefreshBtn">Refresh</button></div></div><div class="v58-grid"><div class="v58-kpi"><span>Total downtime</span><strong id="downtimeTotal">0m</strong></div><div class="v58-kpi"><span>Machines currently down</span><strong id="downtimeCurrent">0</strong></div><div class="v58-kpi"><span>Worst section</span><strong id="downtimeWorstSection">—</strong></div><div class="v58-kpi"><span>Worst machine</span><strong id="downtimeWorstMachine">—</strong></div></div><div id="downtimeCurrentCard" class="v58-card v58-down" hidden><h2>Currently down</h2><div id="downtimeCurrentList" class="v58-down-list"></div></div><div class="v58-two"><div class="v58-card"><h2>Downtime by section</h2><div class="v58-pie-wrap"><div id="downtimeSectionPie" class="v58-pie"></div><div id="downtimeSectionLegend"></div></div></div><div class="v58-card"><h2>Downtime by machine</h2><div class="v58-pie-wrap"><div id="downtimeMachinePie" class="v58-pie"></div><div id="downtimeMachineLegend"></div></div></div></div><div class="v58-card"><h2>Downtime detail</h2><div class="table-wrap"><table><thead><tr><th>Machine</th><th>Section</th><th>Job</th><th>Start</th><th>End</th><th>Downtime in range</th><th>Action</th></tr></thead><tbody id="downtimeBody"></tbody></table></div></div>`;if(reference)viewParent.insertBefore(view,reference);else viewParent.appendChild(view);
  const dashboard=document.getElementById("dashboardView");if(dashboard){const card=document.createElement("div");card.id="dashboardCurrentDown";card.className="v58-card v58-alert";card.hidden=true;dashboard.insertBefore(card,dashboard.firstElementChild?.nextSibling||dashboard.firstChild);}
  const jobFormForOrdered=document.getElementById("jobForm");
  if(jobFormForOrdered&&!document.getElementById("partsOrderedEditor")){
    const orderedSection=document.createElement("section");
    orderedSection.id="jobPartsOrderedSection";
    orderedSection.className="job-ordered-parts-section";
    orderedSection.innerHTML=`<h3>Parts ordered (optional)</h3><p>Record parts ordered specifically for this job. These quantities are for the job record only and do not reduce stock.</p><div id="partsOrderedEditor"></div><button type="button" class="btn secondary compact" id="addOrderedPartRowBtn">＋ Add ordered part</button>`;
    const usedHeading=[...jobFormForOrdered.querySelectorAll("h2,h3,h4")].find(el=>/^Parts used/i.test(String(el.textContent||"").trim()));
    const usedEditor=document.getElementById("partsEditor");
    if(usedHeading?.parentNode)usedHeading.parentNode.insertBefore(orderedSection,usedHeading);
    else if(usedEditor?.parentNode)usedEditor.parentNode.insertBefore(orderedSection,usedEditor);
    else jobFormForOrdered.appendChild(orderedSection);
  }
  const parts=document.getElementById("partsView");if(parts){const block=document.createElement("div");block.id="stockPurchasingBlock";block.className="v58-order-card";block.innerHTML=`<div class="v58-card"><div class="history-heading"><div><h2>Purchasing</h2><p>Build orders, place them when ready, then receive stock against placed orders.</p></div></div><div class="stock-order-nav" id="stockOrderNav"><button type="button" class="stock-order-tab" data-stock-order-tab="needs">Needs ordering <span id="needsOrderingCount">0</span></button><button type="button" class="stock-order-tab" data-stock-order-tab="open">Open orders <span id="openOrdersCount">0</span></button><button type="button" class="stock-order-tab" data-stock-order-tab="ordered">Ordered <span id="orderedOrdersCount">0</span></button><button type="button" class="stock-order-tab" data-stock-order-tab="movements">Stock movements</button></div><div class="v58-order-tabs"><div class="stock-order-panel" data-stock-order-panel="needs"><h3>Needs ordering</h3><p class="v58-mini-note">Create an open order here. It will not count as placed until you press <strong>Place order</strong>.</p><div class="table-wrap"><table><thead><tr><th>Part</th><th>Stock</th><th>Minimum</th><th>Already open / ordered</th><th>Preferred supplier</th><th></th></tr></thead><tbody id="needsOrderingBody"></tbody></table></div></div><div class="stock-order-panel" data-stock-order-panel="open"><h3>Open orders</h3><p class="v58-mini-note">Draft orders waiting to be placed.</p><div class="table-wrap"><table><thead><tr><th>Created</th><th>Part</th><th>Supplier</th><th>Qty</th><th>Expected</th><th>Status</th><th></th></tr></thead><tbody id="openOrdersBody"></tbody></table></div></div><div class="stock-order-panel" data-stock-order-panel="ordered"><h3>Ordered</h3><p class="v58-mini-note">Orders that have been placed and are waiting for delivery.</p><div class="table-wrap"><table><thead><tr><th>Placed</th><th>Part</th><th>Supplier</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Status</th><th></th></tr></thead><tbody id="orderedOrdersBody"></tbody></table></div></div><div class="stock-order-panel" data-stock-order-panel="movements"><h3>Recent stock movements</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Part</th><th>Movement</th><th>Quantity</th><th>Balance</th><th>Reference</th></tr></thead><tbody id="stockTransactionsBody"></tbody></table></div></div></div></div>`;parts.appendChild(block);}
  const jobForm=document.getElementById("jobForm");if(jobForm){const box=document.createElement("div");box.className="v58-downtime-editor";box.id="jobDowntimeEditor";box.innerHTML=`<h3>Machine downtime</h3><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="downtimeStopped" id="jobDowntimeStopped"> Machine stopped / production lost</label><div class="v58-form-grid" id="jobDowntimeFields"><label>Downtime started<input type="datetime-local" name="downtimeStart" id="jobDowntimeStart"></label><label>Back in production<input type="datetime-local" name="downtimeEnd" id="jobDowntimeEnd"></label></div><div class="v58-inline-actions"><button type="button" class="btn secondary compact" id="downtimeStartNowBtn">Start now</button><button type="button" class="btn secondary compact" id="downtimeEndNowBtn">Back in production now</button></div><p class="v58-mini-note">Leave the end time blank while the machine is still down. Downtime reports calculate the live duration automatically.</p>`;const anchor=jobForm.querySelector(".dialog-actions,.form-actions,.modal-actions");jobForm.insertBefore(box,anchor||null);}
  const stockForm=document.getElementById("stockForm");if(stockForm){const anchor=stockForm.querySelector(".dialog-actions,.form-actions,.modal-actions");if(!stockForm.elements.partNo){const identity=document.createElement("div");identity.className="v58-form-grid";identity.id="stockPartIdentity";identity.innerHTML=`<label>Part number<input name="partNo" id="stockEditablePartNumber" maxlength="100" placeholder="Optional"></label>`;stockForm.insertBefore(identity,anchor||null);}const extra=document.createElement("div");extra.className="v58-form-grid";extra.id="stockPurchasingDefaults";extra.innerHTML=`<label>Preferred supplier<input name="preferredSupplier" id="stockPreferredSupplier" list="v58SupplierList" placeholder="Optional"></label><label>Default reorder quantity<input name="reorderQty" id="stockReorderQty" type="number" min="1" step="1" value="1"></label><datalist id="v58SupplierList"></datalist>`;stockForm.insertBefore(extra,anchor||null);}
  const dlg=document.createElement("dialog");dlg.id="stockOrderDialog";dlg.innerHTML=`<form method="dialog" id="stockOrderForm" style="min-width:min(520px,90vw);padding:20px"><h2 id="stockOrderTitle">Create open order</h2><input type="hidden" name="partId"><div class="v58-form-grid"><label>Quantity ordered<input name="qty" type="number" min="1" step="1" required></label><label>Supplier<input name="supplier" list="v58SupplierList"></label><label>Expected date<input name="expectedDate" type="date"></label><label>Note<input name="note" maxlength="300"></label></div><div class="v58-inline-actions" style="justify-content:flex-end"><button type="button" class="btn secondary" id="stockOrderCancelBtn">Cancel</button><button type="submit" class="btn primary">Add to Open Orders</button></div></form>`;document.body.appendChild(dlg);
  bindV58Events();
}
function setDowntimeFieldsEnabled(){const on=$("#jobDowntimeStopped")?.checked;[$("#jobDowntimeStart"),$("#jobDowntimeEnd")].forEach(el=>{if(el)el.disabled=!on;});}
function bindV58Events(){
  $("#jobDowntimeStopped")?.addEventListener("change",()=>{if($("#jobDowntimeStopped").checked&&!$("#jobDowntimeStart").value)$("#jobDowntimeStart").value=localDateTimeValue();setDowntimeFieldsEnabled();});
  $("#downtimeStartNowBtn")?.addEventListener("click",()=>{$("#jobDowntimeStopped").checked=true;$("#jobDowntimeStart").value=localDateTimeValue();setDowntimeFieldsEnabled();});
  $("#downtimeEndNowBtn")?.addEventListener("click",()=>{$("#jobDowntimeStopped").checked=true;if(!$("#jobDowntimeStart").value)$("#jobDowntimeStart").value=localDateTimeValue();$("#jobDowntimeEnd").value=localDateTimeValue();setDowntimeFieldsEnabled();});
  $("#downtimeRangeMode")?.addEventListener("change",e=>{downtimeRangeMode=e.target.value;$$('.v58-custom-date').forEach(x=>x.hidden=downtimeRangeMode!=="custom");renderDowntime();});
  $("#downtimeCustomStart")?.addEventListener("change",e=>{downtimeCustomStart=e.target.value;renderDowntime();});
  $("#downtimeCustomEnd")?.addEventListener("change",e=>{downtimeCustomEnd=e.target.value;renderDowntime();});
  $("#downtimeRefreshBtn")?.addEventListener("click",async()=>{await refreshSharedState({render:false});renderAll();});
  $("#downtimeView")?.addEventListener("click",async e=>{const back=e.target.closest('[data-downtime-end-job]');if(back){await markBackInProduction(back.dataset.downtimeEndJob);return;}const edit=e.target.closest('[data-edit-downtime-job]');if(edit)openJob(edit.dataset.editDowntimeJob);});
  $("#partsView")?.addEventListener("click",async e=>{const tab=e.target.closest('[data-stock-order-tab]');if(tab){stockPurchasingTab=tab.dataset.stockOrderTab||"needs";renderStockPurchasing();return;}const order=e.target.closest('[data-order-part]');if(order){openStockOrderDialog(order.dataset.orderPart);return;}const place=e.target.closest('[data-place-order]');if(place){await placeStockOrder(place.dataset.placeOrder);return;}const receive=e.target.closest('[data-receive-order]');if(receive){await receiveStockOrder(receive.dataset.receiveOrder);return;}const del=e.target.closest('[data-delete-order]');if(del){await deleteStockOrder(del.dataset.deleteOrder);return;}const cancel=e.target.closest('[data-cancel-order]');if(cancel){await cancelStockOrder(cancel.dataset.cancelOrder);return;}});
  $("#stockOrderCancelBtn")?.addEventListener("click",()=>$("#stockOrderDialog")?.close());
  $("#stockOrderForm")?.addEventListener("submit",submitStockOrder);
}
function renderCurrentDownDashboard(){const box=$("#dashboardCurrentDown");if(!box)return;const rows=currentDownJobs();box.hidden=!rows.length;if(!rows.length)return;box.innerHTML=`<div class="history-heading"><div><h2>⚠ Machines currently down</h2><p>${rows.length} machine${rows.length===1?" is":"s are"} still marked out of production.</p></div><button class="btn secondary compact" type="button" data-nav="downtime">Open downtime</button></div><div class="v58-down-list">${rows.slice(0,5).map(j=>`<div class="v58-down-row"><span><strong>${esc(machineLabel(j))}</strong><br><small>${esc(j.section||inferSection(j.machine))} · ${esc(j.jobNo)}</small></span><strong>${formatDurationMinutes((Date.now()-parseLocalDateTime(j.downtimeStart).getTime())/60000)}</strong></div>`).join("")}</div>`;box.querySelector('[data-nav="downtime"]')?.addEventListener('click',()=>switchView('downtime'));}
function renderDowntime(){
  if(!$("#downtimeView"))return;const {start,end,label}=downtimeRange();const base=visibleJobs();const rows=base.map(j=>({job:j,minutes:jobDowntimeMinutes(j,start,end)})).filter(x=>x.minutes>0).sort((a,b)=>b.minutes-a.minutes);const total=rows.reduce((a,x)=>a+x.minutes,0);const sectionMap=new Map(),machineMap=new Map();for(const x of rows){const section=x.job.section||inferSection(x.job.machine);sectionMap.set(section,(sectionMap.get(section)||0)+x.minutes);const machineName=machineLabel(x.job);machineMap.set(machineName,(machineMap.get(machineName)||0)+x.minutes);}const sectionRows=[...sectionMap].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value),machineRows=[...machineMap].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);$("#downtimeSubtitle").textContent=`Production downtime for ${label} · ${profileContext()}.`;$("#downtimeTotal").textContent=formatDurationMinutes(total);$("#downtimeCurrent").textContent=String(currentDownJobs().length);$("#downtimeWorstSection").textContent=sectionRows[0]?`${sectionRows[0].name} · ${formatDurationMinutes(sectionRows[0].value)}`:"—";$("#downtimeWorstMachine").textContent=machineRows[0]?`${machineRows[0].name} · ${formatDurationMinutes(machineRows[0].value)}`:"—";renderPie($("#downtimeSectionPie"),$("#downtimeSectionLegend"),sectionRows,v=>formatDurationMinutes(v));renderPie($("#downtimeMachinePie"),$("#downtimeMachineLegend"),machineRows,v=>formatDurationMinutes(v));const down=currentDownJobs();$("#downtimeCurrentCard").hidden=!down.length;$("#downtimeCurrentList").innerHTML=down.map(j=>`<div class="v58-down-row"><span><strong>${esc(machineLabel(j))}</strong><br><small>${esc(j.section||inferSection(j.machine))} · ${esc(j.jobNo)} · since ${esc(new Date(j.downtimeStart).toLocaleString("en-GB"))}</small></span><div class="v58-table-actions"><strong>${formatDurationMinutes((Date.now()-parseLocalDateTime(j.downtimeStart).getTime())/60000)}</strong><button type="button" class="btn primary compact" data-downtime-end-job="${esc(j.jobNo)}">Back in production</button></div></div>`).join("");$("#downtimeBody").innerHTML=rows.length?rows.map(x=>`<tr><td>${esc(machineLabel(x.job))}</td><td>${esc(x.job.section||inferSection(x.job.machine))}</td><td><button type="button" class="job-link" data-edit-downtime-job="${esc(x.job.jobNo)}">${esc(x.job.jobNo)}</button></td><td>${esc(new Date(x.job.downtimeStart).toLocaleString("en-GB"))}</td><td>${x.job.downtimeEnd?esc(new Date(x.job.downtimeEnd).toLocaleString("en-GB")):'<span class="pill p-high">Still down</span>'}</td><td><strong>${formatDurationMinutes(x.minutes)}</strong></td><td>${x.job.downtimeEnd?`<button type="button" class="btn secondary compact" data-edit-downtime-job="${esc(x.job.jobNo)}">Edit</button>`:`<button type="button" class="btn primary compact" data-downtime-end-job="${esc(x.job.jobNo)}">Back in production</button>`}</td></tr>`).join(""):`<tr><td colspan="7">No downtime recorded for this range.</td></tr>`;
}
async function markBackInProduction(jobNo){const job=jobs.find(j=>j.jobNo===jobNo);if(!job)return;const updated={...job,downtimeStopped:true,downtimeEnd:localDateTimeValue()};try{await saveMutation("/api/jobs",{job:updated,originalJobNo:job.jobNo});switchView("downtime");}catch(error){showSaveError(error);}}
function outstandingOrderQty(partId){return stockOrders.filter(o=>String(o.partId)===String(partId)&&!["Received","Cancelled"].includes(String(o.status))).reduce((n,o)=>n+Math.max(0,(Number(o.orderedQty)||0)-(Number(o.receivedQty)||0)),0);}
function stockOrderDate(value){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("en-GB");}
function setStockPurchasingTab(){const allowed=new Set(["needs","open","ordered","movements"]);if(!allowed.has(stockPurchasingTab))stockPurchasingTab="needs";$$('[data-stock-order-tab]').forEach(btn=>btn.classList.toggle("active",btn.dataset.stockOrderTab===stockPurchasingTab));$$('[data-stock-order-panel]').forEach(panel=>panel.hidden=panel.dataset.stockOrderPanel!==stockPurchasingTab);}
function renderStockPurchasing(){
  if(!$("#needsOrderingBody"))return;
  const needs=partCatalog.filter(p=>p.active!==false&&p.stockTracked===true&&(Number(p.currentStock)||0)<=(Number(p.minStock)||0)).sort((a,b)=>(Number(a.currentStock)||0)-(Number(b.currentStock)||0));
  const open=[...stockOrders].filter(o=>String(o.status||"")==="Open").sort((a,b)=>String(b.createdAt||b.orderedAt||"").localeCompare(String(a.createdAt||a.orderedAt||"")));
  const ordered=[...stockOrders].filter(o=>["Ordered","Part received"].includes(String(o.status||""))).sort((a,b)=>String(b.orderedAt||b.createdAt||"").localeCompare(String(a.orderedAt||a.createdAt||"")));
  $("#needsOrderingCount").textContent=String(needs.length);$("#openOrdersCount").textContent=String(open.length);$("#orderedOrdersCount").textContent=String(ordered.length);
  $("#needsOrderingBody").innerHTML=needs.length?needs.map(p=>{const on=outstandingOrderQty(p.id);return `<tr><td><strong>${esc(p.name)}</strong><br><small>${esc(p.partNo||"No part number")}</small></td><td>${stockNumber(p.currentStock)}</td><td>${stockNumber(p.minStock)}</td><td>${on?`<strong>${stockNumber(on)}</strong>`:"—"}</td><td>${esc(p.preferredSupplier||"—")}</td><td><button type="button" class="btn primary compact" data-order-part="${esc(p.id)}">${on?"Create another":"Create order"}</button></td></tr>`;}).join(""):`<tr><td colspan="6">Nothing currently needs ordering.</td></tr>`;
  $("#openOrdersBody").innerHTML=open.length?open.map(o=>`<tr><td>${esc(stockOrderDate(o.createdAt||o.orderedAt))}</td><td><strong>${esc(o.partName||partCatalog.find(p=>p.id===o.partId)?.name||"Part")}</strong><br><small>${esc(o.partNo||"")}</small></td><td>${esc(o.supplier||"—")}</td><td>${stockNumber(o.orderedQty)}</td><td>${esc(o.expectedDate?fmtDate(o.expectedDate):"—")}</td><td><span class="v58-status">Open</span></td><td><div class="v58-table-actions"><button type="button" class="btn primary compact" data-place-order="${esc(o.id)}">Place order</button><button type="button" class="btn secondary compact" data-delete-order="${esc(o.id)}">Delete</button></div></td></tr>`).join(""):`<tr><td colspan="7">No open orders.</td></tr>`;
  $("#orderedOrdersBody").innerHTML=ordered.length?ordered.map(o=>`<tr><td>${esc(stockOrderDate(o.orderedAt||o.createdAt))}</td><td><strong>${esc(o.partName||partCatalog.find(p=>p.id===o.partId)?.name||"Part")}</strong><br><small>${esc(o.partNo||"")}</small></td><td>${esc(o.supplier||"—")}</td><td>${stockNumber(o.orderedQty)}</td><td>${stockNumber(o.receivedQty)}</td><td>${stockNumber(Math.max(0,(Number(o.orderedQty)||0)-(Number(o.receivedQty)||0)))}</td><td><span class="v58-status ordered">${esc(o.status||"Ordered")}</span></td><td><div class="v58-table-actions"><button type="button" class="btn primary compact" data-receive-order="${esc(o.id)}">Mark received</button><button type="button" class="btn secondary compact" data-delete-order="${esc(o.id)}" ${(Number(o.receivedQty)||0)>0?'disabled title="Delete is only available before stock is received"':""}>Delete</button></div></td></tr>`).join(""):`<tr><td colspan="8">No placed orders waiting for delivery.</td></tr>`;
  const tx=[...stockTransactions].sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).slice(0,60);$("#stockTransactionsBody").innerHTML=tx.length?tx.map(t=>{const part=partCatalog.find(p=>p.id===t.partId);const sign=(Number(t.qty)||0)>0?"+":"";const label={receipt:"Received","job-use":"Used on job","job-return":"Returned",adjustment:"Adjusted"}[t.type]||t.type;return `<tr><td>${esc(new Date(t.createdAt).toLocaleString("en-GB"))}</td><td>${esc(part?.name||"Unknown part")}</td><td>${esc(label)}</td><td><strong>${sign}${stockNumber(t.qty)}</strong></td><td>${t.balanceAfter==null?"—":stockNumber(t.balanceAfter)}</td><td>${esc(t.jobNo||t.orderId||t.note||"—")}</td></tr>`;}).join(""):`<tr><td colspan="6">No stock movements recorded yet.</td></tr>`;
  const list=$("#v58SupplierList");if(list)list.innerHTML=suppliers.map(s=>`<option value="${esc(s)}"></option>`).join("");setStockPurchasingTab();
}
function openStockOrderDialog(partId){const part=partCatalog.find(p=>p.id===partId);if(!part)return;const form=$("#stockOrderForm");form.reset();form.elements.partId.value=part.id;const shortage=Math.max(1,(Number(part.minStock)||0)-(Number(part.currentStock)||0));form.elements.qty.value=Math.max(shortage,Number(part.reorderQty)||1);form.elements.supplier.value=part.preferredSupplier||"";$("#stockOrderTitle").textContent=`Create open order · ${part.name}`;$("#stockOrderDialog").showModal();}
async function submitStockOrder(e){e.preventDefault();const form=e.currentTarget,fd=new FormData(form);const body={action:"order",partId:fd.get("partId"),qty:Number(fd.get("qty")),supplier:String(fd.get("supplier")||"").trim(),expectedDate:String(fd.get("expectedDate")||""),note:String(fd.get("note")||"")};try{stockPurchasingTab="open";await saveMutation("/api/stock/orders",body);$("#stockOrderDialog").close();switchView("parts");}catch(error){showSaveError(error);}}
async function placeStockOrder(orderId){const order=stockOrders.find(o=>o.id===orderId);if(!order)return;try{stockPurchasingTab="ordered";await saveMutation("/api/stock/orders",{action:"place",orderId});switchView("parts");}catch(error){showSaveError(error);}}
async function receiveStockOrder(orderId){const order=stockOrders.find(o=>o.id===orderId);if(!order)return;const remaining=Math.max(0,(Number(order.orderedQty)||0)-(Number(order.receivedQty)||0));const raw=prompt(`How many ${order.partName||"items"} arrived?`,String(remaining));if(raw===null)return;const qty=Number(raw);if(!Number.isFinite(qty)||qty<=0||qty>remaining){alert(`Enter a quantity between 1 and ${remaining}.`);return;}try{stockPurchasingTab="ordered";await saveMutation("/api/stock/orders",{action:"receive",orderId,qty});switchView("parts");}catch(error){showSaveError(error);}}
async function deleteStockOrder(orderId){const order=stockOrders.find(o=>o.id===orderId);if(!order)return;if((Number(order.receivedQty)||0)>0){alert("This order already has received stock, so it cannot be deleted. Cancel or keep it for stock history.");return;}if(!confirm(`Delete the ${String(order.status||"").toLowerCase()||"stock"} order for ${order.partName||"this part"}?`))return;try{await saveMutation("/api/stock/orders",{action:"delete",orderId});switchView("parts");}catch(error){showSaveError(error);}}
async function cancelStockOrder(orderId){const order=stockOrders.find(o=>o.id===orderId);if(!order||!confirm(`Cancel the open order for ${order.partName||"this part"}?`))return;try{await saveMutation("/api/stock/orders",{action:"cancel",orderId});switchView("parts");}catch(error){showSaveError(error);}}

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

function ensureDashboardSpendSplit() {
  const usedValue = $("#kpiSpend");
  if (!usedValue) return;

  // Rename the original spend KPI to make it clear that it is actual parts used.
  let card = usedValue;
  let node = usedValue.parentElement;
  while (node && node.parentElement) {
    const ownKpis = node.querySelectorAll('[id^="kpi"]').length;
    const parentKpis = node.parentElement.querySelectorAll('[id^="kpi"]').length;
    if (ownKpis === 1 && parentKpis > 1) { card = node; break; }
    node = node.parentElement;
  }
  const renameLabel = (root, from, to) => {
    const candidates = [...root.querySelectorAll('span,small,p,div')];
    const label = candidates.find(el => el.children.length === 0 && String(el.textContent||'').trim().toLowerCase() === from.toLowerCase());
    if (label) label.textContent = to;
  };
  renameLabel(card, 'Parts spend', 'Parts used');

  if (!$("#kpiOrderedSpend")) {
    const clone = card.cloneNode(true);
    const clonedSpendValue = clone.querySelector('#kpiSpend');
    clone.id = 'kpiOrderedSpendCard';
    clone.querySelectorAll('[id]').forEach(el => {
      if (el === clonedSpendValue) el.id = 'kpiOrderedSpend';
      else el.removeAttribute('id');
    });
    if (!clonedSpendValue) {
      const fallbackValue = clone.querySelector('strong');
      if (fallbackValue) fallbackValue.id = 'kpiOrderedSpend';
    }
    renameLabel(clone, 'Parts spend', 'Parts ordered');
    renameLabel(clone, 'Parts used', 'Parts ordered');
    card.insertAdjacentElement('afterend', clone);
  }

  // The existing donut remains a machine-category view of actual parts consumed.
  const spendPie = $("#spendPie");
  if (spendPie) {
    let pieCard = spendPie.parentElement;
    while (pieCard && pieCard.parentElement && !/parts spend by machine category/i.test(String(pieCard.textContent||''))) pieCard = pieCard.parentElement;
    const title = pieCard ? [...pieCard.querySelectorAll('h1,h2,h3,h4,h5,h6,strong')].find(el => /parts spend by machine category/i.test(String(el.textContent||''))) : null;
    if (title) title.textContent = 'PARTS USED BY MACHINE CATEGORY';
  }
}

function renderDashboard() {
  const base = visibleJobs();
  const monthJobs = selectedMonthJobs();
  const raised = base.filter(j=>inSelectedMonth(j.raised));
  const open = base.filter(j=>!["Completed","Cancelled"].includes(j.status));
  const hours = monthJobs.reduce((a,j)=>a+workHoursThisMonth(j),0);
  const usedSpend = base.reduce((a,j)=>a+spendThisMonth(j),0);
  const orderedSpend = base.reduce((a,j)=>a+orderedSpendThisMonth(j),0);
  $("#monthTitle").textContent = `${FULL_MONTHS[selectedMonth]} ${selectedYear}`;
  $("#dashboardSubtitle").textContent = selectedProfileId === "all" ? "Overview of maintenance activity for the whole team this month." : `Showing only jobs and activity assigned to ${profileContext()}.`;
  $("#sideMonthLabel").textContent = `${FULL_MONTHS[selectedMonth]} ${selectedYear} · ${profileContext()}`;
  $("#kpiJobs").textContent = raised.length;
  $("#kpiOpen").textContent = open.length;
  $("#kpiHours").textContent = hours.toFixed(1);
  ensureDashboardSpendSplit();
  // The sidebar summary uses the same value as actual parts consumed.
  const sideSpendValue = $("#sideSpend");
  if (sideSpendValue?.parentElement) {
    const sideLabel = [...sideSpendValue.parentElement.querySelectorAll("span,small,p,div")].find(el =>
      el !== sideSpendValue && el.children.length === 0 && /^parts spend$/i.test(String(el.textContent || "").trim())
    );
    if (sideLabel) sideLabel.textContent = "Parts used";
  }
  $("#kpiSpend").textContent = shortMoney(usedSpend);
  if ($("#kpiOrderedSpend")) $("#kpiOrderedSpend").textContent = shortMoney(orderedSpend);
  $("#sideSpend").textContent = shortMoney(usedSpend);
  $("#sideHours").textContent = hours.toFixed(1);
  $("#openBadge").textContent = open.length;

  const cats = [...new Set(machines.map(m=>m.category || "Other"))];
  const hourRows = cats.map(c=>({name:c,value:base.filter(j=>machineForJob(j)?.category===c).reduce((a,j)=>a+workHoursThisMonth(j),0)})).filter(x=>x.value>0);
  const spendRows = cats.map(c=>({name:c,value:base.filter(j=>machineForJob(j)?.category===c).reduce((a,j)=>a+spendThisMonth(j),0)})).filter(x=>x.value>0);
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
  const mj = visibleJobs().filter(j=>jobBelongsToMachine(j,machine));
  return {jobs:mj.length,open:mj.filter(j=>!["Completed","Cancelled"].includes(j.status)).length,hours:mj.reduce((a,j)=>a+jobHours(j),0),spend:mj.reduce((a,j)=>a+jobPartsCost(j),0)};
}

function machineHistoryTable(history, emptyText) {
  return `<div class="table-wrap"><table><thead><tr><th>Job</th><th>Title</th><th>Engineer</th><th>Status</th><th>Raised</th><th>Completed</th><th>Hours</th><th>Parts Cost</th></tr></thead><tbody>${history.length?history.map(j=>`<tr><td><button type="button" class="job-link" data-edit-job="${esc(j.jobNo)}">${esc(j.jobNo)}</button></td><td>${esc(j.title)}</td><td>${esc(j.assigned||"—")}</td><td>${statusPill(j.status)}</td><td>${fmtDate(j.raised)}</td><td>${fmtDate(j.completed)}</td><td>${jobHours(j).toFixed(1)}</td><td>${money(jobPartsCost(j))}</td></tr>`).join(""):`<tr><td colspan="8">${esc(emptyText)}</td></tr>`}</tbody></table></div>`;
}

function machineFilesContent(machine) {
  const accept=attachmentAccept();
  return `<div class="machine-files"><div class="history-heading"><div><h3>Documents & photos</h3><p>Manuals, wiring diagrams, photos and other permitted files. ${esc(attachmentPolicyText())}</p></div></div><div class="attachment-picker-row"><label class="file-picker btn secondary compact">＋ Choose photos/files<input id="machineAttachmentInput" type="file" multiple ${accept?`accept="${esc(accept)}"`:""} /></label><label class="file-picker btn secondary compact camera-picker">📷 Take photo<input id="machineCameraInput" type="file" accept="image/*" capture="environment" /></label></div><p id="machineAttachmentStatus" class="attachment-status"></p><div id="machineAttachmentsList" class="attachment-list"><p class="empty-note">Loading files…</p></div></div>`;
}

function machineQrContent(machine) {
  const qrUrl=`/api/machines/qr?id=${encodeURIComponent(machine.id)}`;
  const destination=`${location.origin}/request?machine=${encodeURIComponent(machine.id)}`;
  return `<div class="machine-qr-panel"><div class="history-heading"><div><h3>Operator Maintenance QR</h3><p>Print one QR code and place it on the machine. Operators scan it, enter their name and describe the issue. No maintenance login is required on the request form.</p></div></div><div class="machine-qr-layout"><div class="qr-card"><img src="${qrUrl}" alt="Operator request QR code for ${esc(machine.assetId)} · ${esc(machine.name)}" /><strong>${esc(machine.assetId)} · ${esc(machine.name)}</strong><span>${esc(machine.location||machine.section||"")}</span></div><div class="qr-actions"><p><strong>Operator form:</strong><br><span class="qr-destination">${esc(destination)}</span></p><a class="btn secondary" href="${qrUrl}&download=1&label=1">Download QR SVG</a><button type="button" class="btn primary" id="printMachineQrBtn">Print QR Label</button><button type="button" class="btn secondary" id="copyMachineLinkBtn">Copy request link</button><p class="muted">This is the only QR needed on the machine. Submitted issues appear in the Requests page for any engineer to accept and assign.</p></div></div></div>`;
}

function bindMachineQrControls(machine) {
  const destination=`${location.origin}/request?machine=${encodeURIComponent(machine.id)}`;
  $("#copyMachineLinkBtn")?.addEventListener("click",async e=>{
    try{await navigator.clipboard.writeText(destination);e.currentTarget.textContent="Copied ✓";setTimeout(()=>e.currentTarget.textContent="Copy request link",1500);}catch{prompt("Copy this operator request link:",destination);}
  });
  $("#printMachineQrBtn")?.addEventListener("click",()=>{
    const qrUrl=`${location.origin}/api/machines/qr?id=${encodeURIComponent(machine.id)}`;
    const w=window.open("","_blank");
    if(!w){alert("Allow pop-ups to print the QR label.");return;}
    w.document.write(`<!doctype html><html><head><title>${esc(machine.assetId)} maintenance request QR</title><style>body{font-family:Arial,sans-serif;margin:0;padding:24px;text-align:center}.label{display:inline-block;border:2px solid #111;border-radius:12px;padding:18px;max-width:360px}.label img{width:260px;height:260px;display:block;margin:auto}.label h1{font-size:24px;margin:8px 0 4px}.label p{margin:3px 0;font-size:14px}.action{font-size:16px!important;font-weight:700;margin-top:10px!important}.hint{font-size:11px!important;margin-top:7px!important}@media print{body{padding:0}.label{border:2px solid #111}}</style></head><body><div class="label"><img src="${qrUrl}"/><h1>${esc(machine.assetId)}</h1><p><strong>${esc(machine.name)}</strong></p><p>${esc(machine.location||machine.section||"")}</p><p class="action">Scan to report a maintenance issue</p><p class="hint">Enter your name and describe the problem</p></div><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
    w.document.close();
  });
}

function bindMachineAttachmentControls(machine) {
  const input=$("#machineAttachmentInput"), camera=$("#machineCameraInput");
  const handle=async files=>{
    const list=[...(files||[])];
    if(!list.length)return;
    const status=$("#machineAttachmentStatus");
    try{
      for(let i=0;i<list.length;i++){
        if(list[i].size>maxAttachmentBytes())throw new Error(`${list[i].name} is larger than ${Number(appSettings.maxAttachmentMb)||25} MB.`);
        if(!fileAllowedClient(list[i]))throw new Error(`${list[i].name} is not an allowed file type.`);
        if(status)status.textContent=`Uploading ${i+1} of ${list.length}: ${list[i].name}…`;
        await uploadAttachment("machine",machine.id,list[i]);
      }
      await loadAttachments("machine",machine.id,$("#machineAttachmentsList"),status);
    }catch(error){showSaveError(error);if(status)status.textContent="Upload stopped.";}
  };
  if(input)input.addEventListener("change",async e=>{const files=e.target.files;await handle(files);e.target.value="";});
  if(camera)camera.addEventListener("change",async e=>{const files=e.target.files;await handle(files);e.target.value="";});
  loadAttachments("machine",machine.id,$("#machineAttachmentsList"),$("#machineAttachmentStatus"));
}

function requestDate(value) {
  if(!value)return "—";
  const d=new Date(String(value).replace(" ","T")+( /Z$|[+-]\d\d:\d\d$/.test(String(value))?"":"Z" ));
  return Number.isNaN(d.getTime())?String(value):d.toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
}

function requestDefaultAssigneeId() {
  const email=String(signedInIdentity?.email||"").trim().toLowerCase();
  const own=activeProfiles().find(p=>String(p.email||"").trim().toLowerCase()===email);
  if(own)return own.id;
  if(selectedProfileId!=="all"&&activeProfiles().some(p=>p.id===selectedProfileId))return selectedProfileId;
  return activeProfiles()[0]?.id||"";
}

function requestAssigneeOptions(selected="") {
  const wanted=selected||requestDefaultAssigneeId();
  return activeProfiles().map(p=>`<option value="${esc(p.id)}" ${p.id===wanted?"selected":""}>${esc(p.name)}</option>`).join("");
}

function renderRequests() {
  const container=$("#requestsContent");
  if(!container)return;
  const pending=operatorRequests.filter(r=>r.status==="pending"||r.status==="accepting");
  const accepted=operatorRequests.filter(r=>r.status==="accepted").slice(0,40);
  if($("#requestBadge")){
    $("#requestBadge").textContent=String(pending.length);
    $("#requestBadge").hidden=pending.length===0;
  }
  const options=requestAssigneeOptions();
  const pendingHtml=pending.length?pending.map(r=>{
    const m=r.machine||{};
    const busy=r.status==="accepting";
    return `<article class="operator-request-row ${busy?"accepting":""}"><div class="request-main"><div class="request-topline"><strong>${esc(r.requestNo)}</strong><span>${esc(requestDate(r.createdAt))}</span></div><h3>${esc(m.assetId||"Machine")} · ${esc(m.name||"Unknown machine")}</h3><p class="request-operator">Reported by <strong>${esc(r.operatorName)}</strong>${m.location?` · ${esc(m.location)}`:""}</p><p class="request-issue">${esc(r.issue)}</p></div><div class="request-accept"><label>Assign to<select data-request-assignee="${esc(r.id)}" ${busy?"disabled":""}>${options}</select></label><button type="button" class="btn primary" data-accept-request="${esc(r.id)}" ${busy||!options?"disabled":""}>${busy?"Being accepted…":"Accept & create job"}</button><button type="button" class="btn danger compact" data-delete-request="${esc(r.id)}" data-request-no="${esc(r.requestNo)}" data-request-status="pending" ${busy?"disabled":""}>Delete</button></div></article>`;
  }).join(""):`<div class="panel request-empty"><strong>No pending operator requests.</strong><p>New issues submitted from machine QR codes will appear here.</p></div>`;
  const acceptedHtml=accepted.length?`<article class="panel"><div class="panel-title"><div><h2>Recently accepted</h2><p class="muted">Accepted requests remain here for reference for 90 days unless you delete them.</p></div></div><div class="table-wrap"><table class="requests-history-table"><thead><tr><th>Request</th><th>Machine</th><th>Operator</th><th>Assigned</th><th>Job</th><th>Accepted</th><th>Action</th></tr></thead><tbody>${accepted.map(r=>`<tr><td>${esc(r.requestNo)}</td><td>${esc(r.machine?.assetId||"")} · ${esc(r.machine?.name||"Unknown")}</td><td>${esc(r.operatorName)}</td><td>${esc(r.assignedProfileName||"—")}</td><td>${r.linkedJobNo?`<button type="button" class="job-link" data-edit-job="${esc(r.linkedJobNo)}">${esc(r.linkedJobNo)}</button>`:"—"}</td><td>${esc(requestDate(r.acceptedAt))}</td><td><button type="button" class="btn danger compact" data-delete-request="${esc(r.id)}" data-request-no="${esc(r.requestNo)}" data-request-status="accepted" data-linked-job="${esc(r.linkedJobNo||"")}">Delete</button></td></tr>`).join("")}</tbody></table></div></article>`:"";
  container.innerHTML=`<div class="requests-summary"><div class="mini-metric"><span>Waiting</span><strong>${pending.length}</strong></div><div class="mini-metric"><span>Accepted recently</span><strong>${accepted.length}</strong></div></div><div class="operator-request-list">${pendingHtml}</div>${acceptedHtml}`;
  bindJobEditors();
}

function ensureMachineListControls() {
  const list=$("#machineList");
  if(!list||$("#machineListControls"))return;
  const controls=document.createElement("div");
  controls.id="machineListControls";
  controls.className="machine-list-controls";
  controls.innerHTML=`<div class="machine-search-wrap"><input id="machineListSearch" type="search" autocomplete="off" placeholder="Search machine no, asset no, name, manufacturer or tooling…" aria-label="Search machines"></div><select id="machineSectionFilter" aria-label="Filter machines by section"><option value="all">All sections</option></select><select id="machineStatusFilter" aria-label="Filter machines by status"><option value="all">All statuses</option><option value="active">Active</option><option value="archived">Archived</option></select><button type="button" class="btn secondary compact machine-download-qrs" id="machineDownloadAllQrBtn">Download all QR codes</button>`;
  const count=document.createElement("div");
  count.id="machineListCount";
  count.className="machine-list-count";
  list.parentNode.insertBefore(controls,list);
  list.parentNode.insertBefore(count,list);
  $("#machineListSearch").addEventListener("input",e=>{machineSearchQuery=e.target.value;renderMachines();});
  $("#machineSectionFilter").addEventListener("change",e=>{machineSectionFilter=e.target.value;renderMachines();});
  $("#machineStatusFilter").addEventListener("change",e=>{machineStatusFilter=e.target.value;renderMachines();});
  $("#machineDownloadAllQrBtn").addEventListener("click",downloadFilteredMachineQrs);
}

function filteredMachinesForList() {
  const query=machineSearchQuery.trim().toLowerCase();
  return machines.filter(m=>{
    if(machineSectionFilter!=="all"&&String(m.section||"")!==machineSectionFilter)return false;
    const archived=isMachineArchived(m);
    if(machineStatusFilter==="active"&&archived)return false;
    if(machineStatusFilter==="archived"&&!archived)return false;
    if(!query)return true;
    return [m.assetId,m.assetNumber,m.name,m.section,m.category,m.location,m.manufacturer,m.make,m.model,m.serialNumber,...(Array.isArray(m.tooling)?m.tooling.flatMap(t=>[t?.name,t?.description]):[])].some(value=>String(value||"").toLowerCase().includes(query));
  });
}

function qrSafeFilename(value) {
  return String(value||"machine").trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g,"-").replace(/\s+/g," ").slice(0,120)||"machine";
}

let qrCrcTable=null;
function qrCrc32(bytes) {
  if(!qrCrcTable){
    qrCrcTable=Array.from({length:256},(_,n)=>{
      let c=n;
      for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
      return c>>>0;
    });
  }
  let crc=0xffffffff;
  for(const byte of bytes)crc=qrCrcTable[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

function qrZipU16(view,offset,value){view.setUint16(offset,value,true);}
function qrZipU32(view,offset,value){view.setUint32(offset,value>>>0,true);}

function createStoredZip(files) {
  const encoder=new TextEncoder();
  const now=new Date();
  const dosTime=((now.getHours()&31)<<11)|((now.getMinutes()&63)<<5)|((Math.floor(now.getSeconds()/2))&31);
  const dosDate=(((Math.max(1980,now.getFullYear())-1980)&127)<<9)|(((now.getMonth()+1)&15)<<5)|(now.getDate()&31);
  const entries=files.map(file=>{
    const nameBytes=encoder.encode(file.name);
    const data=file.data instanceof Uint8Array?file.data:encoder.encode(String(file.data||""));
    return {nameBytes,data,crc:qrCrc32(data),offset:0};
  });
  let localSize=0;
  for(const entry of entries)localSize+=30+entry.nameBytes.length+entry.data.length;
  let centralSize=0;
  for(const entry of entries)centralSize+=46+entry.nameBytes.length;
  const out=new Uint8Array(localSize+centralSize+22);
  const view=new DataView(out.buffer);
  let p=0;
  for(const entry of entries){
    entry.offset=p;
    qrZipU32(view,p,0x04034b50); qrZipU16(view,p+4,20); qrZipU16(view,p+6,0x0800); qrZipU16(view,p+8,0);
    qrZipU16(view,p+10,dosTime); qrZipU16(view,p+12,dosDate); qrZipU32(view,p+14,entry.crc);
    qrZipU32(view,p+18,entry.data.length); qrZipU32(view,p+22,entry.data.length); qrZipU16(view,p+26,entry.nameBytes.length); qrZipU16(view,p+28,0);
    p+=30; out.set(entry.nameBytes,p); p+=entry.nameBytes.length; out.set(entry.data,p); p+=entry.data.length;
  }
  const centralStart=p;
  for(const entry of entries){
    qrZipU32(view,p,0x02014b50); qrZipU16(view,p+4,20); qrZipU16(view,p+6,20); qrZipU16(view,p+8,0x0800); qrZipU16(view,p+10,0);
    qrZipU16(view,p+12,dosTime); qrZipU16(view,p+14,dosDate); qrZipU32(view,p+16,entry.crc);
    qrZipU32(view,p+20,entry.data.length); qrZipU32(view,p+24,entry.data.length); qrZipU16(view,p+28,entry.nameBytes.length); qrZipU16(view,p+30,0);
    qrZipU16(view,p+32,0); qrZipU16(view,p+34,0); qrZipU16(view,p+36,0); qrZipU32(view,p+38,0); qrZipU32(view,p+42,entry.offset);
    p+=46; out.set(entry.nameBytes,p); p+=entry.nameBytes.length;
  }
  const centralLength=p-centralStart;
  qrZipU32(view,p,0x06054b50); qrZipU16(view,p+4,0); qrZipU16(view,p+6,0); qrZipU16(view,p+8,entries.length); qrZipU16(view,p+10,entries.length);
  qrZipU32(view,p+12,centralLength); qrZipU32(view,p+16,centralStart); qrZipU16(view,p+20,0);
  return out;
}

async function downloadFilteredMachineQrs(e) {
  const button=e?.currentTarget||$("#machineDownloadAllQrBtn");
  const rows=filteredMachinesForList();
  if(!rows.length){alert("No machines match the current search and filters.");return;}
  const original=button?.textContent||"Download all QR codes";
  if(button){button.disabled=true;button.textContent=`Preparing ${rows.length} QR code${rows.length===1?"":"s"}…`;}
  try{
    const encoder=new TextEncoder();
    const files=[];
    for(let i=0;i<rows.length;i++){
      const machine=rows[i];
      if(button)button.textContent=`Preparing ${i+1} of ${rows.length}…`;
      const response=await fetch(`/api/machines/qr?id=${encodeURIComponent(machine.id)}&label=1`,{credentials:"same-origin"});
      if(!response.ok)throw new Error(`Could not create QR code for ${machine.assetId||machine.name}.`);
      const svg=await response.text();
      files.push({name:`${qrSafeFilename(`${machine.assetId||""}${machine.assetId&&machine.name?" - ":""}${machine.name||"machine"}`)}.svg`,data:encoder.encode(svg)});
    }
    const zip=createStoredZip(files);
    const blob=new Blob([zip],{type:"application/zip"});
    const link=document.createElement("a");
    link.href=URL.createObjectURL(blob);
    const objectUrl=link.href;
    const sectionPart=machineSectionFilter!=="all"?`-${qrSafeFilename(machineSectionFilter).toLowerCase().replace(/\s+/g,"-")}`:"";
    const searchPart=machineSearchQuery.trim()?`-search-${qrSafeFilename(machineSearchQuery).toLowerCase().replace(/\s+/g,"-")}`:"";
    link.download=`machine-qr-codes${sectionPart}${searchPart}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  }catch(error){showSaveError(error);}
  finally{if(button){button.disabled=false;button.textContent=original;renderMachines();}}
}

function renderMachines() {
  ensureMachineListControls();
  $("#machinesSubtitle").textContent = selectedProfileId === "all" ? "Select a machine to see its maintenance overview, files and full job history." : `Machine figures are filtered to work assigned to ${profileContext()}.`;
  const sectionsForFilter=[...new Set(machines.map(m=>String(m.section||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
  if(machineSectionFilter!=="all"&&!sectionsForFilter.includes(machineSectionFilter))machineSectionFilter="all";
  const sectionSelect=$("#machineSectionFilter");
  if(sectionSelect){sectionSelect.innerHTML=`<option value="all">All sections</option>${sectionsForFilter.map(section=>`<option value="${esc(section)}">${esc(section)}</option>`).join("")}`;sectionSelect.value=machineSectionFilter;}
  const search=$("#machineListSearch"); if(search&&search.value!==machineSearchQuery)search.value=machineSearchQuery;
  const statusSelect=$("#machineStatusFilter"); if(statusSelect)statusSelect.value=machineStatusFilter;
  const filteredMachines=filteredMachinesForList();
  if(filteredMachines.length&&!filteredMachines.some(m=>m.id===selectedMachineId))selectedMachineId=filteredMachines[0].id;
  if($("#machineListCount"))$("#machineListCount").textContent=`Showing ${filteredMachines.length} of ${machines.length} machine${machines.length===1?"":"s"}`;
  const qrAllBtn=$("#machineDownloadAllQrBtn");if(qrAllBtn&&!qrAllBtn.disabled){qrAllBtn.textContent=`Download ${filteredMachines.length} QR code${filteredMachines.length===1?"":"s"}`;qrAllBtn.disabled=filteredMachines.length===0;}
  $("#machineList").innerHTML = filteredMachines.length ? filteredMachines.map(m=>{
    const s = machineStats(m);
    return `<button class="machine-item ${m.id===selectedMachineId?"active":""}" data-machine="${esc(m.id)}"><strong>${esc(m.assetId)} · ${esc(m.name)}</strong><span>${m.assetNumber?`Asset ${esc(m.assetNumber)} · `:""}${esc(m.section)} · ${esc(m.category)} · ${s.jobs} jobs · ${money(s.spend)} parts</span></button>`;
  }).join("") : `<div class="machine-list-empty">No machines match your search or filters.</div>`;
  const m = filteredMachines.find(x=>x.id===selectedMachineId) || filteredMachines[0];
  if (!machines.length) { $("#machineDetail").innerHTML = "<p>No machines added yet.</p>"; return; }
  if (!m) { $("#machineDetail").innerHTML = "<p>No machines match your current search or filters.</p>"; return; }
  selectedMachineId = m.id;
  const stats = machineStats(m);
  const history = visibleJobs().filter(j=>jobBelongsToMachine(j,m)).sort((a,b)=>b.raised.localeCompare(a.raised));
  const recent = history.slice(0,5);
  const toolingRows=cleanMachineToolingRows(m.tooling||[]);
  const toolingContent=toolingRows.length?`<div class="machine-tooling-overview"><h3>Tooling (${toolingRows.length})</h3><div class="machine-tooling-list">${toolingRows.map(t=>`<div class="machine-tooling-item"><strong>${esc(t.name)}</strong>${t.description?`<small>${esc(t.description)}</small>`:""}</div>`).join("")}</div></div>`:"";
  const overviewContent = `<div class="machine-meta"><div class="meta-box"><small>Machine number</small><strong>${esc(m.assetId)}</strong></div><div class="meta-box"><small>Asset number</small><strong>${esc(m.assetNumber||"—")}</strong></div><div class="meta-box"><small>Section</small><strong>${esc(m.section)}</strong></div><div class="meta-box"><small>Location</small><strong>${esc(m.location||"—")}</strong></div><div class="meta-box"><small>Purchase cost</small><strong>${m.purchaseCost!=null?money(m.purchaseCost):"Unknown"}</strong></div><div class="meta-box"><small>Manufacturer / Model</small><strong>${esc([m.manufacturer||m.make,m.model].filter(Boolean).join(" · ")||"—")}</strong></div><div class="meta-box"><small>Serial number</small><strong>${esc(m.serialNumber||"—")}</strong></div><div class="meta-box"><small>Tooling items</small><strong>${toolingRows.length}</strong></div><div class="meta-box"><small>Purchase date</small><strong>${fmtDate(m.purchaseDate)}</strong></div><div class="meta-box"><small>Install date</small><strong>${fmtDate(m.installDate)}</strong></div></div>${toolingContent}${m.notes?`<div class="machine-notes"><strong>Machine notes</strong><p>${esc(m.notes)}</p></div>`:""}<div class="metric-strip"><div class="mini-metric"><span>Maintenance jobs</span><strong>${stats.jobs}</strong></div><div class="mini-metric"><span>Open jobs</span><strong>${stats.open}</strong></div><div class="mini-metric"><span>Maintenance hours</span><strong>${stats.hours.toFixed(1)}</strong></div><div class="mini-metric"><span>Parts used</span><strong>${money(stats.spend)}</strong></div></div><div class="machine-overview-note">${selectedProfileId === "all" ? "These figures use the machine’s full recorded maintenance history." : `These figures currently show only ${esc(profileContext())}’s assigned work.`}</div><h3 class="subheading">Recent jobs</h3>${machineHistoryTable(recent, "No jobs recorded for this machine.")}`;
  const historyContent = `<div class="history-heading"><div><h3>Job history</h3><p>${history.length} recorded job${history.length===1?"":"s"} for ${esc(profileContext())}.</p></div></div>${machineHistoryTable(history, "No job history for this machine and profile.")}`;
  const filesContent = machineFilesContent(m);
  const qrContent = machineQrContent(m);
  const tabContent = machineDetailTab==="history"?historyContent:machineDetailTab==="files"?filesContent:machineDetailTab==="qr"?qrContent:overviewContent;
  $("#machineDetail").innerHTML = `<div class="machine-head"><div><h2>${esc(m.name)}</h2><p><strong>${esc(m.assetId)}</strong> · ${esc(m.section)} · ${esc(m.category)} · ${esc(m.status||"Active")}</p></div><div class="machine-head-actions"><strong>${m.purchaseCost!=null?money(m.purchaseCost):"Cost unknown"}</strong><button type="button" class="btn secondary compact" data-edit-machine="${esc(m.id)}">Edit Machine</button></div></div><div class="machine-tabs"><button type="button" class="${machineDetailTab==="overview"?"active":""}" data-machine-tab="overview">Overview</button><button type="button" class="${machineDetailTab==="files"?"active":""}" data-machine-tab="files">Files</button><button type="button" class="${machineDetailTab==="qr"?"active":""}" data-machine-tab="qr">QR Code</button><button type="button" class="${machineDetailTab==="history"?"active":""}" data-machine-tab="history">Job History (${history.length})</button></div>${tabContent}`;
  $$('[data-machine]').forEach(b=>b.addEventListener('click',()=>{selectedMachineId=b.dataset.machine;machineDetailTab="overview";renderMachines();}));
  $$('[data-machine-tab]').forEach(b=>b.addEventListener('click',()=>{machineDetailTab=b.dataset.machineTab;renderMachines();}));
  $$('[data-edit-machine]').forEach(b=>b.addEventListener('click',()=>openMachineDialog('',b.dataset.editMachine)));
  if(machineDetailTab==="files")bindMachineAttachmentControls(m);
  if(machineDetailTab==="qr")bindMachineQrControls(m);
  bindJobEditors();
}


function ensurePartsUsageUi(){
  const body=$("#partsBody");if(!body)return;
  const head=body.closest("table")?.querySelector("thead tr");
  if(head&&!head.querySelector('[data-parts-usage-actions-head]')){const th=document.createElement("th");th.dataset.partsUsageActionsHead="1";th.textContent="Action";head.appendChild(th);}
  if(!$("#partUsageDialog")){
    const dialog=document.createElement("dialog");dialog.id="partUsageDialog";dialog.className="pm-dialog";dialog.innerHTML=`<form id="partUsageForm"><div class="pm-dialog-head"><div><h2>Edit parts usage</h2><p class="muted" id="partUsageSummary"></p></div><button type="button" class="btn secondary compact" id="partUsageCloseBtn">Close</button></div><input type="hidden" name="jobNo"><input type="hidden" name="usageIndex"><div class="pm-form-grid"><label>Quantity used<input name="qty" type="number" min="0" step="1" required></label><label>Unit price (${currencySymbol()})<input name="unitPrice" type="number" min="0" step="0.01" required></label><label>Supplier<input name="supplier" list="partUsageSuppliers"></label><label>Date used / fitted<input name="date" type="date" required></label></div><datalist id="partUsageSuppliers"></datalist><div class="pm-dialog-actions"><div></div><div><button type="button" class="btn secondary" id="partUsageCancelBtn">Cancel</button><button type="submit" class="btn primary">Save changes</button></div></div></form>`;document.body.appendChild(dialog);
    $("#partUsageCloseBtn")?.addEventListener("click",()=>dialog.close());$("#partUsageCancelBtn")?.addEventListener("click",()=>dialog.close());
    $("#partUsageForm")?.addEventListener("submit",submitPartUsageEdit);
  }
  if(!body.dataset.usageActionsBound){
    body.dataset.usageActionsBound="1";
    body.addEventListener("click",e=>{
      const edit=e.target.closest("[data-part-usage-edit]");if(edit){openPartUsageEdit(edit.dataset.jobNo,Number(edit.dataset.usageIndex));return;}
      const del=e.target.closest("[data-part-usage-delete]");if(del){deletePartUsage(del.dataset.jobNo,Number(del.dataset.usageIndex));}
    });
  }
}
function openPartUsageEdit(jobNo,usageIndex){
  const job=jobs.find(row=>String(row.jobNo)===String(jobNo)),usage=job?.parts?.[usageIndex];if(!job||!usage||(Number(usage.qty)||0)<=0){alert("Parts usage record not found.");return;}
  editingPartUsageRef={jobNo,usageIndex};const form=$("#partUsageForm");form.elements.jobNo.value=jobNo;form.elements.usageIndex.value=String(usageIndex);form.elements.qty.value=String(Number(usage.qty)||0);form.elements.unitPrice.value=String(Number(usage.unitPrice)||0);form.elements.supplier.value=usage.supplier||"";form.elements.date.value=usage.date||job.raised||defaultFormDate();
  $("#partUsageSummary").textContent=`${jobNo} · ${usage.name||"Part"}${usage.partNo?` · ${usage.partNo}`:""}`;
  $("#partUsageSuppliers").innerHTML=activeSuppliers().map(name=>`<option value="${esc(name)}"></option>`).join("");
  $("#partUsageDialog").showModal();
}
async function submitPartUsageEdit(e){
  e.preventDefault();const form=e.currentTarget,fd=new FormData(form);
  try{await saveMutation("/api/parts-usage",{action:"edit",jobNo:String(fd.get("jobNo")||""),usageIndex:Number(fd.get("usageIndex")),qty:Number(fd.get("qty")),unitPrice:Number(fd.get("unitPrice")),supplier:String(fd.get("supplier")||"").trim(),date:String(fd.get("date")||"")});$("#partUsageDialog").close();editingPartUsageRef=null;switchView("parts");}catch(error){showSaveError(error);}
}
async function deletePartUsage(jobNo,usageIndex){
  const job=jobs.find(row=>String(row.jobNo)===String(jobNo)),usage=job?.parts?.[usageIndex];if(!job||!usage)return;
  if(!confirm(`Delete this parts-used record?\n\n${usage.name||"Part"} · ${Number(usage.qty)||0} used on ${jobNo}\n\nTracked stock will be corrected automatically.`))return;
  try{await saveMutation("/api/parts-usage",{action:"delete",jobNo,usageIndex});switchView("parts");}catch(error){showSaveError(error);}
}

function renderParts() {
  ensurePartsUsageUi();
  $("#partsSubtitle").textContent = selectedProfileId === "all" ? "Parts usage, live stock levels, suppliers and costs recorded through maintenance jobs." : `Parts used on jobs assigned to ${profileContext()}, plus the shared stock position.`;
  const stockRank=p=>p.active===false?4:p.stockTracked!==true?3:(Number(p.currentStock)||0)<=0?0:(Number(p.currentStock)||0)<=(Number(p.minStock)||0)?1:2;
  const saved=partCatalog.filter(p=>p.active!==false).sort((a,b)=>stockRank(a)-stockRank(b)||String(a.name).localeCompare(String(b.name)));
  const tracked=saved.filter(p=>p.active!==false&&p.stockTracked===true);
  const low=tracked.filter(p=>(Number(p.currentStock)||0)<=(Number(p.minStock)||0));
  if($("#stockSavedParts")) $("#stockSavedParts").textContent=String(saved.length);
  if($("#stockTrackedParts")) $("#stockTrackedParts").textContent=String(tracked.length);
  if($("#stockLowParts")) $("#stockLowParts").textContent=String(low.length);
  const alertBox=$("#stockLowAlert");
  if(alertBox){
    alertBox.hidden=!low.length;
    alertBox.textContent=low.length?`${low.length} tracked part${low.length===1?" is":"s are"} at or below minimum stock: ${low.slice(0,5).map(p=>p.name).join(", ")}${low.length>5?"…":""}`:"";
  }
  if($("#stockPlaceholderBody")) $("#stockPlaceholderBody").innerHTML=saved.length?saved.map(p=>{
    const status=stockStatus(p);
    const current=p.stockTracked===true?stockNumber(p.currentStock):"Not tracked";
    const min=p.stockTracked===true?stockNumber(p.minStock):"—";
    const rowClass=status.className==="stock-out"?"stock-out-row":status.className==="stock-low"?"stock-low-row":"";
    return `<tr class="${rowClass}"><td><strong>${esc(p.name)}</strong>${p.active===false?`<br><span class="stock-muted">Archived</span>`:""}</td><td>${esc(p.partNo||"—")}</td><td>${esc(current)}</td><td>${esc(min)}</td><td>${esc(p.binLocation||"—")}</td><td><span class="status-chip ${status.className}">${esc(status.label)}</span></td><td><button type="button" class="btn secondary compact stock-action" data-edit-stock="${esc(p.id)}">Edit stock</button></td></tr>`;
  }).join(""):`<tr><td colspan="7">No saved parts yet.</td></tr>`;
  const parts = visibleJobs().flatMap(j=>(j.parts||[]).map((p,usageIndex)=>({...p,usageIndex,jobNo:j.jobNo,machine:j.machine,machineId:j.machineId||"",section:j.section||inferSection(j.machine)})).filter(p=>(Number(p.qty)||0)>0)).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  $("#partsBody").innerHTML = parts.length ? parts.map(p=>`<tr><td>${fmtDate(p.date)}</td><td>${esc(p.name)}</td><td>${esc(p.partNo||"—")}</td><td>${Number(p.qty)||0} used</td><td>${money(p.unitPrice)}</td><td>${money(partTotal(p))}</td><td>${esc(p.supplier||"—")}</td><td><button type="button" class="job-link" data-edit-job="${esc(p.jobNo)}">${esc(p.jobNo)}</button></td><td>${esc(machineLabel(p))}</td><td><div class="manage-actions"><button type="button" class="btn secondary compact" data-part-usage-edit data-job-no="${esc(p.jobNo)}" data-usage-index="${p.usageIndex}">Edit</button><button type="button" class="btn danger compact" data-part-usage-delete data-job-no="${esc(p.jobNo)}" data-usage-index="${p.usageIndex}">Delete</button></div></td></tr>`).join("") : `<tr><td colspan="10">No parts recorded for ${esc(profileContext())}.</td></tr>`;
}

function reportData() {
  const base = visibleJobs();
  const monthJobs = selectedMonthJobs();
  const parts = base.flatMap(j=>partsThisMonth(j).map(p=>({...p,job:j})));
  const time = base.flatMap(j=>(j.timeEntries||[]).filter(t=>inSelectedMonth(t.date)).map(t=>({...t,job:j})));
  const usedSpend = parts.reduce((a,x)=>a+partTotal(x),0);
  const orderedSpend = parts.reduce((a,x)=>a+partOrderedTotal(x),0);
  const hours = time.reduce((a,x)=>a+(Number(x.hours)||0),0);
  return {base,monthJobs,parts,time,spend:usedSpend,usedSpend,orderedSpend,hours,raised:base.filter(j=>inSelectedMonth(j.raised)).length,completed:base.filter(j=>inSelectedMonth(j.completed)).length,open:base.filter(j=>!["Completed","Cancelled"].includes(j.status)).length};
}

function renderReports() {
  const r = reportData();
  $("#reportsSubtitle").textContent = selectedProfileId === "all" ? "Generate a whole-team PDF or Excel report for the selected month." : `Generate a monthly PDF or Excel report for ${profileContext()} only.`;
  $("#reportMonth").textContent = `${FULL_MONTHS[selectedMonth]} ${selectedYear} · ${profileContext()}`;
  $("#reportSummary").textContent = `${r.raised} jobs raised, ${r.completed} completed, ${r.open} currently open, ${r.hours.toFixed(1)} maintenance hours logged, ${money(r.usedSpend)} of parts used and ${money(r.orderedSpend)} of parts ordered in this month.`;
  const jobsRows = r.monthJobs.map(j=>`<tr><td>${esc(j.jobNo)}</td><td>${esc(j.title)}</td><td>${esc(machineLabel(j))}</td><td>${esc(j.assigned||"—")}</td><td>${esc(j.status)}</td><td>${fmtDate(j.raised)}</td><td>${fmtDate(j.completed)}</td><td>${workHoursThisMonth(j).toFixed(1)}</td><td>${money(spendThisMonth(j))}</td></tr>`).join("");
  const partsRows = r.parts.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.job.jobNo)}</td><td>${esc(machineLabel(x.job))}</td><td>${esc(x.name)}</td><td>${partOrderedQty(x)}</td><td>${Number(x.qty)||0}</td><td>${money(x.unitPrice)}</td><td>${money(partTotal(x))}</td><td>${esc(x.supplier||"—")}</td></tr>`).join("");
  const timeRows = r.time.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.job.jobNo)}</td><td>${esc(x.job.assigned||"—")}</td><td>${esc(machineLabel(x.job))}</td><td>${Number(x.hours||0).toFixed(2)}</td></tr>`).join("");
  $("#reportPreview").innerHTML = `<div class="print-report-head"><div><h2>Monthly Maintenance Report</h2><p>${esc(FULL_MONTHS[selectedMonth])} ${selectedYear} · ${esc(profileContext())}</p></div><span>Generated ${esc(new Date().toLocaleString("en-GB"))}</span></div><div class="report-kpis"><div><span>Jobs raised</span><strong>${r.raised}</strong></div><div><span>Completed</span><strong>${r.completed}</strong></div><div><span>Open now</span><strong>${r.open}</strong></div><div><span>Hours this month</span><strong>${r.hours.toFixed(1)}</strong></div><div><span>Parts used</span><strong>${money(r.usedSpend)}</strong></div><div><span>Parts ordered</span><strong>${money(r.orderedSpend)}</strong></div></div><h3>Jobs in / carried through this month</h3><div class="table-wrap"><table><thead><tr><th>Job</th><th>Title</th><th>Asset / Machine</th><th>Engineer</th><th>Status</th><th>Raised</th><th>Completed</th><th>Month hours</th><th>Month parts</th></tr></thead><tbody>${jobsRows||`<tr><td colspan="9">No jobs for this report.</td></tr>`}</tbody></table></div><h3>Time entries</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Job</th><th>Engineer</th><th>Asset / Machine</th><th>Hours</th></tr></thead><tbody>${timeRows||`<tr><td colspan="5">No time entries this month.</td></tr>`}</tbody></table></div><h3>Parts used / ordered</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Job</th><th>Asset / Machine</th><th>Part</th><th>Ordered</th><th>Used</th><th>Unit price</th><th>Used value</th><th>Supplier</th></tr></thead><tbody>${partsRows||`<tr><td colspan="9">No parts recorded this month.</td></tr>`}</tbody></table></div>`;
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


function machineUsageCount(machine) { return jobs.filter(j=>jobBelongsToMachine(j,machine)).length; }
function sectionUsageCount(name) { return machines.filter(m=>m.section===name).length + jobs.filter(j=>j.section===name).length; }
function supplierUsageCount(name) { return jobs.reduce((n,j)=>n+(j.parts||[]).filter(p=>p.supplier===name).length,0) + purchaseOrders.filter(order=>order.supplier===name).length; }
function partUsageCount(part) { return jobs.reduce((n,j)=>n+(j.parts||[]).filter(p=>p.name===part.name).length,0); }
function manageActions(entity, key, archived, used, edit=true) {
  const keyAttr = entity === "machine" || entity === "part" ? `data-id="${esc(key)}"` : `data-key="${esc(key)}"`;
  const partWithHistory = entity === "part" && used;
  const deleteDisabled = used && entity !== "part";
  const deleteLabel = partWithHistory ? "Remove" : "Delete";
  const deleteTitle = partWithHistory ? `title="Used in job history — Remove archives it safely"` : deleteDisabled ? `disabled title="Used in maintenance history — archive instead"` : "";
  return `<div class="manage-actions">${edit?`<button type="button" class="btn secondary compact" data-master-action="edit" data-entity="${entity}" ${keyAttr}>Edit</button>`:""}<button type="button" class="btn secondary compact" data-master-action="${archived?"reactivate":"archive"}" data-entity="${entity}" ${keyAttr}>${archived?"Reactivate":"Archive"}</button><button type="button" class="btn danger compact" data-master-action="delete" data-entity="${entity}" ${keyAttr} ${deleteTitle}>${deleteLabel}</button></div>`;
}
function renderManageData() {
  const machineRows=[...machines].sort((a,b)=>String(a.assetId).localeCompare(String(b.assetId))).map(m=>{const used=machineUsageCount(m);const archived=isMachineArchived(m);return `<div class="manage-row"><div><strong>${esc(m.assetId)} · ${esc(m.name)}</strong><span>${m.assetNumber?`Asset ${esc(m.assetNumber)} · `:""}${esc(m.manufacturer||m.make||"Manufacturer not set")} · ${esc(m.section)} · ${esc(m.location||"No location")} · ${used} job${used===1?"":"s"}</span></div><div class="manage-row-right"><span class="status-chip ${archived?"archived":"active"}">${archived?"Archived":"Active"}</span>${manageActions("machine",m.id,archived,used,true)}</div></div>`;}).join("");
  $("#manageMachinesList").innerHTML=machineRows||`<p class="empty-note">No machines yet.</p>`;
  $("#manageSectionsList").innerHTML=[...sections].sort().map(name=>{const used=sectionUsageCount(name);const archived=isSectionArchived(name);return `<div class="manage-row"><div><strong>${esc(name)}</strong><span>${used} linked machine/job reference${used===1?"":"s"}</span></div><div class="manage-row-right"><span class="status-chip ${archived?"archived":"active"}">${archived?"Archived":"Active"}</span>${manageActions("section",name,archived,used,true)}</div></div>`;}).join("")||`<p class="empty-note">No sections yet.</p>`;
  $("#managePartsList").innerHTML=[...partCatalog].sort((a,b)=>a.name.localeCompare(b.name)).map(part=>{const used=partUsageCount(part);const archived=part.active===false;const stock=stockStatus(part);const stockText=part.stockTracked===true?`Stock ${stockNumber(part.currentStock)} · min ${stockNumber(part.minStock)}${part.binLocation?` · ${part.binLocation}`:""}`:"Stock not tracked";return `<div class="manage-row"><div><strong>${esc(part.name)}</strong><span>${esc(part.partNo||"No part number")} · ${used} historical use${used===1?"":"s"} · ${esc(stockText)}</span></div><div class="manage-row-right"><span class="status-chip ${stock.className}">${esc(stock.label)}</span><span class="status-chip ${archived?"archived":"active"}">${archived?"Archived":"Active"}</span>${manageActions("part",part.id,archived,used,true)}</div></div>`;}).join("")||`<p class="empty-note">No saved parts yet.</p>`;
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
  if(action==="delete") {
    let message=entity==="machine"?"Permanently delete this unused machine? Any attached photos/files will also be deleted. This cannot be undone.":"Permanently delete this unused item? This cannot be undone.";
    if(entity==="part") {
      const part=partCatalog.find(p=>p.id===id);
      const used=part?partUsageCount(part):0;
      if(used) message=`This part is used in ${used} historical job ${used===1?"entry":"entries"}. Remove it from active parts? Job history will be kept and the part can be restored later from Manage Data.`;
    }
    if(!confirm(message))return;
  }
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
  const selectedValue=String(selected||"");
  const selectedMachine=machines.find(m=>String(m.id)===selectedValue) || machines.find(m=>m.name===selectedValue && m.section===section);
  const list = machines.filter(m=>m.section===section && (!isMachineArchived(m) || m.id===selectedMachine?.id));
  select.innerHTML = section ? `<option value="">Select machine…</option>${list.map(m=>`<option value="${esc(m.id)}" ${m.id===selectedMachine?.id?"selected":""}>${esc(m.assetId)} · ${esc(m.name)}${isMachineArchived(m)?" (archived)":""}</option>`).join("")}<option value="__add_machine__">＋ Add new machine in ${esc(section)}…</option>` : `<option value="">Select a section first…</option>`;
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
  const assetRaw = prompt(`Machine number / ID for the new machine in ${section} (for example 101 or RM-124):`);
  if (!assetRaw?.trim()) return null;
  const assetId = assetRaw.trim();
  if (machines.some(m=>String(m.assetId).toLowerCase()===assetId.toLowerCase())) { alert("That machine number already exists."); return null; }
  const name = prompt(`Machine / equipment name for ${assetId}:`);
  if (!name?.trim()) return null;
  const clean = name.trim();
  const assetNumberRaw = prompt(`Asset number for ${assetId} (optional):`,"");
  if (assetNumberRaw===null) return null;
  const assetNumber=assetNumberRaw.trim();
  if(assetNumber&&machines.some(m=>String(m.assetNumber||"").toLowerCase()===assetNumber.toLowerCase())){alert("That asset number already exists.");return null;}
  const manufacturerRaw=prompt(`Manufacturer for ${assetId} (optional):`,"");
  if(manufacturerRaw===null)return null;
  const manufacturer=manufacturerRaw.trim();
  try {
    const machine = {assetId,assetNumber,name:clean,section,category:section,location:"",purchaseCost:null,manufacturer,make:manufacturer,status:"Active"};
    const payload = await saveMutation("/api/machines", {machine}, {render:false});
    selectedMachineId = payload.machineId || machines.find(m=>m.assetId===assetId)?.id || null;
    renderMachines();
    return selectedMachineId;
  } catch (error) { showSaveError(error); return null; }
}

function partOptions(selected="") {
  const list = activeParts();
  const selectedPart = partCatalog.find(p=>p.id===selected);
  if (selectedPart && !list.some(p=>p.id===selectedPart.id)) list.unshift(selectedPart);
  const sorted=[...list].sort((a,b)=>a.name.localeCompare(b.name));
  return `<option value="">Select part…</option>${sorted.map(p=>{const stock=p.stockTracked===true?` · stock ${stockNumber(p.currentStock)}${(Number(p.currentStock)||0)<=(Number(p.minStock)||0)?" LOW":""}`:"";return `<option value="${esc(p.id)}" ${p.id===selected?"selected":""}>${esc(p.name)}${p.partNo?` — ${esc(p.partNo)}`:""}${esc(stock)}${p.active===false?" (archived)":""}</option>`;}).join("")}<option value="__add_part__">＋ Add new part…</option>`;
}

function supplierOptions(selected="") {
  const list = activeSuppliers();
  if (selected && suppliers.includes(selected) && !list.includes(selected)) list.unshift(selected);
  return `<option value="">Select supplier…</option>${list.map(s=>`<option value="${esc(s)}" ${s===selected?"selected":""}>${esc(s)}${isSupplierArchived(s)?" (archived)":""}</option>`).join("")}<option value="__add_supplier__">＋ Add new supplier…</option>`;
}

function updatePartRowStockNote(row) {
  if(!row)return;
  const partId=row.querySelector('.part-select')?.value||"";
  const note=row.querySelector('.part-stock-note');
  if(!note)return;
  const part=partCatalog.find(p=>p.id===partId);
  note.className="part-stock-note";
  if(!part){note.textContent="";return;}
  if(part.stockTracked!==true){note.textContent="Stock is not currently tracked for this part.";return;}
  const status=stockStatus(part);
  note.textContent=`Current known stock: ${stockNumber(part.currentStock)} · minimum: ${stockNumber(part.minStock)}${part.binLocation?` · ${part.binLocation}`:""}${status.label!=="In stock"?` · ${status.label}`:""}`;
  if(status.className==="stock-low")note.classList.add("low");
  if(status.className==="stock-out")note.classList.add("out");
}

function addPartRow(data={}) {
  partRowCounter += 1;
  const row = document.createElement("div");
  row.className = "part-entry part-used-entry";
  row.dataset.partRow = String(partRowCounter);
  row.innerHTML = `<div class="part-entry-head"><strong>Used part ${partRowCounter}</strong><button type="button" class="remove-part-btn" title="Remove part">Remove</button></div><div class="part-entry-grid"><label>Part<select class="part-select">${partOptions(data.partId||"")}</select></label><label>Part number<input class="part-number" value="${esc(data.partNo||"")}" readonly placeholder="From saved part" /></label><label>Quantity used<input class="part-qty" type="number" min="0" step="1" value="${data.qty!==undefined?Math.max(0,Number(data.qty)||0):1}" /></label><label>Unit price (${currencySymbol()})<input class="part-price" type="number" min="0" step="0.01" value="${data.unitPrice!==undefined?esc(data.unitPrice):""}" placeholder="Price per item" /></label><label>Supplier<select class="supplier-select">${supplierOptions(data.supplier||"")}</select></label><label>Date used / fitted<input class="part-date" type="date" value="${esc(data.date||defaultFormDate())}" /></label></div><div class="price-note">Only <strong>Quantity used</strong> is deducted from tracked stock. Unit price is the price per item.</div><div class="part-stock-note"></div>`;
  $("#partsEditor").appendChild(row);
  const selected = partCatalog.find(p=>p.id===data.partId);
  if (selected) row.querySelector('.part-number').value = selected.partNo || "";
  updatePartRowStockNote(row);
}

function addOrderedPartRow(data={}) {
  orderedPartRowCounter += 1;
  const row = document.createElement("div");
  row.className = "part-entry part-ordered-entry";
  row.dataset.orderedPartRow = String(orderedPartRowCounter);
  row.innerHTML = `<div class="part-entry-head"><strong>Ordered part ${orderedPartRowCounter}</strong><button type="button" class="remove-ordered-part-btn" title="Remove ordered part">Remove</button></div><div class="part-entry-grid"><label>Part<select class="part-select">${partOptions(data.partId||"")}</select></label><label>Part number<input class="part-number" value="${esc(data.partNo||"")}" readonly placeholder="From saved part" /></label><label>Quantity ordered<input class="part-ordered-qty" type="number" min="0" step="1" value="${data.orderedQty!==undefined?Math.max(0,Number(data.orderedQty)||0):1}" /></label><label>Unit price (${currencySymbol()})<input class="part-price" type="number" min="0" step="0.01" value="${data.unitPrice!==undefined?esc(data.unitPrice):""}" placeholder="Price per item" /></label><label>Supplier<select class="supplier-select">${supplierOptions(data.supplier||"")}</select></label><label>Date ordered<input class="part-date" type="date" value="${esc(data.date||defaultFormDate())}" /></label></div><div class="price-note">This records what was ordered for the job. It does <strong>not</strong> change stock. Stock only changes when parts are received through ordering or recorded as used.</div><div class="part-stock-note"></div>`;
  $("#partsOrderedEditor")?.appendChild(row);
  const selected = partCatalog.find(p=>p.id===data.partId);
  if (selected) row.querySelector('.part-number').value = selected.partNo || "";
  updatePartRowStockNote(row);
}

function refreshAllPartRowOptions() {
  $$('.part-entry').forEach(row=>{
    const partSel = row.querySelector('.part-select');
    const supplierSel = row.querySelector('.supplier-select');
    if(!partSel||!supplierSel)return;
    const p = partSel.value, s = supplierSel.value;
    partSel.innerHTML = partOptions(p);
    supplierSel.innerHTML = supplierOptions(s);
  });
}

function collectUsedPartsFromEditor() {
  const result = [];
  for (const row of $$('#partsEditor .part-entry')) {
    const partId = row.querySelector('.part-select')?.value || "";
    if (!partId || partId.startsWith('__')) continue;
    const catalogPart = partCatalog.find(p=>p.id===partId);
    if (!catalogPart) continue;
    const qty = Math.max(0, Number(row.querySelector('.part-qty')?.value)||0);
    if (qty === 0) continue;
    const priceRaw = row.querySelector('.part-price')?.value ?? "";
    if (priceRaw === "") { alert(`Enter the current unit price for ${catalogPart.name}.`); row.querySelector('.part-price')?.focus(); return null; }
    const unitPrice = Math.max(0, Number(priceRaw)||0);
    const supplier = row.querySelector('.supplier-select')?.value || "";
    const date = row.querySelector('.part-date')?.value || "";
    result.push({partId:catalogPart.id,name:catalogPart.name,partNo:catalogPart.partNo||"",orderedQty:0,qty,unitPrice,supplier,date});
  }
  return result;
}

function collectOrderedPartsFromEditor() {
  const result = [];
  for (const row of $$('#partsOrderedEditor .part-entry')) {
    const partId = row.querySelector('.part-select')?.value || "";
    if (!partId || partId.startsWith('__')) continue;
    const catalogPart = partCatalog.find(p=>p.id===partId);
    if (!catalogPart) continue;
    const orderedQty = Math.max(0, Number(row.querySelector('.part-ordered-qty')?.value)||0);
    if (orderedQty === 0) continue;
    const priceRaw = row.querySelector('.part-price')?.value ?? "";
    if (priceRaw === "") { alert(`Enter the current unit price for ${catalogPart.name}.`); row.querySelector('.part-price')?.focus(); return null; }
    const unitPrice = Math.max(0, Number(priceRaw)||0);
    const supplier = row.querySelector('.supplier-select')?.value || "";
    const date = row.querySelector('.part-date')?.value || "";
    result.push({partId:catalogPart.id,name:catalogPart.name,partNo:catalogPart.partNo||"",orderedQty,qty:0,unitPrice,supplier,date});
  }
  return result;
}

function collectPartsFromEditor() {
  const ordered = collectOrderedPartsFromEditor();
  if (ordered===null) return null;
  const used = collectUsedPartsFromEditor();
  if (used===null) return null;
  return [...ordered,...used];
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
  renderJobProjectSelect($("#jobProjectSelect")?.value||"");
  const currentSection = $("#jobSectionSelect")?.value || "";
  renderMachineSelect(currentSection,$("#jobMachineSelect")?.value || "");
  refreshAllPartRowOptions();
}


function pmDateObject(value) {
  const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return null;
  return new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12,0,0,0);
}
function pmDateOnly(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;}
function pmWeekRange(){const d=new Date();d.setHours(12,0,0,0);const day=d.getDay()||7;const start=new Date(d);start.setDate(start.getDate()-(day-1));const end=new Date(start);end.setDate(end.getDate()+6);return{start:pmDateOnly(start),end:pmDateOnly(end)};}
function pmAddDays(value,days){const d=pmDateObject(value);if(!d)return value;d.setDate(d.getDate()+days);return pmDateOnly(d);}
function pmFrequencyLabel(schedule){const n=Math.max(1,Number(schedule?.intervalValue)||1),unit=String(schedule?.intervalUnit||"month");return n===1?`Every ${unit}`:`Every ${n} ${unit}s`;}
function pmMachineForSchedule(schedule){return schedule?.machineId?machines.find(m=>String(m.id)===String(schedule.machineId)):null;}
function pmLocationLabel(schedule){const m=pmMachineForSchedule(schedule);if(m)return `${m.assetId} · ${m.name}${m.section?` · ${m.section}`:""}`;return schedule?.location||schedule?.section||"Site-wide";}
function pmAssignedNames(schedule){const ids=new Set(schedule?.assignedProfileIds||[]);const names=profiles.filter(p=>ids.has(String(p.id))).map(p=>p.name);return names.length?names.join(", "):"Unassigned";}
function pmVisibleSchedules(){return selectedProfileId==="all"?preventiveSchedules:preventiveSchedules.filter(s=>(s.assignedProfileIds||[]).includes(selectedProfileId));}
function pmActiveCategories(){return preventiveCategories.filter(c=>c.active!==false);}
function pmCategory(schedule){return preventiveCategories.find(c=>String(c.id)===String(schedule?.categoryId||""))||null;}
function pmCategoryName(schedule){return pmCategory(schedule)?.name||"Uncategorised";}
function pmCategoryMatches(schedule){if(selectedPmCategory==="all")return true;if(selectedPmCategory==="uncategorised")return !pmCategory(schedule);return String(schedule?.categoryId||"")===String(selectedPmCategory);}
function pmCategoryVisibleSchedules(){return pmVisibleSchedules().filter(pmCategoryMatches);}
function pmStatus(schedule){if(schedule?.active===false)return{label:"Paused",cls:"paused"};const today=pmDateOnly(),due=String(schedule?.nextDueDate||"");if(!due)return{label:"No due date",cls:"paused"};if(due<today)return{label:"Overdue",cls:"overdue"};if(due<=pmAddDays(today,7))return{label:"Due soon",cls:"soon"};return{label:"Scheduled",cls:"scheduled"};}
function pmHistoryLocation(row){if(row.machineAssetId||row.machineName)return `${row.machineAssetId||""}${row.machineAssetId?" · ":""}${row.machineName||"Machine"}${row.section?` · ${row.section}`:""}`;return row.location||row.section||"Site-wide";}

function ensurePreventiveUi(){
  if(document.getElementById("preventiveView"))return;
  const style=document.createElement("style");style.id="pmStyles";style.textContent=`
  .pm-titlebar{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;margin-bottom:16px}.pm-titlebar h1{margin:0 0 5px}.pm-titlebar p{margin:0;color:#667085}.pm-actions{display:flex;gap:8px;flex-wrap:wrap}.pm-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}.pm-kpi,.pm-card{background:var(--card,#fff);border:1px solid #e2e7ef;border-radius:16px}.pm-kpi{padding:15px}.pm-kpi span{display:block;color:#667085;font-size:.82rem}.pm-kpi strong{display:block;font-size:1.45rem;margin-top:5px}.pm-card{padding:18px;margin:16px 0}.pm-card h2{margin:0 0 4px}.pm-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px}.pm-card-head p{margin:3px 0 0;color:#667085}.pm-status{display:inline-flex;padding:4px 9px;border-radius:999px;font-size:.75rem;font-weight:700;white-space:nowrap}.pm-status.overdue{background:#fee4e2;color:#b42318}.pm-status.due{background:#fff3d6;color:#934d00}.pm-status.soon{background:#e8f1ff;color:#175cd3}.pm-status.scheduled{background:#f2f4f7;color:#475467}.pm-status.paused{background:#f2f4f7;color:#667085}.pm-due-title{display:block;font-weight:700}.pm-due-sub{display:block;color:#667085;font-size:.78rem;margin-top:3px}.pm-table-actions{display:flex;gap:6px;flex-wrap:wrap}.pm-dialog{border:0;border-radius:18px;width:min(760px,calc(100% - 24px));max-height:90%;padding:0;box-shadow:0 24px 70px rgba(16,24,40,.24)}.pm-dialog::backdrop{background:rgba(16,24,40,.55)}.pm-dialog form{padding:20px}.pm-dialog-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:16px}.pm-dialog-head h2{margin:0}.pm-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pm-form-grid label,.pm-full{display:grid;gap:5px;font-size:.84rem;font-weight:600}.pm-form-grid input,.pm-form-grid select,.pm-form-grid textarea,.pm-full textarea,.pm-full input,.pm-full select{width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #cfd6e1;border-radius:9px;background:#fff;color:inherit;font:inherit}.pm-full{margin-top:12px}.pm-assignees{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;border:1px solid #e2e7ef;border-radius:10px;padding:10px;max-height:190px;overflow:auto}.pm-assignee{display:flex!important;grid-template-columns:auto 1fr!important;gap:8px!important;align-items:center;font-weight:500!important;padding:7px;border-radius:8px}.pm-assignee input{width:auto!important}.pm-dialog-actions{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:18px;padding-top:14px;border-top:1px solid #e2e7ef}.pm-dialog-actions>div{display:flex;gap:8px;flex-wrap:wrap}.pm-empty{padding:24px;text-align:center;color:#667085;border:1px dashed #cfd6e1;border-radius:12px}.pm-email-note{font-size:.78rem;color:#667085;margin-top:8px}.pm-email-result{margin:8px 0 0;font-size:.82rem}.pm-check{display:flex!important;grid-template-columns:auto 1fr!important;gap:8px!important;align-items:center}.pm-check input{width:auto!important}.pm-category-tabs{display:flex;gap:8px;overflow-x:auto;padding:2px 0 8px;margin:2px 0 8px;scrollbar-width:thin}.pm-category-tab{border:1px solid #cfd6e1;background:#fff;color:#344054;border-radius:999px;padding:9px 14px;font:inherit;font-weight:700;white-space:nowrap;cursor:pointer}.pm-category-tab.active{background:#101828;color:#fff;border-color:#101828}.pm-category-tab span{opacity:.7;font-size:.78rem;margin-left:5px}.pm-category-badge{display:inline-flex;margin-top:5px;padding:3px 7px;border-radius:999px;background:#f2f4f7;color:#475467;font-size:.7rem;font-weight:700}.pm-category-list{display:grid;gap:8px;margin-top:14px}.pm-category-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e2e7ef;border-radius:10px}.pm-category-row.archived{opacity:.65}.pm-category-row-actions{display:flex;gap:6px;flex-wrap:wrap}.pm-category-add{display:flex;gap:8px;align-items:end}.pm-category-add label{flex:1;display:grid;gap:5px;font-size:.84rem;font-weight:600}.pm-category-add input{width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #cfd6e1;border-radius:9px;font:inherit}@media(max-width:760px){.pm-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pm-form-grid{grid-template-columns:1fr}.pm-assignees{grid-template-columns:1fr}.pm-card{padding:14px}}@media(max-width:420px){.pm-grid{grid-template-columns:1fr 1fr}.pm-kpi strong{font-size:1.2rem}}
  `;document.head.appendChild(style);
  const nav=document.getElementById("mainNav");if(nav){const b=document.createElement("button");b.type="button";b.className="nav-item";b.dataset.view="preventive";b.innerHTML=`<span>✓</span><span>Preventive</span>`;const downtime=nav.querySelector('[data-view="downtime"]');nav.insertBefore(b,downtime||nav.querySelector('[data-view="reports"]')||null);}
  const view=document.createElement("section");view.id="preventiveView";view.className="view";view.innerHTML=`<div class="pm-titlebar"><div><h1>Preventive Maintenance</h1><p id="pmSubtitle">Recurring checks and planned maintenance.</p></div><div class="pm-actions"><button type="button" class="btn secondary" id="pmManageCategoriesBtn" hidden>Manage categories</button><button type="button" class="btn secondary" id="pmEmailNowBtn" hidden>✉ Send this week's emails</button><button type="button" class="btn primary" id="pmNewBtn">+ New PM schedule</button></div></div><div id="pmCategoryTabs" class="pm-category-tabs" aria-label="Preventive maintenance categories"></div><div class="pm-grid"><div class="pm-kpi"><span>Overdue</span><strong id="pmOverdueCount">0</strong></div><div class="pm-kpi"><span>Due this week</span><strong id="pmWeekCount">0</strong></div><div class="pm-kpi"><span>Due soon (7 days)</span><strong id="pmSoonCount">0</strong></div><div class="pm-kpi"><span>Active schedules</span><strong id="pmActiveCount">0</strong></div></div><article class="pm-card"><div class="pm-card-head"><div><h2>Due soon & overdue</h2><p>Shows overdue jobs and work due within the next 7 days.</p></div></div><div class="table-wrap"><table><thead><tr><th>PM job</th><th>Location / machine</th><th>Engineers</th><th>Frequency</th><th>Next due</th><th>Status</th><th>Action</th></tr></thead><tbody id="pmDueBody"></tbody></table></div></article><article class="pm-card"><div class="pm-card-head"><div><h2>All schedules</h2><p>Site-wide checks and machine-specific maintenance can both be scheduled.</p></div></div><div class="table-wrap"><table><thead><tr><th>PM job</th><th>Location / machine</th><th>Engineers</th><th>Frequency</th><th>Next due</th><th>Status</th><th>Action</th></tr></thead><tbody id="pmScheduleBody"></tbody></table></div></article><article class="pm-card"><div class="pm-card-head"><div><h2>Recent completion history</h2><p>Completed preventive jobs stay recorded here. Admins can remove duplicate or test records.</p></div></div><div class="table-wrap"><table><thead><tr><th>Completed</th><th>PM job</th><th>Due</th><th>Location / machine</th><th>Completed by</th><th>Notes</th><th>Action</th></tr></thead><tbody id="pmHistoryBody"></tbody></table></div></article>`;
  const reference=document.getElementById("downtimeView")||document.getElementById("reportsView");const parent=reference?.parentElement||document.querySelector("main")||document.body;if(reference)parent.insertBefore(view,reference);else parent.appendChild(view);
  const dialog=document.createElement("dialog");dialog.id="pmDialog";dialog.className="pm-dialog";dialog.innerHTML=`<form id="pmForm"><div class="pm-dialog-head"><div><h2 id="pmDialogTitle">New PM schedule</h2><p class="muted" id="pmDialogSubtitle">Create a recurring preventive-maintenance job.</p></div><button type="button" class="btn secondary compact" id="pmCloseBtn">Close</button></div><input type="hidden" name="id"><div class="pm-form-grid"><label>Job title<input name="title" required maxlength="160" placeholder="Emergency light checks"></label><label>Category<select name="categoryId" id="pmCategorySelect" required></select></label><label>First / next due date<input name="nextDueDate" type="date" required></label><label>Repeat every<input name="intervalValue" type="number" min="1" max="365" step="1" value="1" required></label><label>Period<select name="intervalUnit"><option value="day">Day(s)</option><option value="week">Week(s)</option><option value="month" selected>Month(s)</option><option value="year">Year(s)</option></select></label><label>Section (optional)<select name="section" id="pmSectionSelect"></select></label><label>Machine (optional)<select name="machineId" id="pmMachineSelect"></select></label><label style="grid-column:1/-1">Area / location (optional)<input name="location" maxlength="300" placeholder="All factory emergency lights"></label></div><label class="pm-full">Instructions / checklist<textarea name="description" rows="4" maxlength="4000" placeholder="Check operation, test button, condition and record any failures..."></textarea></label><div class="pm-full"><span>Assigned engineers</span><div id="pmAssignees" class="pm-assignees"></div></div><label class="pm-full pm-check"><input type="checkbox" name="active" checked> Schedule active</label><p class="pm-email-note">Every Monday morning, each assigned engineer receives one email listing their overdue and due-this-week PM jobs.</p><div class="pm-dialog-actions"><div><button type="button" class="btn danger" id="pmDeleteBtn" hidden>Delete schedule</button></div><div><button type="button" class="btn secondary" id="pmCancelBtn">Cancel</button><button type="submit" class="btn primary" id="pmSaveBtn">Save schedule</button></div></div></form>`;document.body.appendChild(dialog);
  const categoryDialog=document.createElement("dialog");categoryDialog.id="pmCategoryDialog";categoryDialog.className="pm-dialog";categoryDialog.innerHTML=`<form id="pmCategoryForm"><div class="pm-dialog-head"><div><h2>Preventive categories</h2><p class="muted">Mechanical, Electrical and Tooling are included by default. Add more categories whenever you need them.</p></div><button type="button" class="btn secondary compact" id="pmCategoryCloseBtn">Close</button></div><div class="pm-category-add"><label>New category<input name="name" maxlength="80" placeholder="Facilities" required></label><button type="submit" class="btn primary">Add category</button></div><div id="pmCategoryList" class="pm-category-list"></div></form>`;document.body.appendChild(categoryDialog);
  $("#pmNewBtn")?.addEventListener("click",()=>openPreventiveDialog());
  $("#pmCloseBtn")?.addEventListener("click",()=>dialog.close());$("#pmCancelBtn")?.addEventListener("click",()=>dialog.close());
  $("#pmMachineSelect")?.addEventListener("change",e=>{const m=machines.find(x=>String(x.id)===String(e.target.value));if(m&&$("#pmSectionSelect"))$("#pmSectionSelect").value=m.section||"";});
  $("#pmForm")?.addEventListener("submit",submitPreventiveSchedule);
  $("#pmDeleteBtn")?.addEventListener("click",deletePreventiveFromDialog);
  $("#preventiveView")?.addEventListener("click",handlePreventiveViewClick);
  $("#pmEmailNowBtn")?.addEventListener("click",sendPreventiveEmailsNow);
  $("#pmManageCategoriesBtn")?.addEventListener("click",openPmCategoryDialog);
  $("#pmCategoryCloseBtn")?.addEventListener("click",()=>categoryDialog.close());
  $("#pmCategoryForm")?.addEventListener("submit",submitPmCategory);
  $("#pmCategoryList")?.addEventListener("click",handlePmCategoryManagerClick);
}

function renderPmDialogOptions(selectedSchedule=null){
  const section=$("#pmSectionSelect"),machine=$("#pmMachineSelect"),assignees=$("#pmAssignees"),category=$("#pmCategorySelect");if(!section||!machine||!assignees||!category)return;
  const activeCategories=pmActiveCategories();const currentCategory=pmCategory(selectedSchedule);category.innerHTML=activeCategories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")+(currentCategory&&currentCategory.active===false?`<option value="${esc(currentCategory.id)}">${esc(currentCategory.name)} (archived)</option>`:"");
  const sectionNames=[...new Set(sections.filter(Boolean))].sort((a,b)=>a.localeCompare(b));section.innerHTML=`<option value="">Site-wide / no section</option>${sectionNames.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join("")}`;
  const activeMachines=machines.filter(m=>!isMachineArchived(m)).sort((a,b)=>String(a.assetId).localeCompare(String(b.assetId),undefined,{numeric:true}));machine.innerHTML=`<option value="">No machine / general check</option>${activeMachines.map(m=>`<option value="${esc(m.id)}">${esc(m.assetId)} · ${esc(m.name)} · ${esc(m.section)}</option>`).join("")}`;
  const selectedIds=new Set(selectedSchedule?.assignedProfileIds||((selectedProfileId!=="all"&&selectedProfileId)?[selectedProfileId]:[]));assignees.innerHTML=activeProfiles().length?activeProfiles().map(p=>`<label class="pm-assignee"><input type="checkbox" value="${esc(p.id)}" ${selectedIds.has(String(p.id))?"checked":""}> <span>${esc(p.name)}${p.email?`<small style="display:block;color:#667085">${esc(p.email)}</small>`:""}</span></label>`).join(""):`<div class="pm-empty">Add an engineer profile before creating PM schedules.</div>`;
}

function openPreventiveDialog(scheduleId=""){
  ensurePreventiveUi();const dialog=$("#pmDialog"),form=$("#pmForm");if(!dialog||!form)return;form.reset();const schedule=scheduleId?preventiveSchedules.find(item=>String(item.id)===String(scheduleId)):null;renderPmDialogOptions(schedule);form.elements.id.value=schedule?.id||"";form.elements.title.value=schedule?.title||"";form.elements.categoryId.value=schedule?.categoryId||pmActiveCategories()[0]?.id||"";form.elements.description.value=schedule?.description||"";form.elements.nextDueDate.value=schedule?.nextDueDate||pmDateOnly();form.elements.intervalValue.value=Math.max(1,Number(schedule?.intervalValue)||1);form.elements.intervalUnit.value=schedule?.intervalUnit||"month";form.elements.section.value=schedule?.section||"";form.elements.machineId.value=schedule?.machineId||"";form.elements.location.value=schedule?.location||"";form.elements.active.checked=schedule?.active!==false;$("#pmDialogTitle").textContent=schedule?`Edit · ${schedule.title}`:"New PM schedule";$("#pmDialogSubtitle").textContent=schedule?"Update the recurrence, assignment or next due date.":"Create a recurring site-wide or machine-specific preventive-maintenance job.";$("#pmDeleteBtn").hidden=!schedule;$("#pmSaveBtn").textContent=schedule?"Save changes":"Save schedule";dialog.showModal();
}

async function submitPreventiveSchedule(e){e.preventDefault();const form=e.currentTarget,assigned=[...$("#pmAssignees").querySelectorAll('input[type="checkbox"]:checked')].map(input=>input.value);if(!assigned.length){alert("Assign this PM job to at least one engineer.");return;}const schedule={id:String(form.elements.id.value||""),title:String(form.elements.title.value||"").trim(),categoryId:String(form.elements.categoryId.value||""),description:String(form.elements.description.value||"").trim(),nextDueDate:String(form.elements.nextDueDate.value||""),intervalValue:Number(form.elements.intervalValue.value)||1,intervalUnit:String(form.elements.intervalUnit.value||"month"),section:String(form.elements.section.value||""),machineId:String(form.elements.machineId.value||""),location:String(form.elements.location.value||"").trim(),assignedProfileIds:assigned,active:form.elements.active.checked};const btn=$("#pmSaveBtn");btn.disabled=true;btn.textContent="Saving…";try{await saveMutation("/api/preventive",{action:schedule.id?"update":"create",schedule});$("#pmDialog").close();switchView("preventive");}catch(error){showSaveError(error);}finally{btn.disabled=false;btn.textContent=schedule.id?"Save changes":"Save schedule";}}
async function deletePreventiveFromDialog(){const id=String($("#pmForm")?.elements.id.value||"");const schedule=preventiveSchedules.find(item=>String(item.id)===id);if(!schedule||!confirm(`Delete the PM schedule “${schedule.title}”?\n\nIts existing completion history will be kept.`))return;try{await saveMutation("/api/preventive",{action:"delete",id});$("#pmDialog").close();switchView("preventive");}catch(error){showSaveError(error);}}
async function completePreventive(id){const schedule=preventiveSchedules.find(item=>String(item.id)===String(id));if(!schedule)return;const notes=prompt(`Complete “${schedule.title}” due ${fmtDate(schedule.nextDueDate)}.\n\nCompletion notes (optional):`,"");if(notes===null)return;try{await saveMutation("/api/preventive",{action:"complete",id:schedule.id,notes});switchView("preventive");}catch(error){showSaveError(error);}}
async function togglePreventive(id){const schedule=preventiveSchedules.find(item=>String(item.id)===String(id));if(!schedule)return;const active=schedule.active===false;if(!active&&!confirm(`Pause “${schedule.title}”? It will stop appearing as due and will not be included in Monday emails.`))return;try{await saveMutation("/api/preventive",{action:"toggle",id:schedule.id,active});switchView("preventive");}catch(error){showSaveError(error);}}
async function deletePreventiveHistory(id){if(!signedInIdentity?.admin)return;const row=preventiveHistory.find(item=>String(item.id)===String(id));if(!row)return;const label=row.title||"this completion";if(!confirm(`Delete the completion history record for “${label}”?\n\nThis only removes this history row. It will not delete the PM schedule or change its current next due date.`))return;try{await saveMutation("/api/preventive",{action:"history-delete",id:row.id,scheduleId:row.scheduleId||"",completedAt:row.completedAt||"",dueDate:row.dueDate||"",title:row.title||""});switchView("preventive");}catch(error){showSaveError(error);}}
function handlePreventiveViewClick(e){const category=e.target.closest("[data-pm-category]");if(category){selectedPmCategory=String(category.dataset.pmCategory||"all");renderPreventive();return;}const historyDelete=e.target.closest("[data-pm-history-delete]");if(historyDelete){deletePreventiveHistory(historyDelete.dataset.pmHistoryDelete);return;}const complete=e.target.closest("[data-pm-complete]");if(complete){completePreventive(complete.dataset.pmComplete);return;}const edit=e.target.closest("[data-pm-edit]");if(edit){openPreventiveDialog(edit.dataset.pmEdit);return;}const toggle=e.target.closest("[data-pm-toggle]");if(toggle){togglePreventive(toggle.dataset.pmToggle);return;}}
function renderPmCategoryTabs(){
  const host=$("#pmCategoryTabs");if(!host)return;const visible=pmVisibleSchedules();const active=pmActiveCategories();const validIds=new Set(active.map(c=>String(c.id)));if(selectedPmCategory!=="all"&&selectedPmCategory!=="uncategorised"&&!validIds.has(String(selectedPmCategory)))selectedPmCategory="all";
  const countFor=id=>id==="all"?visible.length:id==="uncategorised"?visible.filter(s=>!pmCategory(s)).length:visible.filter(s=>String(s.categoryId||"")===String(id)).length;
  const tabs=[{id:"all",name:"All"},...active.map(c=>({id:String(c.id),name:c.name}))];if(visible.some(s=>!pmCategory(s)))tabs.push({id:"uncategorised",name:"Uncategorised"});
  host.innerHTML=tabs.map(tab=>`<button type="button" class="pm-category-tab ${selectedPmCategory===tab.id?"active":""}" data-pm-category="${esc(tab.id)}">${esc(tab.name)}<span>${countFor(tab.id)}</span></button>`).join("");
}
function renderPmCategoryManager(){
  const host=$("#pmCategoryList");if(!host)return;host.innerHTML=preventiveCategories.length?preventiveCategories.map(c=>{const used=preventiveSchedules.filter(s=>String(s.categoryId||"")===String(c.id)).length;return `<div class="pm-category-row ${c.active===false?"archived":""}"><div><strong>${esc(c.name)}</strong><div class="muted">${used} schedule${used===1?"":"s"}${c.active===false?" · Archived":""}</div></div><div class="pm-category-row-actions"><button type="button" class="btn secondary compact" data-pm-category-edit="${esc(c.id)}">Rename</button><button type="button" class="btn secondary compact" data-pm-category-toggle="${esc(c.id)}">${c.active===false?"Restore":"Archive"}</button></div></div>`;}).join(""):`<div class="pm-empty">No categories found.</div>`;
}
function openPmCategoryDialog(){if(!signedInIdentity?.admin)return;renderPmCategoryManager();$("#pmCategoryForm")?.reset();$("#pmCategoryDialog")?.showModal();}
async function submitPmCategory(e){e.preventDefault();const form=e.currentTarget;const name=String(form.elements.name.value||"").trim();if(!name)return;try{await saveMutation("/api/preventive",{action:"category-add",name});form.reset();renderPmCategoryManager();renderPreventive();}catch(error){showSaveError(error);}}
async function handlePmCategoryManagerClick(e){
  const edit=e.target.closest("[data-pm-category-edit]");if(edit){const c=preventiveCategories.find(x=>String(x.id)===String(edit.dataset.pmCategoryEdit));if(!c)return;const name=prompt(`Rename “${c.name}” to:`,c.name);if(name===null||!String(name).trim())return;try{await saveMutation("/api/preventive",{action:"category-rename",id:c.id,name:String(name).trim()});renderPmCategoryManager();renderPreventive();}catch(error){showSaveError(error);}return;}
  const toggle=e.target.closest("[data-pm-category-toggle]");if(toggle){const c=preventiveCategories.find(x=>String(x.id)===String(toggle.dataset.pmCategoryToggle));if(!c)return;const active=c.active===false;if(!active&&!confirm(`Archive “${c.name}”? Existing schedules keep their category and remain available under All, but this tab will be hidden until restored.`))return;try{await saveMutation("/api/preventive",{action:"category-toggle",id:c.id,active});renderPmCategoryManager();renderPreventive();}catch(error){showSaveError(error);}}
}
async function sendPreventiveEmailsNow(){if(!signedInIdentity?.admin)return;if(!confirm("Send each engineer their preventive-maintenance list for this week now?\n\nOnly engineers with overdue or due-this-week work will receive an email."))return;const btn=$("#pmEmailNowBtn");btn.disabled=true;btn.textContent="Sending…";try{const payload=await api("/api/preventive/send-weekly",{method:"POST",body:JSON.stringify({})});if(payload.state)applySharedState(payload);renderAll();switchView("preventive");const result=payload.result||{};const sent=Number(result.sentEmails)||0;alert(sent?`Sent ${sent} weekly PM email${sent===1?"":"s"}.`:`No emails were sent because no engineers currently have overdue or due-this-week PM jobs.`);}catch(error){showSaveError(error);}finally{btn.disabled=false;btn.textContent="✉ Send this week's emails";}}

function pmScheduleRow(schedule,{dueList=false}={}){const status=pmStatus(schedule);return `<tr><td><span class="pm-due-title">${esc(schedule.title)}</span><span class="pm-category-badge">${esc(pmCategoryName(schedule))}</span>${schedule.description?`<span class="pm-due-sub">${esc(schedule.description.length>110?schedule.description.slice(0,107)+"…":schedule.description)}</span>`:""}</td><td>${esc(pmLocationLabel(schedule))}</td><td>${esc(pmAssignedNames(schedule))}</td><td>${esc(pmFrequencyLabel(schedule))}</td><td><strong>${esc(fmtDate(schedule.nextDueDate))}</strong></td><td><span class="pm-status ${status.cls}">${esc(status.label)}</span></td><td><div class="pm-table-actions">${schedule.active!==false?`<button type="button" class="btn primary compact" data-pm-complete="${esc(schedule.id)}">Complete</button>`:""}<button type="button" class="btn secondary compact" data-pm-edit="${esc(schedule.id)}">Edit</button>${dueList?"":`<button type="button" class="btn secondary compact" data-pm-toggle="${esc(schedule.id)}">${schedule.active===false?"Resume":"Pause"}</button>`}</div></td></tr>`;}

function renderPreventive(){
  if(!$("#preventiveView"))return;
  renderPmCategoryTabs();
  const visible=pmCategoryVisibleSchedules(),active=visible.filter(s=>s.active!==false),today=pmDateOnly(),week=pmWeekRange(),soonEnd=pmAddDays(today,7);
  const overdue=active.filter(s=>s.nextDueDate&&s.nextDueDate<today),dueWeek=active.filter(s=>s.nextDueDate&&s.nextDueDate>=today&&s.nextDueDate<=week.end),soon=active.filter(s=>s.nextDueDate&&s.nextDueDate>=today&&s.nextDueDate<=soonEnd);
  $("#pmOverdueCount").textContent=String(overdue.length);$("#pmWeekCount").textContent=String(dueWeek.length);$("#pmSoonCount").textContent=String(soon.length);$("#pmActiveCount").textContent=String(active.length);
  const categoryText=selectedPmCategory==="all"?"all categories":selectedPmCategory==="uncategorised"?"uncategorised work":(preventiveCategories.find(c=>String(c.id)===String(selectedPmCategory))?.name||"selected category");
  $("#pmSubtitle").textContent=selectedProfileId==="all"?`Recurring checks and planned maintenance · ${categoryText}.`:`Preventive-maintenance work assigned to ${profileContext()} · ${categoryText}.`;
  const dueRows=active.filter(s=>s.nextDueDate&&s.nextDueDate<=soonEnd).sort((a,b)=>String(a.nextDueDate).localeCompare(String(b.nextDueDate))||String(a.title).localeCompare(String(b.title)));
  $("#pmDueBody").innerHTML=dueRows.length?dueRows.map(s=>pmScheduleRow(s,{dueList:true})).join(""):`<tr><td colspan="7">No preventive-maintenance jobs are overdue or due in the next 7 days for this category.</td></tr>`;
  const all=[...visible].sort((a,b)=>(a.active===false)-(b.active===false)||String(a.nextDueDate).localeCompare(String(b.nextDueDate))||String(a.title).localeCompare(String(b.title)));
  $("#pmScheduleBody").innerHTML=all.length?all.map(s=>pmScheduleRow(s)).join(""):`<tr><td colspan="7">No preventive-maintenance schedules in this category.</td></tr>`;
  let history=[...preventiveHistory].sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt)));
  if(selectedProfileId!=="all")history=history.filter(row=>(row.assignedProfileIds||[]).includes(selectedProfileId));
  if(selectedPmCategory!=="all")history=history.filter(row=>selectedPmCategory==="uncategorised"?!row.categoryId:String(row.categoryId||"")===String(selectedPmCategory));
  history=history.slice(0,30);
  $("#pmHistoryBody").innerHTML=history.length?history.map(row=>`<tr><td>${esc(new Date(row.completedAt).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}))}</td><td><strong>${esc(row.title)}</strong><span class="pm-category-badge">${esc(row.categoryName||preventiveCategories.find(c=>String(c.id)===String(row.categoryId||""))?.name||"Uncategorised")}</span></td><td>${esc(fmtDate(row.dueDate))}</td><td>${esc(pmHistoryLocation(row))}</td><td>${esc(row.completedByName||row.completedByEmail||"—")}</td><td>${esc(row.notes||"—")}</td><td>${signedInIdentity?.admin?`<button type="button" class="btn danger compact" data-pm-history-delete="${esc(row.id)}">Delete</button>`:"—"}</td></tr>`).join(""):`<tr><td colspan="7">No preventive-maintenance completions recorded for this category yet.</td></tr>`;
  const emailBtn=$("#pmEmailNowBtn"),manageBtn=$("#pmManageCategoriesBtn");if(emailBtn)emailBtn.hidden=!signedInIdentity?.admin;if(manageBtn)manageBtn.hidden=!signedInIdentity?.admin;
}


function projectOptions(selected="", {includeArchived=false}={}) {
  const rows=projects.filter(project=>includeArchived||String(project.status||"Active")!=="Archived").slice().sort((a,b)=>String(a.code||a.name).localeCompare(String(b.code||b.name)));
  const selectedProject=projectForId(selected);
  if(selectedProject&&!rows.some(project=>String(project.id)===String(selectedProject.id))) rows.unshift(selectedProject);
  return `<option value="">No project</option>${rows.map(project=>`<option value="${esc(project.id)}" ${String(project.id)===String(selected)?"selected":""}>${esc(project.code?`${project.code} · ${project.name}`:project.name)}${project.status==="Archived"?" (archived)":""}</option>`).join("")}`;
}
function ensureJobProjectField(){
  const form=$("#jobForm");if(!form||form.elements.projectId)return;
  const label=document.createElement("label");label.className="job-project-field";label.innerHTML=`Project (optional)<select name="projectId" id="jobProjectSelect"></select>`;
  const assigned=$("#jobAssignedSelect")?.closest("label");
  if(assigned?.parentElement) assigned.parentElement.insertBefore(label,assigned.nextSibling);
  else form.insertBefore(label,form.querySelector("#jobPartsOrderedSection")||form.querySelector("#timeEditor")||null);
}
function renderJobProjectSelect(selected=""){
  ensureJobProjectField();
  const select=$("#jobProjectSelect");if(!select)return;
  select.innerHTML=projectOptions(selected,{includeArchived:true});
  select.value=String(selected||"");
}
function projectStats(project){
  const linkedJobs=jobs.filter(job=>String(job.projectId||"")===String(project.id));
  const linkedOrders=purchaseOrders.filter(order=>String(order.projectId||"")===String(project.id));
  const ordered=linkedOrders.filter(order=>order.status==="Ordered").reduce((sum,order)=>sum+purchaseOrderTotal(order),0);
  const used=linkedJobs.reduce((sum,job)=>sum+jobPartsCost(job),0);
  return {jobs:linkedJobs.length,orders:linkedOrders.length,ordered,used};
}
function ensureProjectsUi(){
  if(document.getElementById("projectsView")){ensureJobProjectField();return;}
  const style=document.createElement("style");style.id="projectStyles";style.textContent=`
  .project-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px}.project-head h1,.project-head h2{margin:0 0 5px}.project-head p{margin:0;color:#667085}.project-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.project-kpi,.project-card{background:var(--card,#fff);border:1px solid #e2e7ef;border-radius:16px}.project-kpi{padding:15px}.project-kpi span{display:block;color:#667085;font-size:.82rem}.project-kpi strong{display:block;font-size:1.45rem;margin-top:5px}.project-card{padding:18px;margin:16px 0}.project-chart-wrap{display:grid;grid-template-columns:minmax(220px,320px) 1fr;gap:24px;align-items:center}.project-pie{width:min(240px,100%);aspect-ratio:1;border-radius:50%;margin:auto;background:#e7ebf1}.project-legend{display:grid;gap:8px}.project-actions{display:flex;gap:6px;flex-wrap:wrap}.project-dialog{border:0;border-radius:18px;width:min(620px,calc(100% - 24px));padding:0;box-shadow:0 24px 70px rgba(16,24,40,.24)}.project-dialog::backdrop{background:rgba(16,24,40,.55)}.project-dialog form{padding:20px}.project-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.project-form-grid label,.project-full{display:grid;gap:5px;font-size:.84rem;font-weight:700}.project-form-grid input,.project-form-grid select,.project-full textarea{width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #cfd6e1;border-radius:9px;font:inherit}.project-full{margin-top:12px}.project-dialog-actions{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:18px}@media(max-width:720px){.project-grid{grid-template-columns:1fr}.project-chart-wrap{grid-template-columns:1fr}.project-form-grid{grid-template-columns:1fr}}
  `;document.head.appendChild(style);
  const nav=$("#mainNav");if(nav){const b=document.createElement("button");b.type="button";b.className="nav-item";b.dataset.view="projects";b.innerHTML=`<span>▤</span><span>Projects</span>`;nav.insertBefore(b,nav.querySelector('[data-view="data"]')||null);}
  const reference=$("#dataView")||$("#reportsView"),parent=reference?.parentElement||document.querySelector("main")||document.body;
  const view=document.createElement("section");view.id="projectsView";view.className="view";view.innerHTML=`<div class="project-head"><div><h1>Projects</h1><p>Group maintenance jobs and purchase orders together and track project costs.</p></div><button type="button" class="btn primary" id="projectNewBtn">+ New project</button></div><div class="project-grid"><div class="project-kpi"><span>Active projects</span><strong id="projectActiveCount">0</strong></div><div class="project-kpi"><span>Ordered cost</span><strong id="projectOrderedCost">${money(0)}</strong></div><div class="project-kpi"><span>Parts used</span><strong id="projectUsedCost">${money(0)}</strong></div></div><article class="project-card"><div class="project-head"><div><h2>Project cost pie chart</h2><p>Placed purchase-order value by project. Parts used from stock are shown separately to avoid double-counting purchases.</p></div></div><div class="project-chart-wrap"><div class="project-pie" id="projectCostPie"></div><div class="project-legend" id="projectCostLegend"></div></div></article><article class="project-card"><div class="project-head"><div><h2>All projects</h2><p>Jobs and purchase orders can be assigned to a project from their normal forms.</p></div></div><div class="table-wrap"><table><thead><tr><th>Project</th><th>Status</th><th>Jobs</th><th>Orders</th><th>Ordered cost</th><th>Parts used</th><th>Budget</th><th>Action</th></tr></thead><tbody id="projectsBody"></tbody></table></div></article>`;
  if(reference)parent.insertBefore(view,reference);else parent.appendChild(view);
  const dialog=document.createElement("dialog");dialog.id="projectDialog";dialog.className="project-dialog";dialog.innerHTML=`<form id="projectForm"><div class="project-head"><div><h2 id="projectDialogTitle">New project</h2><p>Create a project for jobs and purchase orders.</p></div><button type="button" class="btn secondary compact" id="projectCloseBtn">Close</button></div><input type="hidden" name="id"><div class="project-form-grid"><label>Project name<input name="name" required maxlength="180" placeholder="Line 4 upgrade"></label><label>Project code<input name="code" maxlength="80" placeholder="PRJ-001"></label><label>Status<select name="status"><option>Active</option><option>Completed</option><option>Archived</option></select></label><label>Budget (${currencySymbol()})<input name="budget" type="number" min="0" step="0.01" placeholder="Optional"></label></div><label class="project-full">Notes<textarea name="notes" rows="4" maxlength="2000"></textarea></label><div class="project-dialog-actions"><button type="button" class="btn danger" id="projectDeleteBtn" hidden>Delete project</button><div><button type="button" class="btn secondary" id="projectCancelBtn">Cancel</button><button type="submit" class="btn primary">Save project</button></div></div></form>`;document.body.appendChild(dialog);
  $("#projectNewBtn")?.addEventListener("click",()=>openProjectDialog());
  $("#projectCloseBtn")?.addEventListener("click",()=>dialog.close());$("#projectCancelBtn")?.addEventListener("click",()=>dialog.close());
  $("#projectForm")?.addEventListener("submit",submitProject);
  $("#projectDeleteBtn")?.addEventListener("click",deleteProjectFromDialog);
  $("#projectsBody")?.addEventListener("click",e=>{const edit=e.target.closest("[data-project-edit]");if(edit)openProjectDialog(edit.dataset.projectEdit);});
  ensureJobProjectField();
}
function openProjectDialog(id=""){
  editingProjectId=id||null;const form=$("#projectForm");if(!form)return;form.reset();const project=projectForId(id);
  $("#projectDialogTitle").textContent=project?"Edit project":"New project";$("#projectDeleteBtn").hidden=!project;
  form.elements.id.value=project?.id||"";form.elements.name.value=project?.name||"";form.elements.code.value=project?.code||"";form.elements.status.value=project?.status||"Active";form.elements.budget.value=project?.budget?String(project.budget):"";form.elements.notes.value=project?.notes||"";
  $("#projectDialog")?.showModal();
}
async function submitProject(e){
  e.preventDefault();const form=e.currentTarget,fd=new FormData(form);const project={id:String(fd.get("id")||"")||undefined,name:String(fd.get("name")||"").trim(),code:String(fd.get("code")||"").trim(),status:String(fd.get("status")||"Active"),budget:Number(fd.get("budget"))||0,notes:String(fd.get("notes")||"").trim()};
  try{await saveMutation("/api/projects",{action:"save",project});$("#projectDialog").close();editingProjectId=null;switchView("projects");}catch(error){showSaveError(error);}
}
async function deleteProjectFromDialog(){
  const id=$("#projectForm")?.elements.id.value;if(!id)return;if(!confirm("Delete this project? Projects linked to jobs or purchase orders must be archived instead."))return;
  try{await saveMutation("/api/projects",{action:"delete",id});$("#projectDialog").close();editingProjectId=null;switchView("projects");}catch(error){showSaveError(error);}
}
function renderProjects(){
  if(!$("#projectsView"))return;
  const active=projects.filter(project=>project.status==="Active"),stats=projects.map(project=>({project,...projectStats(project)}));
  const orderedTotal=stats.reduce((sum,row)=>sum+row.ordered,0),usedTotal=stats.reduce((sum,row)=>sum+row.used,0);
  $("#projectActiveCount").textContent=String(active.length);$("#projectOrderedCost").textContent=money(orderedTotal);$("#projectUsedCost").textContent=money(usedTotal);
  const pieRows=stats.filter(row=>row.ordered>0).sort((a,b)=>b.ordered-a.ordered).map(row=>({name:row.project.code?`${row.project.code} · ${row.project.name}`:row.project.name,value:row.ordered}));
  renderPie($("#projectCostPie"),$("#projectCostLegend"),pieRows,money);
  $("#projectsBody").innerHTML=stats.length?stats.sort((a,b)=>String(a.project.status).localeCompare(String(b.project.status))||String(a.project.code||a.project.name).localeCompare(String(b.project.code||b.project.name))).map(({project,jobs:jobCount,orders,ordered,used})=>`<tr><td><strong>${esc(project.code?`${project.code} · ${project.name}`:project.name)}</strong>${project.notes?`<br><small>${esc(project.notes.length>90?project.notes.slice(0,87)+"…":project.notes)}</small>`:""}</td><td>${esc(project.status||"Active")}</td><td>${jobCount}</td><td>${orders}</td><td>${money(ordered)}</td><td>${money(used)}</td><td>${project.budget?money(project.budget):"—"}</td><td><div class="project-actions"><button type="button" class="btn secondary compact" data-project-edit="${esc(project.id)}">Edit</button></div></td></tr>`).join(""):`<tr><td colspan="8">No projects yet.</td></tr>`;
  renderJobProjectSelect($("#jobProjectSelect")?.value||"");
  const poProject=$("#poProjectSelect");if(poProject){const current=poProject.value;poProject.innerHTML=projectOptions(current,{includeArchived:true});poProject.value=current;}
}

function ensurePurchaseOrderUi(){
  document.getElementById("stockPurchasingBlock")?.remove();
  if(document.getElementById("openOrdersView"))return;
  const style=document.createElement("style");style.id="purchaseOrderStyles";style.textContent=`
  .po-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px}.po-head h1{margin:0 0 5px}.po-head p{margin:0;color:#667085}.po-card{background:var(--card,#fff);border:1px solid #e2e7ef;border-radius:16px;padding:18px;margin:16px 0}.po-supplier-row{display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:9px;align-items:end;margin-bottom:16px}.po-supplier-row label{display:grid;gap:5px;font-size:.84rem;font-weight:700}.po-supplier-row select{width:100%;padding:10px 11px;border:1px solid #cfd6e1;border-radius:9px;background:#fff;font:inherit}.po-lines{display:grid;gap:9px}.po-line{display:grid;grid-template-columns:minmax(170px,1.3fr) minmax(120px,.7fr) 90px 120px 120px auto;gap:8px;align-items:end;padding:10px;border:1px solid #e2e7ef;border-radius:11px}.po-line label{display:grid;gap:4px;font-size:.78rem;font-weight:700;min-width:0}.po-line input{width:100%;min-width:0;box-sizing:border-box;padding:9px 10px;border:1px solid #cfd6e1;border-radius:8px;font:inherit}.po-line-total{padding:10px 8px;border:1px solid #e2e7ef;border-radius:8px;background:#f8fafc;min-height:20px;font-weight:800;text-align:right}.po-total-row{display:flex;justify-content:flex-end;align-items:center;gap:18px;margin-top:16px;padding-top:14px;border-top:1px solid #e2e7ef;font-size:1.05rem}.po-total-row strong{font-size:1.45rem}.po-actions{display:flex;justify-content:space-between;gap:9px;flex-wrap:wrap;margin-top:16px}.po-actions>div{display:flex;gap:8px;flex-wrap:wrap}.po-list{display:grid;gap:10px}.po-list-card{border:1px solid #e2e7ef;border-radius:12px;padding:14px}.po-list-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}.po-list-head h3{margin:0 0 4px}.po-meta{color:#667085;font-size:.8rem}.po-order-total{font-size:1.15rem;font-weight:800}.po-line-readonly{display:grid;grid-template-columns:minmax(160px,1.4fr) minmax(100px,.7fr) 70px 105px 110px;gap:8px;padding:8px 0;border-top:1px solid #eef1f5;align-items:center}.po-line-readonly:first-child{margin-top:10px}.po-line-readonly span:last-child{text-align:right;font-weight:700}.po-empty{padding:22px;text-align:center;color:#667085;border:1px dashed #cfd6e1;border-radius:11px}.po-status{display:inline-flex;padding:4px 9px;border-radius:999px;background:#e8f1ff;color:#175cd3;font-size:.74rem;font-weight:800}.po-builder-ref{font-size:.8rem;color:#667085;margin-bottom:10px}.po-readonly-note{color:#667085;font-size:.8rem;margin:4px 0 0}.po-small-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.po-project-assignment{display:grid;grid-template-columns:minmax(190px,1fr) auto;gap:8px;align-items:end;margin-top:12px;padding-top:12px;border-top:1px solid #eef1f5}.po-project-assignment label{display:grid;gap:5px;font-size:.8rem;font-weight:700}.po-project-assignment select{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cfd6e1;border-radius:8px;background:#fff;font:inherit}.po-project-assignment small{grid-column:1/-1;color:#667085}.po-search-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 16px}.po-search-row input{flex:1 1 280px;min-width:0;padding:11px 12px;border:1px solid #cfd6e1;border-radius:9px;font:inherit}.po-search-count{font-size:.82rem;color:#667085;white-space:nowrap}.po-requisition-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,190px));justify-content:start;gap:8px;margin-bottom:14px}.po-requisition-grid label,.po-notes{display:grid;gap:4px;font-size:.78rem;font-weight:700}.po-requisition-grid label{grid-template-rows:18px 38px;align-content:start}.po-field-title{height:18px;display:flex;align-items:baseline;gap:3px;white-space:nowrap}.po-requisition-grid input,.po-requisition-grid select,.po-notes textarea{width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cfd6e1;border-radius:8px;background:#fff;font:inherit}.po-requisition-grid input,.po-requisition-grid select{height:38px;min-height:38px}.po-requisition-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0;padding:10px;background:#f8fafc;border:1px solid #eef1f5;border-radius:10px}.po-requisition-meta div{min-width:0}.po-requisition-meta small{display:block;color:#667085}.po-requisition-meta strong{overflow-wrap:anywhere}.po-notes{margin:12px 0}.po-required{color:#b42318}
  @media(max-width:900px){.po-requisition-meta{grid-template-columns:repeat(2,minmax(0,1fr))}.po-line{grid-template-columns:1fr 1fr 90px 1fr}.po-line .po-total-cell{grid-column:1/3}.po-line .po-remove-cell{grid-column:3/5}.po-line .po-remove-cell button{width:100%}.po-line-readonly{grid-template-columns:1fr 1fr 70px 100px}.po-line-readonly span:last-child{grid-column:1/-1;text-align:left}}
  @media(max-width:560px){.po-project-assignment{grid-template-columns:1fr}.po-project-assignment button{width:100%}.po-requisition-grid{grid-template-columns:1fr}.po-requisition-meta{grid-template-columns:1fr}.po-card{padding:14px}.po-supplier-row{grid-template-columns:1fr}.po-line{grid-template-columns:1fr 1fr}.po-line .po-name-cell,.po-line .po-code-cell{grid-column:1/-1}.po-line .po-total-cell,.po-line .po-remove-cell{grid-column:auto}.po-line-readonly{grid-template-columns:1fr 1fr}.po-actions{display:grid}.po-actions>div{display:grid}.po-actions button{width:100%}}
  `;document.head.appendChild(style);
  const nav=document.getElementById("mainNav");if(nav){const partsBtn=nav.querySelector('[data-view="parts"]');const ref=partsBtn?.nextSibling||nav.querySelector('[data-view="data"]')||null;const open=document.createElement("button");open.type="button";open.className="nav-item";open.dataset.view="openOrders";open.innerHTML=`<span>🧾</span><span>Open Orders</span>`;const ordered=document.createElement("button");ordered.type="button";ordered.className="nav-item";ordered.dataset.view="ordered";ordered.innerHTML=`<span>📦</span><span>Ordered</span>`;nav.insertBefore(open,ref);nav.insertBefore(ordered,ref);}
  const reference=document.getElementById("dataView")||document.getElementById("reportsView");const parent=reference?.parentElement||document.querySelector("main")||document.body;
  const openView=document.createElement("section");openView.id="openOrdersView";openView.className="view";openView.innerHTML=`<div class="po-head"><div><h1>Open Orders</h1><p>Create a supplier order with as many parts as you need, then place it when ready.</p></div><button type="button" class="btn primary" id="poNewBtn">+ New order</button></div><div class="po-card"><div class="po-builder-ref" id="poBuilderRef">New open order</div><div class="po-requisition-grid"><label><span class="po-field-title">GL Code <span class="po-required">*</span></span><input id="poGlCode" maxlength="80" placeholder="Required"></label><label><span class="po-field-title">Div <span class="po-required">*</span></span><input id="poDiv" maxlength="80" placeholder="Required"></label><label><span class="po-field-title">Dept <span class="po-required">*</span></span><input id="poDept" maxlength="80" placeholder="Required"></label><label><span class="po-field-title">New Account</span><select id="poAccount"><option value="">—</option><option value="No">No</option><option value="Yes">Yes</option></select></label><label><span class="po-field-title">Department <span class="po-required">*</span></span><input id="poDepartment" maxlength="120" value="Maintenance"></label><label><span class="po-field-title">IPP</span><input id="poEpp" maxlength="120"></label><label><span class="po-field-title">Job Number</span><select id="poJobNumber"><option value="">No job</option></select></label><label><span class="po-field-title">Project</span><select id="poProjectSelect"></select></label><label><span class="po-field-title">Currency</span><select id="poCurrency"><option value="GBP">GBP</option><option value="EUR">EUR</option><option value="USD">USD</option><option value="CAD">CAD</option><option value="AUD">AUD</option></select></label><label><span class="po-field-title">Requisition raised by <span class="po-required">*</span></span><input id="poRequestedBy" maxlength="180" readonly></label><label><span class="po-field-title">Date quote needed <span class="po-required">*</span></span><input id="poDateQuoteNeeded" type="date"></label></div><div class="po-supplier-row"><label>Nominated supplier<select id="poSupplierSelect"><option value="">Select supplier…</option></select></label><button type="button" class="btn secondary" id="poAddSupplierBtn">+ Add supplier</button></div><datalist id="poPartNames"></datalist><div id="poLines" class="po-lines"></div><div style="margin-top:10px"><button type="button" class="btn secondary compact" id="poAddLineBtn">+ Add part</button></div><label class="po-notes">Notes<textarea id="poNotes" rows="3" maxlength="2000" placeholder="Optional requisition notes"></textarea></label><div class="po-total-row"><span>Order total</span><strong id="poGrandTotal">${money(0)}</strong></div><div class="po-actions"><div><button type="button" class="btn secondary" id="poClearBtn">Clear</button></div><div><button type="button" class="btn secondary" id="poSaveOpenBtn">Save Open Order</button><button type="button" class="btn primary" id="poPlaceBtn">Place Order</button></div></div></div><div class="po-card"><div class="po-head"><div><h2 style="margin:0">Saved open orders</h2><p>Draft orders can still be edited before they are placed.</p></div></div><div id="poOpenList" class="po-list"></div></div>`;
  const orderedView=document.createElement("section");orderedView.id="orderedView";orderedView.className="view";orderedView.innerHTML=`<div class="po-head"><div><h1>Ordered</h1><p>Placed orders are locked and read-only. Delete remains available for testing for now.</p></div></div><div class="po-search-row"><input id="poOrderedSearch" type="search" placeholder="Search PO, supplier, part or part code…" autocomplete="off"><span class="po-search-count" id="poOrderedSearchCount"></span></div><div id="poOrderedList" class="po-list"></div>`;
  if(reference){parent.insertBefore(openView,reference);parent.insertBefore(orderedView,reference);}else{parent.appendChild(openView);parent.appendChild(orderedView);}
  $("#poNewBtn")?.addEventListener("click",()=>{editingPurchaseOrderId=null;renderPurchaseOrderBuilder();});
  $("#poAddSupplierBtn")?.addEventListener("click",addPurchaseOrderSupplier);
  $("#poAddLineBtn")?.addEventListener("click",()=>addPurchaseOrderLine());
  $("#poClearBtn")?.addEventListener("click",()=>{editingPurchaseOrderId=null;renderPurchaseOrderBuilder();});
  $("#poSaveOpenBtn")?.addEventListener("click",()=>submitPurchaseOrder("save"));
  $("#poPlaceBtn")?.addEventListener("click",()=>submitPurchaseOrder("place"));
  $("#openOrdersView")?.addEventListener("input",updatePurchaseOrderPlaceState);
  $("#openOrdersView")?.addEventListener("change",updatePurchaseOrderPlaceState);
  $("#poLines")?.addEventListener("input",updatePurchaseOrderTotals);
  $("#poLines")?.addEventListener("change",e=>{const name=e.target.closest('.po-part-name');if(name){const part=activeParts().find(p=>String(p.name).toLowerCase()===String(name.value).trim().toLowerCase());const row=name.closest('.po-line');const code=row?.querySelector('.po-part-code');if(part&&code&&!code.value)code.value=part.partNo||"";autofillPurchaseOrderPrice(row,part);}updatePurchaseOrderTotals();});
  $("#poLines")?.addEventListener("click",e=>{const btn=e.target.closest('[data-po-remove-line]');if(!btn)return;btn.closest('.po-line')?.remove();if(!$("#poLines")?.children.length)addPurchaseOrderLine();updatePurchaseOrderTotals();});
  $("#poOpenList")?.addEventListener("click",handleOpenPurchaseOrderClick);
  $("#poOrderedList")?.addEventListener("click",handleOrderedPurchaseOrderClick);
  $("#poOrderedSearch")?.addEventListener("input",e=>{orderedPurchaseSearchQuery=String(e.target.value||"");renderPurchaseOrders();});
  renderPurchaseOrderBuilder();
}
function purchaseOrderDate(value){if(!value)return "—";const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";}
function purchaseOrderTotal(order){return (order?.lines||[]).reduce((sum,row)=>sum+(Math.max(1,Number(row.qty)||1)*Math.max(0,Number(row.unitPrice)||0)),0);}
function purchaseOrderSupplierOptions(selected=""){const values=activeSuppliers().slice().sort((a,b)=>a.localeCompare(b));return `<option value="">Select supplier…</option>${values.map(name=>`<option value="${esc(name)}" ${name===selected?"selected":""}>${esc(name)}</option>`).join("")}`;}
function lastPurchasePrice(partName,partCode,supplier=""){
  const name=String(partName||"").trim().toLowerCase(),code=String(partCode||"").trim().toLowerCase(),wantedSupplier=String(supplier||"").trim().toLowerCase();
  if(!name&&!code)return null;
  const ordered=[...purchaseOrders].filter(order=>order.status==="Ordered").sort((a,b)=>String(b.orderedAt||b.updatedAt||b.createdAt||"").localeCompare(String(a.orderedAt||a.updatedAt||a.createdAt||"")));
  const matches=[];
  for(const order of ordered){
    for(const line of order.lines||[]){
      const lineName=String(line.partName||"").trim().toLowerCase(),lineCode=String(line.partCode||"").trim().toLowerCase();
      const same=(code&&lineCode===code)||(!code&&name&&lineName===name)||(code&&name&&lineName===name);
      if(!same)continue;
      const price=Number(line.unitPrice);
      if(!Number.isFinite(price)||price<0)continue;
      matches.push({price,supplier:String(order.supplier||"").trim().toLowerCase(),date:order.orderedAt||order.updatedAt||order.createdAt||""});
    }
  }
  if(!matches.length)return null;
  return (wantedSupplier&&matches.find(row=>row.supplier===wantedSupplier))||matches[0];
}
function autofillPurchaseOrderPrice(row,part){
  if(!row)return;
  const priceInput=row.querySelector('.po-unit-price');
  if(!priceInput||String(priceInput.value||"").trim()!=="")return;
  const partName=part?.name||row.querySelector('.po-part-name')?.value||"",partCode=part?.partNo||row.querySelector('.po-part-code')?.value||"";
  const remembered=lastPurchasePrice(partName,partCode,$("#poSupplierSelect")?.value||"");
  if(!remembered)return;
  priceInput.value=Number(remembered.price).toFixed(2);
  priceInput.title=`Last ordered price: ${money(remembered.price)}`;
}
function addPurchaseOrderLine(data={}){const lines=$("#poLines");if(!lines)return;const row=document.createElement("div");row.className="po-line";row.innerHTML=`<label class="po-name-cell">Part name<input class="po-part-name" list="poPartNames" maxlength="180" value="${esc(data.partName||"")}" placeholder="Bearing 6204" required></label><label class="po-code-cell">Part code<input class="po-part-code" maxlength="120" value="${esc(data.partCode||"")}" placeholder="6204-2RS"></label><label>Qty<input class="po-qty" type="number" min="1" step="1" value="${Math.max(1,Number(data.qty)||1)}"></label><label>Unit price (${currencySymbol()})<input class="po-unit-price" type="number" min="0" step="0.01" value="${data.unitPrice!==undefined?esc(Number(data.unitPrice)||0):""}" placeholder="0.00"></label><label class="po-total-cell">Line total<span class="po-line-total">${money((Number(data.qty)||1)*(Number(data.unitPrice)||0))}</span></label><div class="po-remove-cell"><button type="button" class="btn danger compact" data-po-remove-line>Remove</button></div>`;lines.appendChild(row);updatePurchaseOrderTotals();}
function collectPurchaseOrderLines(){return $$("#poLines .po-line").map(row=>({partName:String(row.querySelector('.po-part-name')?.value||"").trim(),partCode:String(row.querySelector('.po-part-code')?.value||"").trim(),qty:Math.max(1,Number(row.querySelector('.po-qty')?.value)||1),unitPrice:Math.max(0,Number(row.querySelector('.po-unit-price')?.value)||0)})).filter(row=>row.partName);}
function updatePurchaseOrderTotals(){let grand=0;$$("#poLines .po-line").forEach(row=>{const qty=Math.max(1,Number(row.querySelector('.po-qty')?.value)||1),price=Math.max(0,Number(row.querySelector('.po-unit-price')?.value)||0),total=qty*price;grand+=total;const cell=row.querySelector('.po-line-total');if(cell)cell.textContent=money(total);});if($("#poGrandTotal"))$("#poGrandTotal").textContent=money(grand);updatePurchaseOrderPlaceState();}
function purchaseOrderRequesterName(){
  const email=String(signedInIdentity?.email||"").trim().toLowerCase();
  const own=profiles.find(profile=>String(profile.email||"").trim().toLowerCase()===email && profile.active!==false);
  if(own?.name)return String(own.name).trim();
  const selected=selectedProfileName();
  if(selected)return String(selected).trim();
  const local=String(signedInIdentity?.email||"").split("@")[0].replace(/[._-]+/g," ").trim();
  return local?local.replace(/\b\w/g,ch=>ch.toUpperCase()):"";
}
function latestPurchaseOrderDefaults(){
  const sorted=[...purchaseOrders].sort((a,b)=>String(b.updatedAt||b.orderedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.orderedAt||a.createdAt||"")));
  const lastValue=(field,fallback="")=>{
    const row=sorted.find(order=>String(order?.[field]??"").trim());
    return row?String(row[field]):fallback;
  };
  return {
    glCode:lastValue("glCode"),
    div:lastValue("div"),
    dept:lastValue("dept"),
    department:lastValue("department","Maintenance")||"Maintenance",
    epp:lastValue("epp"),
    currency:lastValue("currency",appSettings.currency||"GBP")
  };
}
function purchaseOrderPlaceMissing(meta=purchaseOrderMeta(),lines=collectPurchaseOrderLines(),supplier=String($("#poSupplierSelect")?.value||"").trim()){
  const missing=[];
  if(!meta.glCode)missing.push("GL Code");
  if(!meta.div)missing.push("Div");
  if(!meta.dept)missing.push("Dept");
  if(!meta.dateQuoteNeeded)missing.push("Date quote needed");
  if(!supplier)missing.push("Supplier");
  if(!meta.requestedBy)missing.push("Raised by");
  if(!lines.length)missing.push("Part");
  return missing;
}
function purchaseOrderObjectPlaceMissing(order){
  const lines=(order?.lines||[]).filter(line=>String(line.partName||"").trim());
  const missing=[];
  if(!String(order?.glCode||"").trim())missing.push("GL Code");
  if(!String(order?.div||"").trim())missing.push("Div");
  if(!String(order?.dept||"").trim())missing.push("Dept");
  if(!String(order?.dateQuoteNeeded||"").trim())missing.push("Date quote needed");
  if(!String(order?.supplier||"").trim())missing.push("Supplier");
  if(!String(order?.requestedBy||"").trim())missing.push("Raised by");
  if(!lines.length)missing.push("Part");
  return missing;
}
function updatePurchaseOrderPlaceState(){
  const button=$("#poPlaceBtn");if(!button)return;
  const missing=purchaseOrderPlaceMissing();
  button.disabled=missing.length>0;
  button.title=missing.length?`Complete before placing: ${missing.join(", ")}`:"Ready to place order";
}
function purchaseOrderJobOptions(selected=""){
  const wanted=String(selected||"").trim();
  const sorted=jobs.slice().sort((a,b)=>{
    const dateCompare=String(b.raised||b.createdAt||"").localeCompare(String(a.raised||a.createdAt||""));
    if(dateCompare)return dateCompare;
    return String(b.jobNo||"").localeCompare(String(a.jobNo||""),undefined,{numeric:true,sensitivity:"base"});
  });
  let html='<option value="">No job</option>';
  if(wanted&&!sorted.some(job=>String(job.jobNo)===wanted)) html+=`<option value="${esc(wanted)}" selected>${esc(wanted)}</option>`;
  html+=sorted.map(job=>`<option value="${esc(job.jobNo||"")}"${String(job.jobNo||"")===wanted?' selected':''}>${esc(job.jobNo||"Job")}</option>`).join("");
  return html;
}
function purchaseOrderMeta(){
  return {
    glCode:String($("#poGlCode")?.value||"").trim(),
    div:String($("#poDiv")?.value||"").trim(),
    dept:String($("#poDept")?.value||"").trim(),
    account:"",
    department:String($("#poDepartment")?.value||"Maintenance").trim()||"Maintenance",
    epp:String($("#poEpp")?.value||"").trim(),
    jobNumber:String($("#poJobNumber")?.value||"").trim(),
    projectId:String($("#poProjectSelect")?.value||"").trim(),
    newAccount:String($("#poAccount")?.value||"").trim(),
    currency:String($("#poCurrency")?.value||appSettings.currency||"GBP"),
    requestedBy:String($("#poRequestedBy")?.value||"").trim(),
    dateQuoteNeeded:String($("#poDateQuoteNeeded")?.value||""),
    notes:String($("#poNotes")?.value||"").trim()
  };
}
function setPurchaseOrderMeta(order){
  const defaults=latestPurchaseOrderDefaults();
  const selectedNewAccount=order?.newAccount||(["Yes","No"].includes(String(order?.account||""))?String(order.account):"");
  const values={
    poGlCode:order?.glCode??defaults.glCode,poDiv:order?.div??defaults.div,poDept:order?.dept??defaults.dept,poAccount:selectedNewAccount,
    poDepartment:order?.department??defaults.department,poEpp:order?.epp??defaults.epp,
    poCurrency:order?.currency??defaults.currency,
    poRequestedBy:(String(order?.requestedBy||"").includes("@")?purchaseOrderRequesterName():String(order?.requestedBy||"").trim())||purchaseOrderRequesterName(),
    poDateQuoteNeeded:order?.dateQuoteNeeded||"",poNotes:order?.notes||""
  };
  Object.entries(values).forEach(([id,value])=>{const el=$("#"+id);if(el)el.value=value;});
  const jobSelect=$("#poJobNumber");if(jobSelect){jobSelect.innerHTML=purchaseOrderJobOptions(order?.jobNumber||"");jobSelect.value=String(order?.jobNumber||"");}
  const project=$("#poProjectSelect");if(project){project.innerHTML=projectOptions(order?.projectId||"",{includeArchived:true});project.value=String(order?.projectId||"");}
}
function purchaseOrderMetaReadOnly(order){
  const rows=[
    ["GL Code",order.glCode],["Div",order.div],["Dept",order.dept],["New Account",order.newAccount||(["Yes","No"].includes(String(order.account||""))?order.account:"")],
    ["Department",order.department||"Maintenance"],["IPP",order.epp],["Job Number",order.jobNumber],
    ["Project",projectLabel(order.projectId)],["Currency",order.currency||appSettings.currency],
    ["Raised by",order.requestedBy],["Quote needed",order.dateQuoteNeeded?fmtDate(order.dateQuoteNeeded):""]
  ].filter(([,value])=>String(value||"").trim());
  return `<div class="po-requisition-meta">${rows.map(([label,value])=>`<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join("")}</div>${order.notes?`<div class="po-readonly-note"><strong>Notes:</strong> ${esc(order.notes)}</div>`:""}`;
}
function renderPurchaseOrderBuilder(){
  if(!$("#poSupplierSelect"))return;
  const order=editingPurchaseOrderId?purchaseOrders.find(row=>String(row.id)===String(editingPurchaseOrderId)&&row.status!=="Ordered"):null;
  if(editingPurchaseOrderId&&!order)editingPurchaseOrderId=null;
  $("#poSupplierSelect").innerHTML=purchaseOrderSupplierOptions(order?.supplier||"");
  $("#poSupplierSelect").value=order?.supplier||"";
  setPurchaseOrderMeta(order);
  $("#poPartNames").innerHTML=activeParts().slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${esc(p.name)}">${esc(p.partNo||"")}</option>`).join("");
  $("#poLines").innerHTML="";
  (order?.lines?.length?order.lines:[{}]).forEach(addPurchaseOrderLine);
  $("#poBuilderRef").textContent=order?`Editing ${order.orderNo||"open order"}`:"New open order";
  updatePurchaseOrderTotals();
}
async function addPurchaseOrderSupplier(){const name=prompt("Supplier name:");if(!name?.trim())return;try{const payload=await api("/api/catalog",{method:"POST",body:JSON.stringify({type:"supplier",value:name.trim()})});if(payload.state)applySharedState(payload);$("#poSupplierSelect").innerHTML=purchaseOrderSupplierOptions(name.trim());$("#poSupplierSelect").value=name.trim();}catch(error){showSaveError(error);}}
async function submitPurchaseOrder(action){
  const supplier=String($("#poSupplierSelect")?.value||"").trim(),lines=collectPurchaseOrderLines(),meta=purchaseOrderMeta();
  if(!supplier){alert("Choose or add a supplier first.");return;}
  if(!lines.length){alert("Add at least one part to the order.");return;}
  if(action==="place"){
    const missing=purchaseOrderPlaceMissing(meta,lines,supplier);
    if(missing.length){
      alert(`Complete the required order information before placing: ${missing.join(", ")}.`);
      const focusMap={"GL Code":"#poGlCode","Div":"#poDiv","Dept":"#poDept","Date quote needed":"#poDateQuoteNeeded","Supplier":"#poSupplierSelect","Raised by":"#poRequestedBy","Part":"#poLines .po-part-name"};
      document.querySelector(focusMap[missing[0]]||"")?.focus();
      updatePurchaseOrderPlaceState();
      return;
    }
  }
  const button=action==="place"?$("#poPlaceBtn"):$("#poSaveOpenBtn"),old=button?.textContent;
  if(button){button.disabled=true;button.textContent=action==="place"?"Placing…":"Saving…";}
  try{
    const payload=await saveMutation("/api/purchase-orders",{action,orderId:editingPurchaseOrderId||"",supplier,lines,...meta});
    if(action==="place"){editingPurchaseOrderId=null;renderPurchaseOrderBuilder();switchView("ordered");}
    else{editingPurchaseOrderId=payload.order?.id||editingPurchaseOrderId;switchView("openOrders");renderPurchaseOrderBuilder();}
  }catch(error){showSaveError(error);}finally{if(button){button.disabled=false;button.textContent=old;}}
}
async function deletePurchaseOrder(orderId){if(!confirm("Delete this order? This is enabled for testing at the moment."))return;try{const wasEditing=String(editingPurchaseOrderId)===String(orderId);if(wasEditing)editingPurchaseOrderId=null;await saveMutation("/api/purchase-orders",{action:"delete",orderId});if(wasEditing)renderPurchaseOrderBuilder();}catch(error){showSaveError(error);}}
function handleOpenPurchaseOrderClick(e){const edit=e.target.closest('[data-po-edit]');if(edit){editingPurchaseOrderId=edit.dataset.poEdit;renderPurchaseOrderBuilder();switchView("openOrders");window.scrollTo?.({top:0,behavior:"smooth"});return;}const place=e.target.closest('[data-po-place]');if(place){const order=purchaseOrders.find(row=>String(row.id)===String(place.dataset.poPlace));if(!order)return;editingPurchaseOrderId=order.id;renderPurchaseOrderBuilder();submitPurchaseOrder("place");return;}const del=e.target.closest('[data-po-delete]');if(del)deletePurchaseOrder(del.dataset.poDelete);}
async function assignPurchaseOrderProject(orderId){
  const order=purchaseOrders.find(row=>String(row.id)===String(orderId));if(!order)return;
  const select=[...document.querySelectorAll("[data-po-project-select]")].find(el=>String(el.dataset.poProjectSelect)===String(orderId));
  const projectId=String(select?.value||"").trim();
  try{await saveMutation("/api/purchase-orders",{action:"setProject",orderId,projectId});renderPurchaseOrders();renderProjects();}
  catch(error){showSaveError(error);}
}
function handleOrderedPurchaseOrderClick(e){const assign=e.target.closest('[data-po-project-save]');if(assign){assignPurchaseOrderProject(assign.dataset.poProjectSave);return;}const del=e.target.closest('[data-po-delete]');if(del)deletePurchaseOrder(del.dataset.poDelete);}
function purchaseOrderLinesReadOnly(order){return (order.lines||[]).map(row=>`<div class="po-line-readonly"><span><strong>${esc(row.partName)}</strong></span><span>${esc(row.partCode||"No code")}</span><span>× ${esc(row.qty)}</span><span>${money(row.unitPrice)}</span><span>${money((Number(row.qty)||0)*(Number(row.unitPrice)||0))}</span></div>`).join("");}
function renderPurchaseOrders(){
  ensurePurchaseOrderUi();
  const open=purchaseOrders.filter(row=>row.status!=="Ordered").sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
  const allOrdered=purchaseOrders.filter(row=>row.status==="Ordered").sort((a,b)=>String(b.orderedAt||"").localeCompare(String(a.orderedAt||"")));
  const query=String(orderedPurchaseSearchQuery||"").trim().toLowerCase();
  const ordered=query ? allOrdered.filter(order=>{
    const searchable=[order.orderNo,order.supplier,order.glCode,order.department,order.jobNumber,order.requestedBy,projectLabel(order.projectId),...(order.lines||[]).flatMap(line=>[line.partName,line.partCode])].join(" ").toLowerCase();
    return searchable.includes(query);
  }) : allOrdered;

  if($("#poOpenList")) $("#poOpenList").innerHTML=open.length?open.map(order=>`<article class="po-list-card"><div class="po-list-head"><div><h3>${esc(order.orderNo||"Open order")}</h3><div class="po-meta">${esc(order.supplier||"No supplier")} · Updated ${esc(purchaseOrderDate(order.updatedAt||order.createdAt))}</div></div><div class="po-order-total">${money(purchaseOrderTotal(order))}</div></div>${purchaseOrderMetaReadOnly(order)}${purchaseOrderLinesReadOnly(order)}<div class="po-small-actions"><button type="button" class="btn secondary compact" data-po-edit="${esc(order.id)}">Edit</button><button type="button" class="btn primary compact" data-po-place="${esc(order.id)}" ${purchaseOrderObjectPlaceMissing(order).length?'disabled title="Complete GL Code, Div, Dept, date, supplier and parts before placing"':''}>Place Order</button><button type="button" class="btn danger compact" data-po-delete="${esc(order.id)}">Delete</button></div></article>`).join(""):`<div class="po-empty">No saved open orders.</div>`;

  if($("#poOrderedSearch") && $("#poOrderedSearch").value!==orderedPurchaseSearchQuery) $("#poOrderedSearch").value=orderedPurchaseSearchQuery;
  if($("#poOrderedSearchCount")) $("#poOrderedSearchCount").textContent=query?`Showing ${ordered.length} of ${allOrdered.length}`:`${allOrdered.length} order${allOrdered.length===1?"":"s"}`;
  if($("#poOrderedList")) $("#poOrderedList").innerHTML=ordered.length?ordered.map(order=>`<article class="po-list-card"><div class="po-list-head"><div><h3>${esc(order.orderNo||"Purchase order")} <span class="po-status">Ordered</span></h3><div class="po-meta">${esc(order.supplier||"No supplier")} · Placed ${esc(purchaseOrderDate(order.orderedAt))}</div><p class="po-readonly-note">This order is locked. Its project assignment can still be changed.</p></div><div class="po-order-total">${money(purchaseOrderTotal(order))}</div></div>${purchaseOrderMetaReadOnly(order)}${purchaseOrderLinesReadOnly(order)}<div class="po-project-assignment"><label>Add ordered parts to project<select data-po-project-select="${esc(order.id)}">${projectOptions(order.projectId||"",{includeArchived:false})}</select></label><button type="button" class="btn secondary compact" data-po-project-save="${esc(order.id)}">Save project</button><small>All parts and costs on this purchase order will count against the selected project.</small></div><div class="po-small-actions"><button type="button" class="btn danger compact" data-po-delete="${esc(order.id)}">Delete</button></div></article>`).join(""):`<div class="po-empty">${query?"No ordered purchases match your search.":"No placed orders yet."}</div>`;

  const supplier=$("#poSupplierSelect");
  if(supplier){const current=supplier.value;supplier.innerHTML=purchaseOrderSupplierOptions(current);supplier.value=current;}
  const project=$("#poProjectSelect");if(project){const current=project.value;project.innerHTML=projectOptions(current,{includeArchived:true});project.value=current;}
  if($("#poPartNames")) $("#poPartNames").innerHTML=activeParts().slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${esc(p.name)}">${esc(p.partNo||"")}</option>`).join("");
}

function renderAll() {
  ensureV58Ui();
  ensurePreventiveUi();
  ensurePurchaseOrderUi();
  ensureProjectsUi();
  ensureMachineIdentityFields();
  applyUiSettings();
  buildTabs();
  renderProfileSelector();
  renderDashboard();
  renderOpen();
  renderAllJobs();
  renderRequests();
  renderMachines();
  renderParts();
  renderManageData();
  renderReports();
  renderTeam();
  renderDowntime();
  renderPreventive();
  renderCurrentDownDashboard();
  renderPurchaseOrders();
  renderProjects();
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
  if (name==='downtime') renderDowntime();
  if (name==='preventive') renderPreventive();
  if (name==='openOrders' || name==='ordered') renderPurchaseOrders();
  if (name==='projects') renderProjects();
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
    excelRow(["Hours this month",{value:r.hours,type:"Number"}]), excelRow([`Parts used ${appSettings.currency}`,{value:r.usedSpend.toFixed(2),type:"Number"}]), excelRow([`Parts ordered ${appSettings.currency}`,{value:r.orderedSpend.toFixed(2),type:"Number"}])
  ];
  const jobsRows=[excelRow(["Job No","Title","Description","Section","Asset ID","Machine","Priority","Status","Date Raised","Target Date","Completion Date","Hours This Month","Lifetime Hours","Assigned To","Pinned",`Parts This Month ${appSettings.currency}`,`Lifetime Parts ${appSettings.currency}`])];
  r.monthJobs.forEach(j=>{const m=machineForJob(j);jobsRows.push(excelRow([j.jobNo,j.title,j.description||"",j.section||inferSection(j.machine),m?.assetId||"",j.machine,j.priority,j.status,j.raised||"",j.target||"",j.completed||"",{value:workHoursThisMonth(j),type:"Number"},{value:jobHours(j),type:"Number"},j.assigned||"",j.pinned?"Yes":"No",{value:spendThisMonth(j).toFixed(2),type:"Number"},{value:jobPartsCost(j).toFixed(2),type:"Number"}]))});
  const timeRows=[excelRow(["Date","Job No","Engineer","Asset ID","Machine","Hours"])];
  r.time.forEach(x=>{const m=machineForJob(x.job);timeRows.push(excelRow([x.date,x.job.jobNo,x.job.assigned||"",m?.assetId||"",x.job.machine,{value:Number(x.hours)||0,type:"Number"}]))});
  const partRows=[excelRow(["Date","Job No","Section","Asset ID","Machine","Part Name","Part No","Qty Ordered","Qty Used",`Unit Price ${appSettings.currency}`,`Used Value ${appSettings.currency}`,`Ordered Value ${appSettings.currency}`,"Supplier"])];
  r.parts.forEach(x=>{const m=machineForJob(x.job);partRows.push(excelRow([x.date,x.job.jobNo,x.job.section||inferSection(x.job.machine),m?.assetId||"",x.job.machine,x.name,x.partNo||"",{value:partOrderedQty(x),type:"Number"},{value:Number(x.qty)||0,type:"Number"},{value:Number(x.unitPrice)||0,type:"Number"},{value:partTotal(x),type:"Number"},{value:partOrderedTotal(x),type:"Number"},x.supplier||""]))});
  const xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${excelSheet("Summary",summary)}${excelSheet("Jobs",jobsRows)}${excelSheet("Time Entries",timeRows)}${excelSheet("Parts",partRows)}</Workbook>`;
  const blob=new Blob([xml],{type:"application/vnd.ms-excel;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  const profileSlug=selectedProfileId==="all"?"all-jobs":profileContext().toLowerCase().replace(/[^a-z0-9]+/g,"-");
  a.download=`maintenance-report-${profileSlug}-${selectedYear}-${String(selectedMonth+1).padStart(2,"0")}.xls`; a.click(); URL.revokeObjectURL(a.href);
}

// Global search across jobs, machines, saved parts, engineers and attachment names.
let globalSearchTimer=null;
let globalSearchSeq=0;
function localSearchResults(query) {
  const q=String(query||"").trim().toLowerCase();
  if(q.length<2)return [];
  const includes=(...values)=>values.some(v=>String(v??"").toLowerCase().includes(q));
  const results=[];
  for(const j of jobs){
    if(includes(j.jobNo,j.title,j.description,j.machine,j.section,j.assigned,j.notes,j.status,j.priority,...(j.parts||[]).flatMap(p=>[p.name,p.partNo,p.supplier]))){
      results.push({kind:"job",id:j.jobNo,icon:"🧰",title:`${j.jobNo} · ${j.title}`,meta:`${j.machine} · ${j.status} · ${j.assigned||"Unassigned"}`});
      if(results.filter(x=>x.kind==="job").length>=6)break;
    }
  }
  for(const m of machines){
    if(includes(m.assetId,m.assetNumber,m.name,m.section,m.category,m.location,m.manufacturer,m.make,m.model,m.serialNumber,m.notes,...(Array.isArray(m.tooling)?m.tooling.flatMap(t=>[t?.name,t?.description]):[]))){
      results.push({kind:"machine",id:m.id,icon:"▣",title:`${m.assetId} · ${m.name}`,meta:`${m.section}${m.location?` · ${m.location}`:""}`});
      if(results.filter(x=>x.kind==="machine").length>=5)break;
    }
  }
  for(const part of partCatalog){
    if(includes(part.name,part.partNo)){
      const stock=part.stockTracked===true?`Stock ${stockNumber(part.currentStock)} · min ${stockNumber(part.minStock)} · ${stockStatus(part).label}`:"Stock not tracked";
      results.push({kind:"part",id:part.id,icon:"◇",title:part.name,meta:`Part ${part.partNo||"number not set"} · ${stock}`});
      if(results.filter(x=>x.kind==="part").length>=4)break;
    }
  }
  for(const profile of profiles){
    if(includes(profile.name)){
      results.push({kind:"profile",id:profile.id,icon:"♟",title:profile.name,meta:"Engineer profile"});
      if(results.filter(x=>x.kind==="profile").length>=3)break;
    }
  }
  for(const request of operatorRequests){
    if(includes(request.requestNo,request.operatorName,request.issue,request.machine?.assetId,request.machine?.name)){
      results.push({kind:"request",id:String(request.id),icon:"⚠",title:`${request.requestNo} · ${request.machine?.assetId||"Machine"}`,meta:`${request.operatorName} · ${request.status==="accepted"?"Accepted":"Waiting"}`});
      if(results.filter(x=>x.kind==="request").length>=4)break;
    }
  }
  for(const schedule of preventiveSchedules){
    if(includes(schedule.title,schedule.description,schedule.section,schedule.location,schedule.machineName,schedule.machineAssetId,pmAssignedNames(schedule))){
      results.push({kind:"preventive",id:schedule.id,icon:"✓",title:schedule.title,meta:`${pmLocationLabel(schedule)} · due ${fmtDate(schedule.nextDueDate)}`});
      if(results.filter(x=>x.kind==="preventive").length>=4)break;
    }
  }
  return results;
}

function renderGlobalSearchResults(query, local, attachments=[]) {
  const box=$("#globalSearchResults");
  if(!box)return;
  const fileResults=(attachments||[]).map(a=>({kind:"file",id:a.id,entityType:a.entityType,entityId:a.entityId,icon:attachmentIcon(a.contentType,a.fileName),title:a.label||a.fileName,meta:`${a.fileName}${a.entityType?` · ${a.entityType==="job"?"Job":"Machine"} attachment`:""}`}));
  const all=[...local,...fileResults].slice(0,16);
  if(String(query||"").trim().length<2){box.hidden=true;box.innerHTML="";return;}
  box.innerHTML=all.length?all.map(r=>`<button type="button" class="global-search-result" data-search-kind="${esc(r.kind)}" data-search-id="${esc(r.id)}" ${r.entityType?`data-entity-type="${esc(r.entityType)}" data-entity-id="${esc(r.entityId)}"`:""}><span class="search-result-icon">${r.icon}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.meta||"")}</small></span></button>`).join(""):`<div class="global-search-empty">No matching jobs, requests, machines, parts or files.</div>`;
  box.hidden=false;
}

async function updateGlobalSearch() {
  const input=$("#globalSearch");
  if(!input)return;
  const query=input.value.trim();
  const seq=++globalSearchSeq;
  const local=localSearchResults(query);
  renderGlobalSearchResults(query,local,[]);
  if(query.length<2)return;
  try{
    const data=await api(`/api/search?q=${encodeURIComponent(query)}`,{method:"GET",headers:{accept:"application/json"}});
    if(seq!==globalSearchSeq)return;
    renderGlobalSearchResults(query,local,data.attachments||[]);
  }catch{}
}

$("#globalSearch")?.addEventListener("input",()=>{clearTimeout(globalSearchTimer);globalSearchTimer=setTimeout(updateGlobalSearch,180);});
$("#globalSearch")?.addEventListener("focus",()=>{if($("#globalSearch").value.trim().length>=2)updateGlobalSearch();});
$("#globalSearch")?.addEventListener("keydown",e=>{if(e.key==="Escape"){$("#globalSearchResults").hidden=true;e.currentTarget.blur();}});
$("#globalSearchResults")?.addEventListener("click",e=>{
  const hit=e.target.closest("[data-search-kind]");if(!hit)return;
  const kind=hit.dataset.searchKind,id=hit.dataset.searchId;
  $("#globalSearchResults").hidden=true;
  if(kind==="job"){openJob(id);return;}
  if(kind==="machine"){selectedMachineId=id;machineDetailTab="overview";switchView("machines");renderMachines();return;}
  if(kind==="part"){switchView("parts");openStockDialog(id);return;}
  if(kind==="profile"){selectedProfileId=id;renderAll();switchView("dashboard");return;}
  if(kind==="file"){window.open(attachmentFileUrl(id),"_blank","noopener");return;}
  if(kind==="request"){switchView("requests");return;}
  if(kind==="preventive"){switchView("preventive");openPreventiveDialog(id);return;}
});
document.addEventListener("click",e=>{if(!e.target.closest(".global-search-shell")&&$("#globalSearchResults"))$("#globalSearchResults").hidden=true;});

// Navigation and filters
$("#mainNav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)switchView(b.dataset.view);});
$("#refreshRequestsBtn")?.addEventListener("click",async e=>{
  const button=e.currentTarget;button.disabled=true;button.textContent="Refreshing…";
  try{await refreshOperatorRequests();}finally{button.disabled=false;button.textContent="↻ Refresh";}
});
$("#requestsView")?.addEventListener("click",async e=>{
  const deleteButton=e.target.closest("[data-delete-request]");
  if(deleteButton){
    const id=Number(deleteButton.dataset.deleteRequest);
    const requestNo=deleteButton.dataset.requestNo||`Request ${id}`;
    const linkedJob=deleteButton.dataset.linkedJob||"";
    const message=linkedJob
      ? `Delete ${requestNo}?\n\nThis removes the operator request only. Linked job ${linkedJob} will remain in the job history.`
      : `Delete ${requestNo}?\n\nThis cannot be undone.`;
    if(!confirm(message))return;
    const original=deleteButton.textContent;
    deleteButton.disabled=true;deleteButton.textContent="Deleting…";
    try{
      const payload=await api(`/api/requests?id=${encodeURIComponent(id)}`,{method:"DELETE"});
      operatorRequests=Array.isArray(payload.requests)?payload.requests:operatorRequests;
      renderRequests();
    }catch(error){showSaveError(error);deleteButton.disabled=false;deleteButton.textContent=original;}
    return;
  }
  const button=e.target.closest("[data-accept-request]");
  if(!button)return;
  const id=Number(button.dataset.acceptRequest);
  const select=$( `[data-request-assignee="${id}"]` );
  const assignedProfileId=select?.value||"";
  if(!assignedProfileId){alert("Choose an engineer to assign this request to.");return;}
  button.disabled=true;button.textContent="Accepting…";if(select)select.disabled=true;
  try{
    const payload=await api("/api/requests/accept",{method:"POST",body:JSON.stringify({id,assignedProfileId})});
    if(payload.state)applySharedState(payload);
    operatorRequests=Array.isArray(payload.requests)?payload.requests:operatorRequests;
    renderAll();
    switchView("requests");
  }catch(error){showSaveError(error);await refreshOperatorRequests().catch(()=>{});}
});
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
  if(part?.partId && partCatalog.some(p=>p.id===part.partId)) return part.partId;
  let found=partCatalog.find(p=>p.name.toLowerCase()===String(part.name||"").toLowerCase());
  if (!found && part.name) { found={id:`p${Date.now()}-${partCatalog.length}`,name:part.name,partNo:part.partNo||"",active:true,stockTracked:false,currentStock:0,minStock:0,binLocation:""}; partCatalog.push(found); }
  return found?.id || "";
}
async function openJob(jobNo=null) {
  const form=$("#jobForm");
  form.reset();
  pendingJobFiles=[];
  editingJobNo=jobNo;
  $("#jobAttachmentsList").innerHTML="";
  $("#jobAttachmentStatus").textContent="";
  renderPendingJobFiles();
  const job=jobNo?jobs.find(j=>j.jobNo===jobNo):null;
  renderSectionSelects();
  $("#partsEditor").innerHTML=""; partRowCounter=0;
  if($("#partsOrderedEditor")) $("#partsOrderedEditor").innerHTML=""; orderedPartRowCounter=0;
  $("#timeEditor").innerHTML=""; timeRowCounter=0;
  const deleteBtn=$("#deleteJobBtn");
  if (job) {
    $("#jobDialogTitle").textContent=`Edit ${job.jobNo}`;
    $("#jobDialogSubtitle").textContent="Any engineer can update this job, including completed jobs. Job number can also be changed.";
    $("#jobSubmitBtn").textContent="Save Changes";
    deleteBtn.hidden=false;
    deleteBtn.disabled=false;
    deleteBtn.textContent="Delete Job";
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
    if($("#jobDowntimeStopped")){ $("#jobDowntimeStopped").checked=job.downtimeStopped===true; $("#jobDowntimeStart").value=job.downtimeStart||""; $("#jobDowntimeEnd").value=job.downtimeEnd||""; setDowntimeFieldsEnabled(); }
    $("#jobSectionSelect").value=job.section||inferSection(job.machine);
    renderMachineSelect($("#jobSectionSelect").value,job.machineId||job.machine);
    renderAssignedSelect(job.assigned||"");
    renderJobProjectSelect(job.projectId||"");
    (job.timeEntries||[]).forEach(t=>addTimeRow(t));
    if (!(job.timeEntries||[]).length) addTimeRow({date:job.raised||defaultFormDate()});
    const orderedParts=(job.parts||[]).filter(p=>partOrderedQty(p)>0);
    const usedParts=(job.parts||[]).filter(p=>(Number(p.qty)||0)>0);
    orderedParts.forEach(p=>addOrderedPartRow({partId:catalogPartId(p),partNo:p.partNo||"",orderedQty:p.orderedQty,unitPrice:p.unitPrice,supplier:p.supplier,date:p.date}));
    usedParts.forEach(p=>addPartRow({partId:catalogPartId(p),partNo:p.partNo||"",qty:p.qty,unitPrice:p.unitPrice,supplier:p.supplier,date:p.date}));
    if (!orderedParts.length) addOrderedPartRow({date:job.raised||defaultFormDate()});
    if (!usedParts.length) addPartRow({date:job.raised||defaultFormDate()});
  } else {
    $("#jobDialogTitle").textContent="Add maintenance job";
    $("#jobDialogSubtitle").textContent="Job number is created automatically but can be changed before saving.";
    $("#jobSubmitBtn").textContent="Save Job";
    deleteBtn.hidden=true;
    renderAssignedSelect(selectedProfileId === "all" ? "" : profileContext());
    renderJobProjectSelect("");
    renderMachineSelect("");
    try {
      const next = await api(`/api/next-job-number?year=${encodeURIComponent(selectedYear)}`, {method:"GET",headers:{accept:"application/json"}});
      form.elements.jobNo.value=next.jobNo || nextJobNumber();
    } catch { form.elements.jobNo.value=nextJobNumber(); }
    form.elements.priority.value=appSettings.defaultPriority||"Medium";
    form.elements.raised.value=defaultFormDate();
    if($("#jobDowntimeStopped")){ $("#jobDowntimeStopped").checked=false; $("#jobDowntimeStart").value=""; $("#jobDowntimeEnd").value=""; setDowntimeFieldsEnabled(); }
    addTimeRow({date:defaultFormDate()});
    addOrderedPartRow({date:defaultFormDate()});
    addPartRow({date:defaultFormDate()});
  }
  jobDialog.showModal();
  renderPendingJobFiles();
  if(job){
    loadAttachments("job",job.jobNo,$("#jobAttachmentsList"),$("#jobAttachmentStatus"));
  }else{
    $("#jobAttachmentsList").innerHTML=`<p class="empty-note attachment-empty">Save the job first; any files you select now will upload immediately after it is saved.</p>`;
    $("#jobAttachmentStatus").textContent=attachmentPolicyText();
  }
}
$("#newJobBtn").addEventListener("click",()=>openJob());
$$('[data-new-job]').forEach(b=>b.addEventListener('click',()=>openJob()));
$$('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>{editingJobNo=null;pendingJobFiles=[];renderPendingJobFiles();jobDialog.close();}));

$("#jobAttachmentInput").addEventListener("change",e=>{addPendingJobFiles(e.target.files);e.target.value="";});
$("#jobCameraInput").addEventListener("change",e=>{addPendingJobFiles(e.target.files);e.target.value="";});
$("#jobPendingFiles").addEventListener("click",e=>{
  const button=e.target.closest("[data-remove-pending]");
  if(!button)return;
  pendingJobFiles.splice(Number(button.dataset.removePending),1);
  renderPendingJobFiles();
});
$("#jobUploadAttachmentsBtn").addEventListener("click",async()=>{
  if(!editingJobNo||!pendingJobFiles.length)return;
  const button=$("#jobUploadAttachmentsBtn");
  button.disabled=true;
  try{await uploadPendingJobFiles(editingJobNo);}
  catch(error){showSaveError(error);}
  finally{renderPendingJobFiles();}
});

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
$("#addOrderedPartRowBtn")?.addEventListener("click",()=>addOrderedPartRow({date:$("#jobForm").elements.raised.value || defaultFormDate()}));
$("#partsEditor").addEventListener("click",e=>{ const remove=e.target.closest('.remove-part-btn'); if(remove)remove.closest('.part-entry').remove(); });
$("#partsOrderedEditor")?.addEventListener("click",e=>{ const remove=e.target.closest('.remove-ordered-part-btn'); if(remove)remove.closest('.part-entry').remove(); });
async function handleJobPartEditorChange(e){
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
      refreshAllPartRowOptions(); row.querySelector('.part-select').value=part.id; row.querySelector('.part-number').value=part.partNo||""; updatePartRowStockNote(row);
    } else { const part=partCatalog.find(p=>p.id===e.target.value);row.querySelector('.part-number').value=part?.partNo||"";row.querySelector('.part-price').value=""; updatePartRowStockNote(row); }
  }
  if (e.target.classList.contains('supplier-select') && e.target.value === "__add_supplier__") {
    const name=prompt("New supplier name:");if(!name?.trim()){e.target.value="";return;}
    try { const payload=await saveMutation("/api/catalog",{type:"supplier",value:name.trim()},{render:false}); const saved=payload.value||name.trim();refreshAllPartRowOptions();row.querySelector('.supplier-select').value=saved; }
    catch(error){e.target.value="";showSaveError(error);}
  }
}
$("#partsEditor").addEventListener("change",handleJobPartEditorChange);
$("#partsOrderedEditor")?.addEventListener("change",handleJobPartEditorChange);

$("#deleteJobBtn").addEventListener("click",async()=>{
  if(!editingJobNo)return;
  const job=jobs.find(j=>j.jobNo===editingJobNo);
  if(!job){alert("Job not found.");return;}
  const details=[];
  const hours=jobHours(job);
  const partsCost=jobPartsCost(job);
  if(hours>0)details.push(`${hours.toFixed(1)} recorded hour${hours===1?"":"s"}`);
  if((job.parts||[]).length)details.push(`${job.parts.length} part entr${job.parts.length===1?"y":"ies"} (${money(partsCost)} used value)`);
  const stockReturn=(job.parts||[]).reduce((n,p)=>n+(Number(p.stockAppliedQty)||0),0);
  if(stockReturn>0)details.push(`${stockNumber(stockReturn)} stock-tracked item${stockReturn===1?"":"s"} that will be returned to stock`);
  const extra=details.length?`\n\nThis job contains ${details.join(" and ")}.`:"";
  if(!confirm(`Permanently delete ${job.jobNo} · ${job.title}?${extra}\n\nAny attached photos/files will also be deleted. This cannot be undone.`))return;
  const btn=$("#deleteJobBtn");
  btn.disabled=true;btn.textContent="Deleting…";
  try{
    await saveMutation("/api/jobs/delete",{jobNo:editingJobNo});
    editingJobNo=null;
    pendingJobFiles=[];
    renderPendingJobFiles();
    jobDialog.close();
  }catch(error){
    showSaveError(error);
    btn.disabled=false;btn.textContent="Delete Job";
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
  const selectedMachine=machines.find(m=>String(m.id)===String(obj.machine));
  if(!selectedMachine){alert("Select a valid machine.");return;}
  const updated={jobNo:cleanNo,title:obj.title,description:obj.description,section:selectedMachine.section,machineId:selectedMachine.id,machine:selectedMachine.name,projectId:String(obj.projectId||""),priority:obj.priority,status:obj.status,raised:obj.raised,target:obj.target,completed:obj.completed,hours:timeEntries.reduce((a,t)=>a+(Number(t.hours)||0),0),timeEntries,notes:obj.notes,assigned:obj.assigned,pinned:fd.has("pinned"),parts,downtimeStopped:fd.has("downtimeStopped"),downtimeStart:obj.downtimeStart||"",downtimeEnd:obj.downtimeEnd||""};
  const originalJobNo=editingJobNo;
  const submit=$("#jobSubmitBtn"); submit.disabled=true; submit.textContent="Saving…";
  try {
    const payload=await saveMutation("/api/jobs",{job:updated,originalJobNo},{render:false});
    const savedJobNo=payload.jobNo||cleanNo;
    editingJobNo=savedJobNo;
    if(pendingJobFiles.length){
      submit.textContent="Uploading files…";
      try{await uploadPendingJobFiles(savedJobNo);}
      catch(uploadError){
        renderAll();
        showSaveError(new Error(`Job saved, but a file could not be uploaded: ${uploadError.message||uploadError}`));
        $("#jobDialogTitle").textContent=`Edit ${savedJobNo}`;
        $("#jobSubmitBtn").textContent="Save Changes";
        $("#deleteJobBtn").hidden=false;
        await loadAttachments("job",savedJobNo,$("#jobAttachmentsList"),$("#jobAttachmentStatus"));
        return;
      }
    }
    editingJobNo=null;
    pendingJobFiles=[];
    renderAll();
    jobDialog.close();
  } catch(error){ showSaveError(error); }
  finally { submit.disabled=false; submit.textContent=editingJobNo?"Save Changes":"Save Job"; renderPendingJobFiles(); }
});

// Add / edit machine form. All authenticated maintenance users can maintain machine details.
function relabelMachineInput(input,labelText){
  const label=input?.closest("label");if(!label)return;
  const textNode=[...label.childNodes].find(node=>node.nodeType===3&&String(node.textContent||"").trim());
  if(textNode)textNode.textContent=labelText;
}
function ensureMachineIdentityFields(){
  const form=$("#machineForm");if(!form)return;
  const machineNo=form.elements.assetId;
  if(machineNo){
    relabelMachineInput(machineNo,"Machine number / ID");
    if(!form.elements.assetNumber){
      const existingLabel=machineNo.closest("label");
      const label=document.createElement("label");
      if(existingLabel?.className)label.className=existingLabel.className;
      label.dataset.v593AssetNumber="1";
      label.append(document.createTextNode("Asset number"));
      const input=document.createElement("input");input.name="assetNumber";input.maxLength=100;input.placeholder="Optional asset tag / number";if(machineNo.className)input.className=machineNo.className;
      label.appendChild(input);
      if(existingLabel?.parentNode)existingLabel.parentNode.insertBefore(label,existingLabel.nextSibling);else form.insertBefore(label,form.querySelector(".dialog-actions,.form-actions,.modal-actions")||null);
    }
  }
  const make=form.elements.make;if(make)relabelMachineInput(make,"Manufacturer");
}
function cleanMachineToolingRows(value){
  return (Array.isArray(value)?value:[]).map(item=>({name:String(item?.name||"").trim(),description:String(item?.description||"").trim()})).filter(item=>item.name).slice(0,100);
}
function updateMachineToolingEmptyState(){
  const rows=$("#machineToolingRows"),empty=$("#machineToolingEmpty");if(!rows||!empty)return;empty.hidden=Boolean(rows.querySelector(".machine-tooling-row"));
}
function addMachineToolingRow(item={},shouldFocus=true){
  const rows=$("#machineToolingRows");if(!rows)return;
  const row=document.createElement("div");row.className="machine-tooling-row";
  const nameLabel=document.createElement("label");nameLabel.append(document.createTextNode("Tooling name / number"));
  const nameInput=document.createElement("input");nameInput.type="text";nameInput.maxLength=160;nameInput.placeholder="e.g. Rivet head T-104";nameInput.dataset.toolingName="1";nameInput.value=String(item?.name||"");nameLabel.appendChild(nameInput);
  const descLabel=document.createElement("label");descLabel.append(document.createTextNode("Description (optional)"));
  const descInput=document.createElement("input");descInput.type="text";descInput.maxLength=300;descInput.placeholder="Size, position, purpose or notes";descInput.dataset.toolingDescription="1";descInput.value=String(item?.description||"");descLabel.appendChild(descInput);
  const remove=document.createElement("button");remove.type="button";remove.className="btn secondary compact";remove.textContent="Remove";remove.addEventListener("click",()=>{row.remove();updateMachineToolingEmptyState();});
  row.append(nameLabel,descLabel,remove);rows.appendChild(row);updateMachineToolingEmptyState();if(shouldFocus)nameInput.focus();
}
function renderMachineToolingEditor(value=[]){
  const rows=$("#machineToolingRows");if(!rows)return;rows.innerHTML="";for(const item of cleanMachineToolingRows(value))addMachineToolingRow(item,false);updateMachineToolingEmptyState();
}
function readMachineToolingEditor(){
  return $$("#machineToolingRows .machine-tooling-row").map(row=>({name:String(row.querySelector("[data-tooling-name]")?.value||"").trim(),description:String(row.querySelector("[data-tooling-description]")?.value||"").trim()})).filter(item=>item.name).slice(0,100);
}
function ensureMachineToolingEditor(){
  const form=$("#machineForm");if(!form||$("#machineToolingEditor"))return;
  const editor=document.createElement("div");editor.id="machineToolingEditor";editor.className="machine-tooling-editor";
  editor.innerHTML=`<div class="machine-tooling-head"><div><strong>Tooling</strong><small>Add as many tooling items as this machine needs.</small></div><button type="button" class="btn secondary compact" id="machineAddToolingBtn">＋ Add tooling</button></div><div id="machineToolingRows" class="machine-tooling-rows"></div><div id="machineToolingEmpty" class="machine-tooling-empty">No tooling added to this machine.</div>`;
  const notes=form.elements.notes?.closest("label");const actions=form.querySelector(".dialog-actions,.form-actions,.modal-actions");const anchor=notes||actions;if(anchor?.parentNode)anchor.parentNode.insertBefore(editor,anchor);else form.appendChild(editor);
  $("#machineAddToolingBtn")?.addEventListener("click",()=>addMachineToolingRow());updateMachineToolingEmptyState();
}
ensureMachineIdentityFields();
ensureMachineToolingEditor();
const machineDialog = $("#machineDialog");
function openMachineDialog(preselect="", machineId="") {
  const form=$("#machineForm");
  form.reset();
  renderMachineToolingEditor([]);
  form.elements.machineId.value=machineId||"";
  const existing=machineId?machines.find(m=>m.id===machineId):null;
  renderSectionSelects();
  if(existing){
    $("#machineDialogTitle").textContent=`Edit ${existing.assetId} · ${existing.name}`;
    $("#machineDialogSubtitle").textContent="Changes are shared immediately. Renaming the machine also updates linked job history.";
    form.elements.assetId.value=existing.assetId||"";
    if(form.elements.assetNumber)form.elements.assetNumber.value=existing.assetNumber||"";
    form.elements.name.value=existing.name||"";
    form.elements.section.value=existing.section||"";
    form.elements.category.value=existing.category||existing.section||"";
    form.elements.location.value=existing.location||"";
    form.elements.purchaseCost.value=existing.purchaseCost??"";
    form.elements.make.value=existing.manufacturer||existing.make||"";
    form.elements.model.value=existing.model||"";
    form.elements.serialNumber.value=existing.serialNumber||"";
    form.elements.purchaseDate.value=existing.purchaseDate||"";
    form.elements.installDate.value=existing.installDate||"";
    form.elements.notes.value=existing.notes||"";
    renderMachineToolingEditor(existing.tooling||[]);
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
  const assetId=String(o.assetId||"").trim(),assetNumber=String(o.assetNumber||"").trim(),name=String(o.name||"").trim(),manufacturer=String(o.make||"").trim(),tooling=readMachineToolingEditor();
  if (machines.some(m=>m.id!==id && String(m.assetId).toLowerCase()===assetId.toLowerCase())) { alert("That machine number already exists."); return; }
  if (assetNumber && machines.some(m=>m.id!==id && String(m.assetNumber||"").toLowerCase()===assetNumber.toLowerCase())) { alert("That asset number already exists."); return; }
  const machine = {assetId,assetNumber,name,section:o.section,category:o.category,location:o.location,purchaseCost:o.purchaseCost===""?null:Number(o.purchaseCost),manufacturer,make:manufacturer,model:o.model,serialNumber:o.serialNumber,purchaseDate:o.purchaseDate,installDate:o.installDate,notes:o.notes,tooling};
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

const stockDialog=$("#stockDialog");
function setStockFormEnabled() {
  const form=$("#stockForm");
  if(!form)return;
  const tracked=form.elements.stockTracked.checked;
  [form.elements.currentStock,form.elements.minStock,form.elements.binLocation,form.elements.preferredSupplier,form.elements.reorderQty].filter(Boolean).forEach(el=>{el.disabled=!tracked;});
  const help=$("#stockTrackingHelp");
  if(help) help.textContent=tracked
    ? "This current-stock figure is treated as the known physical count now. Existing historical jobs are not deducted again; future job use is deducted automatically."
    : "Stock is not tracked for this part. It can still be selected on jobs, but job use will not change a stock quantity.";
}
function openStockDialog(partId) {
  const part=partCatalog.find(p=>p.id===partId);
  if(!part||!stockDialog)return;
  editingStockPartId=part.id;
  stockTrackingTouched=false;
  const form=$("#stockForm");
  form.reset();
  form.elements.partId.value=part.id;
  form.elements.stockTracked.checked=part.stockTracked===true;
  if(form.elements.partNo)form.elements.partNo.value=part.partNo||"";
  form.elements.currentStock.value=stockNumber(part.currentStock);
  form.elements.minStock.value=stockNumber(part.minStock);
  form.elements.binLocation.value=part.binLocation||"";
  if(form.elements.preferredSupplier)form.elements.preferredSupplier.value=part.preferredSupplier||"";
  if(form.elements.reorderQty)form.elements.reorderQty.value=Math.max(1,Number(part.reorderQty)||1);
  $("#stockDialogTitle").textContent=`Stock · ${part.name}`;
  $("#stockPartName").textContent=part.name;
  $("#stockPartNumber").textContent=part.partNo?`Part no. ${part.partNo}`:"No part number set";
  setStockFormEnabled();
  stockDialog.showModal();
}
$$('[data-close-stock]').forEach(b=>b.addEventListener('click',()=>{editingStockPartId=null;stockTrackingTouched=false;stockDialog.close();}));
$("#stockForm")?.elements.stockTracked.addEventListener("change",()=>{stockTrackingTouched=true;setStockFormEnabled();});
$("#stockForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const part=partCatalog.find(p=>p.id===String(form.elements.partId.value||editingStockPartId||""));
  if(!part){alert("Part not found.");return;}
  const tracked=stockTrackingTouched?form.elements.stockTracked.checked:part.stockTracked===true;
  form.elements.stockTracked.checked=tracked;
  const current=tracked?Number(form.elements.currentStock.value):Number(part.currentStock)||0;
  const min=tracked?Number(form.elements.minStock.value):Number(part.minStock)||0;
  if(tracked && (!Number.isFinite(current) || !Number.isFinite(min) || min<0)){alert("Enter a valid current stock and minimum stock.");return;}
  const btn=$("#stockSaveBtn");btn.disabled=true;btn.textContent="Saving…";
  try{
    const result=await masterMutation({entity:"part",action:"update",id:part.id,name:part.name,partNo:String(form.elements.partNo?.value??part.partNo??"").trim(),stockTracked:tracked,currentStock:current,minStock:min,binLocation:tracked?String(form.elements.binLocation.value||"").trim():part.binLocation||"",preferredSupplier:tracked?String(form.elements.preferredSupplier?.value||"").trim():part.preferredSupplier||"",reorderQty:tracked?Math.max(1,Number(form.elements.reorderQty?.value)||1):Math.max(1,Number(part.reorderQty)||1)});
    if(!result)return;
    editingStockPartId=null;
    stockTrackingTouched=false;
    stockDialog.close();
  }finally{btn.disabled=false;btn.textContent="Save Stock";}
});
$("#partsView")?.addEventListener("click",e=>{
  const button=e.target.closest('[data-edit-stock]');
  if(button)openStockDialog(button.dataset.editStock);
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
    await refreshOperatorRequests({render:false});
    const identity=payload.identity||{};
    const params=new URLSearchParams(location.search);
    if(identity.cloudflareLogin && identity.admin && !params.get("view")) {
      location.replace("/admin");
      return;
    }
    const machineParam=params.get("machine");
    if(machineParam && machines.some(m=>m.id===machineParam)){selectedMachineId=machineParam;machineDetailTab="overview";}
    renderAll();
    const requestedView=params.get("view");
    const allowedViews=new Set(["dashboard","requests","all","machines","parts","preventive","downtime","reports","data"]);
    if(machineParam && machines.some(m=>m.id===machineParam)) switchView("machines");
    else if(requestedView && allowedViews.has(requestedView)) switchView(requestedView);
  } catch(error) {
    console.error(error);
    document.body.innerHTML=`<main style="max-width:760px;margin:60px auto;font-family:system-ui;padding:24px"><h1>Maintenance Manager</h1><p>The shared database could not be loaded.</p><pre style="white-space:pre-wrap;background:#f4f5f7;padding:16px;border-radius:10px">${esc(error.message||error)}</pre><p>Check that the Worker has a D1 binding named DB, then reload this page. Tables are created automatically on first use.</p></main>`;
  }
}
window.addEventListener("focus",()=>{ if(!jobDialog.open && !machineDialog.open && !stockDialog.open) Promise.all([refreshSharedState({render:false}),refreshOperatorRequests({render:false})]).then(()=>renderAll()).catch(()=>{}); });
initializeApp();
