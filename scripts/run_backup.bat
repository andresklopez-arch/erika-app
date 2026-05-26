@echo off
echo ========================================================
echo     INICIANDO RESPALDO DE BASE DE DATOS DE ERIKA
echo ========================================================
echo.
cd ..
node scripts/backup_supabase.js
echo.
echo Presiona cualquier tecla para salir...
pause >nul
