const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
let profiles=[];
let jobs=[];
let identity=null;
let accessSyncConfigured=false;

async function api(path, options={}){
  const response=await fetch(path,{credentials:"same-origin",headers:{"content-type":"application/json",...(options.headers||{})},...options});
  let data={};try{data=await response.json()}catch{}
  if(!response.ok)throw new Error(data?.error||data?.accessSync?.message||`Request failed (${response.status})`);
  return data;
}

function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim())}
function setStatus(title,message,kind=""){
  $("#accessTitle").textContent=title;
  $("#accessStatus").textContent=message;
  $("#accessStatus").dataset.kind=kind;
}

function render(){
  const list=[...profiles].sort((a,b)=>(a.active===false)-(b.active===false)||a.name.localeCompare(b.name));
  $("#profileList").innerHTML=list.length?list.map(p=>{
    const assigned=jobs.filter(j=>j.assigned===p.name).length;
    return `<div class="profile-admin-row"><div><strong>${esc(p.name)} <span class="status-dot ${p.active===false?"inactive":"active"}">${p.active===false?"Inactive":"Active"}</span></strong><span>${esc(p.email||"No email recorded")} · ${assigned} assigned job${assigned===1?"":"s"}</span></div><div class="profile-admin-actions"><button type="button" class="btn secondary compact" data-edit-email="${esc(p.id)}">Edit email</button><button type="button" class="btn secondary compact" data-toggle="${esc(p.id)}">${p.active===false?"Reactivate":"Deactivate"}</button></div></div>`;
  }).join(""):`<p class="admin-note">No engineer profiles yet. Add the first engineer on the left.</p>`;
  const active=profiles.filter(p=>p.active!==false).length;
  $("#profileCount").textContent=`${active} active profile${active===1?"":"s"}. Deactivating a profile keeps its complete job history.`;

  document.querySelectorAll("[data-toggle]").forEach(btn=>btn.addEventListener("click",async()=>{
    btn.disabled=true;
    try{
      const data=await api("/api/admin/profiles",{method:"POST",body:JSON.stringify({action:"toggle",id:btn.dataset.toggle})});
      profiles=data.profiles||profiles;jobs=data.jobs||jobs;render();showSync(data.accessSync);
    }catch(error){alert(error.message)}finally{btn.disabled=false}
  }));

  document.querySelectorAll("[data-edit-email]").forEach(btn=>btn.addEventListener("click",async()=>{
    const p=profiles.find(x=>x.id===btn.dataset.editEmail);if(!p)return;
    const entered=prompt(`Access email for ${p.name}:`,p.email||"");if(entered===null)return;
    const email=entered.trim().toLowerCase();if(!validEmail(email)){alert("Enter a valid email address.");return;}
    btn.disabled=true;
    try{
      const data=await api("/api/admin/profiles",{method:"POST",body:JSON.stringify({action:"email",id:p.id,email})});
      profiles=data.profiles||profiles;jobs=data.jobs||jobs;render();showSync(data.accessSync);
    }catch(error){alert(error.message)}finally{btn.disabled=false}
  }));
}

function showSync(sync){
  if(!sync)return;
  setStatus(sync.ok?"Cloudflare Access synced":"Profile saved",sync.message,sync.ok?"ok":"warning");
}

$("#profileForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const fd=new FormData(e.currentTarget);
  const name=String(fd.get("name")||"").trim();
  const email=String(fd.get("email")||"").trim().toLowerCase();
  if(!name||!validEmail(email))return;
  const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent="Adding…";
  try{
    const data=await api("/api/admin/profiles",{method:"POST",body:JSON.stringify({action:"create",name,email})});
    profiles=data.profiles||profiles;jobs=data.jobs||jobs;e.currentTarget.reset();render();showSync(data.accessSync);
  }catch(error){alert(error.message)}finally{button.disabled=false;button.textContent="＋ Add Profile"}
});

$("#syncAccessBtn")?.addEventListener("click",async e=>{
  e.currentTarget.disabled=true;
  try{const data=await api("/api/admin/sync-access",{method:"POST",body:"{}"});showSync(data.accessSync)}
  catch(error){setStatus("Cloudflare sync failed",error.message,"warning")}
  finally{e.currentTarget.disabled=false}
});

async function initialize(){
  try{
    const data=await api("/api/admin/profiles",{method:"GET",headers:{accept:"application/json"}});
    profiles=data.profiles||[];jobs=data.jobs||[];identity=data.identity||null;accessSyncConfigured=Boolean(data.accessSyncConfigured);
    setStatus(
      "Cloudflare Admin verified",
      `${identity?.email?`Signed in as ${identity.email}. `:""}Profiles are stored in the shared D1 database.${accessSyncConfigured?" Cloudflare Access email syncing is configured.":" Cloudflare Access automatic email syncing is not configured yet; profiles will still save to D1."}`,
      accessSyncConfigured?"ok":"warning"
    );
    render();
  }catch(error){
    document.body.innerHTML=`<main style="max-width:760px;margin:60px auto;font-family:system-ui;padding:24px"><h1>Admin access unavailable</h1><p>${esc(error.message)}</p><p>Open this page using the Cloudflare login method and check the Admin Access policy.</p><p><a href="/index.html?view=dashboard">Back to dashboard</a></p></main>`;
  }
}

initialize();
