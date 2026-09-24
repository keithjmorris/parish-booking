// booking-form.js — stage 1: public booking request

import { db } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_REQUEST_RECEIVED
} from "./emailjs-config.js";
import {
  TOTAL_LIMIT, COMMERCIAL_LIMIT, GREEN_LAYOUT,
  loadActiveSites, groupSitesByType, getUsageForSites,
  fmtDateShort, fmtDateList, datesForWeeklyRange
} from "./locations.js";

emailjs.init(EMAILJS_PUBLIC_KEY);

const form = document.getElementById("booking-form");
const submitBtn = document.getElementById("submit-btn");
const formError = document.getElementById("form-error");

let siteGroups = { green: [], playing_field: [], pavilion: [], other: [] };
let activeLocs = new Set(); // "green" | "playing_field" | "pavilion" | "freetext"
let selectedGreenIds = new Set();
let dates = []; // sorted ISO strings

// ---- Load sites & build the greens map/list ------------------------------

async function loadSites() {
  let sites = [];
  try {
    sites = await loadActiveSites();
  } catch (err) {
    console.error("Failed to load sites", err);
  }
  siteGroups = groupSitesByType(sites);
  renderGreensMap();
  renderGreensList();
  refreshCapacityDisplays();
}

function renderGreensMap() {
  const svg = document.getElementById("greens-map");
  svg.innerHTML = "";
  siteGroups.green.forEach(site => {
    const layout = GREEN_LAYOUT[site.number];
    if (!layout) return;
    const ns = "http://www.w3.org/2000/svg";
    const ellipse = document.createElementNS(ns, "ellipse");
    ellipse.setAttribute("cx", layout.cx);
    ellipse.setAttribute("cy", layout.cy);
    ellipse.setAttribute("rx", layout.rx);
    ellipse.setAttribute("ry", layout.ry);
    ellipse.setAttribute("class", "green-shape");
    ellipse.setAttribute("data-site-id", site.id);
    ellipse.setAttribute("tabindex", "0");
    ellipse.setAttribute("role", "button");
    ellipse.setAttribute("aria-label", `${site.name} — toggle selection`);
    // Inline fallback so the map still reads correctly even if styles.css
    // hasn't loaded yet (e.g. mid-deploy) — the CSS class still wins once it's there.
    ellipse.style.cssText = "fill:#E4EBE3;stroke:#B9B3A0;stroke-width:1.5px;cursor:pointer;transition:fill 0.12s,stroke 0.12s;";
    ellipse.addEventListener("click", () => toggleGreen(site.id));
    ellipse.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGreen(site.id); }
    });
    ellipse.addEventListener("mouseenter", () => {
      if (!selectedGreenIds.has(site.id)) { ellipse.style.fill = "#F1E7CE"; ellipse.style.stroke = "#A9822C"; }
    });
    ellipse.addEventListener("mouseleave", () => syncGreenVisuals());
    svg.appendChild(ellipse);

    // A small light "halo" behind the number keeps it legible whatever the
    // shape's fill colour ends up being (selected/unselected/hover).
    const halo = document.createElementNS(ns, "circle");
    halo.setAttribute("cx", layout.cx);
    halo.setAttribute("cy", layout.cy);
    halo.setAttribute("r", 11);
    halo.setAttribute("class", "green-label-halo");
    halo.setAttribute("data-site-id", site.id);
    halo.style.cssText = "fill:#FFFFFF;opacity:0.75;pointer-events:none;";
    svg.appendChild(halo);

    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", layout.cx);
    text.setAttribute("y", layout.cy);
    text.setAttribute("class", "green-label");
    text.setAttribute("data-site-id", site.id);
    text.textContent = site.number;
    text.style.cssText = "pointer-events:none;font-family:var(--font-body,sans-serif);font-size:13px;font-weight:600;fill:#14291D;text-anchor:middle;dominant-baseline:middle;";
    svg.appendChild(text);
  });
  syncGreenVisuals();
}

