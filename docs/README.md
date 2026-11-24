# Documentação

Índice dos documentos. Comece por **OPERACAO** (o dia a dia) e **MIGRACAO-AZURE** (como o banco está montado hoje). O banco de produção é o **Azure Database for PostgreSQL** desde 18/11/2026; documentos antigos que citam o Neon trazem um aviso no topo.

## Operação e recuperação

- [OPERACAO.md](OPERACAO.md): Operação do Radar Pré-Vendas
- [BACKUP.md](BACKUP.md): Backup do banco (Neon → Google Drive e espelho no Supabase)
- [MIGRACAO-AZURE.md](MIGRACAO-AZURE.md): Banco no Azure (Azure Database for PostgreSQL)
- [PLANO-DE-ACAO-BANCO.md](PLANO-DE-ACAO-BANCO.md): Plano de ação: banco gratuito, redundância e backup
- [INCIDENTE-2026-11-17-NEON.md](INCIDENTE-2026-11-17-NEON.md): Incidente: banco bloqueado por cota (17–18/11/2026)
- [CONTAS-E-SERVICOS.md](CONTAS-E-SERVICOS.md): Contas e serviços (mapa para centralização)
- [REQUISITOS-INFRA.md](REQUISITOS-INFRA.md): Arquitetura atual (front, workers e banco) e requisitos de infraestrutura, com rede, segredos, capacidade e riscos; a Parte E traz a máquina com IP fixo

## Produto e integrações

- [CADASTRO-OPORTUNIDADES.md](CADASTRO-OPORTUNIDADES.md): Especificação: cadastro de oportunidades na aplicação web
- [EMAIL-NOVAS-OPORTUNIDADES.md](EMAIL-NOVAS-OPORTUNIDADES.md): E-mail a cada nova oportunidade
- [INTEGRACAO-PLANNER.md](INTEGRACAO-PLANNER.md): Integração Radar → Microsoft Planner
- [MONITORAMENTO-LICITACOES.md](MONITORAMENTO-LICITACOES.md): Módulo de monitoramento de licitações
- [API-EXTERNA.md](API-EXTERNA.md): API externa: criar oportunidades a partir de outra aplicação
- [API-LEITURA.md](API-LEITURA.md): API de leitura: consultar as oportunidades (somente visualização, para agentes e relatórios)
- [DIAGNOSTICO.md](DIAGNOSTICO.md): Diagnóstico de erros (503/502): origem da resposta, código da requisição, log e `/api/diagnostico`
- [MCP-REMOTO.md](MCP-REMOTO.md): MCP remoto somente leitura (Claude.ai, Copilot Studio, Gemini, GPT personalizado): como liberar para outras pessoas
- [../mcp/README.md](../mcp/README.md): servidor MCP somente leitura (agentes de IA consultam as oportunidades; depende da API de leitura)
- [API-COMPRAS-GOV-ENDPOINTS.md](API-COMPRAS-GOV-ENDPOINTS.md): API Compras.gov.br (Dados Abertos) — mapa dos endpoints

## Arquitetura e testes

- [ARQUITETURA.md](ARQUITETURA.md): Arquitetura do Radar Pré-Vendas
- [DIAGRAMAS.md](DIAGRAMAS.md): Diagramas do Radar Pré-Vendas
- [TESTES.md](TESTES.md): Testes: regressão, carga, desempenho e segurança
- [ROADMAP.md](ROADMAP.md): Roadmap de melhorias

## Histórico (referência; parte pode estar superada)

- [CARGA-DE-DADOS.md](CARGA-DE-DADOS.md): Carga de dados (planilha → Postgres, por merge)
- [AGENTE-DE-CARGA.md](AGENTE-DE-CARGA.md): Carga automática da planilha (planilha → banco, por merge)
- [DECISAO-FIM-DA-CARGA-DA-PLANILHA.md](DECISAO-FIM-DA-CARGA-DA-PLANILHA.md): Decisão: o banco não é mais alimentado pela planilha do Excel

## Observações

- `api-externa.openapi.json`: especificação OpenAPI da API externa (gerada; ver API-EXTERNA.md).
- `api-leitura.openapi.json`: especificação OpenAPI só de leitura, para importar em um GPT personalizado (gerada; mesmo comando `UPDATE_OPENAPI=1`).
- `diagramas/`: diagramas SVG gerados por `scripts/gerar-diagramas.mjs`. Os diagramas D02, D03, D12, D15 e D17 ainda mostram o Neon e devem ser regerados.
