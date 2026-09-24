// details-form.js — stage 3: follow-up details for an approved booking
// Reached via a link containing ?id=<bookingId>&token=<followUpToken>, no login required.

import { db, storage } from "./firebase-config.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import {
  EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_DETAILS_CONFIRMED
} from "./emailjs-config.js";
import { fmtDateList, summariseLocations } from "./locations.js";

emailjs.init(EMAILJS_PUBLIC_KEY);

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
  let summary = `${summariseLocations(bookingData)} — ${fmtDateList(bookingData.dates)}`;
  if (bookingData.pavilionMode === "hourly") summary += ` (pavilion: ${bookingData.pavilionStart}–${bookingData.pavilionEnd})`;
  document.getElementById("event-summary").textContent = summary;

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

    const statusEl = document.getElementById("details-email-status");
    try {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_DETAILS_CONFIRMED, {
        to_email: bookingData.organiserEmail,
        to_name: bookingData.organiserName,
        reply_to: bookingData.organiserEmail,
        event_title: bookingData.eventTitle,
        site_name: summariseLocations(bookingData),
        event_date: fmtDateList(bookingData.dates),
      });
      statusEl.textContent = "A confirmation email has been sent to you.";
    } catch (err) {
      console.error("EmailJS send failed", err);
      // Non-blocking: the details are already saved, a missed email isn't critical.
      statusEl.textContent = "";
    }
  } catch (err) {
    console.error(err);
    errorBox.textContent = err.message || "Something went wrong submitting your details. Please try again.";
    errorBox.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit details";
  }
});

init();
