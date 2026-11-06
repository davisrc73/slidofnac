#!/usr/bin/env bash
# scripts/deploy-nas.sh — Sincroniza o código no Synology NAS via Git e executa update-nas.sh
set -euo pipefail

if [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi

NAS_HOST="${NAS_HOST:-192.168.68.117}"
NAS_USER="${NAS_USER:-davis.correia}"
NAS_SSH_PORT="${NAS_SSH_PORT:-22}"
NAS_DEPLOY_PATH="${NAS_DEPLOY_PATH:-/volume1/docker/slidofnac}"
REPO_URL="https://github.com/davisrc73/slidofnac.git"

echo "🚀 A sincronizar repositório GitHub no NAS (${NAS_USER}@${NAS_HOST}:${NAS_DEPLOY_PATH})..."

ssh -p "${NAS_SSH_PORT}" "${NAS_USER}@${NAS_HOST}" "
  export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\$PATH
  if [ ! -d '${NAS_DEPLOY_PATH}/.git' ]; then
    rm -rf '${NAS_DEPLOY_PATH}'
    git clone '${REPO_URL}' '${NAS_DEPLOY_PATH}'
  else
    cd '${NAS_DEPLOY_PATH}'
    git fetch origin main
    git reset --hard origin/main
  fi
  cd '${NAS_DEPLOY_PATH}'
  mkdir -p data/prod data/staging backups logs
  if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
  fi
  if docker info >/dev/null 2>&1; then
    bash scripts/update-nas.sh --force
  elif sudo -n docker info >/dev/null 2>&1; then
    sudo bash scripts/update-nas.sh --force
  else
    echo '✅ Repositório sincronizado em ${NAS_DEPLOY_PATH}!'
    echo 'ℹ️  Para compilar/subir os contentores Docker no Synology DSM:'
    echo '   - No Agendador de Tarefas do DSM (como root): bash /volume1/docker/slidofnac/scripts/update-nas.sh --force'
    echo '   - Ou via SSH: cd /volume1/docker/slidofnac && sudo bash scripts/update-nas.sh --force'
  fi
"
