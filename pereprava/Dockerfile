# Переправа: одна сборка — два образа.
#   target server — игровой сервер на Node.js (WebSocket /ws, /health)
#   target web    — nginx: собранный клиент + прокси /ws на сервер
# Сборка: docker compose build (см. docker-compose.yml и DEPLOY.md)

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production PORT=8787
# Из зависимостей на сервере нужен только ws — остальное собрано в один файл
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund ws@8.18.3 && npm cache clean --force
COPY --from=build /src/packages/server/dist/server.js ./server.mjs
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1
CMD ["node", "server.mjs"]

FROM nginx:1.27-alpine AS web
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/00-pereprava.sh /docker-entrypoint.d/00-pereprava.sh
COPY deploy/nginx/*.conf.in /etc/nginx/pereprava/
RUN chmod +x /docker-entrypoint.d/00-pereprava.sh && mkdir -p /var/www/certbot
COPY --from=build /src/packages/client/dist /usr/share/nginx/html
EXPOSE 80 443
