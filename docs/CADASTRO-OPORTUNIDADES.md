# Especificação: cadastro de oportunidades na aplicação web

> Status: **implementado e em produção** (F0–F4 concluídas em 20–21/10/2026; F5, encerramento da planilha, pendente). Este documento mantém a especificação original; o desenho atual está em [ARQUITETURA.md](ARQUITETURA.md) e o que falta em [ROADMAP.md](ROADMAP.md).
> Objetivo: tirar a planilha `BaseLicitacao.xlsx` do centro do processo. Os usuários da organização cadastram e atualizam oportunidades numa nova aba do Radar; cada gravação alimenta o banco que já serve as métricas do time.

## 1. Decisões de produto

| Tema | Decisão |
|---|---|
| Quem acessa | Qualquer usuário `@ctctech.com.br` (login pelo Cloudflare Access já existente). A identidade (e-mail) vai em todo registro e no histórico. |
| Cadastro | Qualquer usuário cadastra oportunidades. |
| Edição | Qualquer usuário edita; toda alteração fica no **histórico** (quem, quando, campo, valor anterior e novo). |
| Exclusão | Somente **administradores** arquivam (exclusão lógica, reversível). |
| Listas de opções | **Listas fechadas** (Status, Torre, Linha de Serviço, Pré-vendas, Site, Modalidade, motivos...), administráveis numa tela de configuração. Grafias normalizadas. |
| Virada da planilha | **Convivência temporária**: planilha e web em paralelo, com sincronização por merge (seção 3). Data de encerramento a definir; depois a planilha vira somente leitura. |
| Escopo da v1 | Formulário completo + grade com busca/filtros/ordenação + edição + histórico + migração limpa dos 600 registros atuais. |

## 2. Dicionário de dados (34 colunas da planilha)

Perfil feito sobre as 600 linhas de 14/10/2026. "Preench." é o percentual de linhas com valor.