function renderGreensList() {
  const list = document.getElementById("greens-list");
  list.innerHTML = "";
  siteGroups.green.forEach(site => {
    const row = document.createElement("label");
    row.className = "green-list-row";
    row.innerHTML = `<input type="checkbox" data-site-id="${site.id}"> ${site.number}. ${escapeHtml(site.name)}`;
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) selectedGreenIds.add(site.id);
      else selectedGreenIds.delete(site.id);
      syncGreenVisuals();
      refreshCapacityDisplays();
    });
    list.appendChild(row);
  });
}

function toggleGreen(siteId) {
  if (selectedGreenIds.has(siteId)) selectedGreenIds.delete(siteId);
  else selectedGreenIds.add(siteId);
  syncGreenVisuals();
  refreshCapacityDisplays();
}

function syncGreenVisuals() {
  const allGreensBox = document.getElementById("allGreens");
  const allSelected = siteGroups.green.length > 0 && selectedGreenIds.size === siteGroups.green.length;
  allGreensBox.checked = allSelected;

  document.querySelectorAll("#greens-map .green-shape").forEach(el => {
    const on = selectedGreenIds.has(el.dataset.siteId);
    el.classList.toggle("is-selected", on);
    // Drive the colour directly (rather than relying only on the CSS class)
    // so selection always reads correctly even if the stylesheet is stale.
    el.style.fill = on ? "#1F3D2B" : "#E4EBE3";
    el.style.stroke = on ? "#14291D" : "#B9B3A0";
  });
  document.querySelectorAll("#greens-map .green-label").forEach(el => {
    // The white halo behind each number means it stays legible on any
    // fill colour, so the label itself always stays dark.
    el.style.fill = "#14291D";
  });
  document.querySelectorAll("#greens-map .green-label-halo").forEach(el => {
    const on = selectedGreenIds.has(el.dataset.siteId);
    el.style.opacity = on ? "1" : "0.75";
  });
  document.querySelectorAll("#greens-list input[type=checkbox]").forEach(el => {
    el.checked = selectedGreenIds.has(el.dataset.siteId);
  });
}

document.getElementById("allGreens").addEventListener("change", (e) => {
  selectedGreenIds = new Set(e.target.checked ? siteGroups.green.map(s => s.id) : []);
  syncGreenVisuals();
  refreshCapacityDisplays();
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---- Location toggles -----------------------------------------------------

document.querySelectorAll(".loc-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const loc = btn.dataset.loc;
    if (activeLocs.has(loc)) activeLocs.delete(loc);
    else activeLocs.add(loc);
    btn.classList.toggle("is-active", activeLocs.has(loc));
    document.getElementById(`panel-${loc}`).hidden = !activeLocs.has(loc);
    document.getElementById("locations-error").style.display = "none";
    refreshCapacityDisplays();
  });
});

document.getElementById("pavilionAllDay").addEventListener("change", updatePavilionHours);
document.getElementById("pavilionHourly").addEventListener("change", updatePavilionHours);
function updatePavilionHours() {
  document.getElementById("pavilion-hours").hidden = !document.getElementById("pavilionHourly").checked;
}

document.getElementById("isCommercial").addEventListener("change", refreshCapacityDisplays);

// ---- Capacity display -----------------------------------------------------

