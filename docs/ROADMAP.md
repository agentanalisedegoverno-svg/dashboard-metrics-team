# Roadmap de melhorias

Estado em 28/10/2026 e o que vem a seguir. Cada item traz o **porquê** e o **tamanho** aproximado (P = horas, M = dias, G = semanas). A prioridade é uma sugestão para validação do time.

## 1. Onde estamos

| Entrega | Estado |
|---|---|
| Painel de métricas (7 abas) lendo do banco, atrás do Cloudflare Access | ✅ em produção |
| Banco com cadastro: histórico, bloqueio otimista, listas fechadas, usuários | ✅ |
| API de cadastro (CRUD, histórico, arquivar/restaurar, listas, usuários) | ✅ |
| Aba **Oportunidades** (grade virtualizada, formulário, histórico, administração) | ✅ |
| Carga da planilha por **merge** (`sync-db.mjs`) com relatório de qualidade | ✅ → **descontinuada em 27/10/2026** (o banco não é mais alimentado pela planilha) |
| Backup diário criptografado no Google Drive + teste de restauração | ✅ |
| Integração Radar → Planner (exportador, `planner-auto`) **na nuvem**, disparada ao salvar (GitHub Actions, estado cifrado no banco) | ✅ (28/10) |
| E-mails de nova oportunidade e de mudança de status, com todas as informações | ✅ (27/10) |
| Espelho diário do banco no Supabase (segunda redundância) | ✅ (28/10) |
| API externa para outras aplicações criarem oportunidades (chave por aplicação, idempotência, solicitante) | ✅ (28/10); Bypass do Access criado e função validada em produção (sem rastro); modo de simulação (`?simular=true`, sem gravar nada) e documentação interativa em Administração → API; **falta**: teste com chave (`scripts/teste-api-externa.mjs --simular`), chave da aplicação real e regra de *rate limiting* no Cloudflare |
| Campos novos: sigla (20), descritivo (60), duração do contrato em meses, valores em R$ com máscara | ✅ (27–28/10) |
| Carga automática da planilha (tarefa do Windows, sem IA) + alerta de carga atrasada | ✅ (22/10) → **desativada e removida em 27/10/2026** |
| Trava final: revogar a carga total antiga do `radar_escritor` (migração 002) | ✅ (22/10) |

## Monitoramento de licitações — evolução incremental

| Etapa | Estado | Escopo / critério de conclusão |
|---|---|---|
| Consulta PNCP na aba Licitações | 🟡 Em validação | Proxy de mesma origem com timeout; painel exibe dados encontrados, nível de atenção e próxima ação. Ainda exige validação com oportunidades reais em produção. Sem novas tabelas ou APIs do Radar. |
| Ampliar a cobertura de descoberta | 🟡 Próxima prioridade | Revisar paginação e filtros do PNCP para reduzir falsos negativos. Inventário atual: 22 oportunidades ativas em Comprasnet (Gov.br), 11 em Compras.gov.br / PNCP, 4 em Petronect, 2 em Compras SC e 2 em bbmnet; existem registros sem portal identificado. A contagem é por cadastro atual, não prova que cada fonte tenha API pública utilizável. |
| Compras.gov.br — dados abertos | 🟡 Implementação inicial | Proxy de mesma origem restrito a endpoints oficiais; consultas aos módulos legados de licitação/pregão e ao módulo de contratações da Lei 14.133. A cobertura e os parâmetros precisam ser validados com respostas reais antes de declarar concluído. |
| Portais estaduais abertos | ⬜ Próxima etapa | Priorizar Compras SC, Compras MS e Seplag/MT. Confirmar endpoints oficiais, parâmetros, limites e termos de uso; manter conectores isolados e somente leitura. |
| Acompanhamento de certames em que participamos | ⬜ Futuro | Evoluir de descoberta para acompanhamento de oportunidades confirmadas: vínculo por identificador oficial, prazos/sessões, mudanças publicadas, resultado/andamento e links oficiais. Definir o fluxo operacional com o time antes de persistir qualquer dado novo. |
| Alertas de prazo e mudança | ⬜ Futuro | Após validar a etapa de acompanhamento, definir alertas para prazos e alterações relevantes com fonte e data da última verificação visíveis. |

