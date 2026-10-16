# Delipo Marketplace (flat package: NO folders)
Use this package if folders keep getting lost when you upload to GitHub. Every file sits at the top level.

## Method A (recommended): deploy without GitHub
1. Unzip this package.
2. Windows: double-click DEPLOY-WINDOWS.bat (Mac: DEPLOY-MAC.command). It needs Node.js (free, nodejs.org, LTS version).
3. Log in to Vercel in the browser window that opens, then answer: Set up and deploy = Y, Link to existing project = Y, project name = your Delipo project.
4. The window prints a "Production:" address. Open it: the login screen must end with "Delipo v10".
5. Then do the one-time settings (database, admin password, Paystack key) and redeploy.
Any error is printed in plain text in that window.

## Method B: deploy through GitHub

1. Delete everything in your GitHub repository, then upload ALL the files from this package (select all of them). There are no folders to forget.
2. Vercel > Settings > General: leave Root Directory empty, Framework Preset "Other", and turn OFF any Output Directory / Build Command overrides.
3. Vercel > Storage: connect an Upstash Redis database to the project.
4. Vercel > Settings > Environment Variables: PAYSTACK_SECRET_KEY, ADMIN_PASSWORD, ADMIN_KEY, SMS_API_URL, SMS_API_KEY (see .env.example).
5. Redeploy, then open https://YOUR-SITE.vercel.app/api/health : you should see text starting with {"functions":true and "database":true.
6. The login screen should end with "Delipo v10 · live".

If the site still shows an old screen (no "Delipo v10" at the bottom): Vercel > Deployments > top row. "Error" means a file is missing or misnamed: every file in this package must be uploaded. No new row means Vercel > Settings > Git is not watching the branch you uploaded to.
