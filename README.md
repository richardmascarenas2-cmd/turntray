# Inventory Requests

Tray request, pull, delivery and return tracking for Arthrex Portland. Live at https://turntray.com.

The website is hosted on GitHub Pages. Sign-in and all data (requests, photos, comments, team list) live in Firebase project `inventory-request-b962f`.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app |
| `firebase-config.js` | Tells the app which Firebase project to use. The API key in it is meant to be public; the data is protected by `richies.rules`. |
| `richies.rules` | Copy of the Firestore security rules. Changing this file does nothing on its own. Paste it into Firebase Console → Firestore Database → Rules → Publish. |
| `manifest.webmanifest`, `icon-*.png` | Home Screen name and icons |
| `CNAME` | The custom domain (turntray.com). Don't delete it, or the domain stops working. |
| `.nojekyll` | Tells GitHub Pages to publish the files as they are |

## Important: this repository is public

Everything here can be seen by anyone and is published on turntray.com. Never add exports, backups, spreadsheets or any file with surgeon names, accounts or patient IDs. `.gitignore` blocks the common ones, but uploads through the GitHub website ignore it, so check before you upload.

## Updating the app

Upload the changed file on GitHub (Add file → Upload files → Commit changes). The site updates in a minute or two. Reps may need to close and reopen the app to see the change.

## If sign-in fails on a new address

Add the domain in Firebase Console → Authentication → Settings → Authorized domains.