**Limite da fase atual:** o módulo é um paliativo de consulta. Não registra participação, não confirma automaticamente vínculos e não altera banco/back-end. As etapas futuras precisam de decisão explícita antes de introduzir persistência ou automações.

## 2. Próximos passos (curto prazo)

1. **Licitações — validar em produção** a resposta do PNCP e a cobertura de campos no painel.
2. **Compras.gov.br — validar os três endpoints oficiais** e ajustar os filtros conforme o contrato real da API.
3. **Portais estaduais — implementar conectores** após validar cada endpoint oficial e as condições de uso.
4. **NOC — planejar snapshots persistentes** para detectar alterações históricas entre consultas; o painel atual sinaliza a situação da consulta corrente, não compara versões históricas.

| # | Item | Por quê | Tam. |
|---|---|---|---|
| 1 | ~~Aplicar a migração 002~~ **Feito (22/10)** | A carga antiga que apagava tudo não é mais executável pelo escritor | — |
| 2 | **Corrigir as pendências da migração** pela aba (63 registros: Lost sem motivo, "Validar", pregão antes da distribuição, sem Pré-vendas) | Qualidade das métricas; hoje elas entram como "pendência" | M |
| 3 | **Acompanhar os primeiros cartões reais do Planner** (cadastrar, conferir bucket/responsável/prazo, mudar status) e apagar o cartão `RAD-999001` | É a primeira escrita real; o 50%/100% pode sobrescrever progresso manual | P |
| 4 | **Alerta de falha** da integração (e-mail/Teams quando o log trouxer `[ERRO]`; a carga da planilha não existe mais) | Hoje só se descobre olhando o log ou o "Última atualização" | M |
| 5 | **Rotacionar credenciais** pendentes e passar a trimestral (papéis do banco, token Cloudflare, tokens antigos do GitHub) | Higiene; vários valores já passaram por conversas | P |
| 6 | ~~Teste de restauração em branch real do Neon~~ **Feito (22/10):** restaura em Postgres temporário e no branch `teste-restauracao`, com cadastro de teste; vigia diário ativo | — | — |
| 7 | **Dependabot:** revisar os PRs semanais e planejar a migração do `@tanstack/react-table` v9 (hoje fixado na v8) | Evita a main quebrada que já ocorreu uma vez | M |

## 3. Médio prazo

