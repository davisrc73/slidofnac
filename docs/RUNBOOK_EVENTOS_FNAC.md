# ✅ Runbook & Checklist de Produção para Eventos FNAC

Este documento serve de guia prático de verificação técnica antes, durante e após qualquer evento ou convenção **FNAC**.

---

## 1. Escolha do Modo de Rede para os Telemóveis

A plataforma suporta dois modos de ligação para os telemóveis da audiência (`/play`):

### Opção A — Rede Wi-Fi Local do Evento (Sem Internet necessária)
Ideal quando o Mac da régie e os telemóveis dos participantes estão ligados ao mesmo router/rede Wi-Fi (sem isolamento de clientes AP):
1. O servidor deteta automaticamente o IP Wi-Fi local do Mac (ex.: `http://192.168.68.116:4321/play`).
2. Em `/admin`, no cartão **🌐 Acesso Telemóveis (QR Code)**, deixe o campo de endereço personalizado **vazio**.
3. O QR Code gerado no palco aponta diretamente para o IP local do Mac com latência inferior a 5 milissegundos.

### Opção B — Acesso via 4G / 5G (Túnel Público Cloud)
Recomendado para grandes auditórios onde os participantes usam os dados móveis (4G/5G) dos seus telemóveis:
1. Num segundo terminal do Mac, inicie um túnel gratuito **Cloudflare Quick Tunnel** (ou `ngrok`):
   ```bash
   npx cloudflared tunnel --url http://localhost:4321
   ```
2. Copie o endereço `https://xxxx-xxxx.trycloudflare.com` gerado no terminal.
3. Abra `http://localhost:4321/admin`, cole esse endereço no cartão **🌐 Acesso Telemóveis (QR Code)** e clique em **Guardar**.
4. O QR Code no palco (`/stage`) atualiza-se instantaneamente para o endereço HTTPS público!

---

## 2. Checklist Pré-Evento (T-60 Minutos)

- [ ] **1. Energia e Suspensão do Mac**:
  - Ligar o Mac à corrente elétrica.
  - Desativar a suspensão automática de ecrã nas *Definições do Sistema → Ecrã / Bateria* durante a apresentação.
- [ ] **2. Arrancar o Servidor**:
  - Abrir o terminal na pasta `/Users/daviscorreia/Antigravity /slidofnac` e correr `npm run dev`.
- [ ] **3. Testar o QR Code com 2 Telemóveis**:
  - Abrir `http://localhost:4321/stage` e ler o QR Code com um telemóvel de teste.
  - Verificar se a entrada no Lobby e o envio de uma resposta aparecem em menos de 1 segundo no palco.
- [ ] **4. Limpar Dados de Teste Antes de Abrir Portas**:
  - Em `http://localhost:4321/admin`, clicar no botão **🗑️ Zerar Respostas** para limpar os votos de ensaio antes da entrada real do público.
- [ ] **5. Configurar Ecrã Estendido (Segundo Monitor / Projetor)**:
  - No ecrã do Projetor: deixar aberta a janela `http://localhost:4321/stage` em Ecrã Inteiro (tecla `F`).
  - No ecrã do Portátil da Régie: deixar aberta a janela `http://localhost:4321/admin`.

---

## 3. Checklist Pós-Evento & Arquivo de Resultados

- [ ] **1. Exportar o Relatório Excel Completo (`.XLSX`)**:
  - Em `/admin`, clicar no botão verde **📥 Exportar .XLSX** (ou aceder a `http://localhost:4321/api/live/export.xlsx`).
  - Guardar o ficheiro `resultados-fnac-YYYY-MM-DD.xlsx` que inclui as 4 folhas (*Ranking Individual*, *Ranking Lojas FNAC*, *Atividades e Resultados* e *Respostas Detalhadas*).
- [ ] **2. Backup da Base de Dados Local (Opcional)**:
  - Todos os dados brutos estão guardados na pasta `.slido-data/` (`quiz-platform.sqlite` e `leaderboard-state.json`). Basta copiar essa pasta para arquivar o estado completo do evento.

---

## 4. Resolução Rápida de Problemas (Troubleshooting)

| Sintoma | Causa Provável | Solução Rápida |
| :--- | :--- | :--- |
| **O telemóvel lê o QR Code mas a página não carrega** | Os telemóveis estão em 4G/5G ou a rede Wi-Fi de convidados tem *Client Isolation* ativo. | Ativar um túnel público (`npx cloudflared tunnel --url http://localhost:4321`) e colar o URL HTTPS no cartão **🌐 Acesso Telemóveis** em `/admin`. |
| **Um participante entrou duas vezes com nomes ligeiramente diferentes** | Escreveu o nome de forma diferente após atualizar a página. | Em `/admin` → aba **📊 Importar Excel & Unificar Nomes**, clicar em **🔗 Unificar** na sugestão automática ou selecionar os dois registos na tabela. |
| **O denominador de respostas certas aparece acima do esperado** | Existem múltiplas rondas ativas acumuladas. | Em `/admin`, desmarcar a opção *"Combinar pontos dos Quizzes Ao Vivo com ficheiros Excel importados"* se quiser ver apenas o quiz atual, ou usar **🔄 Substituir Tudo** ao carregar um Excel isolado. |
| **Quero repetir a animação de Countdown do Top 10** | Já foram revelados os 10 lugares em `/vencedores`. | Premir a tecla **`R`** na página `/vencedores` para reiniciar a contagem decrescente em `#10 → #1`. |