async function refreshCapacityDisplays() {
  const isCommercial = document.getElementById("isCommercial").checked;

  if (activeLocs.has("green") && selectedGreenIds.size > 0) {
    const el = document.getElementById("greens-capacity");
    el.textContent = "Checking availability…";
    const usage = await getUsageForSites([...selectedGreenIds]);
    const lines = [...selectedGreenIds].map(id => {
      const site = siteGroups.green.find(s => s.id === id);
      const u = usage[id] || { total: 0, commercial: 0 };
      let line = `${site ? site.name : id}: ${u.total}/${TOTAL_LIMIT} total, ${u.commercial}/${COMMERCIAL_LIMIT} commercial`;
      if (u.total >= TOTAL_LIMIT) line += " — fully booked";
      else if (isCommercial && u.commercial >= COMMERCIAL_LIMIT) line += " — commercial limit reached";
      return line;
    });
    el.textContent = lines.join(" · ");
  } else if (activeLocs.has("green")) {
    document.getElementById("greens-capacity").textContent = "Select at least one green above.";
  }

  if (activeLocs.has("playing_field")) {
    const el = document.getElementById("playing-field-capacity");
    const site = siteGroups.playing_field[0];
    if (site) {
      el.textContent = "Checking availability…";
      const usage = await getUsageForSites([site.id]);
      const u = usage[site.id];
      el.textContent = `${u.total}/${TOTAL_LIMIT} total, ${u.commercial}/${COMMERCIAL_LIMIT} commercial used${u.total >= TOTAL_LIMIT ? " — fully booked" : ""}`;
    } else {
      el.textContent = "The playing field isn't set up yet — the council will confirm availability.";
    }
  }

  if (activeLocs.has("pavilion")) {
    const el = document.getElementById("pavilion-capacity");
    const site = siteGroups.pavilion[0];
    if (site) {
      el.textContent = "Checking availability…";
      const usage = await getUsageForSites([site.id]);
      const u = usage[site.id];
      el.textContent = `${u.total}/${TOTAL_LIMIT} total, ${u.commercial}/${COMMERCIAL_LIMIT} commercial used${u.total >= TOTAL_LIMIT ? " — fully booked" : ""}`;
    } else {
      el.textContent = "The pavilion isn't set up yet — the council will confirm availability.";
    }
  }
}

// ---- Dates -----------------------------------------------------------

function renderDates() {
  const list = document.getElementById("dates-list");
  const empty = document.getElementById("dates-empty");
  dates.sort();
  list.innerHTML = "";
  empty.hidden = dates.length > 0;

  dates.forEach(d => {
    const chip = document.createElement("span");
    chip.className = "date-chip";
    // Inline fallback layout in case the stylesheet hasn't loaded/deployed yet —
    // keeps the chip on one line either way.
    chip.style.cssText = "display:inline-flex;flex-shrink:0;white-space:nowrap;align-items:center;gap:8px;";
    chip.textContent = fmtDateShort(d) + " ";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "Remove date");
    removeBtn.textContent = "×";
    removeBtn.style.cssText = "flex-shrink:0;";
    removeBtn.addEventListener("click", () => {
      dates = dates.filter(x => x !== d);
      renderDates();
    });
    chip.appendChild(removeBtn);
    list.appendChild(chip);
  });
  document.getElementById("dates-error").style.display = "none";
}

function addDate(iso) {
  if (!iso) return;
  if (!dates.includes(iso)) dates.push(iso);
  renderDates();
}

document.getElementById("add-single-date").addEventListener("click", () => {
  const input = document.getElementById("singleDate");
  addDate(input.value);
  input.value = "";
});

document.getElementById("add-weekly-dates").addEventListener("click", () => {
  const weekday = document.getElementById("weeklyDay").value;
  const start = document.getElementById("weeklyStart").value;
  const end = document.getElementById("weeklyEnd").value;
  if (!start || !end) {
    alert("Please choose a start and end date for the weekly range.");
    return;
  }
  const newDates = datesForWeeklyRange(weekday, start, end);
  newDates.forEach(d => { if (!dates.includes(d)) dates.push(d); });
  renderDates();
});