| # | Item | Por quê | Tam. |
|---|---|---|---|
| 8 | ~~Gravar o código na planilha~~ **Descartado:** o Excel não será alterado; a planilha será desativada (item 9). Até lá, a chave instável (processo + órgão + data + torre) segue como limitação conhecida da carga | O código `AAAA-NNNN` já identifica a oportunidade no Radar e no Planner, sem depender do Excel | — |
| 9 | **Encerrar a convivência com a planilha** (data de corte; planilha somente leitura; depois desligar o agente) | Elimina duplo lançamento e a dependência da máquina local | M |
| 10 | **Planner: propagar arquivamento e mudança de torre** (arquivar → mover para CANCELLED/concluir; trocar de plano) | Hoje o cartão fica órfão nesses casos | M |
| 11 | **Planner: conta de serviço** do time (login do `planner-auto` fora de pessoa) ou permissão de aplicativo | O computador já não é necessário (item 12), mas o login Microsoft ainda é o do João e expira em ~90 dias sem uso | M |
| 12 | ~~**Rodar a integração fora da máquina local** (runner agendado)~~ **Feito em 27/10/2026:** GitHub Actions disparado pelo Radar ao salvar, estado cifrado no banco (migração 018). Falta só desativar a tarefa do Windows | Mesma razão; exigia o item 11 | G |
| 13 | **Planner: alertas e relatório semanal** (atrasadas, vencendo, sem responsável) — Fase 1 do plano do `planner-auto` | Valor imediato para o time, sem tela nova | M |
| 14 | **Visões salvas e exportação CSV/Excel** na aba Oportunidades | Substitui o uso do Excel para consulta e envio | M |
| 15 | **Duplicatas:** tela de revisão (hoje só aviso no cadastro) e mesclagem | 6 grupos duplicados vindos da planilha | M |
| 16 | **Notificação de edição simultânea** em tempo real (ou aviso ao abrir) | Hoje só detecta ao salvar (409) | M |
| 17 | **Auditoria navegável:** tela de histórico global (quem mexeu em quê) com filtros | A trilha existe por registro; falta visão geral | M |
| 18 | **E2E contra a API real** (ambiente de teste com branch do Neon) | Hoje o e2e usa API simulada | M |
| 28 | **Editar linha → torre pela tela** (a aba Administração já mostra a regra em modo consulta; a edição ainda é por SQL) | Evitar SQL quando surgir uma linha nova | P |
| 29 | **Mais de uma empresa vencedora** (lista de CNPJs) e preço por empresa | Hoje há um único CNPJ; o texto antigo fica só como registro anterior | M |
| 30 | **Valores formatados no modo leitura** (R$ e %) e destaque dos campos alterados | Hoje a tela travada mostra o número bruto | P |
| 31 | **Fonte alternativa para o CNPJ** (e cache) se a BrasilAPI ficar instável | Reduz dependência de um serviço público | P |

## 4. Longo prazo

| # | Item | Por quê | Tam. |
|---|---|---|---|
| 19 | **Eventos dos Fluxos 1 a 3** (parecer GO/NO GO, aderência) e **agenda** (sessão do pregão, limite de impugnação) no Planner | Une o processo de análise ao acompanhamento; precisa compatibilizar a chave (UASG + ano + pregão) com `RAD-<id>` | G |
| 20 | **Sincronização com a lista "Pipeline Oportunidades"** (SharePoint) | Uma só visão no M365; direção única Radar → lista | M |
| 21 | **Painel web do Planner** (funil, prazos, carga por responsável) integrado ao Radar | Visões que o Planner não tem | G |
| 22 | **Permissões ainda mais finas:** lista nominal no Access (hoje todo o domínio entra e quem não está em `usuarios` é editor), perfis por torre/plano | Os perfis administrador/editor/visualizador já existem (22/10/2026) | M |
| 23 | **Domínio próprio** e política de retenção/LGPD (histórico, e-mails dos usuários) | Profissionalização | M |
| 24 | **Neon pago** (histórico maior, sem limites de computação) ou segundo backup em outra região | Folga operacional se o volume crescer | P |
| 25 | **SLA real de triagem** (campo de data da decisão Go/No Go) | Hoje o indicador é um proxy distribuição → pregão | M |
| 26 | **ESLint** quando o `typescript-eslint` suportar TypeScript 7 | Hoje o gate é só o `tsc` | P |
| 27 | **Observabilidade:** métricas de uso, erros da API e tempo de resposta (Cloudflare Analytics / logs) | Hoje não há visão de uso | M |

## 5. Riscos que o roadmap endereça

| Risco | Itens |
|---|---|
| Dependência do computador do João (carga, Planner) | 4, 9, 11, 12 |
| Perda de vínculo ao corrigir a planilha | 8, 9 |
| Cartões órfãos no Planner | 10 |
| Credenciais antigas circulando | 5 |
| Quebra por atualização de dependência | 7, 18 |
| Qualidade dos dados migrados | 2, 15 |

## 6. Como usar este roadmap
- Revisar a cada mês junto com o teste de restauração e o calendário de segurança ([OPERACAO.md](OPERACAO.md) §4.4).
- Antes de começar um item médio/longo, abrir uma issue com o critério de aceite e o plano de teste.
