// details-form.js — stage 3: follow-up details for an approved booking
// Reached via a link containing ?id=<bookingId>&token=<followUpToken>, no login required.

import { db, storage } from "./firebase-config.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const params = new URLSearchParams(location.search);
const bookingId = params.get("id");
const token = params.get("token");

const loadingView = document.getElementById("loading-view");
const invalidView = document.getElementById("invalid-view");
const detailsView = document.getElementById("details-view");
const confirmView = document.getElementById("details-confirm-view");
const form = document.getElementById("details-form");
const errorBox = document.getElementById("details-error");
const submitBtn = document.getElementById("details-submit-btn");

let bookingRef = null;
let bookingData = null;

async function init() {
  if (!bookingId || !token) {
    showInvalid();
    return;
  }

  bookingRef = doc(db, "bookings", bookingId);
  let snap;
  try {
    snap = await getDoc(bookingRef);
  } catch (err) {
    console.error(err);
    showInvalid();
    return;
  }

  if (!snap.exists()) {
    showInvalid();
    return;
  }

  bookingData = snap.data();

  if (bookingData.status !== "approved" || bookingData.followUpToken !== token) {
    showInvalid();
    return;
  }

  loadingView.hidden = true;
  detailsView.hidden = false;

  document.getElementById("event-title-heading").textContent = bookingData.eventTitle;
  document.getElementById("event-summary").textContent =
    `${bookingData.siteName} — ${bookingData.eventDate}${bookingData.eventEndDate && bookingData.eventEndDate !== bookingData.eventDate ? " to " + bookingData.eventEndDate : ""}, ${bookingData.startTime}–${bookingData.endTime}`;

  // Pre-fill if details were already submitted, so the organiser can amend them.
  const d = bookingData.details;
  if (d) {
    document.getElementById("insuranceProvider").value = d.insuranceProvider || "";
    document.getElementById("insurancePolicyNumber").value = d.insurancePolicyNumber || "";
    document.getElementById("insuranceExpiry").value = d.insuranceExpiry || "";
    document.getElementById("eventPlan").value = d.eventPlan || "";
    document.getElementById("riskAssessment").value = d.riskAssessment || "";
    document.getElementById("paymentConfirmed").checked = !!d.paymentConfirmed;
    document.getElementById("paymentNotes").value = d.paymentNotes || "";
    document.getElementById("specialArrangements").value = d.specialArrangements || "";
    submitBtn.textContent = "Update details";
  }
}

function showInvalid() {
  loadingView.hidden = true;
  invalidView.hidden = false;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function uploadIfPresent(inputId, label) {
  const input = document.getElementById(inputId);
  const file = input.files[0];
  if (!file) return null;
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${label} file is too large (max 10MB).`);
  }
  const path = `bookings/${bookingId}/${inputId}-${Date.now()}-${file.name}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.hidden = true;

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Uploading…";

  try {
    const [insuranceUrl, eventPlanUrl, riskAssessmentUrl] = await Promise.all([
      uploadIfPresent("insuranceFile", "Insurance certificate"),
      uploadIfPresent("eventPlanFile", "Event plan"),
      uploadIfPresent("riskAssessmentFile", "Risk assessment"),
    ]);

    const fileUrls = [insuranceUrl, eventPlanUrl, riskAssessmentUrl].filter(Boolean);

    const details = {
      insuranceProvider: document.getElementById("insuranceProvider").value.trim(),
      insurancePolicyNumber: document.getElementById("insurancePolicyNumber").value.trim(),
      insuranceExpiry: document.getElementById("insuranceExpiry").value,
      eventPlan: document.getElementById("eventPlan").value.trim(),
      riskAssessment: document.getElementById("riskAssessment").value.trim(),
      paymentConfirmed: document.getElementById("paymentConfirmed").checked,
      paymentNotes: document.getElementById("paymentNotes").value.trim(),
      specialArrangements: document.getElementById("specialArrangements").value.trim(),
      fileUrls,
    };

    submitBtn.textContent = "Saving…";

    await updateDoc(bookingRef, {
      details,
      detailsSubmittedAt: serverTimestamp(),
    });

    detailsView.hidden = true;
    confirmView.hidden = false;
    confirmView.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error(err);
    errorBox.textContent = err.message || "Something went wrong submitting your details. Please try again.";
    errorBox.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit details";
  }
});

init();
