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
