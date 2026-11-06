# 🏆 Plataforma Interativa de Quizzes, Sondagens & Classificação — FNAC

Plataforma proprietária de interação em tempo real para eventos, convenções comerciais e formações **FNAC Portugal**, desenvolvida como alternativa local/híbrida ao **Slido**, **Kahoot** e **Mentimeter**, com controlo total de dados, latência zero em rede local, suporte para 4G/5G via túnel e identidade visual adaptada ao ecrã de palco.

---

## 📚 Índice da Documentação (`docs/`)

Toda a documentação técnica e operacional do projeto encontra-se estruturada na pasta [`docs/`](file:///Users/daviscorreia/Antigravity%20/slidofnac/docs):

1. 📖 [**Manual do Operador, Apresentador & Régie**](file:///Users/daviscorreia/Antigravity%20/slidofnac/docs/MANUAL_OPERADOR_E_REGIE.md)
   - Guia passo-a-passo para operar o Backoffice (`/admin`), o Palco (`/stage`), o Countdown Top 10 (`/vencedores`) e a Unificação de Nomes.
2. 🎮 [**Guia dos 8 Modelos Interativos & Gamificação FNAC**](file:///Users/daviscorreia/Antigravity%20/slidofnac/docs/GUIA_8_MODELOS_INTERATIVOS.md)
   - Explicação detalhada dos 8 formatos (*Multiple choice*, *Word cloud*, *Open text*, *Ideas*, *Ranking*, *Rating*, *Quiz* e *Survey*), regras de pontuação, **Pontos Duplos (`2x`)**, **Imagem Misteriosa (Blur/Zoom)** e **Batalha de Lojas FNAC**.
3. 🛠️ [**Arquitetura Técnica, Base de Dados & API**](file:///Users/daviscorreia/Antigravity%20/slidofnac/docs/ARQUITETURA_E_DESENVOLVIMENTO.md)
   - Documentação da arquitetura Astro + Node.js + SQLite nativo, motores `.xlsx` e QR Code SVG sem dependências externas, esquema de dados, endpoints REST e registo histórico do desenvolvimento.
4. ✅ [**Runbook & Checklist de Produção para Eventos FNAC**](file:///Users/daviscorreia/Antigravity%20/slidofnac/docs/RUNBOOK_EVENTOS_FNAC.md)
   - Checklist pré-evento, configuração de Wi-Fi local vs Túnel Cloud (4G/5G), segurança de dados, backups e resolução rápida de problemas em direto.
5. 🚢 [**Manual de Versionamento GitHub & Deploy no NAS (Staging / Produção)**](file:///Users/daviscorreia/Antigravity%20/slidofnac/docs/DEPLOY_GITHUB_E_NAS.md)
   - Fluxo Git/GitHub, contentorização Docker (`Dockerfile` + `docker-compose.yml`), volumes persistentes SQLite, healthcheck `/api/health` e deploy automatizado via SSH (`npm run deploy:nas`).

---

## 🗺️ Mapa de Ecrãs e Rotas da Aplicação

| Rota | URL Local | Destino / Utilizador | Descrição |
| :--- | :--- | :--- | :--- |
| **`/`** | `http://localhost:4321/` | 🖥️ Projetor / LED Wall | **Tabela de Classificação Geral** com atualização automática a cada 3 segundos. |
| **`/stage`** | `http://localhost:4321/stage` | 📡 Projetor Principal | **Ecrã de Palco Dinâmico**: mostra QR Code no Lobby, qualquer um dos 8 modelos interativos em direto e o Ranking Individual ou por Lojas FNAC. |
| **`/play`** | `http://<IP-DO-MAC>:4321/play` | 📱 Telemóveis (Audiência) | **Web App Mobile** onde os colaboradores entram via QR Code, escolhem a sua Loja FNAC e respondem em tempo real. |
| **`/vencedores`** | `http://localhost:4321/vencedores` | 🎬 Projetor (Momento Final) | **Revelação Dramática Top 10 em Countdown** (`#10` até `#1`), controlada por clique ou comando apresentador, com confetti no `#1`. |
| **`/admin`** | `http://localhost:4321/admin` | ⚙️ Operador / Régie | **Backoffice & Telecomando Ao Vivo**: criação de playlists com os 8 modelos, controlo do palco, importação de Excel, unificação de utilizadores e manual integrado. |

---

## 🚀 Instalação e Arranque Rápido (macOS)

### Pré-requisitos
- **macOS** com **Node.js v22.5+ ou v24+** (utiliza o motor nativo `node:sqlite` e `node:zlib` incluídos no Node.js moderno).

### Comandos Principais

```bash
# 1. Instalar dependências do projeto
npm install

# 2. Iniciar o servidor em modo de Evento Ao Vivo (escuta em localhost e na rede Wi-Fi local)
npm run dev

# 3. Validar compilação de produção
npm run build
```

Assim que executar `npm run dev`, o terminal apresenta:
- **Local**: `http://localhost:4321/`
- **Network (Wi-Fi)**: `http://<IP-DO-SEU-MAC>:4321/` *(usado automaticamente para gerar o QR Code dos telemóveis)*

---

## ✨ Principais Funcionalidades Diferenciadoras

- **8 Modelos Interativos Nativos (Estilo Slido)**: *Multiple choice (Poll)*, *Word cloud*, *Open text*, *Ideas (com upvotes 👍)*, *Ranking (ordenação Borda)*, *Rating (estrelas)*, *Quiz Competitivo* e *Survey Multi-Pergunta*.
- **🏪 Batalha de Lojas / Equipas FNAC**: Além do ranking individual, agrega automaticamente as pontuações por Loja/Direção FNAC (média de pontos por colaborador + total de pontos da loja).
- **🔥 Pontos Duplos (`2x`) & 🖼️ Imagem Misteriosa**: Suporte para perguntas de Quiz valendo o dobro dos pontos e imagens que começam desfocadas (*Blur*) ou ampliadas (*Zoom*) e revelam-se ao longo do tempo.
- **🤝 Unificação Inteligente e Manual de Utilizadores**: Normaliza automaticamente acentos, maiúsculas/minúsculas e repetições por `Quiz ID` (somando pontos e tempos), sugerindo nomes parecidos (distância de Levenshtein) e permitindo unificar manualmente qualquer conjunto de participantes.
- **📥 Exportação Excel Multi-Folha (`.XLSX`)**: Descarregamento imediato (`/api/live/export.xlsx`) com 4 folhas estruturadas (*Ranking Individual*, *Ranking Lojas FNAC*, *Atividades e Resultados* e *Respostas Detalhadas*).

