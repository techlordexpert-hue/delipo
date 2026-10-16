# Delipo Marketplace

## Method A (recommended): deploy without GitHub
1. Unzip this package.
2. Windows: double-click DEPLOY-WINDOWS.bat (Mac: DEPLOY-MAC.command). It needs Node.js (free, nodejs.org, LTS version).
3. Log in to Vercel in the browser window that opens, then answer: Set up and deploy = Y, Link to existing project = Y, project name = your Delipo project.
4. The window prints a "Production:" address. Open it: the login screen must end with "Delipo v10".
5. Then do the one-time settings below (database, admin password, Paystack key) and redeploy.
Any error is printed in plain text in that window.

## Method B: deploy through GitHub
## If the site still shows an old screen
The "Almost ready" screen and the login screen both end with the text "Delipo v10". If you do not see v10, an old copy is live.
Open Vercel > your project > Deployments and look at the top row:
- Ready: it is deployed. Hard refresh the site (on a phone close the tab and reopen it).
- Error: click it and read the red message; fix it, then upload again.
- No new row after you committed on GitHub: Vercel > Settings > Git must show your repository, and its Production Branch must be the branch you uploaded to.

## One-minute test (do this first)
After deploying, open `https://YOUR-SITE.vercel.app/api/health` in the browser.
- You see text starting with `{"functions":true` : the backend is deployed. Check `"database":true`.
- You see a 404 page: the `api` folder is not in the repository root. Upload the `api` folder itself (drag the folder, not the files inside it) and redeploy.
In Vercel > Settings > General, Root Directory must be empty. If a deployment shows "Error", open it and read the message: a missing `api/db.js` is reported there.

## Plan B
If folders keep getting lost on upload, use the separate package `delipo-flat.zip`: it has no folders at all.

## Upload checklist (what your GitHub repository must look like)
The files below must sit at the TOP LEVEL of the repository (not inside another folder):
```
api/            (db.js, health.js, paystack-init.js, paystack-verify.js, sms.js)
public/         (index.html, config.js, logo.png)
package.json
vercel.json
.env.example
README.md
```
Delete anything else from the repository (an old index.html at the top level, a folder called "delipo", old api files), then redeploy.

Static front-end (`public/`) + Vercel serverless functions (`api/`) + a shared Redis database.
Stores, products, accounts, chats, orders and payments are shared across every device.

## Deploy on Vercel (one time)
1. Upload the files listed in the checklist above to GitHub, replacing old ones.
2. In Vercel open your project > **Storage** > Create Database > **Upstash Redis** (free plan is fine) > connect it to the project. This adds the database variables automatically.
3. Project > Settings > **Environment Variables**, add the values listed in `.env.example`:
   `PAYSTACK_SECRET_KEY`, `ADMIN_PASSWORD`, `ADMIN_KEY`, and the SMS values.
   Secret keys go ONLY here, never in the code or in a README.
4. **Redeploy** (Deployments > the latest > Redeploy).
5. Open the site. The login screen shows "Delipo v10 · live". If it says "demo mode", the database is not connected yet.
6. Log in as admin (username `yo!` or your `ADMIN_USER`, with `ADMIN_PASSWORD`; or type `ADMIN_KEY` in either box), open Settings > **System check**, then change the admin password.

## If stores or products do not show on other devices
Look at the small text at the bottom of the login screen:
- "Delipo v10 · live": sharing is on. Wait a few seconds or reload; the app refreshes itself every 12 seconds.
- "demo mode": that page is a preview or the database is not connected, so data stays on that device. The Claude preview link is always demo mode.
- "Almost ready" screen: the database or the api folder is missing. Press "Check server status".
- No "v9" text: an old copy is still deployed. Upload every file again and redeploy.

## Live updates, chat monitoring and fraud controls
- Every open device checks a tiny version number about every 3 seconds (every 15 seconds when idle, paused when the tab is hidden) and reloads only when something changed. A new store, product, order or chat therefore shows on all devices within a few seconds. Each check is one small Redis command; a busy site may need Upstash's pay-as-you-go plan.
- Admin > Chats shows every conversation between shopkeepers and customers. The server automatically flags messages that contain phone numbers, mobile money, WhatsApp/Telegram, links or talk of paying outside Delipo. Use "Flagged" to review them, then Suspend store or Suspend customer from the chat.
- Admin > Orders: set a suspicious order to Suspended (or Refunded after you refund it in Paystack). Sellers cannot change held orders. Suspended stores disappear from the market and cannot take orders; suspended customers are signed out on every device.

## Admin-published content
Anything the admin publishes (stores, slideshow slides, announcements, prices, verification) is stored in the shared database and appears on every device within seconds. Admin > Slideshow publishes the big slides at the top of the market.

## No automatic data
The site never creates stores, products or accounts by itself. The market starts empty; only the admin (Admin > New Store) or users (Account > Rent a Store) create stores.

## How it works
- Accounts: passwords are stored hashed on the server. Sessions last 30 days.
- Payments: Paystack window opens with the public key in `public/config.js`. After paying, the server asks Paystack to confirm the payment, recalculates the price from the database, checks the buyer's email and only then creates the order or the store. A payment reference can be used once.
- Orders and rent payments are visible to the admin (Orders and Revenue tabs) and in your Paystack dashboard.
- Chats are per customer and store. The admin can read and join every chat.

## Limits to know
- Product photos are stored in the database (small, compressed). For hundreds of products move photos to file storage.
- Store rent has no expiry reminders yet.
