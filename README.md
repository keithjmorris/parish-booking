# Parish Council Booking System

A three-stage booking workflow for a small local council: public request form →
council approval → follow-up event details (insurance, plan, risk assessment,
payment). Plain HTML/JS, Firestore for data, Firebase Storage for uploaded
documents, deployed as a static site on Vercel.

## Files

| File | Purpose |
|---|---|
| `index.html` / `booking-form.js` | Stage 1 — public booking request form |
| `admin.html` / `admin-dashboard.js` | Stage 2 — council login, approve/reject, sites management |
| `details.html` / `details-form.js` | Stage 3 — follow-up form, reached via emailed link, no login |
| `locations.js` | Shared logic: site types, the greens map layout, capacity counting, date helpers — used by both the public form and the dashboard |
| `firebase-config.js` | Firebase project keys + SDK init (shared by all three pages) |
| `styles.css` | Shared styling |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json` | Security rules & index definitions |
| `vercel.json` | Static hosting config |

## Updating an existing deployment (schema change)

This version changes the shape of a booking — a single site/date has become
a **list of locations** (any mix of greens, the playing field, the
pavilion) and a **list of dates**. Older bookings created before this
change won't match the new shape and will display with blank locations/
dates in the dashboard.

If your existing bookings are just test data, the simplest path is to
clear them out before deploying: **Firebase Console → Firestore Database →
Data tab → `bookings` collection → select all documents → Delete**. Leave
the `sites` and `councilMembers` collections alone — those aren't affected.

Once cleared, follow step 3 below to (re)create your sites with the new
numbered-greens structure, then redeploy the updated files as usual.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. In **Build → Authentication**, enable the **Email/Password** sign-in method.
3. In **Build → Firestore Database**, create a database (production mode).
4. In **Build → Storage**, set up a default bucket.
5. In **Project settings → General → Your apps**, add a **Web app** and copy the
   config object into `firebase-config.js` (replace every `REPLACE_ME`).

This file is safe to commit and be public — it's not a secret. Access is
controlled entirely by `firestore.rules` / `storage.rules`, not by hiding
these keys.

## 2. Add your council (approver) accounts

Each council member gets their own login, as you asked for:

1. **Authentication → Users → Add user** — create an account per person
   (email + password). They can reset their own password later via
   "Forgot password" once you wire that up, or you can set it for them now.
2. Copy each user's **UID** from the Users list.
3. In **Firestore Database**, create a collection called `councilMembers`.
   For each person, add a document whose **document ID is their UID**, with
   fields:
   ```
   name: "Jane Smith"
   email: "jane@example.com"
   ```
   Only accounts with a matching `councilMembers/{uid}` document can sign
   into the dashboard — creating an Auth user alone isn't enough, this is
   the deliberate authorisation step.

## 3. Add your sites

Sign in to the dashboard and open the **Sites** tab. Click **"Create
standard sites"** to set up the whole starting list in one go: 9 numbered
village greens (`Green 1`–`Green 9`), the **Playing Field**, and the
**Pavilion**. You can rename any of them afterwards from the same tab
(click **Rename**) — the greens are deliberately left as plain numbers
so you can settle on names later without touching this setup step again.

If you'd rather add sites one at a time, the same tab has an **"Add a
site"** form with a **Type** selector (Village green / Playing field /
Pavilion / Other). Greens need a **Number**, which is what places them on
the map on the public form — pick any unused number.

A site's **type** decides where it shows up on the public form:
- **Village green** sites appear on the greens map/list under "Village
  green(s)".
- **Playing field** and **Pavilion** each show as their own toggle. If you
  ever add more than one site of either type, the form currently only
  offers the first active one it finds — this app assumes one playing
  field and one pavilion.
- **Other** sites aren't currently reachable from the public form (there's
  no toggle for them) — they exist for future use or historical record only.

## 4. Deploy the security rules and indexes

Install the Firebase CLI once, then deploy from this folder:

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # pick your project
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Without this step the app will still load, but every read/write will be
rejected (Firestore defaults to deny-all), and the capacity-check queries
will fail until the composite indexes exist.

## 5. Set up automatic emails (EmailJS)

Three emails send automatically, all straight from the browser (no server needed):

1. **Request received** — sent the moment someone submits the public booking form, before any council decision.
2. **Booking approved** — sent the moment a council member clicks Approve, containing the follow-up link for insurance/event plan/risk assessment/payment.
3. **Details confirmed** — sent the moment an organiser submits that follow-up form, confirming everything's been received.

Anything beyond that — questions, back-and-forth about the risk assessment, etc. — happens as normal email, since all three templates set Reply-To to the organiser's address.

**Setup:**

1. Create a free account at [emailjs.com](https://www.emailjs.com) (200 emails/month free).
2. **Email Services → Add New Service** — connect a mailbox (Gmail works well). Note the **Service ID**.
3. **Account → General** — copy your **Public Key**.
4. **Email Templates → Create New Template**, three times — once per email below. For each, set:
   - **To Email**: `{{to_email}}`
   - **Reply To**: `{{reply_to}}`
   - **Subject** and **body**: your own wording, using the variables listed below wherever you want that data to appear.
   - Note each template's **Template ID**.

   **Template 1 — request received.** Variables available: `to_email`, `to_name`, `event_title`, `site_name`, `event_date`.

   **Template 2 — booking approved.** Variables available: `to_email`, `to_name`, `event_title`, `site_name`, `event_date`, `start_time`, `end_time`, `follow_up_url`. The body should include `{{follow_up_url}}` as a link/button — that's the whole point of this email.

   **Template 3 — details confirmed.** Variables available: `to_email`, `to_name`, `event_title`, `site_name`, `event_date`.

5. Fill in `emailjs-config.js` with your **Public Key**, **Service ID**, and the three **Template IDs**.

If a send fails (bad config, over the free quota, network issue), nothing breaks — the booking is still saved / approved / detailed in Firestore either way. The request-received and details-confirmed emails fail silently (the on-screen confirmation message is enough either way); the approval email shows a visible warning in the dashboard and lets you copy the link and send it by hand instead. You can also click **Resend email** on any approved booking in the **Approved & upcoming** tab at any time.

## 6. Push to GitHub and connect Vercel

```bash
git init
git add .
git commit -m "Initial parish booking system"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in [vercel.com](https://vercel.com): **New Project → Import** the repo.
No build command or output directory is needed — it's a static site, deploy
as-is. Once deployed:

- Public form: `https://your-project.vercel.app/`
- Council dashboard: `https://your-project.vercel.app/admin.html`

Add `admin.html` to your bookmarks rather than advertising it — it's not
linked from the public form except as a small "Council login" link.

## How locations, dates and the booking limits work

A single booking can now cover **several locations and several dates at
once** — for example, the annual craft fair books all 9 greens plus the
playing field, for one date; the weekly auction books one green, for a
dozen Monday dates across a summer.

On the request form:
- **Village green(s)**, **Playing field**, **Pavilion** and **Somewhere
  else** are independent toggles — any combination can be selected together.
- Greens are chosen on the schematic map (click a green to select/deselect
  it) or from the list underneath, and there's an **"All greens"** shortcut.
  The map is illustrative, not to scale or geographically accurate — see
  `locations.js` → `GREEN_LAYOUT` to adjust the shapes if the real layout
  changes.
- The **Pavilion** is the only location with a time-of-day choice (All day
  or By the hour) — greens and the playing field are always booked for the
  whole day, since in practice bookings are never split by morning/afternoon.
- **Dates** are added individually, or with a **weekly recurring**
  shortcut (day of week + start/end date) that drops the matching Mondays
  (or whichever day) straight into the date list, which can still be edited
  by hand afterwards.

**Capacity limit:** each site (each individual green, the playing field,
the pavilion) is capped at **28 total approved uses** and **14 approved
commercial uses**, counted independently per site. Every date in an
approved booking that includes a given site counts as one use of that
site — so a 12-date weekly booking of Green 1 uses up 12 of Green 1's 28,
and a craft-fair booking of all 9 greens plus the playing field uses 1 of
each of those 10 sites' limits, even though it's a single request. This
applies the same way whether a site was booked on its own or as part of a
multi-site "All greens" request.

The count is checked live as locations/dates are chosen on the request
form, re-checked at submission time, and re-checked again when a council
member clicks Approve (since two requests could be approved out of order).
Rejected and still-pending requests never count towards the limit — only
approved ones do.

This is currently an **all-time running count**, not reset yearly. If you'd
rather it reset each calendar year (e.g. re-open capacity every January),
the easiest change is to filter the capacity queries by year from each
date — ask and this can be added.

The **"Somewhere else"** free-text option is never capacity-checked, since
it's not a tracked site.

## Known limitations / good next steps

- **Emails depend on EmailJS's free tier (200/month)** and on the organiser's browser successfully reaching EmailJS at the moment they click Approve / Submit. Nothing in Firestore depends on the email succeeding — bookings and details are saved regardless — but if you outgrow 200/month or want guaranteed delivery/retries, move sending into a Cloud Function triggered on the Firestore write instead of sending from the browser.
- **Follow-up link security is link-secrecy based, not cryptographically
  enforced.** The emailed link (booking ID + random token) is unguessable,
  and Firestore rules restrict what it can be used to change (only the
  `details` fields on an already-approved booking) — but the underlying
  trust model relies on that link staying private, similar to a
  "password reset" email link. This is proportionate for this app, but if
  you're storing genuinely sensitive data and want stronger guarantees,
  move link issuance and detail submission behind a Cloud Function instead
  of writing to Firestore directly from the browser.
- **No calendar view yet** beyond the "Approved & upcoming" list — could
  add a proper month calendar, or an ICS export council members can add to
  Outlook/Google Calendar.
- **One playing field, one pavilion assumed.** If a second active site of
  either type is ever added, the public form only offers the first one it
  finds — it doesn't currently support choosing between two playing fields,
  say.
- **Greens are numbered, not named,** on purpose — rename them from the
  Sites tab once you've settled on names locally. Numbers stay stable even
  if you rename, so old bookings referencing "Green 3" won't be affected
  by a later rename.

## Local testing

Because these are ES modules (`type="module"`), opening the HTML files
directly via `file://` won't work in most browsers. Serve the folder
locally instead, e.g.:

```bash
npx serve .
```

then visit the printed `localhost` URL.
