# Radar Pré-Vendas — Requisitos mínimos de infraestrutura (máquina com IP fixo)

Versão 1.1 · 12/11/2026 · para o time de infraestrutura provisionar **uma máquina (VM)** que roda a consulta à API da ConLicitações a partir de um **IP público fixo**.

> **O que este documento NÃO cobre:** o site, a API, o banco, os backups e as rotinas de e-mail/Planner/monitor continuam na nuvem (Cloudflare Pages, Neon, GitHub Actions, Supabase e Drive) e **não precisam de máquina própria**. Quem é dono de cada conta está em [CONTAS-E-SERVICOS.md](CONTAS-E-SERVICOS.md). O dimensionamento do outro projeto (Radar TIC, captador de editais) é separado e está no repositório dele.

## 1. Por que uma máquina

A API da ConLicitações (`consultaonline.conlicitacao.com.br/api`) recusa o token do Radar (HTTP 401) quando chamada pelo Cloudflare Pages. A suspeita é **restrição por IP de origem**: o Cloudflare sai por IPs variáveis, que não dá para cadastrar na ConLicitações. Uma máquina com **IP público fixo e saída dedicada** resolve, porque esse IP é informado à ConLicitações para liberação.

> **Causa confirmada em 12/11/2026:** o token é válido (a consulta retornou HTTP 200 a partir de um IP liberado, pela VPN) e a ConLicitações recusa as chamadas feitas pelo Cloudflare Pages (HTTP 401, "Token inválido ou IP de origem não cadastrado"). É restrição por IP de origem. **A máquina só é necessária se a ConLicitações não retirar a restrição** (ver seção 10); pedir isso a eles vem primeiro.

## 2. Resumo para quem vai provisionar

| Item | Mínimo (funciona) | **Recomendado (produção)** |
|---|---|---|
| Sistema operacional | Linux 64 bits com suporte vigente (Ubuntu Server 22.04/24.04 LTS ou equivalente) ou Windows Server 2022 | **Ubuntu Server 24.04 LTS** (ou o padrão de servidores da empresa) |
| vCPU | 1 | **2** |
| Memória | 2 GB | **4 GB** (Windows Server: mínimo 4 GB) |
| Disco | 20 GB (Linux) / 60 GB (Windows) | **40 GB SSD** (Linux) |
| **IP público** | **Fixo, de saída (NAT/Elastic IP/IP reservado), exclusivo da máquina ou de um grupo conhecido** | idem, com o endereço **documentado e comunicado à ConLicitações** |
| Rede de entrada | **Nenhuma porta aberta** para a internet (nada escuta conexões) | idem; administração só pela VPN/bastion da empresa |
| Rede de saída | HTTPS (443) para os destinos da seção 5 | idem, com lista de liberação |
| Disponibilidade | Dias úteis, 07:00 às 20:00 (horário de Brasília) | **24 x 7**, sem suspensão nem hibernação |
| Fuso e hora | América/São Paulo, NTP ativo | idem |
| Software | **Node.js 22 LTS** (o `package.json` exige `>=22`), Git | idem, com atualizações de segurança automáticas |
| Conta de serviço | Usuário dedicado, **sem privilégio de administrador** | idem |

Os valores são para uma carga muito pequena (ver seção 3); sobram recursos de propósito. Pode ser a menor instância/VM que o time de infraestrutura oferece, desde que tenha **IP fixo**.

## 3. O que vai rodar e carga de trabalho

Um **coletor** em lote (Node.js), não um serviço web. A cada execução ele:

1. lê o catálogo de filtros da conta (`GET /filtros`);
2. lê o último boletim de cada filtro (`GET /boletim/{id}?page=1&per_page=100`);
3. normaliza licitações e acompanhamentos (inclui diligências e esclarecimentos, quando a ConLicitações os fornecer);
4. entrega o resultado ao Radar (seção 6).

