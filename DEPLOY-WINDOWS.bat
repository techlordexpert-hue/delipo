@echo off
cd /d "%~dp0"
echo.
echo  DELIPO - deploy to Vercel (no GitHub needed)
echo  ---------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. Install the LTS version from https://nodejs.org , then double-click this file again.
  pause
  exit /b
)
echo  A browser window will open so you can log in to Vercel.
echo  When asked: Set up and deploy? = Y.  Link to existing project? = Y.  Project name = your Delipo project name.
echo.
call npx --yes vercel@latest --prod
echo.
echo  If you see "Production:" with a web address above, it worked. Open that address and look for "Delipo v13" at the bottom of the login screen.
echo  If you see a red error, copy all the text above and send it to your developer.
pause
