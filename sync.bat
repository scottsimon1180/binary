@echo off
cd /d "%~dp0"
git add -A
git commit -m "Sync %date% %time%"
git push origin main --force
pause
