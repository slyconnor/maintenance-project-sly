const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
let profiles=[];
let jobs=[];
let identity=null;
let accessSyncConfigured=false;

async function api(path, options={}){
  const response=await fetch(path,{credentials:"same-origin",headers:{"content-type":"application/json",...(options.headers||{})},...options});
  let data={};try{data=await response.json()}catch{}
  if(!response.ok){
    const error=new Error(data?.error||data?.accessSync?.message||`Request failed (${response.status})`);
    error.status=response.status;
    error.data=data;
    throw error;
  }
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
    const deleteTitle=assigned?`Cannot permanently delete: ${assigned} job${assigned===1?"":"s"} are assigned to this profile.`:"Permanently delete this profile";
    return `<div class="profile-admin-row"><div><strong>${esc(p.name)} <span class="status-dot ${p.active===false?"inactive":"active"}">${p.active===false?"Inactive":"Active"}</span></strong><span>${esc(p.email||"No email recorded")} · ${assigned} assigned job${assigned===1?"":"s"}</span></div><div class="profile-admin-actions"><button type="button" class="btn secondary compact" data-edit-email="${esc(p.id)}">Edit email</button><button type="button" class="btn secondary compact" data-toggle="${esc(p.id)}">${p.active===false?"Reactivate":"Deactivate"}</button><button type="button" class="btn danger compact" data-delete="${esc(p.id)}" ${assigned?"disabled":""} title="${esc(deleteTitle)}">Delete</button></div></div>`;
  }).join(""):`<p class="admin-note">No engineer profiles yet. Add the first engineer on the left.</p>`;
  const active=profiles.filter(p=>p.active!==false).length;
  $("#profileCount").textContent=`${active} active profile${active===1?"":"s"}. Deactivate keeps job history; Delete permanently removes profiles that have no assigned jobs.`;

  document.querySelectorAll("[data-toggle]").forEach(btn=>btn.addEventListener("click",async()=>{
    btn.disabled=true;
    try{
      const data=await api("/admin?api=profiles",{method:"POST",body:JSON.stringify({action:"toggle",id:btn.dataset.toggle})});
      profiles=data.profiles||profiles;jobs=data.jobs||jobs;render();showSync(data.accessSync);
    }catch(error){alert(error.message)}finally{btn.disabled=false}
  }));

  document.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",async()=>{
    const p=profiles.find(x=>x.id===btn.dataset.delete);if(!p)return;
    const assigned=jobs.filter(j=>j.assigned===p.name).length;
    if(assigned){alert("This profile has job history, so it cannot be permanently deleted. Deactivate it instead.");return;}
    if(!confirm(`Permanently delete ${p.name}?\n\nThis removes the profile and its Access email. This cannot be undone.`))return;
    btn.disabled=true;
    try{
      const data=await api("/admin?api=profiles",{method:"POST",body:JSON.stringify({action:"delete",id:p.id})});
      profiles=data.profiles||profiles;jobs=data.jobs||jobs;render();showSync(data.accessSync);
    }catch(error){alert(error.message)}finally{btn.disabled=false}
  }));

  document.querySelectorAll("[data-edit-email]").forEach(btn=>btn.addEventListener("click",async()=>{
    const p=profiles.find(x=>x.id===btn.dataset.editEmail);if(!p)return;
    const entered=prompt(`Access email for ${p.name}:`,p.email||"");if(entered===null)return;
    const email=entered.trim().toLowerCase();if(!validEmail(email)){alert("Enter a valid email address.");return;}
    btn.disabled=true;
    try{
      const data=await api("/admin?api=profiles",{method:"POST",body:JSON.stringify({action:"email",id:p.id,email})});
      profiles=data.profiles||profiles;jobs=data.jobs||jobs;render();showSync(data.accessSync);
    }catch(error){alert(error.message)}finally{btn.disabled=false}
  }));
}

function showSync(sync){
  if(!sync)return;
  setStatus(sync.ok?"Cloudflare Access synced":"Profile saved",sync.message,sync.ok?"ok":"warning");
}

$("#profileForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const fd=new FormData(form);
  const name=String(fd.get("name")||"").trim();
  const email=String(fd.get("email")||"").trim().toLowerCase();
  if(!name||!validEmail(email))return;
  const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent="Adding…";
  try{
    const data=await api("/admin?api=profiles",{method:"POST",body:JSON.stringify({action:"create",name,email})});
    profiles=data.profiles||profiles;jobs=data.jobs||jobs;form.reset();render();showSync(data.accessSync);
  }catch(error){alert(error.message)}finally{button.disabled=false;button.textContent="＋ Add Profile"}
});

$("#syncAccessBtn")?.addEventListener("click",async e=>{
  e.currentTarget.disabled=true;
  try{const data=await api("/admin?api=sync-access",{method:"POST",body:"{}"});showSync(data.accessSync)}
  catch(error){setStatus("Cloudflare sync failed",error.message,"warning")}
  finally{e.currentTarget.disabled=false}
});

function showDenied(error){
  const email=error?.data?.identity?.email||"the current account";
  const isAdminError=error?.status===403;
  document.body.innerHTML=`<main class="admin-denied-shell"><section class="admin-denied-card"><h1>${isAdminError?"Admin login required":"Admin access unavailable"}</h1><p>${isAdminError?`You are signed in as <strong>${esc(email)}</strong>, but that session is not an approved Cloudflare Admin login.`:esc(error.message)}</p>${isAdminError?`<p>Use <strong>Log out / switch account</strong>, then open Admin Login again and sign in with the approved admin email. Cloudflare can otherwise reuse the engineer session you already had open.</p>`:""}<div class="admin-denied-actions"><a class="btn primary" href="/cdn-cgi/access/logout">Log out / switch account</a><a class="btn secondary" href="/index.html?view=dashboard">Back to Maintenance Manager</a></div></section></main>`;
}

async function initialize(){
  try{
    const data=await api("/admin?api=profiles",{method:"GET",headers:{accept:"application/json"}});
    profiles=data.profiles||[];jobs=data.jobs||[];identity=data.identity||null;accessSyncConfigured=Boolean(data.accessSyncConfigured);
    setStatus(
      "Cloudflare Admin verified",
      `${identity?.email?`Signed in as ${identity.email}. `:""}Profiles are stored in the shared D1 database.${accessSyncConfigured?" Cloudflare Access email syncing is configured.":" Cloudflare Access automatic email syncing is not configured yet; profiles will still save to D1."}`,
      accessSyncConfigured?"ok":"warning"
    );
    render();
  }catch(error){
    showDenied(error);
  }
}

initialize();
