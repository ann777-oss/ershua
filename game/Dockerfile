# 二刷 · 生产镜像（单端口 3001：静态页 + API；DEEPSEEK_API_KEY 由部署平台环境变量注入）
FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

ENV PORT=3001 NODE_ENV=production
EXPOSE 3001
CMD ["node", "server/index.js"]