| # | Coluna da planilha | Campo | Tipo | Preench. | Regra / observação |
|---|---|---|---|---|---|
| 1 | Data de distribuição (envio edital) | `data_distribuicao` | data | 90% | Opcional. Não pode ser posterior à Data Pregão (41 linhas violam hoje). |
| 2 | Status | `status` | lista | 98% | **Obrigatório**. 9 valores: No Go, Lost, Prospect, Canceled, On going, Win, Validar, Suspended, Go. "Validar" passa a ser *pendência*, não opção. |
| 3 | Data Pregão | `data_pregao` | data | 100% | **Obrigatória**. Deriva `ano` e `mes`. Faixa 2025-01 a 2026-12 hoje. |
| 4 | Instituição / Órgão | `orgao` | texto 1–120 | 100% | **Obrigatório**. 472 grafias distintas: autocompletar a partir de órgãos já cadastrados. |
| 5 | Descritivo | `descritivo` | texto ≤ 300 | 100% | **Obrigatório**. |
| 6 | Critério | `criterio` | lista | 90% | Menor Preço, Técnica e Preço (normalizar "preço/Preço"). |
| 7 | UF | `uf` | lista | 100% | 27 UFs. "Validar" e vazio viram pendência. |
| 8 | Processo | `processo` | texto ≤ 60 | 98% | Texto sempre (21 linhas vêm como número). Alerta de duplicata com órgão + data. |
| 9 | UASG | `uasg` | texto | 66% | Texto (preserva zero à esquerda; "-" vira vazio). |
| 10 | Modalidade | `modalidade` | lista | 98% | 14 valores; normalizar ("Chamamento"/"Chamamento Público"). |
| 11 | Tipo | `tipo` | lista | 0% | Quase não usada (2 linhas). Campo "Avançado". |
| 12 | Modo de Disputa | `modo_disputa` | lista | 89% | Aberto, Aberto e Fechado, Fechado, Dispensa com disputa. |
| 13 | Origem | `origem_oportunidade` | lista | 70% | Reativo, Proativo. |
| 14 | Pré-Vendas | `analista` | lista | 92% | 7 pessoas hoje. Lista administrável. |
| 15 | Site | `site` | lista | 82% | 25 grafias para ~12 portais reais. Lista normalizada. |
| 16 | Vistoria | `vistoria` | lista | 82% | Sim, Não, Opcional, Omissa (4 valores, sem variação de grafia). |
| 17 | Linha de Serviço | `linha_servico` | lista | 95% | 11 valores. |
| 18 | Torre | `torre` | lista | 100% | **Obrigatório**. ITS, DIGITAL, HEALTH. |
| 19 | Unidade de Fornecimento | `unidade_fornecimento` | texto | 1% | "Avançado". |
| 20 | Conta Vinculada | `conta_vinculada` | lista | 9% | Sim/Não (unifica "SIM"/"Sim"). |
| 21 | MC CTC | `mc_ctc` | número | 2% | Percentual. Hoje mistura 0,18 e 18: padronizar em fração (0–1) e validar faixa. |
| 22 | Simulação da MC x Arrematante | `simulacao_mc_arrematante` | número | 0% | Mesma regra de percentual. "Avançado". |
| 23 | Orçamento | `orcamento` + `orcamento_sigiloso` | R$ ≥ 0 | 76% | "Sigiloso" (20 linhas) vira marcação própria, sem valor. |
| 24 | Valor Vencedor | `valor_vencedor` | R$ ≥ 0 | 28% | Aceita colar "R$ 7.500.000,00" e converte. Alerta se maior que o orçamento (2 linhas). |
| 25 | Valor CTC | `valor_ctc` | R$ ≥ 0 | 13% | **Obrigatório** quando Status = Win (hoje ok em 12/12). |
| 26 | Custo Total CTC | `custo_total_ctc` | R$ ≥ 0 | 0% | Coluna nova; "Avançado". |
| 27 | Motivo de NO GO | `motivo_no_go` | lista | 73% | **Obrigatório** quando Status = No Go (2 linhas violam hoje). 24 grafias → ~14 motivos. |
| 28 | Detalhe do NO GO | `detalhe_no_go` | texto longo ≤ 4000 | 68% | Multilinha (máx. 3.502 caracteres hoje). |
| 29 | Empresas Vencedoras | `empresas_vencedoras` | texto longo ≤ 500 | 32% | Idealmente lista de empresas; v1 texto. |
| 30 | Motivo do Lost | `motivo_lost` | lista | 5% | **Obrigatório** quando Status = Lost (30 linhas violam hoje). |
| 31 | Acompanhamento / Status / Observações | `observacoes` | texto longo ≤ 4000 | 11% | Multilinha. |
| 32 | Posição pós lance CTC | `posicao_lance` + `situacao_lance` | inteiro ≥ 1 + lista | 10% | "19ª posição" → 19; "Desclassificada" e "Não participamos" → `situacao_lance`. |
| 33 | Mês | *(derivado)* | — | 100% | Calculado de `data_pregao`. Não é digitado. |
| 34 | Ação IA | `acao_ia` | reservado | 0% | Pertence a outro agente. Aparece somente leitura; nunca editável no formulário. |

**Código da oportunidade** (`codigo`, `AAAA-NNNN`): identificador de negócio, atribuído automaticamente (ano da data do pregão + número sequencial do ano, de `0001` em diante), **único e imutável**. Aparece na grade, no formulário e no título do cartão do Planner. Numeração inicial feita em 21/10/2026 (da data do pregão mais antiga para a mais nova, por ano); depois disso, cada nova oportunidade recebe o próximo número do ano.

Campos derivados (nunca digitados): `ano`, `mes` (de `data_pregao`) e `sla` = dias entre `data_distribuicao` e `data_pregao`.

## 3. Convivência planilha ↔ web (sincronização por merge)

O agente atual **apaga e reescreve toda a base**. Isso é incompatível com cadastro na web. Na convivência:

1. Cada linha tem `fonte` (`planilha` ou `web`) e `chave_planilha` (identificador estável gerado a partir de processo + órgão + data pregão + torre, com contador para repetições).
2. O agente deixa de usar `carregar_oportunidades` (substituição total) e passa a chamar `sincronizar_planilha`, que: **insere** linhas novas, **atualiza** linhas da planilha que mudaram e **nunca toca** em linhas de origem `web` nem em linhas **editadas na web** (campo `editado_na_web`).
3. Linha que sumiu da planilha **não é apagada**: é marcada `ausente_na_planilha` e aparece para revisão.
4. No cadastro web, o sistema avisa de **possível duplicata** (mesmo processo + órgão + data) antes de salvar.
5. Regra de ouro: **a edição na web vence a planilha**. Definir a data de encerramento da convivência para o time parar de editar o Excel.

## 4. Validações

**Bloqueiam o salvamento** (erro): Status, Data Pregão, Órgão, Descritivo e Torre obrigatórios; valores monetários ≥ 0; datas válidas; Data Pregão ≥ Data de distribuição; opções só das listas; Motivo de NO GO obrigatório se No Go; Motivo do Lost obrigatório se Lost; Valor CTC obrigatório se Win; limites de tamanho.

**Avisam mas permitem** (alerta): possível duplicata; Valor Vencedor > Orçamento; Valor CTC > Orçamento; pregão no passado com status Prospect/On going; UF fora da lista (pendência); campos em "Validar" (vão para a visão **Pendências**).

As mesmas regras rodam **no navegador e na API** (um único esquema Zod compartilhado), e a API é a fonte de verdade.

## 5. Arquitetura

```mermaid
flowchart LR
  U(["Usuário @ctctech.com.br"]) --> ACC["Cloudflare Access"]
  ACC --> SPA["Painel React: aba Oportunidades"]
  SPA -->|"fetch + cabeçalho CSRF"| API["Pages Functions /api/oportunidades"]
  API -->|"papel radar_app (INSERT/UPDATE limitado)"| DB[("Neon Postgres")]
  DB --> HIST[("oportunidades_historico")]
  DB --> OPT[("opcoes (listas)")]
  AG["Agente de carga (merge)"] -->|"sincronizar_planilha()"| DB
  SPA2["Abas de métricas"] -->|"papel radar_leitor (SELECT)"| DB
```

- **Banco:** colunas novas na tabela `oportunidades` (apenas adições, sem quebrar o painel atual); tabelas `opcoes` (listas), `oportunidades_historico` (auditoria) e `usuarios_admin`.
- **API:** `GET/POST /api/oportunidades`, `GET/PATCH /api/oportunidades/:id`, `POST /api/oportunidades/:id/arquivar` (admin), `GET /api/opcoes`, `GET /api/oportunidades/:id/historico`. Validação Zod, **bloqueio otimista** (`versao`: se dois usuários editam a mesma linha, o segundo recebe conflito em vez de sobrescrever), e papel de banco **dedicado** com permissão só para o necessário.
- **Segurança:** identidade vem do JWT do Access (nunca do corpo da requisição); proteção CSRF (cabeçalho obrigatório + verificação de origem); consultas parametrizadas; limites de tamanho; trilha de auditoria imutável.

## 6. Experiência de uso e responsividade (celular até 4K/8K)

