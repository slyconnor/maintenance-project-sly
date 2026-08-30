const $ = (s) => document.querySelector(s);
const escText = (v) => String(v ?? "");

let machine = null;

async function requestApi(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showError(message) {
  const box = $("#requestError");
  box.textContent = message;
  box.hidden = false;
}

function hideError() {
  $("#requestError").hidden = true;
  $("#requestError").textContent = "";
}

function showForm() {
  hideError();
  $("#requestSuccess").hidden = true;
  $("#operatorRequestForm").hidden = false;
  $("#operatorIssue").value = "";
  $("#operatorIssue").focus();
}

async function initialize() {
  const params = new URLSearchParams(location.search);
  const machineId = params.get("machine") || "";
  if (!machineId) {
    $("#requestIntro").textContent = "This QR code is missing its machine reference.";
    showError("Please scan the QR code attached to the machine again.");
    return;
  }

  try {
    const data = await requestApi(`/request?api=machine&machine=${encodeURIComponent(machineId)}`, { method: "GET", headers: { accept: "application/json" } });
    machine = data.machine;
    document.title = `${data.siteName || "Maintenance"} · Report Issue`;
    $("#requestIntro").textContent = "Tell maintenance what is wrong. No login is required.";
    $("#machineTitle").textContent = `${escText(machine.assetId)} · ${escText(machine.name)}`;
    $("#machineMeta").textContent = [machine.section, machine.location].filter(Boolean).join(" · ");
    $("#requestMachineId").value = machine.id;
    $("#machineSummary").hidden = false;
    $("#operatorRequestForm").hidden = false;
    $("#operatorName").focus();
  } catch (error) {
    $("#requestIntro").textContent = "This request form could not be opened.";
    showError(error.message || String(error));
  }
}

$("#operatorRequestForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  const form = event.currentTarget;
  const button = $("#operatorSubmitBtn");
  const operatorName = $("#operatorName").value.trim();
  const issue = $("#operatorIssue").value.trim();
  if (operatorName.length < 2) {
    showError("Enter your name.");
    $("#operatorName").focus();
    return;
  }
  if (issue.length < 3) {
    showError("Describe the maintenance issue.");
    $("#operatorIssue").focus();
    return;
  }

  button.disabled = true;
  button.textContent = "Submitting…";
  try {
    const payload = await requestApi("/request?api=submit", {
      method: "POST",
      body: JSON.stringify({
        machineId: $("#requestMachineId").value,
        operatorName,
        issue,
        website: $("#operatorWebsite").value
      })
    });
    $("#requestReference").textContent = payload.requestNo || "Submitted";
    form.hidden = true;
    $("#requestSuccess").hidden = false;
    $("#requestSuccess").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    button.disabled = false;
    button.textContent = "Submit maintenance request";
  }
});

$("#submitAnotherBtn").addEventListener("click", showForm);
initialize();
