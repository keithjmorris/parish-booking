// booking-form.js — stage 1: public booking request

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, query, where,
  getCountFromServer, serverTimestamp, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const TOTAL_LIMIT = 28;
const COMMERCIAL_LIMIT = 14;

const siteSelect = document.getElementById("siteSelect");
const otherLocationField = document.getElementById("otherLocationField");
const otherLocationInput = document.getElementById("otherLocation");
const capacityInfo = document.getElementById("capacity-info");
const capacityBar = document.getElementById("capacity-bar");
const capacityBarFill = document.getElementById("capacity-bar-fill");
const isCommercialInput = document.getElementById("isCommercial");
const form = document.getElementById("booking-form");
const submitBtn = document.getElementById("submit-btn");
const formError = document.getElementById("form-error");

let sitesCache = []; // [{id, name}]

// ---- Load sites -----------------------------------------------------

async function loadSites() {
  siteSelect.innerHTML = "";
  try {
    const snap = await getDocs(
      query(collection(db, "sites"), where("active", "==", true), orderBy("name"))
    );
    sitesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Failed to load sites", err);
    sitesCache = [];
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a location…";
  placeholder.disabled = true;
  placeholder.selected = true;
  siteSelect.appendChild(placeholder);

  sitesCache.forEach(site => {
    const opt = document.createElement("option");
    opt.value = site.id;
    opt.textContent = site.name;
    siteSelect.appendChild(opt);
  });

  const otherOpt = document.createElement("option");
  otherOpt.value = "__other__";
  otherOpt.textContent = "Other (please specify)";
  siteSelect.appendChild(otherOpt);
}

// ---- Capacity check for the selected site ----------------------------

async function getSiteCounts(siteId) {
  const bookingsRef = collection(db, "bookings");

  const totalSnap = await getCountFromServer(
    query(bookingsRef, where("siteId", "==", siteId), where("status", "==", "approved"))
  );
  const commercialSnap = await getCountFromServer(
    query(
      bookingsRef,
      where("siteId", "==", siteId),
      where("status", "==", "approved"),
      where("isCommercial", "==", true)
    )
  );

  return { total: totalSnap.data().count, commercial: commercialSnap.data().count };
}

async function refreshCapacityDisplay() {
  const siteId = siteSelect.value;
  if (!siteId || siteId === "__other__") {
    capacityInfo.hidden = true;
    capacityBar.hidden = true;
    return;
  }

  capacityInfo.hidden = false;
  capacityInfo.textContent = "Checking availability…";
  capacityBar.hidden = true;

  try {
    const counts = await getSiteCounts(siteId);
    const totalPct = Math.min(100, (counts.total / TOTAL_LIMIT) * 100);
    capacityBar.hidden = false;
    capacityBarFill.style.width = `${totalPct}%`;
    capacityBarFill.classList.toggle("is-full", counts.total >= TOTAL_LIMIT);

    capacityInfo.textContent =
      `${counts.total}/${TOTAL_LIMIT} total bookings used · ${counts.commercial}/${COMMERCIAL_LIMIT} commercial bookings used`;

    if (counts.total >= TOTAL_LIMIT) {
      capacityInfo.textContent += " — this site is fully booked and cannot take new requests.";
    } else if (isCommercialInput.checked && counts.commercial >= COMMERCIAL_LIMIT) {
      capacityInfo.textContent += " — commercial capacity reached for this site.";
    }
  } catch (err) {
    console.error("Failed to check capacity", err);
    capacityInfo.textContent = "Couldn't check availability — you can still submit and the council will confirm.";
  }
}

siteSelect.addEventListener("change", () => {
  otherLocationField.hidden = siteSelect.value !== "__other__";
  otherLocationInput.required = siteSelect.value === "__other__";
  refreshCapacityDisplay();
});

isCommercialInput.addEventListener("change", refreshCapacityDisplay);

// ---- Submit -----------------------------------------------------------

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
  formError.scrollIntoView({ behavior: "smooth", block: "center" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const siteId = siteSelect.value;
  const isOther = siteId === "__other__";
  const siteName = isOther ? otherLocationInput.value.trim() : siteSelect.options[siteSelect.selectedIndex].text;
  const isCommercial = isCommercialInput.checked;

  const eventDate = document.getElementById("eventDate").value;
  const eventEndDate = document.getElementById("eventEndDate").value || eventDate;
  if (eventEndDate < eventDate) {
    showError("End date can't be before the start date.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Checking availability…";

  // Re-check capacity at submit time to avoid a stale/raced count.
  if (!isOther) {
    try {
      const counts = await getSiteCounts(siteId);
      if (counts.total >= TOTAL_LIMIT) {
        showError("Sorry — this site has reached its total booking limit (28 uses) and can't take new requests.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit request";
        return;
      }
      if (isCommercial && counts.commercial >= COMMERCIAL_LIMIT) {
        showError("Sorry — this site has reached its commercial booking limit (14 uses). Non-commercial requests may still be possible.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit request";
        return;
      }
    } catch (err) {
      console.error(err);
      // Non-blocking — let the request through, council can catch it on review.
    }
  }

  submitBtn.textContent = "Submitting…";

  const payload = {
    eventTitle: document.getElementById("eventTitle").value.trim(),
    siteId: isOther ? null : siteId,
    siteName,
    isOtherLocation: isOther,
    eventDate,
    eventEndDate,
    startTime: document.getElementById("startTime").value,
    endTime: document.getElementById("endTime").value,
    isCommercial,
    description: document.getElementById("description").value.trim(),
    organiserName: document.getElementById("organiserName").value.trim(),
    organiserEmail: document.getElementById("organiserEmail").value.trim(),
    organiserPhone: document.getElementById("organiserPhone").value.trim(),
    organiserOrg: document.getElementById("organiserOrg").value.trim(),
    status: "pending",
    createdAt: serverTimestamp(),
  };

  try {
    const docRef = await addDoc(collection(db, "bookings"), payload);
    document.getElementById("form-view").hidden = true;
    const confirmView = document.getElementById("confirm-view");
    confirmView.hidden = false;
    document.getElementById("confirm-ref").textContent = docRef.id.slice(0, 8).toUpperCase();
    document.getElementById("confirm-email").textContent = payload.organiserEmail;
    confirmView.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error(err);
    showError("Something went wrong sending your request. Please try again, or contact the parish clerk directly.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit request";
  }
});

loadSites();
