// admin-dashboard.js — stage 2: council approval dashboard

import { db, auth } from "./firebase-config.js";
import {
  collection, doc, addDoc, updateDoc, getDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const TOTAL_LIMIT = 28;
const COMMERCIAL_LIMIT = 14;

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

  // Confirm this account is a registered council member (set up by the clerk
  // in Firestore under councilMembers/{uid} — see README).
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

function fmtDate(iso, endIso) {
  if (!iso) return "";
  const opts = { day: "numeric", month: "short", year: "numeric" };
  const start = new Date(iso + "T00:00:00").toLocaleDateString("en-GB", opts);
  if (endIso && endIso !== iso) {
    const end = new Date(endIso + "T00:00:00").toLocaleDateString("en-GB", opts);
    return `${start} – ${end}`;
  }
  return start;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function siteCollection() { return collection(db, "sites"); }
function bookingsCollection() { return collection(db, "bookings"); }

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
              <div><strong>${escapeHtml(b.siteName)}</strong>${b.isOtherLocation ? " (not a listed site)" : ""}</div>
              <div>${fmtDate(b.eventDate, b.eventEndDate)} · ${escapeHtml(b.startTime)}–${escapeHtml(b.endTime)}</div>
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
  // Final capacity re-check at approval time (bookings can be approved out of
  // request order, and other approvals may have happened since this request came in).
  if (booking.siteId) {
    const bookingsRef = bookingsCollection();
    const totalSnap = await getCountFromServer(
      query(bookingsRef, where("siteId", "==", booking.siteId), where("status", "==", "approved"))
    );
    if (totalSnap.data().count >= TOTAL_LIMIT) {
      alert(`This site is already at its total limit of ${TOTAL_LIMIT} approved bookings.`);
      return;
    }
    if (booking.isCommercial) {
      const commSnap = await getCountFromServer(
        query(bookingsRef, where("siteId", "==", booking.siteId), where("status", "==", "approved"), where("isCommercial", "==", true))
      );
      if (commSnap.data().count >= COMMERCIAL_LIMIT) {
        alert(`This site is already at its commercial limit of ${COMMERCIAL_LIMIT} approved bookings.`);
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
  document.getElementById("link-modal-url").textContent = url;
  const mailto = document.getElementById("link-modal-mailto");
  mailto.href = `mailto:${encodeURIComponent(booking.organiserEmail)}` +
    `?subject=${encodeURIComponent("Your booking has been approved — next steps")}` +
    `&body=${encodeURIComponent(`Hi ${booking.organiserName},\n\nYour booking for "${booking.eventTitle}" has been approved.\n\nPlease complete this short follow-up form with your insurance, event plan, risk assessment and payment details:\n${url}\n\nThank you,\nThe Parish Council`)}`;
  modal.hidden = false;

  document.getElementById("link-modal-copy").onclick = () => {
    navigator.clipboard.writeText(url);
    const btn = document.getElementById("link-modal-copy");
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  };
  document.getElementById("link-modal-close").onclick = () => (modal.hidden = true);
}

// ---- Approved tab -------------------------------------------------------

function startApprovedListener() {
  const q = query(bookingsCollection(), where("status", "==", "approved"), orderBy("eventDate", "asc"));
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
              <div><strong>${escapeHtml(b.siteName)}</strong></div>
              <div>${fmtDate(b.eventDate, b.eventEndDate)} · ${escapeHtml(b.startTime)}–${escapeHtml(b.endTime)}</div>
              <div>${escapeHtml(b.organiserName)} · ${escapeHtml(b.organiserEmail)}</div>
            </div>
          </div>
          <span class="badge ${hasDetails ? "badge--approved" : "badge--pending"}">${hasDetails ? "Details submitted" : "Awaiting details"}</span>
        </div>
        <div class="request-item__actions">
          <button class="btn-secondary btn-small" data-action="link">Copy follow-up link</button>
          ${hasDetails ? `<button class="btn-secondary btn-small" data-action="view">View submitted details</button>` : ""}
        </div>
        <div class="details-panel" hidden style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:0.88rem;"></div>
      `;

      el.querySelector('[data-action="link"]').addEventListener("click", () => showLinkModal(id, b.followUpToken, b));

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

function startSitesListener() {
  const q = query(siteCollection(), orderBy("name", "asc"));
  onSnapshot(q, async (snap) => {
    const list = document.getElementById("sites-list");
    if (snap.empty) {
      list.innerHTML = `<div class="empty-state">No sites added yet.</div>`;
      return;
    }

    list.innerHTML = "";
    for (const docSnap of snap.docs) {
      const site = docSnap.data();
      const id = docSnap.id;

      const bookingsRef = bookingsCollection();
      const [totalSnap, commSnap] = await Promise.all([
        getCountFromServer(query(bookingsRef, where("siteId", "==", id), where("status", "==", "approved"))),
        getCountFromServer(query(bookingsRef, where("siteId", "==", id), where("status", "==", "approved"), where("isCommercial", "==", true))),
      ]);
      const total = totalSnap.data().count;
      const commercial = commSnap.data().count;

      const el = document.createElement("div");
      el.className = "request-item";
      el.innerHTML = `
        <div class="request-item__top">
          <div>
            <div class="request-item__title">${escapeHtml(site.name)}</div>
            <div class="capacity-line">${total}/${TOTAL_LIMIT} total · ${commercial}/${COMMERCIAL_LIMIT} commercial</div>
            <div class="capacity-bar"><div class="capacity-bar__fill ${total >= TOTAL_LIMIT ? "is-full" : ""}" style="width:${Math.min(100, (total / TOTAL_LIMIT) * 100)}%;"></div></div>
          </div>
          <span class="badge ${site.active ? "badge--approved" : "badge--rejected"}">${site.active ? "Active" : "Inactive"}</span>
        </div>
        <div class="request-item__actions">
          <button class="btn-secondary btn-small" data-action="toggle">${site.active ? "Deactivate" : "Reactivate"}</button>
        </div>
      `;
      el.querySelector('[data-action="toggle"]').addEventListener("click", () => {
        updateDoc(doc(db, "sites", id), { active: !site.active });
      });
      list.appendChild(el);
    }
  });
}

document.getElementById("add-site-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("newSiteName");
  const name = input.value.trim();
  if (!name) return;
  await addDoc(siteCollection(), { name, active: true, createdAt: serverTimestamp() });
  input.value = "";
});
