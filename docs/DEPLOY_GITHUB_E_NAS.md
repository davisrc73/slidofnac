# 🚢 Manual de Versionamento GitHub & Deploy no NAS (Staging / Produção)

Este documento descreve o fluxo de controlo de versões no **GitHub** (`https://github.com/davisrc73/slidofnac.git`) e o processo de instalação/atualização no **NAS (`192.168.68.117`)** em modo de **Produção (`4341`)** e **Staging (`4342`)**.

---

## 1. Repositório GitHub Configurado

- **Repositório Remoto (`origin`)**: `https://github.com/davisrc73/slidofnac.git`
- **Branch Principal**: `main`

### Comandos Git Habituais
```bash
git status
git add .
git commit -m "feat: descrição da evolução"
git push origin main
```

---

## 2. Configuração do Ambiente no NAS (`192.168.68.117`)

| Parâmetro | Valor Configurado |
| :--- | :--- |
| **Host / IP do NAS** | `192.168.68.117` |
| **Utilizador SSH** | `davis.correia` |
| **Pasta no NAS** | `/volume1/docker/slidofnac` |
| **Porta de Produção (`slidofnac-prod`)** | **`http://192.168.68.117:4341`** |
| **Porta de Staging (`slidofnac-staging`)** | **`http://192.168.68.117:4342`** |
| **Dados Persistentes (SQLite & Estado)** | `/volume1/docker/slidofnac/data/prod` e `/volume1/docker/slidofnac/data/staging` |
| **Backups Automáticos SQLite** | `/volume1/docker/slidofnac/backups` |

---

## 3. Como Atualizar o NAS (`npm run deploy:nas`)

A partir do Mac, basta executar:

```bash
# Atualiza Produção (4341) e Staging (4342) no NAS com backup automático do SQLite
npm run deploy:nas

# Ou atualizar apenas Produção (4341):
bash scripts/deploy-nas.sh prod

# Ou atualizar apenas Staging (4342):
bash scripts/deploy-nas.sh staging
```

### Verificar o Estado (Healthcheck)
- **Produção**: `http://192.168.68.117:4341/api/health`
- **Staging**: `http://192.168.68.117:4342/api/health`
