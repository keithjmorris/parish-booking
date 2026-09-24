// locations.js — shared logic for sites, the greens map, and capacity counting.
// Used by both booking-form.js (public form) and admin-dashboard.js.

import { db } from "./firebase-config.js";
import {
  collection, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export const TOTAL_LIMIT = 28;
export const COMMERCIAL_LIMIT = 14;

export const SITE_TYPES = {
  green: "Village green",
  playing_field: "Playing field",
  pavilion: "Pavilion",
  other: "Other",
};

// Fixed schematic layout for up to 9 greens, roughly following the real
// west-to-east run of greens along the street, largest (most-used) green
// at the west end. Purely illustrative — not to scale or geographically
// accurate. Coordinates are in a 760x220 viewBox.
export const GREEN_LAYOUT = {
  1: { cx: 110, cy: 130, rx: 85, ry: 55 },
  2: { cx: 230, cy: 95, rx: 40, ry: 28 },
  3: { cx: 300, cy: 140, rx: 34, ry: 24 },
  4: { cx: 370, cy: 90, rx: 32, ry: 22 },
  5: { cx: 435, cy: 135, rx: 30, ry: 21 },
  6: { cx: 500, cy: 90, rx: 28, ry: 20 },
  7: { cx: 565, cy: 132, rx: 27, ry: 19 },
  8: { cx: 628, cy: 92, rx: 26, ry: 18 },
  9: { cx: 690, cy: 130, rx: 26, ry: 18 },
};

// ---- Loading sites ------------------------------------------------------

export async function loadActiveSites() {
  const snap = await getDocs(
    query(collection(db, "sites"), where("active", "==", true), orderBy("name"))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function groupSitesByType(sites) {
  const groups = { green: [], playing_field: [], pavilion: [], other: [] };
  sites.forEach(s => {
    const type = groups[s.type] ? s.type : "other";
    groups[type].push(s);
  });
  groups.green.sort((a, b) => (a.number || 0) - (b.number || 0));
  return groups;
}

// ---- Capacity counting ---------------------------------------------------

// Sums how many approved-booking "site-days" exist for a given site: every
// date in every approved booking that includes this site counts as one use,
// whether the booking is single-site/single-date or a big multi-site,
// multi-date request. A site is capped independently of every other site.
export async function getSiteUsage(siteId) {
  const bookingsRef = collection(db, "bookings");
  const snap = await getDocs(
    query(bookingsRef, where("siteIds", "array-contains", siteId), where("status", "==", "approved"))
  );

  let total = 0;
  let commercial = 0;
  snap.forEach(docSnap => {
    const b = docSnap.data();
    const dateCount = Array.isArray(b.dates) ? b.dates.length : 1;
    total += dateCount;
    if (b.isCommercial) commercial += dateCount;
  });

  return { total, commercial };
}

export async function getUsageForSites(siteIds) {
  const results = {};
  await Promise.all(siteIds.map(async id => {
    results[id] = await getSiteUsage(id);
  }));
  return results;
}

// ---- Date helpers ---------------------------------------------------------

export function fmtDateShort(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateList(dates) {
  if (!dates || !dates.length) return "";
  if (dates.length === 1) return fmtDateShort(dates[0]);
  if (dates.length <= 4) return dates.map(fmtDateShort).join(", ");
  return `${fmtDateShort(dates[0])} – ${fmtDateShort(dates[dates.length - 1])} (${dates.length} dates)`;
}

// Weekday name (0=Sunday) -> matching ISO dates between start/end inclusive.
export function datesForWeeklyRange(weekday, startIso, endIso) {
  const out = [];
  if (!startIso || !endIso) return out;
  let d = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  if (end < d) return out;
  // Move to the first matching weekday on/after start.
  while (d.getDay() !== Number(weekday)) {
    d.setDate(d.getDate() + 1);
    if (d > end) return out;
  }
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

// ---- Display summary for a booking (used by both form confirmation and admin) --

export function summariseLocations(booking) {
  const parts = [];
  const greenCount = (booking.siteTypes || []).filter(t => t === "green").length;

  if (booking.allGreensSelected) {
    parts.push("All village greens");
  } else if (greenCount > 0) {
    const names = booking.siteNames.filter((_, i) => booking.siteTypes[i] === "green");
    parts.push(names.join(", "));
  }

  (booking.siteNames || []).forEach((name, i) => {
    if (booking.siteTypes[i] !== "green") parts.push(name);
  });

  if (booking.otherLocationText) parts.push(booking.otherLocationText + " (not a listed site)");

  return parts.join(" + ") || "—";
}
