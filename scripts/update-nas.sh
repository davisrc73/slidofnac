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

set -e

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
log "Diretório de trabalho: $PROJECT_DIR"

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
git fetch origin main

CURRENT_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse origin/main)

if [ "$CURRENT_HASH" = "$REMOTE_HASH" ] && [ "${1:-}" != "--force" ]; then
  log "${GREEN}✓ O código local já se encontra na versão mais recente ($CURRENT_HASH).${NC}"
  log "Para forçar a reconstrução mesmo sem alterações, use: bash scripts/update-nas.sh --force"
  log "${BLUE}Atualização concluída com sucesso.${NC}"
  exit 0
fi

git pull origin main | tee -a "$LOG_FILE"
NEW_HASH=$(git rev-parse --short HEAD)
log "${GREEN}✓ Código atualizado com sucesso para o commit: $NEW_HASH${NC}"

# 3. Reconstruir os contentores Docker
log "${YELLOW}🔨 [2/5] A reconstruir os contentores Docker (Produção 4341 & Staging 4342)...${NC}"

if docker compose version &> /dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE_CMD="docker-compose"
else
  log "${RED}ERRO: Docker Compose não encontrado no sistema.${NC}"
  exit 1
fi

$COMPOSE_CMD build --no-cache | tee -a "$LOG_FILE"
log "${GREEN}✓ Imagens Docker reconstruídas com sucesso.${NC}"

# 4. Reiniciar os serviços
log "${YELLOW}🚀 [3/5] A reiniciar os contentores do SlidoFNAC...${NC}"
$COMPOSE_CMD up -d --remove-orphans | tee -a "$LOG_FILE"

# 5. Validar o Healthcheck de Produção (4341) e Staging (4342)
log "${YELLOW}⏳ [4/5] A validar estado dos serviços (4341 e 4342)...${NC}"
sleep 5

HEALTHY_PROD=false
for i in {1..10}; do
  if curl -s http://localhost:4341/api/health | grep -q '"status":"ok"'; then
    HEALTHY_PROD=true
    break
  fi
  log "A aguardar inicialização de Produção :4341 (tentativa $i/10)..."
  sleep 2
done

if [ "$HEALTHY_PROD" = true ]; then
  log "${GREEN}✓ Produção (:4341) e Staging (:4342) estão 100% operacionais!${NC}"
else
  log "${YELLOW}⚠️ O serviço demorou a responder, verifique os logs com: $COMPOSE_CMD logs${NC}"
fi

# 6. Limpar imagens Docker obsoletas
log "${YELLOW}🧹 [5/5] A limpar imagens Docker obsoletas para libertar espaço no NAS...${NC}"
docker image prune -f | tee -a "$LOG_FILE" || true
log "${GREEN}✓ Limpeza concluída.${NC}"

log "${GREEN}======================================================${NC}"
log "${GREEN}🎉 Atualização do SlidoFNAC concluída com sucesso!   ${NC}"
log "${GREEN}Versão ativa: Commit $NEW_HASH                        ${NC}"
log "${GREEN}Produção: http://192.168.68.117:4341                  ${NC}"
log "${GREEN}Staging:  http://192.168.68.117:4342                  ${NC}"
log "${GREEN}Registo guardado em: $LOG_FILE                        ${NC}"
log "${GREEN}======================================================${NC}"
