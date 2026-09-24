// admin-dashboard.js — stage 2: council approval dashboard

import { db, auth } from "./firebase-config.js";
import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs, onSnapshot,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_APPROVAL
} from "./emailjs-config.js";
import {
  TOTAL_LIMIT, COMMERCIAL_LIMIT, SITE_TYPES,
  loadActiveSites, groupSitesByType, getUsageForSites,
  fmtDateList, summariseLocations
} from "./locations.js";

emailjs.init(EMAILJS_PUBLIC_KEY);

const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const headerMeta = document.getElementById("header-meta");

// ---- Auth ---------------------------------------------------------------

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error(err);
    loginError.textContent = "Couldn't sign in — check your email and password.";
    loginError.hidden = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loginView.hidden = false;
    dashboardView.hidden = true;
    return;
  }

  const memberDoc = await getDoc(doc(db, "councilMembers", user.uid));
  if (!memberDoc.exists()) {
    loginError.textContent = "This account isn't set up as a council member. Contact the clerk.";
    loginError.hidden = false;
    await signOut(auth);
    return;
  }

  loginView.hidden = true;
  dashboardView.hidden = false;
  const name = memberDoc.data().name || user.email;
  headerMeta.innerHTML = `Signed in as ${name} &middot; <a href="#" id="signout-link">Sign out</a> &middot; <a href="index.html">Public form</a>`;
  document.getElementById("signout-link").addEventListener("click", (e) => {
    e.preventDefault();
    signOut(auth);
  });

  startPendingListener();
  startApprovedListener();
  startSitesListener();
});

// ---- Tabs -----------------------------------------------------------

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("is-active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.hidden = true);
    tab.classList.add("is-active");
    document.getElementById(`tab-${tab.dataset.tab}`).hidden = false;
  });
});

// ---- Helpers ----------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function bookingsCollection() { return collection(db, "bookings"); }
function siteCollection() { return collection(db, "sites"); }

function pavilionSummary(b) {
  if (!b.pavilionMode) return "";
  if (b.pavilionMode === "hourly") return ` (pavilion: ${escapeHtml(b.pavilionStart)}–${escapeHtml(b.pavilionEnd)})`;
  return " (pavilion: all day)";
}

// ---- Pending tab --------------------------------------------------------

function startPendingListener() {
  const q = query(bookingsCollection(), where("status", "==", "pending"), orderBy("createdAt", "asc"));
  onSnapshot(q, (snap) => {
    const list = document.getElementById("pending-list");
    const countEl = document.getElementById("pending-count");
    countEl.textContent = snap.size ? `(${snap.size})` : "";

    if (snap.empty) {
      list.innerHTML = `<div class="empty-state">No pending requests right now.</div>`;
      return;
    }

    list.innerHTML = "";
    snap.forEach(docSnap => {
      const b = docSnap.data();
      const id = docSnap.id;
      const el = document.createElement("div");
      el.className = "request-item";
      el.innerHTML = `
        <div class="request-item__top">
          <div>
            <div class="request-item__title">${escapeHtml(b.eventTitle)}</div>
            <div class="request-item__meta">
              <div><strong>${escapeHtml(summariseLocations(b))}</strong>${pavilionSummary(b)}</div>
              <div>${escapeHtml(fmtDateList(b.dates))}</div>
              <div>${escapeHtml(b.organiserName)} · ${escapeHtml(b.organiserEmail)} · ${escapeHtml(b.organiserPhone)}</div>
              ${b.organiserOrg ? `<div>${escapeHtml(b.organiserOrg)}</div>` : ""}
            </div>
          </div>
          <span class="badge ${b.isCommercial ? "badge--pending" : "badge--approved"}">${b.isCommercial ? "Commercial" : "Non-commercial"}</span>
        </div>
        ${b.description ? `<p style="margin-bottom:0;">${escapeHtml(b.description)}</p>` : ""}
        <div class="request-item__actions">
          <button class="btn-primary btn-small" data-action="approve">Approve</button>
          <button class="btn-alert btn-small" data-action="reject">Reject</button>
        </div>
        <div class="reject-panel" hidden style="margin-top:12px;">
          <div class="field">
            <label>Reason for rejection (sent to the organiser record)</label>
            <textarea class="reject-reason" rows="2"></textarea>
          </div>
          <button class="btn-alert btn-small" data-action="confirm-reject">Confirm rejection</button>
        </div>
      `;

      el.querySelector('[data-action="approve"]').addEventListener("click", () => approveBooking(id, b));
      el.querySelector('[data-action="reject"]').addEventListener("click", () => {
        el.querySelector(".reject-panel").hidden = false;
      });
      el.querySelector('[data-action="confirm-reject"]').addEventListener("click", () => {
        const reason = el.querySelector(".reject-reason").value.trim();
        rejectBooking(id, reason);
      });

      list.appendChild(el);
    });
  });
}

