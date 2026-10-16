#!/bin/bash
cd "$(dirname "$0")"
echo "DELIPO - deploy to Vercel (no GitHub needed)"
if ! command -v node >/dev/null 2>&1; then echo "Install Node.js (LTS) from https://nodejs.org then run this again."; read -p "Press Enter"; exit 1; fi
echo "When asked: Set up and deploy? Y.  Link to existing project? Y.  Project name = your Delipo project."
npx --yes vercel@latest --prod
echo "Open the Production address printed above and look for 'Delipo v10' at the bottom of the login screen."
read -p "Press Enter to close"
