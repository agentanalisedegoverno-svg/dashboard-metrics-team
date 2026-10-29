# Módulo de monitoramento de licitações

## Escopo desta entrega

O módulo vive na aba **Licitações** do Radar Pré-Vendas e reutiliza a autenticação, o tema, os tokens de cor, a tipografia e os componentes de navegação existentes.

### Elegibilidade automática

A migração 021 cria um registro de monitoramento para oportunidades não arquivadas com status:
- Prospect
- Go
- Onboarding
- On going

Quando a oportunidade deixa essas etapas ou é arquivada, o monitoramento é pausado. Registros existentes elegíveis são semeados na aplicação da migração.

### Fontes e identificadores

- **PNCP:** coleta automática ativa para vínculos confirmados com identificador CNPJ/ano/sequencial ou URL oficial que contenha `/orgaos/{CNPJ}/compras/{ano}/{sequencial}`.
- **Compras.gov.br:** disponível na interface para cadastro do vínculo, mas o coletor desta primeira entrega não consulta essa fonte automaticamente. O endpoint de detalhe por identificador precisa de validação de contrato ponta a ponta antes de ativar.
- **Associação automática:** ainda não se confirma um processo apenas pelo nome do órgão ou texto do objeto. O usuário confirma o identificador oficial no módulo para evitar monitorar um certame incorreto. A descoberta e sugestão automática de candidatos é a próxima etapa.

## Instalação

1. Revisar e aplicar `db/migrations/021_monitoramento_licitacoes.sql` no Neon usando o mesmo processo de migrações do Radar e o papel proprietário do banco. A migração é aditiva; não substitui tabelas de oportunidades.
2. No GitHub, cadastrar o secret `DATABASE_URL_MONITOR` com conexão Neon dedicada ao monitoramento. Preferir um papel com permissões mínimas apenas para as tabelas/funções do módulo; não reutilizar uma credencial de proprietário.
3. Verificar o workflow **Monitoramento de licitações** em Actions. Ele roda a cada 30 minutos e também pode ser executado manualmente.
4. Fazer vínculo de teste para um processo real publicado no PNCP e informar o identificador oficial CNPJ/ano/sequencial. Confirmar a primeira coleta, depois uma segunda coleta e o registro de falha simulada antes de habilitar para a equipe.

## Comportamento de coleta

- Primeira coleta bem-sucedida grava a linha de base; não gera alerta de mudança só por ser a primeira observação.
- Em consultas seguintes, conteúdo diferente gera snapshot e evento de comparação com link para a fonte.
- Erros são registrados como falha e reagendados; o último snapshot confirmado é mantido.
- O coletor consulta até 30 registros por execução por padrão, ajustável para 1–100 via `MONITOR_BATCH_SIZE`.
- A frequência de 30 minutos é uma cadência de processamento, não uma garantia de atualização da fonte. APIs públicas podem atualizar com atraso ou não publicar dados de sessão ao vivo.

## Limites semânticos

O módulo não infere convocação, vitória, contratação ou posição ao vivo a partir de uma mudança genérica. Mudanças por comparação precisam de validação humana e devem manter referência à fonte. A cobertura inicial é de dados estruturados publicados; telas restritas, CAPTCHA, MFA e endpoints não autorizados não serão contornados.

## Testes de aceite

- [ ] Migração aplicada sem alterar dados existentes de oportunidades.
- [ ] Nova oportunidade Prospect/Go/Onboarding cria registro de monitoramento.
- [ ] Mudar para status fora do escopo pausa o registro; retornar a status elegível reativa a fila.
- [ ] Vínculo PNCP válido executa coleta e grava snapshot.
- [ ] Segunda coleta sem alteração não duplica evento.
- [ ] Alteração de conteúdo gera evento deduplicado e alerta aberto.
- [ ] Falha da API preserva snapshot anterior e deixa erro visível.
- [ ] Acesso anônimo à API continua bloqueado pelo middleware atual do Radar.
- [ ] Build, testes, segurança e E2E passam antes do merge/publicação.

