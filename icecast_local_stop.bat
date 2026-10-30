
@echo off
title Stop PulseCast Radio

cd /d C:\pulsecast-radio

docker compose down

echo PulseCast Radio stopped.
pause
