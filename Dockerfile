# Dockerfile — Plataforma Interativa de Quizzes & Eventos FNAC (Staging / Produção NAS)
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV ASTRO_TELEMETRY_DISABLED=1
RUN npm run build

# Imagem final leve de Produção / Staging
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4321
ENV HOST=0.0.0.0

# Copiar artefactos compilados e motor backend (SQLite nativo + XLSX + QR SVG)
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.mjs ./server.mjs
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/public ./public
COPY --from=builder /app/resultados*.xlsx ./

# Pasta persistente para a base de dados SQLite e fusões do Leaderboard
RUN mkdir -p /app/.slido-data

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4321/api/health || exit 1

CMD ["node", "server.mjs"]
