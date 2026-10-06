# TurnTray

Tray request, pull, delivery and return tracking, for many agencies. Live at https://turntray.com.

The website is hosted on GitHub Pages. Sign-in and all data (requests, photos, comments, team lists) live in Firebase project `inventory-request-b962f`.

## How agencies work

- Everyone uses the same site. When someone signs in, TurnTray looks up which agency their email belongs to and opens that agency. Nobody picks from a list, and nobody can see another agency's data (the security rules enforce this, not just the app).
- **New agency:** on the sign-in page, *Register your agency*. They create an account, fill in a short form and become that agency's first admin. The agency waits as **pending** until the owner approves it.
- **Owner** (richardmascarenas2@gmail.com): gear menu → **Agencies** lists every agency. Approve or decline new ones, suspend one, or **Open** any agency to see it as its admin.
- **Agency admins:** gear menu → **Setup** for the agency name, their own logos (Inventory and Biologics), territories, accounts, trays and biologics stock. Lists can be typed in or imported from Excel / Google Sheets (paste, .csv or .xlsx). Gear menu → **Team** adds people by email (one agency per email).
- **Paid access:** approving an agency starts a free trial (length set under Agencies → Billing). After it ends, the agency's admin sees a Subscribe button that opens the owner's Stripe payment link, tagged with the agency id. When Stripe reports a payment, the owner taps **Mark paid** (adds a month). **Give free access** lets an agency use TurnTray without paying (Arthrex Portland has it). The security rules enforce this, not just the app.
- **Images:** agencies without their own logos get the plain TurnTray icons (`icon-*.png`, `bio-icon-*.png`). Portland's original images live in `brands/portland/`.

Data layout in Firestore:

| Path | What it is |
| --- | --- |
| `directory/{email}` | Which agency a person belongs to |
| `agencies/{id}` | The agency's name, status (pending / active / rejected) and accounts |
| `agencies/{id}/members`, `users`, `requests`, `prefCards`, `inventory`, `bio…`, `meta` | Everything the app stores, one set per agency |

## Files

| File | What it is |
| --- | --- |
| `index.html` | Inventory Requests app, sign-in, agency sign-up and the owner's Agencies page |
| `bio.html` | Biologics app |
| `agency.js` | Finds each person's agency and points the app at that agency's data |
| `migrate.js` | One-time copy of the original Portland data into an agency (owner only, done) |
| `setup.js` | The Setup page: logos, territories, accounts, trays, biologics import |
| `brands/portland/` | Arthrex Portland's own logos and pop-up image |
| `firebase-config.js` | Tells the app which Firebase project to use. The API key in it is meant to be public; the data is protected by `richies.rules`. |
| `richies.rules` | Copy of the Firestore security rules. Changing this file does nothing on its own. Paste it into Firebase Console → Firestore Database → Rules → Publish. |
| `sw.js` | Keeps a saved copy of the app on each device for networks that block turntray.com |
| `manifest.webmanifest`, `bio.webmanifest`, `icon-*.png`, `bio-icon-*.png` | Home Screen names and icons |
| `CNAME` | The custom domain (turntray.com). Don't delete it, or the domain stops working. |
| `beta/` | Test copy of the multi-agency version, at turntray.com/beta/ (only during the switch-over) |

## Switching Portland over to agencies

1. **Publish the new rules.** Paste `richies.rules` into Firebase Console → Firestore → Rules → Publish. They still allow the current app, so nothing changes for the team yet.
2. **Trial.** Open https://turntray.com/beta/ signed in as the owner. You land in "TurnTray admin". Gear → Agencies → *Copy Portland's current data* into `portland-test` (leave "Send the Portland team here" unticked). Open `portland-test` from the list and check requests, photos, Schedule, Returns, Biologics and Team look right. Try registering a test agency with another email and approving it.
3. **Switch-over** (pick a quiet time). Copy into `portland` with "Send the Portland team here" ticked, then publish the new version at the root of the site (merge the pull request). Portland users sign in as usual and land in Portland.
4. **Lock the old data.** Once Portland is confirmed working, delete the "Old single-agency data" section from `richies.rules` and publish again.
5. Delete `portland-test` and the `beta/` folder.

The hourly Google Sheet sync keeps working after the switch: it signs in as the owner and always writes into the owner's own agency (Portland), even if the owner has another agency open on that device.

## Important: this repository is public

Everything here can be seen by anyone and is published on turntray.com. Never add exports, backups, spreadsheets or any file with surgeon names, accounts or patient IDs. `.gitignore` blocks the common ones, but uploads through the GitHub website ignore it, so check before you upload.

## Updating the app

Upload the changed file on GitHub (Add file → Upload files → Commit changes). The site updates in a minute or two. Reps may need to close and reopen the app to see the change.

## If sign-in fails on a new address

Add the domain in Firebase Console → Authentication → Settings → Authorized domains.
