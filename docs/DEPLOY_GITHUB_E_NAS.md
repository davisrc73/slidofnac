# 🚢 Manual de Versionamento GitHub & Deploy no NAS (Staging / Produção)

Este documento descreve o fluxo de controlo de versões no **GitHub** e o processo de instalação/atualização no **NAS** em modo de **Produção** e **Staging** (via Docker Compose, Container Manager / Portainer ou script SSH automatizado).

---

## 1. Fluxo de Repositório GitHub

O projeto está inicializado na branch `main` e configurado para manter histórico limpo (excluindo `node_modules/`, `dist/`, `.slido-data/`, `data/`, `backups/` e `.env` através do [`.gitignore`](file:///Users/daviscorreia/Antigravity%20/slidofnac/.gitignore)).

### Ligar ao Repositório Remoto no GitHub
Assim que criar o repositório vazio no GitHub (ex.: `https://github.com/<utilizador>/slidofnac.git`):

```bash
git remote add origin https://github.com/<utilizador>/slidofnac.git
git branch -M main
git push -u origin main
```

### Evoluções Futuras
Graças à regra persistida em [`.agents/rules/mandatory-questions-and-suggestions.md`](file:///Users/daviscorreia/Antigravity%20/slidofnac/.agents/rules/mandatory-questions-and-suggestions.md), todas as evoluções de código e documentação serão acompanhadas de `git commit` e `git push origin main`.

---

## 2. Arquitetura Docker no NAS (Staging & Produção)

A infraestrutura de contentorização é composta por:

- [**Dockerfile**](file:///Users/daviscorreia/Antigravity%20/slidofnac/Dockerfile): Imagem multi-stage baseada em `node:24-alpine` (compila o frontend Astro em `dist/` e corre o servidor de alta performance [`server.mjs`](file:///Users/daviscorreia/Antigravity%20/slidofnac/server.mjs) com `node:sqlite` nativo).
- [**docker-compose.yml**](file:///Users/daviscorreia/Antigravity%20/slidofnac/docker-compose.yml):
  - **`slidofnac-prod`** *(Produção)*: Porta predefinida `4321` (`PROD_PORT`), dados persistentes em `./data/prod:/app/.slido-data`.
  - **`slidofnac-staging`** *(Staging)*: Porta predefinida `4322` (`STAGING_PORT`), dados isolados em `./data/staging:/app/.slido-data` (ativado com `--profile staging`).
- **Healthcheck Nativo**: Endpoint `GET /api/health` monitorizado a cada 30 segundos pelo Docker.
- **Deteção Inteligente de IP/Domínio no NAS**: Quando acedido através do IP do NAS (ex.: `http://192.168.68.250:4321/stage`) ou de um domínio Reverse Proxy (`https://quiz.fnac...`), o gerador de QR Code adapta automaticamente o endereço para os telemóveis da audiência.

---

## 3. Como Fazer Deploy para o NAS

### Opção A — Deploy Automatizado a partir do Mac (`npm run deploy:nas`)

1. Copie o ficheiro de exemplo [`.env.example`](file:///Users/daviscorreia/Antigravity%20/slidofnac/.env.example) para `.env`:
   ```bash
   cp .env.example .env
   ```
2. Preencha os dados do seu NAS no ficheiro `.env`:
   ```ini
   NAS_HOST=192.168.68.250
   NAS_USER=admin
   NAS_SSH_PORT=22
   NAS_DEPLOY_PATH=/volume1/docker/slidofnac
   PROD_PORT=4321
   STAGING_PORT=4322
   ```
3. Execute o comando de deploy pretendido:
   ```bash
   # Deploy em Produção (porta 4321) com backup automático prévio do SQLite
   npm run deploy:nas

   # Deploy apenas em Staging (porta 4322)
   bash scripts/deploy-nas.sh staging

   # Deploy em ambos (Produção + Staging)
   bash scripts/deploy-nas.sh both
   ```

### Opção B — Deploy via Portainer / Synology Container Manager / QNAP Container Station (Git Stack)

Se preferir que o próprio NAS faça pull diretamente do GitHub:
1. No Portainer / Container Manager do NAS, crie uma nova **Stack / Project** a partir do repositório Git (`https://github.com/<utilizador>/slidofnac`) apontando para o [`docker-compose.yml`](file:///Users/daviscorreia/Antigravity%20/slidofnac/docker-compose.yml).
2. Defina as variáveis de ambiente opcionais (`PROD_PORT=4321`, `STAGING_PORT=4322`).
3. Ative o webhook ou clique em **Pull and Redeploy** sempre que houver um novo commit no GitHub.
