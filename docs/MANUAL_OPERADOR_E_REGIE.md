# 📖 Manual do Operador, Apresentador & Régie

Este manual destina-se à equipa de produção, régie audiovisual e apresentadores em palco durante convenções e eventos **FNAC**.

---

## 1. Visão Rápida dos 4 Ecrãs de Operação

Durante um evento, a plataforma funciona com duas vistas principais: **o que o público vê** (no projetor e nos telemóveis) e **o que o operador controla** (no portátil de régie).

| Ecrã | Endereço | Onde Abrir | Função Principal |
| :--- | :--- | :--- | :--- |
| **Backoffice / Comando** | `http://localhost:4321/admin` | 💻 Ecrã do Operador | Controlar o palco, lançar perguntas, gerir sessões e exportar Excel. |
| **Palco Ao Vivo** | `http://localhost:4321/stage` | 🖥️ Projetor / LED Wall | Mostrar QR Code de entrada, perguntas/sondagens em direto e classificação. |
| **Revelação Top 10** | `http://localhost:4321/vencedores` | 🎬 Projetor (Final) | Revelar os 10 vencedores em contagem decrescente (`#10` até `#1`). |
| **App Telemóvel** | QR Code no Palco (`/play`) | 📱 Telemóveis da Sala | Onde os participantes inserem o nome, a Loja FNAC e votam/respondem. |

---

## 2. Como Conduzir uma Sessão Ao Vivo Passo a Passo

### Passo 1 — Abrir o Lobby com QR Code no Projetor
1. No computador ligado ao projetor, abra `http://localhost:4321/stage` e prima a tecla **`F`** para colocar em **Ecrã Inteiro**.
   - *Nota*: Após 3 segundos sem mexer o rato, o cursor e a barra de botões do topo desaparecem automaticamente para deixar o ecrã limpo.
2. No Backoffice (`/admin`), clique em **📱 1. Mostrar QR Lobby**.
3. Os participantes apontam a câmara do telemóvel para o QR Code no ecrã gigante, escrevem o seu nome, escolhem a sua **Loja / Direção FNAC** e entram na sala.
4. À medida que entram, o contador **Participantes ligados em sala** e as etiquetas com o nome + loja aparecem imediatamente no projetor.

### Passo 2 — Lançar as Atividades / Perguntas da Playlist
Pode avançar a sessão de **duas formas** (em simultâneo):
- **A partir do Palco (`/stage`)**: Clicando no botão escuro **`>`** no canto inferior esquerdo ou premindo **`Espaço` / `Seta Direita` / Clicker de Apresentação**.
- **A partir do Telecomando (`/admin`)**:
  - **▶️ 2. Abrir Atividade Atual**: Abre a pergunta ou atividade nos telemóveis e inicia o cronómetro.
  - **✅ 3. Revelar / Fechar Votação**:
    - Se for um **Quiz Competitivo**, revela a opção correta a verde, as barras de percentagem e informa cada participante no telemóvel se acertou e quantos pontos ganhou.
    - Se for uma atividade não-competitiva (*Poll*, *Word cloud*, *Open text*, *Ideas*, *Ranking*, *Rating*, *Survey*), os resultados já vão aparecendo ao vivo no palco e este botão encerra a votação.
  - **⏭️ 4. Próxima Atividade**: Avança imediatamente para o item seguinte da playlist.

### Passo 3 — Mostrar Classificação Individual vs Batalha de Lojas FNAC
A meio do quiz ou no fim da ronda, pode mostrar o ranking no projetor:
- Em `/admin`, clique em **🏆 Ranking Individual** para exibir os melhores participantes (ordenados por respostas certas e desempatados ao milissegundo).
- Clique em **🏪 Batalha de Lojas FNAC** para exibir o ranking das Lojas/Direções FNAC (ordenado pela média de pontos por colaborador da loja).

### Passo 4 — Grande Final: Revelação Top 10 em Countdown (`/vencedores`)
Para o momento de entrega de prémios:
1. Abra `http://localhost:4321/vencedores` no projetor (ou clique mais uma vez em **`>`** quando o palco já estiver na tabela de classificação).
2. A tabela começa vazia com a indicação **Pronto a iniciar (#10 → #1)**.
3. A cada clique no botão **`>`** (canto inferior esquerdo) ou tecla **`Espaço` / `Seta Direita`**:
   - 1.º Clique → Revela o **#10**
   - 2.º Clique → Revela o **#9** (aparecendo acima do #10)
   - ...
   - 10.º Clique → Revela o grande vencedor **#1** com barra amarela `#FFCC00` e **explosão de confetti**!

---

## 3. Atalhos de Teclado e Comando Presenter (Clicker)

Tanto o ecrã de **Palco (`/stage`)** como o ecrã de **Vencedores (`/vencedores`)** são compatíveis com comandos sem fios de apresentador (*Logitech Spotlight*, *Kensington*, etc.):

| Tecla / Botão | Ação em `/stage` | Ação em `/vencedores` |
| :--- | :--- | :--- |
| **`Espaço`** / **`Seta Direita`** / **`PageDown`** | Avança para o passo seguinte (Lobby → Pergunta → Revelar → Próxima) | Revela o próximo lugar do Countdown (`#10` → `#1`) |
| **Botão `>` (Canto Inferior Esquerdo)** | Avança para o passo seguinte | Revela o próximo lugar do Countdown |
| **`F`** | Alterna o modo de **Ecrã Inteiro (Fullscreen)** | Alterna o modo de **Ecrã Inteiro (Fullscreen)** |
| **`R`** | — | Reinicia o Countdown do zero (volta a esconder todos os lugares) |

---

## 4. Importação de Ficheiros Excel Slido e Unificação de Nomes

Na aba **📊 Importar Excel & Unificar Nomes** em `/admin`:

1. **Carregar Ficheiros `.XLSX` ou `.CSV`**:
   - Escolha **➕ Somar / Atualizar Ronda** para acumular várias rondas no ranking geral, ou **🔄 Substituir Tudo** para começar uma classificação nova.
   - Arraste o ficheiro para a zona pontilhada.
2. **Unificação Automática**:
   - O sistema junta automaticamente nomes idênticos com diferenças de maiúsculas, acentos ou `_` (ex.: `João_Silva` e `joao silva`) e soma as pontuações repetidas dentro do mesmo `Quiz ID`.
3. **Sugestões Inteligentes de Nomes Parecidos**:
   - Na coluna esquerda, o cartão **🤝 Unificação de Utilizadores** sugere pares de nomes muito semelhantes. Basta clicar em **🔗 Unificar** para fundir os seus pontos e tempos.
4. **Unificação Manual Livre**:
   - Na tabela da direita, marque a caixa de seleção (`☑️`) em 2 ou mais participantes que pertençam à mesma pessoa, escolha na barra preta qual o nome final que deve ficar visível e clique em **🔗 Unificar**.