// ---- Submit -----------------------------------------------------------

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
  formError.scrollIntoView({ behavior: "smooth", block: "center" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const otherText = document.getElementById("otherLocation").value.trim();
  const hasFreetext = activeLocs.has("freetext") && otherText;
  const hasGreens = activeLocs.has("green") && selectedGreenIds.size > 0;
  const hasPlayingField = activeLocs.has("playing_field") && siteGroups.playing_field[0];
  const hasPavilion = activeLocs.has("pavilion") && siteGroups.pavilion[0];

  let locationsValid = hasFreetext || hasGreens || hasPlayingField || hasPavilion;
  document.getElementById("locations-error").style.display = locationsValid ? "none" : "block";

  const datesValid = dates.length > 0;
  document.getElementById("dates-error").style.display = datesValid ? "none" : "block";

  if (!locationsValid || !datesValid) {
    if (!locationsValid) document.getElementById("locations-error").scrollIntoView({ behavior: "smooth", block: "center" });
    else document.getElementById("dates-error").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const siteIds = [];
  const siteNames = [];
  const siteTypes = [];
  if (hasGreens) {
    siteGroups.green.forEach(s => {
      if (selectedGreenIds.has(s.id)) { siteIds.push(s.id); siteNames.push(s.name); siteTypes.push("green"); }
    });
  }
  if (hasPlayingField) {
    const s = siteGroups.playing_field[0];
    siteIds.push(s.id); siteNames.push(s.name); siteTypes.push("playing_field");
  }
  if (hasPavilion) {
    const s = siteGroups.pavilion[0];
    siteIds.push(s.id); siteNames.push(s.name); siteTypes.push("pavilion");
  }

  const allGreensSelected = hasGreens && siteGroups.green.length > 0 && selectedGreenIds.size === siteGroups.green.length;

  const isCommercial = document.getElementById("isCommercial").checked;
  const pavilionMode = hasPavilion ? (document.getElementById("pavilionHourly").checked ? "hourly" : "all_day") : null;
  const pavilionStart = pavilionMode === "hourly" ? document.getElementById("pavilionStart").value : null;
  const pavilionEnd = pavilionMode === "hourly" ? document.getElementById("pavilionEnd").value : null;

  if (pavilionMode === "hourly" && (!pavilionStart || !pavilionEnd)) {
    showError("Please give a start and end time for the pavilion hire.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Checking availability…";

  // Re-check capacity at submit time to avoid a stale/raced count.
  try {
    const usage = await getUsageForSites(siteIds);
    for (const id of siteIds) {
      const u = usage[id];
      const name = siteNames[siteIds.indexOf(id)];
      if (u.total + dates.length > TOTAL_LIMIT) {
        showError(`Sorry — "${name}" doesn't have enough capacity left for all the dates you've chosen (limit is ${TOTAL_LIMIT} total uses).`);
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit request";
        return;
      }
      if (isCommercial && u.commercial + dates.length > COMMERCIAL_LIMIT) {
        showError(`Sorry — "${name}" doesn't have enough commercial capacity left for all the dates you've chosen (limit is ${COMMERCIAL_LIMIT} commercial uses).`);
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit request";
        return;
      }
    }
  } catch (err) {
    console.error(err);
    // Non-blocking — let the request through, council can catch it on review.
  }

  submitBtn.textContent = "Submitting…";

  const sortedDates = [...dates].sort();

  const payload = {
    eventTitle: document.getElementById("eventTitle").value.trim(),
    siteIds, siteNames, siteTypes,
    allGreensSelected,
    otherLocationText: hasFreetext ? otherText : "",
    dates: sortedDates,
    firstDate: sortedDates[0],
    lastDate: sortedDates[sortedDates.length - 1],
    pavilionMode, pavilionStart, pavilionEnd,
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

    const statusEl = document.getElementById("confirm-email-status");
    try {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_REQUEST_RECEIVED, {
        to_email: payload.organiserEmail,
        to_name: payload.organiserName,
        reply_to: payload.organiserEmail,
        event_title: payload.eventTitle,
        site_name: siteNames.join(", ") || payload.otherLocationText,
        event_date: fmtDateList(sortedDates),
      });
      statusEl.textContent = "A confirmation email has been sent to you.";
    } catch (err) {
      console.error("EmailJS send failed", err);
      statusEl.textContent = "";
    }
  } catch (err) {
    console.error(err);
    showError("Something went wrong sending your request. Please try again, or contact the parish clerk directly.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit request";
  }
});

renderDates();
loadSites();