- **Aba "Oportunidades"** com duas visões: **Grade** (consulta) e **Formulário** (cadastro/edição em painel lateral ou página).
- **Formulário em seções** (nada de 34 campos numa tela só): *Identificação* (órgão, processo, UASG, descritivo, datas), *Edital* (modalidade, critério, modo de disputa, site, vistoria, UF), *Equipe* (torre, linha, pré-vendas, origem), *Resultado* (status, motivos, valores, posição, vencedores), *Avançado* (campos raros). Campos condicionais aparecem conforme o Status. Resumo fixo com pendências e alertas.
- **Grade:** busca global, filtros por Status/Torre/Linha/Pré-vendas/período, ordenação, colunas configuráveis, **virtualização** (fluida com milhares de linhas), edição rápida em painel, indicador de pendências.
- **Responsivo de 320 px a 8K:** layout em *grid* fluido com `minmax` e consultas de contêiner; largura máxima de leitura controlada e tipografia fluida (`clamp`); em telas muito largas a grade ganha colunas e o formulário vira duas ou três colunas, em vez de esticar campos; alvos de toque ≥ 44 px no celular; tema claro/escuro; testes visuais em 390, 768, 1280, 1920, 3840 e 7680 px.
- **Acessibilidade WCAG 2.2 AA:** rótulos e erros associados aos campos, foco visível e navegação por teclado, contraste verificado (já temos teste automático com axe).

## 7. Bibliotecas

Mantemos a base atual (React 19, TypeScript, Tailwind v4, componentes no padrão shadcn/ui sobre Radix) e adicionamos só o necessário:

| Necessidade | Biblioteca | Motivo |
|---|---|---|
| Formulário | **React Hook Form** + resolver **Zod** | Pouco re-render, validação por esquema compartilhado com a API. |
| Grade | **TanStack Table** + **TanStack Virtual** | Padrão de mercado, headless (combina com Tailwind), virtualização. |
| Dados/cache | **TanStack Query** (já usado) | Mutations com atualização otimista e invalidação. |
| Campos | componentes shadcn (Select, Combobox/Command, Popover, Calendar, Sheet, Tabs) | Acessíveis e consistentes com o painel atual. |
| Datas | **date-fns** (pt-BR) | Leve e sem estado global. |
| Notificações | **sonner** | Toasts acessíveis. |

## 8. Plano em fases (estado)

| Fase | Entrega | Critério de aceite |
|---|---|---|
| F0 ✅ | Esta especificação revisada | Aprovada pelo dono do produto. |
| F1 ✅ | **Banco:** migração aditiva, listas normalizadas, histórico, papel `radar_app`, `sincronizar_planilha`; backfill dos 600 registros com relatório de qualidade | Painel atual segue idêntico; 600 linhas migradas; relatório de pendências gerado. |
| F2 ✅ | **API** com validação, auditoria, bloqueio otimista, CSRF e papéis | Testes unitários e de contrato; conflito de edição detectado. |
| F3 ✅ | **Front:** aba Oportunidades (formulário, grade, edição, histórico) | E2E (criar, editar, conflito, arquivar), axe sem violações, visual 390–7680 px. |
| F4 ✅ | **Convivência:** agente passa ao merge; runbook e data de encerramento | Carga do agente não sobrescreve edição web (teste automatizado). |
| F5 ⏳ | Encerramento: planilha somente leitura; limpeza | Checklist de virada. |

## 9. Riscos e pontos em aberto (resolvidos e pendentes)

- **Quem são os administradores** (e-mails): preciso da lista para o papel de arquivar e editar listas.
- **Lista de Pré-vendas:** são pessoas do time, não necessariamente usuários do Access; manter lista própria ou mapear para e-mail?
- **Dados com problema** (41 pregões antes da distribuição, 30 Lost sem motivo, 6 grupos duplicados): corrigir na migração (com revisão do time) ou migrar como pendência?
- **Duplo lançamento** durante a convivência: mitigado pelo alerta de duplicata, mas depende de disciplina; por isso a data de encerramento.
- **Custo Total CTC e Ação IA:** campos novos/reservados; confirmar se `Ação IA` continuará sob outro agente.

**Resolvido:** administradores (`joao.henrique@ctctech.com.br`; os demais são promovidos na própria aba); Pré-vendas viram usuários com e-mail (também usado para atribuir cartões no Planner); dados com problema migraram como **pendência**; permissões mantidas (todos cadastram e editam, só o admin arquiva).
**Pendente:** data de encerramento da convivência com a planilha (F5) e destino de `Ação IA`.
