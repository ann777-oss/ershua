@echo off
chcp 65001 >nul
set PATH=d:\知乎黑客松\tools\node-v20.18.0-win-x64;d:\知乎黑客松\tools\mingit\cmd;%PATH%
cd /d d:\知乎黑客松\game
echo [二刷] 开发环境启动中：前端 http://localhost:5173 ｜ 后端 http://localhost:3001
npm run dev
