# syntax=docker/dockerfile:1
# ToolWarden: the gateway, its dashboard and the demo MCP servers, in one image.
#   docker build -t toolwarden .

# ---- build: server (TypeScript) and dashboard (React + Vite) -----------------------
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json web/
RUN npm --prefix web ci
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
RUN npx tsc -p tsconfig.json && npm --prefix web run build

# ---- run: production dependencies only, non-root ------------------------------------
FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 TOOLWARDEN_CONFIG=/app/toolwarden.config.json \
    AUDIT_FILE=/data/audit.jsonl PINS_FILE=/data/pins.json PINS_SEED=/app/pins.json
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir /data && chown node:node /data
COPY --from=build /src/dist ./dist
COPY --from=build /src/web/dist ./web/dist
COPY toolwarden.config.json pins.json ./
USER node
EXPOSE 8090
VOLUME /data
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget -qO- http://127.0.0.1:8090/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