## Descoberta assistida de candidatos PNCP

Na janela de vínculo, o botão **Buscar candidatos no PNCP** consulta o endpoint público `GET /api/consulta/v1/contratacoes/proposta` com `dataFinal`, paginação e, quando disponível, UF. A API oficial documenta essa consulta como contratações com recebimento de propostas aberto.

A lista é ordenada por correspondência heurística entre número do processo, UASG/unidade, órgão e tokens do objeto. A pontuação é apenas uma sugestão, não uma probabilidade estatística. O usuário precisa selecionar explicitamente o candidato e salvar o vínculo; nenhuma associação é feita só com base no score. Certames encerrados podem não aparecer nessa busca, portanto um resultado vazio não comprova ausência no PNCP.

Após selecionar um candidato, confirme o identificador PNCP e a URL gerada antes de salvar. A coleta posterior passa a monitorar contratação, itens e histórico quando os endpoints correspondentes respondem com sucesso. Falha de itens/histórico deixa a coleta como parcial, sem apagar o snapshot anterior.

### Habilitar a rotina agendada

O workflow tem uma proteção de ativação: a agenda de 30 minutos só consulta fontes quando a variável de repositório `MONITOR_LICITACOES_ENABLED` estiver definida como `true`. Isso evita executar uma rotina sem migração/credenciais. Para liberar a agenda, primeiro aplique a migração e valide a coleta manual; depois configure o secret `DATABASE_URL_MONITOR` e a variável `MONITOR_LICITACOES_ENABLED=true`. O disparo manual permanece disponível para testes e falha explicitamente se o secret estiver ausente.


### Elegibilidade e vínculo automático

A fila inclui oportunidades não arquivadas com status Prospect, Go, Onboarding, On going/Ongoing e Suspended/Suspenso. A rotina pausa oportunidades que saem desse conjunto e as reativa quando retornam.

Quando o campo Site contém uma URL oficial canônica do PNCP (`/app/editais/{CNPJ}/{ano}/{sequencial}`), a migração/trigger extrai o identificador e cria o vínculo automaticamente. Quando há somente número de processo ou uma página genérica do portal, o registro permanece pendente para evitar associação errada; a busca de candidatos atual é uma descoberta auxiliar e não cobre todos os certames, especialmente processos encerrados/suspensos.

A coleta automática continua protegida por `MONITOR_LICITACOES_ENABLED=true` e requer `DATABASE_URL_MONITOR` com privilégio mínimo. Habilitar a variável somente depois de aplicar e validar a migração no ambiente alvo.

## Painel de certames (aba Licitações)

A aba abre como um painel de urgência, calculado só com os dados do cadastro do Radar (sem banco novo, sem consulta externa ao abrir):

- **Certames (Prospect e Go):** agrupados por Pregão já passou, Hoje, Amanhã, Próximos 7 dias, Mais adiante e Sem data. Cada cartão mostra o título da situação, a **próxima ação** e o que falta no cadastro. Processo e UF ausentes sobem a urgência perto do pregão; UASG (não cobrada de Corporate) e link do edital só informam.
- **Contratos (On going, Onboarding, Suspended):** visão separada, sem alerta de pregão; Suspended pede confirmação de retomada.
- **Procurar edital no PNCP:** botão por cartão, sob demanda. Consulta pregões eletrônicos (código 6) com propostas abertas na UF, 50 por página, até 6 páginas (300), com cache de 10 minutos por UF. O resultado é sugestão por semelhança; confirme o processo.
- **Fontes públicas (diagnóstico):** bloco recolhido (Compras.gov.br e ConLicitações); só consulta quando aberto.
- Regras em `src/features/licitacoes/noc.ts` (funções puras, com testes).

O acompanhamento automático com histórico e alertas de mudança (migração 021, secret `DATABASE_URL_MONITOR` e `MONITOR_LICITACOES_ENABLED=true`) continua desligado; é a Fase 2.
