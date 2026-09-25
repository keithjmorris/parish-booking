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

// Greens map background image, its natural pixel size (this is also the
// SVG viewBox used to overlay the clickable shapes below), and one
// clickable polygon per green traced from that image — largest
// (most-used) green at the west/left end, matching the real layout.
// If the artwork is ever replaced, re-trace the shapes and regenerate
// this block (ask Claude — it can do this from a new image).
export const GREEN_MAP_IMAGE = "greens-map.png";
export const GREEN_MAP_VIEWBOX = { width: 1800, height: 619 };

export const GREEN_LAYOUT = {
  1: { points: [[392,289],[0,293],[0,587],[155,465],[285,408]], labelX: 142.6, labelY: 388.1 },
  2: { points: [[588,435],[575,430],[306,499],[209,538],[145,580],[134,596],[180,597],[451,525],[589,498],[594,484]], labelX: 386.1, labelY: 511.9 },
  3: { points: [[564,274],[557,269],[494,280],[476,287],[450,310],[392,373],[392,379],[399,381],[565,340],[570,334],[570,315]], labelX: 495.1, labelY: 323.6 },
  4: { points: [[850,462],[807,415],[783,394],[648,416],[644,421],[653,485],[657,492],[739,478],[846,468]], labelX: 736.3, labelY: 443.1 },
  5: { points: [[1149,209],[1113,144],[1089,130],[1029,132],[883,158],[799,180],[624,250],[619,268],[626,317],[632,325],[850,290],[1041,247]], labelX: 883.6, labelY: 224.1 },
  6: { points: [[1017,426],[1012,358],[1005,348],[858,379],[858,387],[913,445],[928,454],[999,440],[1011,434]], labelX: 948.8, labelY: 400.9 },
  7: { points: [[1211,303],[1198,294],[1184,294],[1065,334],[1064,354],[1075,424],[1091,424],[1152,408],[1247,389],[1250,384],[1248,372]], labelX: 1151.3, labelY: 360.2 },
  8: { points: [[1520,258],[1454,201],[1439,199],[1264,266],[1258,271],[1258,277],[1304,359],[1316,369],[1328,370],[1371,355],[1450,318],[1519,266]], labelX: 1384.9, labelY: 282.4 },
  9: { points: [[1799,20],[1656,97],[1539,153],[1537,163],[1584,189],[1651,201],[1719,197],[1799,174]], labelX: 1698.2, labelY: 132.2 },
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
