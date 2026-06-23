@echo off
chcp 65001 > nul
echo ==================================================
echo 수파베이스 음원 로컬 동기화 및 깃허브 배포를 시작합니다...
echo ==================================================

echo 1. 수파베이스에서 로컬로 파일 다운로드 및 DB 업데이트 중...
cd backend
node sync_assets.js
if %ERRORLEVEL% neq 0 (
    echo [오류] 동기화 과정에서 에러가 발생했습니다.
    pause
    exit /b %ERRORLEVEL%
)

echo 2. 깃허브 업로드 진행 중...
cd ..
git add .
git commit -m "sync: 수파베이스 음원 로컬 동기화"
git push origin main

echo ==================================================
echo 동기화 및 배포가 성공적으로 완료되었습니다!
echo ==================================================
pause
