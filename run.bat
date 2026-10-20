@echo off
cd /d "%~dp0"
py -m pip install -r requirements.txt -q
py emg_overlay.py %*
if errorlevel 1 pause