| Medida | Valor |
|---|---|
| Frequência prevista | a cada 30 minutos em dias úteis (igual ao monitor atual); ajustável |
| Chamadas por execução | 1 + número de filtros da conta (dezenas no máximo, **estimativa**) |
| Tráfego por execução | menos de 5 MB (**estimativa**) |
| Duração de uma execução | segundos a poucos minutos (timeout por chamada: 20 s) |
| Memória em uso | cerca de 150 a 300 MB durante a execução (**estimativa**) |
| Processos simultâneos | 1 (a rotina deve usar trava para não sobrepor execuções) |
| Armazenamento local | só código, dependências (`npm ci`, ~0,5 GB) e logs; nenhum dado de negócio permanece na máquina |

Números marcados como **estimativa** serão confirmados no piloto (seção 9).

## 4. Software e configuração

- **Node.js 22 LTS** e Git. Dependências instaladas com `npm ci` a partir do repositório (o repositório é público; a máquina só **baixa** o código).
- **Agendador do sistema** (systemd timer ou cron no Linux; Agendador de Tarefas no Windows) chamando o script a cada 30 minutos. A execução deve registrar código de saída e hora.
- **Atualização do código:** `git pull` controlado (manual ou por tarefa agendada), com a versão fixada por tag/commit aprovado.
- **Relógio sincronizado** (NTP): os registros de snapshot e evento usam a hora do servidor.

## 5. Rede: destinos de saída (lista de liberação)

Somente **saída**, por HTTPS (443), a partir do IP fixo:

| Destino | Para quê |
|---|---|
| `consultaonline.conlicitacao.com.br` | API da ConLicitações (**o IP fixo da máquina é o que será liberado**) |
| Servidor do banco Neon do projeto (`*.neon.tech`, região `sa-east-1`) | gravar o resultado; o driver usado pelo projeto trabalha sobre 443. Se o time preferir Postgres puro, liberar também 5432 para esse host |
| `api.github.com` e `github.com` | baixar o código e (opcional) acionar rotinas |
| `registry.npmjs.org` | instalar dependências (pode ser por proxy/espelho da empresa) |
| Servidores de atualização do sistema operacional e de NTP | manutenção |

Nenhuma porta de entrada, nenhum balanceador, nenhum DNS público.

## 6. Como o resultado volta ao Radar (decisão pendente)

O coletor ainda **não foi implementado**; a escolha abaixo muda só o segredo que fica na máquina. A proposta é a opção A.

| Opção | Como funciona | Segredos na máquina |
|---|---|---|
| **A. Gravar direto no banco (proposta)** | o coletor grava os eventos no Neon com um **papel dedicado de privilégio mínimo** (só as tabelas de licitações/diligências), no mesmo modelo do papel `radar_monitor` | `CONLICITACAO_TOKEN`, `DATABASE_URL_CONLICITACAO` |
| B. Enviar pela API do Radar | o coletor chama uma rota nova do Radar com chave de API, e o Radar grava | `CONLICITACAO_TOKEN`, chave da API externa |

## 7. Segurança

- **Segredos fora do Git:** o token e a connection string ficam só no cofre de segredos da máquina ou em variáveis de ambiente do usuário de serviço, com permissão de leitura restrita a ele. Nunca em arquivo versionado, em script, em log ou em tela.
- **Sem agente de CI público:** **não** instalar *self-hosted runner* do GitHub nesta máquina. O repositório é público, e um runner próprio executaria código vindo de PRs. O agendamento é local, não pelo GitHub Actions.
- **Privilégio mínimo:** usuário de serviço sem administrador; papel do banco com acesso só ao necessário; sem acesso à produção além disso.
- **Hardening básico:** atualizações de segurança automáticas, antivírus/EDR conforme o padrão da empresa, firewall com entrada bloqueada, acesso administrativo só por VPN/bastion e com MFA.
- **Logs sem dados sensíveis:** o log registra contagens, status HTTP e duração, nunca o token, o corpo das respostas nem dados de licitantes. Rotacionar e guardar por 30 dias.
- **Rotação:** o token da ConLicitações e a senha do papel do banco devem ser trocados de forma planejada (procedimento em [OPERACAO.md](OPERACAO.md)).

