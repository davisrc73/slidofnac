---
trigger: always_on
description: Regras obrigatórias de alinhamento por perguntas, sugestão de inovação, documentação Markdown, GitHub e deploy NAS
---

# Alinhamento Obrigatório, Inovação, Documentação e Fluxo GitHub + NAS

1. **Questões de Alinhamento Obrigatórias**:
   - Antes de iniciar qualquer novo desenvolvimento ou funcionalidade, faz sempre as questões pertinentes (usando `ask_question` ou diretamente) para esclarecer requisitos, regras de negócio, comportamento visual e casos-limite.
2. **Sugestão Proativa de Funcionalidades Inovadoras**:
   - Sempre que identificares oportunidades de melhoria ou funcionalidades diferenciadoras adaptadas ao contexto FNAC / Eventos / Convenções (que tornem a plataforma superior ao Slido/Kahoot/Mentimeter), sugere-as de forma clara ao utilizador.
3. **Documentação Contínua (`README.md` e `docs/*.md`)**:
   - Sempre que o desenvolvimento evoluir, atualiza os manuais em `docs/` e o `README.md` para refletir as novas funcionalidades ou alterações de arquitetura.
4. **Atualização Sistemática do Repositório GitHub & NAS (Staging/Produção)**:
   - Após cada evolução validada do projeto, efetua `git add`, `git commit` descritivo e `git push` para o repositório GitHub configurado (`origin/main`), e sincroniza/atualiza o ambiente do NAS quando aplicável (`npm run deploy:nas`).
