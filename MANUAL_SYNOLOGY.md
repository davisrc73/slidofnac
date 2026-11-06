# 🏆 SlidoFNAC — Manual de Operação e Guia de Deploy (Synology NAS)

Este documento reúne todas as informações práticas para operar, gerir, atualizar e efetuar backups da **Plataforma Interativa de Quizzes, Sondagens & Classificação FNAC** alojada no seu **Synology NAS (`192.168.68.117`)** com Container Manager / Docker, seguindo exatamente o padrão do projeto **BandaOS**.

---

## 🌐 1. Acesso à Aplicação e Serviços no NAS

| Ambiente | Endereço no NAS | Descrição |
| :--- | :--- | :--- |
| **Produção — Tabela Geral (`/`)** | `http://192.168.68.117:4341/` | Ecrã de Classificação Geral em tempo real. |
| **Produção — Palco Ao Vivo (`/stage`)** | `http://192.168.68.117:4341/stage` | Ecrã de Palco (QR Lobby + 8 Modelos Slido + Ranking Lojas FNAC). |
| **Produção — Telemóveis (`/play`)** | `http://192.168.68.117:4341/play` | Web App Mobile para os participantes (gerada automaticamente no QR Code). |
| **Produção — Top 10 (`/vencedores`)** | `http://192.168.68.117:4341/vencedores` | Revelação dramática Top 10 em Countdown (`#10` → `#1`). |
| **Produção — Backoffice (`/admin`)** | `http://192.168.68.117:4341/admin` | Comando do Apresentador, Criador dos 8 Modelos, Excel e Manuais. |
| **Produção — Healthcheck API** | `http://192.168.68.117:4341/api/health` | Estado de saúde do contentor `slidofnac-prod`. |
| **Staging (Testes / Ensaios)** | `http://192.168.68.117:4342/` | Ambiente isolado (`slidofnac-staging`) com base de dados própria para ensaios. |

---

## 🔄 2. Ciclo de Atualização e Desenvolvimento (Mac ➔ GitHub ➔ Synology NAS)

Sempre que desenvolver novas funcionalidades ou fizer alterações no Mac:

### Passo 1 — No Mac (Automatizado pelo Agente):
```bash
git add .
git commit -m "feat: descrição da alteração"
git push origin main
npm run deploy:nas
```

### Passo 2 — No Synology NAS (4 Métodos Disponíveis, igual ao BandaOS):

#### Método A: Atualização com 1 Clique na Interface Web do Synology DSM (Recomendado — Sem SSH!)
Pode atualizar o NAS a qualquer momento diretamente a partir do navegador Web do DSM:
1. Abra o **DSM** (`http://192.168.68.117:5000`) e vá a **Painel de Controlo** ➔ **Agendador de Tarefas**.
2. Clique em **Criar** ➔ **Tarefa Acionada pelo Utilizador** ➔ **Script definido pelo utilizador**.
   - **Geral**: Nome da tarefa: `Atualizar SlidoFNAC` | Utilizador: `root`
   - **Definições da Tarefa**: No campo de comando, cole:
     ```bash
     bash /volume1/docker/slidofnac/scripts/update-nas.sh --force
     ```
3. Clique em **OK**.
4. Sempre que quiser atualizar os contentores de Produção (`4341`) e Staging (`4342`), basta selecionar a tarefa **"Atualizar SlidoFNAC"** e clicar em **"Executar"**!
5. O histórico completo de cada atualização fica registado em `/volume1/docker/slidofnac/logs/`.

#### Método B: Tornar o Deploy 100% Automático a partir do Mac (Sem clicar no DSM)
Se quiser que o comando `npm run deploy:nas` no Mac também possa reconstruir os contentores Docker sem pedir `sudo`, basta correr uma única vez na tarefa `root` do DSM (ou via SSH com `sudo`):
```bash
sudo chmod 666 /var/run/docker.sock
```
A partir desse momento, `npm run deploy:nas` no Mac faz `git pull`, reconstrói as imagens Docker e reinicia as portas `4341` e `4342` diretamente!

#### Método C: Executar o Script via Terminal SSH no NAS
```bash
cd /volume1/docker/slidofnac
sudo bash scripts/update-nas.sh --force
```

#### Método D: Atualização Noturna Automática (Opcional)
No **Agendador de Tarefas** do DSM, pode agendar `bash /volume1/docker/slidofnac/scripts/update-nas.sh` para correr diariamente (ex.: às `04:30`). Como o script compara o hash do commit local com o `origin/main` do GitHub antes de reconstruir, se não houver alterações termina em ~1 segundo sem reiniciar os contentores.

---

## 💾 3. Persistência de Dados e Backups no NAS

- **Dados de Produção (`4341`)**: `/volume1/docker/slidofnac/data/prod/quiz-platform.sqlite` e `leaderboard-state.json`
- **Dados de Staging (`4342`)**: `/volume1/docker/slidofnac/data/staging/quiz-platform.sqlite` e `leaderboard-state.json`
- **Backups Automáticos**: Antes de cada atualização, o script `scripts/update-nas.sh` cria automaticamente uma cópia datada da base de dados em `/volume1/docker/slidofnac/backups/quiz-prod-YYYYMMDD_HHMMSS.sqlite`.