## 8. Operação e monitoramento

- **Alerta de execução parada:** o coletor registra a última execução bem-sucedida no banco; o Radar deve mostrar "última atualização" e alertar se passar de 2 horas em dias úteis.
- **Falha de credencial ou de IP** (401/403): visível na aba Licitações com a mensagem já existente; também registrada no log da máquina.
- **Backup:** a máquina é descartável (nada de negócio nela). O que se guarda é o procedimento de reinstalação (este documento + o repositório) e o IP fixo reservado.
- **Capacidade:** nenhuma ação esperada; revisar só se a conta ganhar muitos filtros.

## 9. Pendências e critérios de aceite

**Antes de provisionar**

1. ~~**Confirmar a restrição por IP.**~~ **Feito em 12/11/2026** (200 no IP liberado, 401 pelo Cloudflare). Procedimento usado: Com a VPN ligada, testar a chamada à API da ConLicitações **de uma máquina com IP conhecido** e comparar com a chamada pelo Cloudflare. Teste: `curl -s -o /dev/null -w "%{http_code}" -H "X-AUTH-TOKEN: $T" https://consultaonline.conlicitacao.com.br/api/filtros`, com o token numa variável `T` digitada na hora (nunca colada em chat ou arquivo). `200` no IP conhecido e `401` pelo Cloudflare confirma a restrição por IP; `401` nos dois indica problema no próprio token. Perguntar ao suporte da ConLicitações **quais IPs o token aceita**, **como cadastrar o novo IP** e **quais limites de chamadas por minuto/dia** a API aplica.
2. **Decidir o destino do resultado** (seção 6) e criar o papel do banco correspondente.
3. **Definir o dono da máquina e do IP fixo** (conta/centro de custo) e registrar em [CONTAS-E-SERVICOS.md](CONTAS-E-SERVICOS.md).

**Aceite da máquina (depois de provisionada)**

- [ ] IP público de saída é o IP fixo informado (`curl https://api.ipify.org` ou equivalente, por quem tem acesso).
- [ ] Nenhuma porta de entrada acessível de fora.
- [ ] Node.js 22 e Git instalados; relógio sincronizado; fuso América/São Paulo.
- [ ] Saída HTTPS liberada para todos os destinos da seção 5.
- [ ] IP cadastrado na ConLicitações e consulta de `/filtros` com resposta **200** a partir da máquina.
- [ ] Execução completa do coletor lê os boletins e grava no banco sem erro.
- [ ] Duas execuções seguidas não duplicam registros nem se sobrepõem.
- [ ] Falha simulada (token errado) aparece como erro visível, sem quebrar o restante do painel.
- [ ] Reinício da máquina: o agendador volta sozinho e a próxima execução ocorre no horário.
- [ ] Nenhum segredo aparece em log, histórico de comandos ou arquivo do repositório.

## 10. Alternativas

- **Sem máquina (tentar primeiro):** a ConLicitações remove a restrição de IP do token. É a opção mais simples. Cadastrar as faixas de IP do Cloudflare não é uma boa saída: são faixas enormes e compartilhadas com outros clientes, e o IP de saída do Cloudflare Pages não é garantido nem estável, então a liberação seria frágil e pouco segura.
- **Serviço gerenciado com IP de saída fixo** (por exemplo um serviço de nuvem com NAT dedicado): exige conta e cartão na nuvem escolhida; mesmo conjunto de requisitos de rede e segurança deste documento.
- **Máquina pessoal na VPN:** só para testes. Não serve para produção (depende de uma pessoa ligada e logada, como o histórico do Planner mostrou em [INTEGRACAO-PLANNER.md](INTEGRACAO-PLANNER.md)).
