
@echo off
title PulseCast Radio Server

cd /d C:\pulsecast-radio

echo Starting Icecast and Liquidsoap...
docker compose up -d

echo.
echo PulseCast Radio is starting!
echo.
echo Icecast: http://localhost:8000
echo Stream:  http://localhost:8000/pulsecast.mp3
echo.

pause