async function approveBooking(id, booking) {
  const siteIds = booking.siteIds || [];
  const dateCount = (booking.dates || []).length;

  if (siteIds.length) {
    const usage = await getUsageForSites(siteIds);
    for (let i = 0; i < siteIds.length; i++) {
      const u = usage[siteIds[i]];
      const name = booking.siteNames[i];
      if (u.total + dateCount > TOTAL_LIMIT) {
        alert(`Can't approve — "${name}" only has ${TOTAL_LIMIT - u.total} of its ${TOTAL_LIMIT} total uses left, but this booking needs ${dateCount}.`);
        return;
      }
      if (booking.isCommercial && u.commercial + dateCount > COMMERCIAL_LIMIT) {
        alert(`Can't approve — "${name}" only has ${COMMERCIAL_LIMIT - u.commercial} of its ${COMMERCIAL_LIMIT} commercial uses left, but this booking needs ${dateCount}.`);
        return;
      }
    }
  }

  const token = crypto.randomUUID();
  await updateDoc(doc(db, "bookings", id), {
    status: "approved",
    approvedAt: serverTimestamp(),
    approvedBy: auth.currentUser.email,
    followUpToken: token,
  });

  showLinkModal(id, token, booking);
  sendApprovalEmail(id, token, booking);
}

async function sendApprovalEmail(bookingId, token, booking) {
  const url = `${location.origin}/details.html?id=${bookingId}&token=${token}`;
  const statusEl = document.getElementById("link-modal-status");

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_APPROVAL, {
      to_email: booking.organiserEmail,
      to_name: booking.organiserName,
      reply_to: booking.organiserEmail,
      event_title: booking.eventTitle,
      site_name: summariseLocations(booking),
      event_date: fmtDateList(booking.dates),
      start_time: booking.pavilionStart || "",
      end_time: booking.pavilionEnd || "",
      follow_up_url: url,
    });
    if (statusEl && !document.getElementById("link-modal").hidden) {
      statusEl.textContent = `Email sent to ${booking.organiserEmail}.`;
    }
    return true;
  } catch (err) {
    console.error("EmailJS send failed", err);
    if (statusEl && !document.getElementById("link-modal").hidden) {
      statusEl.textContent = `Couldn't send the email automatically — please copy the link below and send it yourself.`;
      statusEl.style.color = "var(--alert)";
    }
    return false;
  }
}

async function rejectBooking(id, reason) {
  await updateDoc(doc(db, "bookings", id), {
    status: "rejected",
    rejectedAt: serverTimestamp(),
    rejectedBy: auth.currentUser.email,
    rejectionReason: reason,
  });
}

function showLinkModal(bookingId, token, booking) {
  const url = `${location.origin}/details.html?id=${bookingId}&token=${token}`;
  const modal = document.getElementById("link-modal");
  const statusEl = document.getElementById("link-modal-status");
  statusEl.textContent = "Sending email to the organiser…";
  statusEl.style.color = "";
  document.getElementById("link-modal-url").textContent = url;
  const mailto = document.getElementById("link-modal-mailto");
  mailto.href = `mailto:${encodeURIComponent(booking.organiserEmail)}` +
    `?subject=${encodeURIComponent("Your booking has been approved — next steps")}` +
    `&body=${encodeURIComponent(`Hi ${booking.organiserName},\n\nYour booking for "${booking.eventTitle}" has been approved.\n\nPlease complete this short follow-up form with your insurance, event plan, risk assessment and payment details:\n${url}\n\nThank you,\nThe Parish Council`)}`;
  modal.hidden = false;
  modal.style.display = "flex";

  document.getElementById("link-modal-copy").onclick = () => {
    navigator.clipboard.writeText(url);
    const btn = document.getElementById("link-modal-copy");
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  };
  document.getElementById("link-modal-close").onclick = () => {
    modal.hidden = true;
    modal.style.display = "none";
  };
}

