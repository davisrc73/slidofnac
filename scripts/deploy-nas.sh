#!/usr/bin/env bash
# scripts/deploy-nas.sh — Script Automatizado de Deploy para o NAS (Staging / Produção)
set -euo pipefail

# Carregar variáveis do ficheiro .env se existir
if [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi

TARGET_ENV="${1:-prod}" # prod | staging | both
NAS_HOST="${NAS_HOST:-}"
NAS_USER="${NAS_USER:-admin}"
NAS_SSH_PORT="${NAS_SSH_PORT:-22}"
NAS_DEPLOY_PATH="${NAS_DEPLOY_PATH:-/volume1/docker/slidofnac}"
PROD_PORT="${PROD_PORT:-4321}"
STAGING_PORT="${STAGING_PORT:-4322}"

if [ -z "$NAS_HOST" ]; then
  echo "⚠️  NAS_HOST não está definido. Configure o ficheiro .env (cp .env.example .env) com o IP/Host do seu NAS."
  exit 1
fi

echo "🚀 A iniciar deploy [${TARGET_ENV}] para ${NAS_USER}@${NAS_HOST}:${NAS_DEPLOY_PATH}..."

# 1. Criar pasta remota e fazer backup preventivo da base de dados SQLite no NAS
ssh -p "${NAS_SSH_PORT}" "${NAS_USER}@${NAS_HOST}" "
  mkdir -p '${NAS_DEPLOY_PATH}/data/prod' '${NAS_DEPLOY_PATH}/data/staging' '${NAS_DEPLOY_PATH}/backups'
  TIMESTAMP=\$(date +%Y%m%d_%H%M%S)
  if [ -f '${NAS_DEPLOY_PATH}/data/prod/quiz-platform.sqlite' ]; then
    cp '${NAS_DEPLOY_PATH}/data/prod/quiz-platform.sqlite' '${NAS_DEPLOY_PATH}/backups/quiz-prod-\${TIMESTAMP}.sqlite'
    echo '💾 Backup SQLite Produção criado em backups/quiz-prod-'\"\${TIMESTAMP}\"'.sqlite'
  fi
"

# 2. Sincronizar ficheiros do projeto via rsync (excluindo node_modules e dados locais)
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.astro' \
  --exclude '.git' \
  --exclude '.slido-data' \
  --exclude 'data' \
  --exclude 'backups' \
  --exclude '.env' \
  -e "ssh -p ${NAS_SSH_PORT}" \
  ./ "${NAS_USER}@${NAS_HOST}:${NAS_DEPLOY_PATH}/"

# Se existir .env local, envia também para o NAS
if [ -f ".env" ]; then
  scp -P "${NAS_SSH_PORT}" .env "${NAS_USER}@${NAS_HOST}:${NAS_DEPLOY_PATH}/.env"
fi

# 3. Construir e arrancar os contentores Docker no NAS
ssh -p "${NAS_SSH_PORT}" "${NAS_USER}@${NAS_HOST}" "
  cd '${NAS_DEPLOY_PATH}'
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD='docker-compose'
  else
    COMPOSE_CMD='docker compose'
  fi

  if [ '${TARGET_ENV}' = 'staging' ]; then
    \$COMPOSE_CMD --profile staging up -d --build slidofnac-staging
  elif [ '${TARGET_ENV}' = 'both' ]; then
    \$COMPOSE_CMD --profile staging up -d --build
  else
    \$COMPOSE_CMD up -d --build slidofnac-prod
  fi
"

echo "✅ Deploy concluído!"
echo "🔗 Produção: http://${NAS_HOST}:${PROD_PORT}"
if [ "${TARGET_ENV}" = "staging" ] || [ "${TARGET_ENV}" = "both" ]; then
  echo "🔗 Staging:  http://${NAS_HOST}:${STAGING_PORT}"
fi
