const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
let profiles=[];
let jobs=[];
let identity=null;
let accessSyncConfigured=false;
let settings={companyName:"",siteName:"Maintenance Manager",currency:"GBP",defaultPriority:"Medium",maxAttachmentMb:25,allowAllFileTypes:true,allowedExtensions:"jpg,jpeg,png,webp,gif,pdf,doc,docx,xls,xlsx,csv,txt,rtf,zip,7z"};

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

function renderSettings(){
  const form=$("#settingsForm");if(!form)return;
  form.elements.companyName.value=settings.companyName||"";
  form.elements.siteName.value=settings.siteName||"Maintenance Manager";
  form.elements.currency.value=settings.currency||"GBP";
  form.elements.defaultPriority.value=settings.defaultPriority||"Medium";
  form.elements.maxAttachmentMb.value=Number(settings.maxAttachmentMb)||25;
  form.elements.allowAllFileTypes.checked=settings.allowAllFileTypes!==false;
  form.elements.allowedExtensions.value=settings.allowedExtensions||"";
  form.elements.allowedExtensions.disabled=form.elements.allowAllFileTypes.checked;
}

$("#settingsForm")?.elements?.allowAllFileTypes?.addEventListener("change",e=>{
  const field=$("#settingsForm").elements.allowedExtensions;field.disabled=e.currentTarget.checked;
});

$("#settingsForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const form=e.currentTarget,button=$("#saveSettingsBtn"),status=$("#settingsStatus");
  const next={
    companyName:String(form.elements.companyName.value||"").trim(),
    siteName:String(form.elements.siteName.value||"").trim()||"Maintenance Manager",
    currency:form.elements.currency.value,
    defaultPriority:form.elements.defaultPriority.value,
    maxAttachmentMb:Number(form.elements.maxAttachmentMb.value)||25,
    allowAllFileTypes:Boolean(form.elements.allowAllFileTypes.checked),
    allowedExtensions:String(form.elements.allowedExtensions.value||"").trim()
  };
  button.disabled=true;button.textContent="Saving…";status.textContent="";
  try{
    const data=await api("/admin?api=settings",{method:"POST",body:JSON.stringify({settings:next})});
    settings=data.settings||next;renderSettings();status.textContent="Settings saved. The main site will use them on refresh.";
  }catch(error){status.textContent=error.message;alert(error.message)}
  finally{button.disabled=false;button.textContent="Save Settings";}
});

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
    profiles=data.profiles||[];jobs=data.jobs||[];identity=data.identity||null;accessSyncConfigured=Boolean(data.accessSyncConfigured);settings={...settings,...(data.settings||{})};
    setStatus(
      "Cloudflare Admin verified",
      `${identity?.email?`Signed in as ${identity.email}. `:""}Profiles are stored in the shared D1 database.${accessSyncConfigured?" Cloudflare Access email syncing is configured.":" Cloudflare Access automatic email syncing is not configured yet; profiles will still save to D1."}`,
      accessSyncConfigured?"ok":"warning"
    );
    render();
    renderSettings();
  }catch(error){
    showDenied(error);
  }
}

initialize();