// ---- Approved tab -------------------------------------------------------

function startApprovedListener() {
  const q = query(bookingsCollection(), where("status", "==", "approved"), orderBy("firstDate", "asc"));
  onSnapshot(q, (snap) => {
    const list = document.getElementById("approved-list");
    if (snap.empty) {
      list.innerHTML = `<div class="empty-state">No approved events yet.</div>`;
      return;
    }

    list.innerHTML = "";
    snap.forEach(docSnap => {
      const b = docSnap.data();
      const id = docSnap.id;
      const hasDetails = !!b.detailsSubmittedAt;
      const el = document.createElement("div");
      el.className = "request-item";
      el.innerHTML = `
        <div class="request-item__top">
          <div>
            <div class="request-item__title">${escapeHtml(b.eventTitle)}</div>
            <div class="request-item__meta">
              <div><strong>${escapeHtml(summariseLocations(b))}</strong>${pavilionSummary(b)}</div>
              <div>${escapeHtml(fmtDateList(b.dates))}</div>
              <div>${escapeHtml(b.organiserName)} · ${escapeHtml(b.organiserEmail)}</div>
            </div>
          </div>
          <span class="badge ${hasDetails ? "badge--approved" : "badge--pending"}">${hasDetails ? "Details submitted" : "Awaiting details"}</span>
        </div>
        <div class="request-item__actions">
          <button class="btn-secondary btn-small" data-action="link">Resend email</button>
          ${hasDetails ? `<button class="btn-secondary btn-small" data-action="view">View submitted details</button>` : ""}
        </div>
        <div class="details-panel" hidden style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:0.88rem;"></div>
      `;

      el.querySelector('[data-action="link"]').addEventListener("click", () => {
        showLinkModal(id, b.followUpToken, b);
        sendApprovalEmail(id, b.followUpToken, b);
      });

      const viewBtn = el.querySelector('[data-action="view"]');
      if (viewBtn) {
        viewBtn.addEventListener("click", () => {
          const panel = el.querySelector(".details-panel");
          panel.hidden = !panel.hidden;
          if (!panel.hidden) {
            const d = b.details || {};
            panel.innerHTML = `
              <div><strong>Insurance:</strong> ${escapeHtml(d.insuranceProvider)} — policy ${escapeHtml(d.insurancePolicyNumber)}, expires ${escapeHtml(d.insuranceExpiry)}</div>
              <div style="margin-top:6px;"><strong>Event plan:</strong> ${escapeHtml(d.eventPlan)}</div>
              <div style="margin-top:6px;"><strong>Risk assessment:</strong> ${escapeHtml(d.riskAssessment)}</div>
              <div style="margin-top:6px;"><strong>Payment:</strong> ${d.paymentConfirmed ? "Confirmed" : "Not confirmed"} ${d.paymentNotes ? "— " + escapeHtml(d.paymentNotes) : ""}</div>
              ${d.specialArrangements ? `<div style="margin-top:6px;"><strong>Special arrangements:</strong> ${escapeHtml(d.specialArrangements)}</div>` : ""}
              ${d.fileUrls && d.fileUrls.length ? `<div style="margin-top:6px;"><strong>Attached files:</strong> ${d.fileUrls.map(u => `<a href="${u}" target="_blank" rel="noopener">document</a>`).join(", ")}</div>` : ""}
            `;
          }
        });
      }

      list.appendChild(el);
    });
  });
}

// ---- Sites tab ----------------------------------------------------------

