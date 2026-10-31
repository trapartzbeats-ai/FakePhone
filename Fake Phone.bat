@echo off
rem Starts the Fake Phone studio and opens it in the browser.
cd /d "%~dp0"
start "" http://localhost:5190
node server.js 5190
