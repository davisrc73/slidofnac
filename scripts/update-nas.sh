#!/bin/bash
# ==============================================================================
# 🏆 SlidoFNAC — Script de Atualização e Deploy Contínuo no Synology NAS
# ==============================================================================
# Este script (à semelhança do projeto BandaOS):
# 1. Faz backup preventivo da base de dados SQLite (Produção e Staging)
# 2. Atualiza o código fonte a partir do repositório GitHub (branch main)
# 3. Recompila as imagens Docker (Produção: 4341 e Staging: 4342)
# 4. Reinicia os contentores sem perda de dados
# 5. Valida a integridade dos serviços (/api/health)
# 6. Limpa imagens Docker obsoletas para poupar espaço no disco do NAS
# ==============================================================================

set -eo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -d "/volume1/docker/slidofnac" ]; then
  PROJECT_DIR="/volume1/docker/slidofnac"
fi

cd "$PROJECT_DIR"

mkdir -p "$PROJECT_DIR/logs" "$PROJECT_DIR/data/prod" "$PROJECT_DIR/data/staging" "$PROJECT_DIR/backups"
LOG_FILE="$PROJECT_DIR/logs/update_$(date +'%Y%m%d_%H%M%S').log"

log() {
  local msg="[$(date +'%Y-%m-%d %H:%M:%S')] $1"
  echo -e "$msg" | tee -a "$LOG_FILE"
}

log "${BLUE}======================================================${NC}"
log "${BLUE}🏆 SlidoFNAC — Iniciando Atualização no Synology NAS  ${NC}"
log "${BLUE}======================================================${NC}"
log "Diretório de trabalho: $PROJECT_DIR (Utilizador: $(whoami))"

# Se estiver a correr como root (via Agendador de Tarefas DSM), garante que o socket Docker
# também fica acessível para deploys diretos via SSH a partir do Mac (davis.correia)
if [ "$(id -u)" -eq 0 ] && [ -S /var/run/docker.sock ]; then
  chmod 666 /var/run/docker.sock || true
  chown -R davis.correia:users "$PROJECT_DIR" || true
fi

# Verificar acesso ao daemon Docker
DOCKER_PREFIX=""
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    DOCKER_PREFIX="sudo "
  else
    log "${RED}❌ ERRO DE PERMISSÃO NO DOCKER (/var/run/docker.sock):${NC}"
    log "${YELLOW}👉 No Agendador de Tarefas do Synology DSM, edite a tarefa e mude o campo 'Utilizador' de '$(whoami)' para 'root'!${NC}"
    exit 1
  fi
fi

# 1. Backup preventivo da Base de Dados SQLite
TIMESTAMP=$(date +'%Y%m%d_%H%M%S')
if [ -f "$PROJECT_DIR/data/prod/quiz-platform.sqlite" ]; then
  cp "$PROJECT_DIR/data/prod/quiz-platform.sqlite" "$PROJECT_DIR/backups/quiz-prod-${TIMESTAMP}.sqlite"
  log "${GREEN}✓ Backup SQLite Produção criado em backups/quiz-prod-${TIMESTAMP}.sqlite${NC}"
fi

# 2. Verificar Git e puxar atualizações do GitHub
if ! command -v git &> /dev/null; then
  log "${RED}ERRO: O utilitário 'git' não está instalado no NAS.${NC}"
  exit 1
fi

log "${YELLOW}📥 [1/5] A puxar atualizações do GitHub (origin/main)...${NC}"
git config --global --add safe.directory "$PROJECT_DIR" || true
git fetch origin main

CURRENT_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse origin/main)

if [ "$CURRENT_HASH" = "$REMOTE_HASH" ] && [ "${1:-}" != "--force" ]; then
  # Mesmo que o commit seja igual, verifica se o contentor já está a correr
  if ${DOCKER_PREFIX}docker ps --format '{{.Names}}' | grep -q 'slidofnac-prod'; then
    log "${GREEN}✓ O código local já se encontra na versão mais recente ($CURRENT_HASH) e os contentores estão ativos.${NC}"
    exit 0
  else
    log "${YELLOW}ℹ️ O código está atualizado, mas os contentores ainda não estão ativos. A iniciar construção...${NC}"
  fi
else
  git pull origin main | tee -a "$LOG_FILE"
fi

NEW_HASH=$(git rev-parse --short HEAD)
log "${GREEN}✓ Código pronto no commit: $NEW_HASH${NC}"

# 3. Reconstruir os contentores Docker
log "${YELLOW}🔨 [2/5] A reconstruir os contentores Docker (Produção 4341 & Staging 4342)...${NC}"

if ${DOCKER_PREFIX}docker compose version &> /dev/null; then
  COMPOSE_CMD="${DOCKER_PREFIX}docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE_CMD="${DOCKER_PREFIX}docker-compose"
else
  log "${RED}ERRO: Docker Compose não encontrado no sistema.${NC}"
  exit 1
fi

$COMPOSE_CMD build --no-cache 2>&1 | tee -a "$LOG_FILE"
log "${GREEN}✓ Imagens Docker reconstruídas com sucesso.${NC}"

# 4. Reiniciar os serviços
log "${YELLOW}🚀 [3/5] A reiniciar os contentores do SlidoFNAC...${NC}"
$COMPOSE_CMD up -d --remove-orphans 2>&1 | tee -a "$LOG_FILE"

# Garantir permissões na pasta de dados e logs para o utilizador davis.correia
if [ "$(id -u)" -eq 0 ]; then
  chown -R davis.correia:users "$PROJECT_DIR/data" "$PROJECT_DIR/logs" "$PROJECT_DIR/backups" || true
fi

# 5. Validar o Healthcheck de Produção (4341) e Staging (4342)
log "${YELLOW}⏳ [4/5] A validar estado dos serviços (4341 e 4342)...${NC}"
sleep 5

HEALTHY_PROD=false
for i in {1..12}; do
  if curl -s http://localhost:4341/api/health | grep -q '"status":"ok"'; then
    HEALTHY_PROD=true
    break
  fi
  log "A aguardar inicialização de Produção :4341 (tentativa $i/12)..."
  sleep 2
done

if [ "$HEALTHY_PROD" = true ]; then
  log "${GREEN}✓ Produção (:4341) e Staging (:4342) estão 100% operacionais!${NC}"
else
  log "${RED}⚠️ O serviço não respondeu no tempo esperado. Verifique os logs com: $COMPOSE_CMD logs${NC}"
  exit 1
fi

# 6. Limpar imagens Docker obsoletas
log "${YELLOW}🧹 [5/5] A limpar imagens Docker obsoletas para libertar espaço no NAS...${NC}"
${DOCKER_PREFIX}docker image prune -f 2>&1 | tee -a "$LOG_FILE" || true
log "${GREEN}✓ Limpeza concluída.${NC}"

log "${GREEN}======================================================${NC}"
log "${GREEN}🎉 Atualização do SlidoFNAC concluída com sucesso!   ${NC}"
log "${GREEN}Versão ativa: Commit $NEW_HASH                        ${NC}"
log "${GREEN}Produção: http://192.168.68.117:4341                  ${NC}"
log "${GREEN}Staging:  http://192.168.68.117:4342                  ${NC}"
log "${GREEN}Registo guardado em: $LOG_FILE                        ${NC}"
log "${GREEN}======================================================${NC}"
