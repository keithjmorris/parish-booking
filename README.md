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
| `firebase-config.js` | Firebase project keys + SDK init (shared by all three pages) |
| `styles.css` | Shared styling |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json` | Security rules & index definitions |
| `vercel.json` | Static hosting config |

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

You can add sites from the dashboard itself (**Sites** tab, once you're
signed in) — no need to do this in the console. Each site just needs a name;
it starts active.

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

## 5. Push to GitHub and connect Vercel

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

## How the booking limits work

Each site is capped at **28 total approved bookings** and **14 approved
commercial bookings**, counted from the `bookings` collection where
`status == 'approved'`. The count is checked live when someone picks a site
on the request form, and re-checked at submission time and again when a
council member clicks Approve (since two requests could be approved out of
order). Rejected and still-pending requests never count towards the limit —
only approved ones do.

This is currently an **all-time running count**, not reset yearly. If you'd
rather it reset each calendar year (e.g. re-open capacity every January),
the easiest change is to add a `year` field to each booking and filter the
capacity queries by the current year — ask and this can be added.

"Other" (free-text) locations are never capacity-checked, since they're not
tracked sites.

## Known limitations / good next steps

- **No automatic emails.** A static site + Firestore can't send email on its
  own. Approving a booking generates the follow-up link and gives you a
  "copy link" / "open in email" button to send it yourself. To automate
  this fully, add a small Vercel serverless function (or a Firebase Cloud
  Function) triggered on a booking's `status` changing to `approved`, using
  an email API such as Resend, Postmark, or SendGrid.
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
- **Multi-day bookings** are supported in the form (`eventDate` /
  `eventEndDate`) but the capacity count treats a multi-day event as a
  single booking, not one-per-day.

## Local testing

Because these are ES modules (`type="module"`), opening the HTML files
directly via `file://` won't work in most browsers. Serve the folder
locally instead, e.g.:

```bash
npx serve .
```

then visit the printed `localhost` URL.
