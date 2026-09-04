const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
let displaySettings={siteName:"Maintenance Manager",companyName:"",currency:"GBP"};
const money=n=>new Intl.NumberFormat("en-GB",{style:"currency",currency:displaySettings.currency||"GBP",maximumFractionDigits:0}).format(Number(n)||0);
const fmtDate=d=>d?new Date(d+"T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short"}):"—";
function partTotal(p){return (Number(p.qty)||0)*(Number(p.unitPrice)||0)}
function jobHours(j){return Array.isArray(j.timeEntries)?j.timeEntries.reduce((a,t)=>a+(Number(t.hours)||0),0):Number(j.hours)||0}
function pill(s){return `<span class="display-pill ${String(s||"").toLowerCase().replaceAll(" ","-")}">${esc(s||"—")}</span>`}
function isOpenJob(j){return !["Completed","Cancelled"].includes(String(j?.status||""))}
function priorityRank(priority){return ({Critical:0,High:1,Medium:2,Low:3})[String(priority||"")]??4}
function newestJobFirst(a,b){
  const byRaised=String(b?.raised||"").localeCompare(String(a?.raised||""));
  if(byRaised)return byRaised;
  return Number(b.pinned)-Number(a.pinned)||priorityRank(a.priority)-priorityRank(b.priority)||String(b.jobNo||"").localeCompare(String(a.jobNo||""),undefined,{numeric:true,sensitivity:"base"});
}
const chartGroups=new Set(["category","machine","section"]);
let displayChartGroup=chartGroups.has(localStorage.getItem("piDisplayChartGroup"))?localStorage.getItem("piDisplayChartGroup"):"category";

async function getState(){
  const response=await fetch("/api/state",{credentials:"same-origin",headers:{accept:"application/json"}});
  if(!response.ok){let d={};try{d=await response.json()}catch{};throw new Error(d.error||`Shared data request failed (${response.status})`)}
  return response.json();
}

function renderMaintenanceChart(jobs,machines,timeMonth,machineFor){
  const labels={category:"machine category",machine:"machine name",section:"section"};
  const grouped=new Map();
  for(const job of jobs){
    const hours=timeMonth(job);
    if(!hours)continue;
    const machine=machineFor(job);
    let name="Other";
    if(displayChartGroup==="machine"){
      if(machine)name=`${machine.assetId?`${machine.assetId} · `:""}${machine.name||job.machine||"Unnamed machine"}`;
      else name=job.machine||"General work";
    }else if(displayChartGroup==="section"){
      name=job.section||machine?.section||"Other";
    }else{
      name=machine?.category||(job.machine?"Other":"General work");
    }
    grouped.set(name,(grouped.get(name)||0)+hours);
  }
  const rows=[...grouped].sort((a,b)=>b[1]-a[1]);
  const max=Math.max(1,...rows.map(row=>row[1]));
  if($("#displayChartHeading"))$("#displayChartHeading").textContent=`Maintenance time by ${labels[displayChartGroup]}`;
  if($("#displayChartGroup")&&$("#displayChartGroup").value!==displayChartGroup)$("#displayChartGroup").value=displayChartGroup;
  $("#displayBars").innerHTML=rows.length?rows.map(([name,val])=>`<div class="display-bar-row"><span class="display-bar-label">${esc(name)}</span><span class="display-bar-track"><span class="display-bar-fill" style="display:block;width:${Math.max(3,val/max*100)}%"></span></span><strong class="display-bar-value">${val.toFixed(1)}h</strong></div>`).join(""):`<div class="display-empty">No time entries this month.</div>`;
}

async function render(){
  try{
    const payload=await getState();
    const state=payload.state||{};
    displaySettings={...displaySettings,...(state.settings||{})};
    const jobs=Array.isArray(state.jobs)?state.jobs:[],machines=Array.isArray(state.machines)?state.machines:[];
    const now=new Date(),year=now.getFullYear(),month=now.getMonth(),prefix=`${year}-${String(month+1).padStart(2,"0")}`;
    const inMonth=d=>Boolean(d&&String(d).startsWith(prefix));
    const machineFor=j=>machines.find(m=>String(m.id||"")===String(j?.machineId||""))||machines.find(m=>m.name===j.machine)||null;
    const timeMonth=j=>Array.isArray(j.timeEntries)?j.timeEntries.filter(t=>inMonth(t.date)).reduce((a,t)=>a+(Number(t.hours)||0),0):0;
    const partsMonth=j=>(j.parts||[]).filter(p=>inMonth(p.date)).reduce((a,p)=>a+partTotal(p),0);
    const currentJobs=jobs.filter(j=>inMonth(j.raised)||inMonth(j.completed)||(j.timeEntries||[]).some(t=>inMonth(t.date))||(j.parts||[]).some(p=>inMonth(p.date))||(isOpenJob(j)&&j.raised<`${prefix}-32`)).sort(newestJobFirst);
    const open=jobs.filter(isOpenJob).length;
    const raised=jobs.filter(j=>inMonth(j.raised)).length;
    const hours=jobs.reduce((a,j)=>a+timeMonth(j),0),spend=jobs.reduce((a,j)=>a+partsMonth(j),0);
    $("#displayTitle").textContent=`${displaySettings.siteName||"Maintenance Manager"} · ${MONTHS[month]} ${year}`;
    document.title=`${displaySettings.siteName||"Maintenance Manager"} · Display Mode`;$("#displayJobsHeading").textContent=`${MONTHS[month]} jobs / carried work`;
    $("#dJobs").textContent=raised;$("#dOpen").textContent=open;$("#dHours").textContent=hours.toFixed(1);$("#dSpend").textContent=money(spend);
    $("#displayJobs").innerHTML=currentJobs.length?currentJobs.map(j=>{const m=machineFor(j),rowClass=isOpenJob(j)?"display-job-open":"display-job-closed";return `<tr class="${rowClass}"><td><strong>${j.pinned?"📌 ":""}${esc(j.jobNo)}</strong></td><td class="display-machine"><strong>${esc(j.title)}</strong><span>${esc(m?.assetId||"—")} · ${esc(j.machine||"General work")} · ${esc(j.section||m?.section||"")}</span></td><td>${pill(j.priority)}</td><td>${pill(j.status)}</td><td>${esc(j.assigned||"—")}</td><td>${fmtDate(j.target)}</td><td>${timeMonth(j).toFixed(1)}</td><td>${money(partsMonth(j))}</td></tr>`}).join(""):`<tr><td colspan="8" class="display-empty">No current-month jobs yet.</td></tr>`;
    renderMaintenanceChart(jobs,machines,timeMonth,machineFor);
    const stamp=new Date();$("#displayTime").textContent=stamp.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});$("#displayRefresh").textContent=`Shared D1 data · refreshed ${stamp.toLocaleTimeString("en-GB")}`;
  }catch(error){
    $("#displayJobs").innerHTML=`<tr><td colspan="8" class="display-empty">${esc(error.message)}</td></tr>`;
    $("#displayRefresh").textContent="Waiting for shared database / Cloudflare Access";
  }
}

$("#displayChartGroup")?.addEventListener("change",event=>{
  const next=String(event.target.value||"");
  if(!chartGroups.has(next))return;
  displayChartGroup=next;
  localStorage.setItem("piDisplayChartGroup",displayChartGroup);
  render();
});
if($("#displayChartGroup"))$("#displayChartGroup").value=displayChartGroup;
render();setInterval(render,60000);
