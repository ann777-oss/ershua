@echo off
chcp 65001 >nul
set PATH=d:\知乎黑客松\tools\node-v20.18.0-win-x64;d:\知乎黑客松\tools\mingit\cmd;%PATH%
cd /d d:\知乎黑客松\game
if not exist dist (
  echo [二刷] 未发现构建产物，先执行 vite build ...
  call npm run build || goto :err
)
echo [二刷] 生产模式启动：http://localhost:3001  （单端口：静态页 + API）
echo [二刷] API Key 从 game\.env 读取；LLM 不可用时自动降级离线剧本模式
node server/index.js
goto :eof
:err
echo [二刷] 构建失败，请检查前端代码后重试
pause
