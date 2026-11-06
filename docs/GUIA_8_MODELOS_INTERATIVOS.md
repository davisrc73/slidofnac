# 🎮 Guia dos 8 Modelos Interativos & Gamificação FNAC

A plataforma disponibiliza **8 modelos de interação em tempo real**, que podem ser combinados livremente na mesma Playlist/Sessão.

---

## 1. Resumo Comparativo dos 8 Modelos

| Modelo | Ícone | Código Interno | Resultados no Palco (`/stage`) | Conta para o Ranking / Pontos? |
| :--- | :---: | :---: | :--- | :---: |
| **Multiple choice** | ☑️ | `poll` | **Tempo Real** (barras horizontais azuis ao vivo) | Não (Sondagem de opinião) |
| **Word cloud** | ☁️ | `wordcloud` | **Tempo Real** (nuvem dinâmica por frequência) | Não |
| **Open text** | 💬 | `opentext` | **Tempo Real** (mural de cartões de comentário) | Não |
| **Ideas** | 💡 | `ideas` | **Tempo Real** (lista ordenada por votos `👍`) | Não |
| **Ranking** | 🏅 | `ranking` | **Tempo Real** (barras ponderadas método Borda) | Não |
| **Rating** | ⭐ | `rating` | **Tempo Real** (média global `4.8 ★` + gráfico vertical) | Não |
| **Quiz** | 🏆 | `quiz` | **Oculto até Revelar** (suspense competitivo) | **Sim** (`1 pt` ou `2 pts` + tempo `ms`) |
| **Survey** | 📋 | `survey` | **Tempo Real** (grelha de resumo das sub-perguntas) | Não |

---

## 2. Detalhe de Cada Modelo

### ☑️ 1. Multiple choice (`poll`)
- **Objetivo**: Sondagens rápidas de opinião onde não há resposta "certa" ou "errada" (ex.: *"Qual a categoria de produto com maior potencial neste Natal?"*).
- **No Telemóvel (`/play`)**: O participante toca numa das opções disponíveis.
- **No Palco (`/stage`)**: As barras horizontais azuis crescem em direto à medida que os votos entram.

### ☁️ 2. Word cloud (`wordcloud`)
- **Objetivo**: Quebra-gelo ou recolha de palavras-chave (ex.: *"Numa palavra, o que define a equipa FNAC?"*).
- **No Telemóvel (`/play`)**: O participante pode enviar uma ou várias palavras curtas sucessivamente.
- **No Palco (`/stage`)**: Palavras iguais (ignorando maiúsculas/acentos) são agrupadas; quanto mais vezes uma palavra é enviada (`×3`, `×5`...), maior é o tamanho da letra no ecrã.

### 💬 3. Open text (`opentext`)
- **Objetivo**: Recolher testemunhos, perguntas abertas ou feedback detalhado.
- **No Telemóvel (`/play`)**: Caixa de texto livre até 300 caracteres, permitindo múltiplos envios.
- **No Palco (`/stage`)**: Mural em grelha com os comentários recebidos, destacando o comentário mais recente no topo e identificando o autor e a sua Loja FNAC.

### 💡 4. Ideas (`ideas`)
- **Objetivo**: Brainstorming colaborativo onde a própria sala vota nas melhores ideias.
- **No Telemóvel (`/play`)**: Os participantes submetem novas ideias **e** vêem em direto a lista de ideias já submetidas pelos colegas, podendo tocar no botão **`👍`** para votar nas suas favoritas.
- **No Palco (`/stage`)**: As ideias sobem automaticamente na lista em tempo real conforme acumulam mais votos `👍`.

### 🏅 5. Ranking (`ranking`)
- **Objetivo**: Pedir à audiência para ordenar prioridades do 1.º ao N.º lugar.
- **No Telemóvel (`/play`)**: Lista interativa com botões **`▲` / `▼`** para colocar os itens na ordem preferida antes de submeter.
- **No Palco (`/stage`)**: Aplica o **Método de Pontuação de Borda** (num ranking de 4 opções, cada 1.º lugar vale 4 pts, 2.º lugar vale 3 pts, 3.º vale 2 pts e 4.º vale 1 pt) e ordena as barras cor-de-rosa da opção vencedora para a última.

### ⭐ 6. Rating (`rating`)
- **Objetivo**: Avaliar de 1 a 5 estrelas (ou 1 a 10 estrelas) uma campanha, formação ou apresentação.
- **No Telemóvel (`/play`)**: Seletor interativo de estrelas douradas `★`.
- **No Palco (`/stage`)**: Exibe à esquerda a **Média Global** em destaque (ex.: `4.8 ★`) e à direita o histograma de colunas verticais com a percentagem de cada nível de estrelas.

### 🏆 7. Quiz (`quiz`)
- **Objetivo**: Competição de conhecimento e rapidez para apurar os vencedores individuais e a Loja FNAC vencedora.
- **Regras de Pontuação e Desempate**:
  1. **Pontos**: Cada resposta certa soma `1 ponto` (ou `2 pontos` se a opção **🔥 2x Pontos Duplos** estiver ativa nessa pergunta).
  2. **Desempate ao Milissegundo**: Em caso de igualdade no número de pontos, fica à frente quem tiver o **menor tempo acumulado de resposta** (`time_ms`).
- **Funcionalidade Extra — 🖼️ Imagem Misteriosa (Blur / Zoom)**:
  - Ao adicionar um URL de imagem numa pergunta de Quiz, pode escolher:
    - **Desfocada (`blur`)**: A imagem começa desfocada (`blur(18px)`) e vai ficando progressivamente nítida até o tempo acabar.
    - **Super Zoom (`zoom`)**: A imagem começa ampliada num detalhe central e faz *zoom-out* progressivo.

### 📋 8. Survey (`survey`)
- **Objetivo**: Agrupar várias perguntas (Avaliação por Estrelas + Texto Aberto) num único passo para preenchimento ao ritmo de cada participante (ex.: inquérito de satisfação final do evento).
- **No Telemóvel (`/play`)**: Apresenta todas as sub-perguntas num único cartão com botão de envio global.
- **No Palco (`/stage`)**: Mostra em simultâneo os cartões de resumo com a média de estrelas e os últimos comentários de cada sub-pergunta.

---

## 3. 🏪 Batalha de Lojas / Equipas FNAC

Para fomentar o espírito de equipa entre lojas e direções nas convenções nacionais:
1. No ecrã de entrada do telemóvel (`/play`), cada participante seleciona a sua loja ou direção (ex.: *FNAC Colombo*, *FNAC Chiado*, *FNAC Norteshopping*, *Sede / Serviços Centrais*, etc.).
2. O sistema calcula automaticamente o **Ranking de Lojas FNAC** (`getTeamStandings`):
   - **Critério Principal**: **Média de Pontos por Colaborador** da loja (`Total de Pontos da Loja ÷ N.º de Participantes da Loja`), garantindo justiça entre lojas grandes e lojas mais pequenas.
   - **1.º Desempate**: Maior pontuação total acumulada pela loja.
   - **2.º Desempate**: Menor tempo médio de resposta dos colaboradores da loja.

