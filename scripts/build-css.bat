@echo off
cd /d "%~dp0.."
call npm run build:css
if errorlevel 1 (
  echo Tailwind 构建失败
  pause
  exit /b 1
)
echo Tailwind 构建完成: static\tailwind.css
pause
