@echo off
chcp 65001 >nul
title ReupManager - Server (dong cua so nay la tat server)
cd /d "%~dp0"
echo.
echo  ============================================================
echo    🎬  ReupManager - dang khoi dong server...
echo  ============================================================
echo.
echo    May NAY (admin) vao:        http://localhost:3000
echo    May KHAC cung wifi vao:     http://192.168.1.88:3000
echo.
echo    Luu y:
echo    - De cua so nay MO thi ca team moi vao duoc.
echo    - Dong cua so = tat server.
echo    - Neu IP 192.168.1.88 doi, xem IP moi bang lenh: ipconfig
echo  ============================================================
echo.
timeout /t 2 >nul
start "" http://localhost:3000
node server.js
echo.
echo  Server da dung. Bam phim bat ky de dong...
pause >nul