const DEFAULT_SITES = [
  ...Array.from({ length: 9 }, (_, i) => ({ name: `Green ${i + 1}`, type: "green", number: i + 1 })),
  { name: "Playing Field", type: "playing_field" },
  { name: "Pavilion", type: "pavilion" },
];

document.getElementById("newSiteType").addEventListener("change", (e) => {
  document.getElementById("newSiteNumberField").hidden = e.target.value !== "green";
});

document.getElementById("seed-sites-btn").addEventListener("click", async () => {
  const btn = document.getElementById("seed-sites-btn");
  btn.disabled = true;
  btn.textContent = "Creating…";
  try {
    const existing = await getDocs(siteCollection());
    const existingNames = new Set(existing.docs.map(d => d.data().name));
    const toCreate = DEFAULT_SITES.filter(s => !existingNames.has(s.name));
    if (toCreate.length === 0) {
      alert("The standard sites already exist.");
    } else {
      await Promise.all(toCreate.map(s => addDoc(siteCollection(), { ...s, active: true, createdAt: serverTimestamp() })));
      alert(`Created ${toCreate.length} site(s).`);
    }
  } catch (err) {
    console.error(err);
    alert("Couldn't create the standard sites — check the console.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Create standard sites (9 greens, playing field, pavilion)";
  }
});

function startSitesListener() {
  const q = query(siteCollection(), orderBy("name", "asc"));
  onSnapshot(q, async (snap) => {
    const list = document.getElementById("sites-list");
    if (snap.empty) {
      list.innerHTML = `<div class="empty-state">No sites added yet.</div>`;
      return;
    }

    const sites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const groups = groupSitesByType(sites);
    const ordered = [...groups.green, ...groups.playing_field, ...groups.pavilion, ...groups.other];

    list.innerHTML = "";
    for (const site of ordered) {
      const id = site.id;
      const usage = (await getUsageForSites([id]))[id];

      const el = document.createElement("div");
      el.className = "request-item";
      el.innerHTML = `
        <div class="request-item__top">
          <div style="flex:1;">
            <div class="request-item__title site-name-display">${escapeHtml(site.name)}${site.type === "green" && site.number ? ` <span style="color:var(--ink-faint);font-weight:400;">#${site.number}</span>` : ""}</div>
            <div class="field" style="display:none;margin:6px 0 0 0;" data-rename-field>
              <input type="text" value="${escapeHtml(site.name)}" style="max-width:280px;">
            </div>
            <div class="capacity-line">${SITE_TYPES[site.type] || SITE_TYPES.other} · ${usage.total}/${TOTAL_LIMIT} total · ${usage.commercial}/${COMMERCIAL_LIMIT} commercial</div>
            <div class="capacity-bar"><div class="capacity-bar__fill ${usage.total >= TOTAL_LIMIT ? "is-full" : ""}" style="width:${Math.min(100, (usage.total / TOTAL_LIMIT) * 100)}%;"></div></div>
          </div>
          <span class="badge ${site.active ? "badge--approved" : "badge--rejected"}">${site.active ? "Active" : "Inactive"}</span>
        </div>
        <div class="request-item__actions">
          <button class="btn-secondary btn-small" data-action="rename">Rename</button>
          <button class="btn-secondary btn-small" data-action="toggle">${site.active ? "Deactivate" : "Reactivate"}</button>
        </div>
      `;

      el.querySelector('[data-action="toggle"]').addEventListener("click", () => {
        updateDoc(doc(db, "sites", id), { active: !site.active });
      });

      const renameBtn = el.querySelector('[data-action="rename"]');
      const renameField = el.querySelector('[data-rename-field]');
      const nameDisplay = el.querySelector('.site-name-display');
      const renameInput = renameField.querySelector('input');
      renameBtn.addEventListener("click", async () => {
        if (renameField.style.display === "none") {
          renameField.style.display = "block";
          nameDisplay.style.display = "none";
          renameBtn.textContent = "Save";
          renameInput.focus();
        } else {
          const newName = renameInput.value.trim();
          if (newName && newName !== site.name) {
            await updateDoc(doc(db, "sites", id), { name: newName });
          }
          renameField.style.display = "none";
          nameDisplay.style.display = "block";
          renameBtn.textContent = "Rename";
        }
      });

      list.appendChild(el);
    }
  });
}

document.getElementById("add-site-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("newSiteName");
  const name = input.value.trim();
  const type = document.getElementById("newSiteType").value;
  if (!name) return;
  const payload = { name, type, active: true, createdAt: serverTimestamp() };
  if (type === "green") {
    const num = Number(document.getElementById("newSiteNumber").value);
    if (num) payload.number = num;
  }
  await addDoc(siteCollection(), payload);
  input.value = "";
  document.getElementById("newSiteNumber").value = "";
});

// ---- CSV export -----------------------------------------------------

const CSV_COLUMNS = [
  "id", "status", "eventTitle",
  "siteNames", "siteTypes", "allGreensSelected", "otherLocationText",
  "dates", "firstDate", "lastDate",
  "pavilionMode", "pavilionStart", "pavilionEnd",
  "isCommercial",
  "organiserName", "organiserEmail", "organiserPhone", "organiserOrg", "description",
  "createdAt", "approvedAt", "approvedBy",
  "rejectedAt", "rejectedBy", "rejectionReason",
  "detailsSubmittedAt",
  "insuranceProvider", "insurancePolicyNumber", "insuranceExpiry",
  "eventPlan", "riskAssessment",
  "paymentConfirmed", "paymentNotes", "specialArrangements", "fileUrls",
];

function tsToStr(ts) {
  if (ts && typeof ts.toDate === "function") return ts.toDate().toISOString();
  return "";
}

function csvEscape(value) {
  const str = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function bookingToRow(id, b) {
  const d = b.details || {};
  const row = {
    id,
    status: b.status,
    eventTitle: b.eventTitle,
    siteNames: (b.siteNames || []).join(" | "),
    siteTypes: (b.siteTypes || []).join(" | "),
    allGreensSelected: b.allGreensSelected,
    otherLocationText: b.otherLocationText,
    dates: (b.dates || []).join(" | "),
    firstDate: b.firstDate,
    lastDate: b.lastDate,
    pavilionMode: b.pavilionMode,
    pavilionStart: b.pavilionStart,
    pavilionEnd: b.pavilionEnd,
    isCommercial: b.isCommercial,
    organiserName: b.organiserName,
    organiserEmail: b.organiserEmail,
    organiserPhone: b.organiserPhone,
    organiserOrg: b.organiserOrg,
    description: b.description,
    createdAt: tsToStr(b.createdAt),
    approvedAt: tsToStr(b.approvedAt),
    approvedBy: b.approvedBy,
    rejectedAt: tsToStr(b.rejectedAt),
    rejectedBy: b.rejectedBy,
    rejectionReason: b.rejectionReason,
    detailsSubmittedAt: tsToStr(b.detailsSubmittedAt),
    insuranceProvider: d.insuranceProvider,
    insurancePolicyNumber: d.insurancePolicyNumber,
    insuranceExpiry: d.insuranceExpiry,
    eventPlan: d.eventPlan,
    riskAssessment: d.riskAssessment,
    paymentConfirmed: d.paymentConfirmed,
    paymentNotes: d.paymentNotes,
    specialArrangements: d.specialArrangements,
    fileUrls: (d.fileUrls || []).join(" | "),
  };
  return CSV_COLUMNS.map(col => csvEscape(row[col])).join(",");
}

async function exportBookingsCSV() {
  const btn = document.getElementById("export-csv-btn");
  btn.disabled = true;
  btn.textContent = "Preparing…";

  try {
    const snap = await getDocs(query(bookingsCollection(), orderBy("createdAt", "asc")));
    const lines = [CSV_COLUMNS.join(",")];
    snap.forEach(docSnap => lines.push(bookingToRow(docSnap.id, docSnap.data())));

    const csv = lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bookings-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("CSV export failed", err);
    alert("Couldn't export bookings — check the console for details.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Download all bookings (CSV)";
  }
}

document.getElementById("export-csv-btn").addEventListener("click", exportBookingsCSV);
