# Operação do Radar Pré-Vendas

Guia do dia a dia: como o sistema roda, onde ficam as configurações, como resolver problemas e como fazer manutenção. A visão de arquitetura está em [ARQUITETURA.md](ARQUITETURA.md) e o que vem a seguir em [ROADMAP.md](ROADMAP.md).

> **Regra de ouro:** nenhuma senha, token ou string de conexão vai para o Git. Este repositório é público.

## 1. Mapa de configuração

| O quê | Onde fica | Tipo | Quem altera |
|---|---|---|---|
| `DATABASE_URL` (papel `radar_leitor`) | Cloudflare Pages → `radar-prevendas` → Settings → Variables and Secrets (Production) | **Secret** | Administrador |
| `DATABASE_URL_APP` (papel `radar_app`, cadastro) | Cloudflare Pages → mesmo local | **Secret** | Administrador |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | `wrangler.toml` `[vars]` | público | Pull request |
| `ACESSO_PUBLICO` | `wrangler.toml` (ausente = API protegida) | público | Pull request (**não usar**) |
| `DATABASE_URL_WRITER` (papel `radar_escritor`) | variável de ambiente do usuário Windows da máquina do agente | **Segredo** | Administrador |
| `DATABASE_URL_PLANNER` (papel `radar_planner`) | variável de ambiente do usuário Windows da máquina da integração | **Segredo** | Administrador |
| `PLANNER_EVENTOS_DIR` | variável de ambiente do usuário Windows (`...\planner-auto\eventos\entrada`) | caminho | Administrador |
| `DATABASE_URL_BACKUP` (papel `radar_backup`) | GitHub → Settings → Secrets and variables → Actions | **Secret** | Administrador |
| `DATABASE_URL_RESTORE` (papel `radar_restore`, só no branch `teste-restauracao`) | GitHub (Actions) | **Secret** | Administrador |
| `BACKUP_PASSPHRASE` | GitHub (Actions) **e** cofre de senhas da empresa | **Secret** | Administrador |
| `RCLONE_DRIVE_TOKEN` | GitHub (Actions) | **Secret** | Administrador |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub (Actions) | **Secret** | Administrador |
| `DEMO_MODE` | GitHub → Actions → Variables (ausente = produção real) | variável | Administrador |
| Política de acesso (quem entra) | Cloudflare Zero Trust → Access → Applications → Radar Pré-Vendas → Policies | configuração | Administrador |
| Administradores do Radar e listas | Aba Oportunidades → **Listas e usuários** (só admin) | dados | Administrador do Radar |
| Mapa de planos/buckets do Planner | `config/planner-mapa.json` | público | Pull request |

## 2. Rotinas

### 2.1 Carga da planilha (a cada 2 dias, por merge)
- A tarefa `RadarPreVendas-Carga` (Agendador de Tarefas do Windows) roda o agente, que copia a planilha para o banco **por merge** (`scripts/sync-db.mjs`). Roteiro: [AGENTE-DE-CARGA.md](AGENTE-DE-CARGA.md).
- **O merge não apaga nada:** atualiza o que mudou, insere o novo, preserva o que foi editado na web e marca como "ausente" o que sumiu da planilha.
- **Pré-condições:** máquina ligada, OneDrive sincronizado ("sempre neste dispositivo") e `DATABASE_URL_WRITER` definida.
- **Verificar a última carga:** o painel mostra "Última atualização". No console do Neon (SQL Editor):
  ```sql
  select ultima_carga_em, total_linhas, fonte, erro from carga_status;
  ```
- **Carga manual:** na pasta do projeto, com a planilha exportada em `aba.json`:
  ```
  node scripts/sync-db.mjs aba.json --dry-run        # valida e mostra o relatório de qualidade, sem gravar
  node scripts/sync-db.mjs aba.json --fonte "manual"
  ```
- **Pendente (trava final):** depois que o agente rodar uma vez no novo fluxo, aplicar `db/migrations/002_revogar_carga_total.sql`. Ela tira do `radar_escritor` a carga total antiga, para um agente desatualizado nunca apagar o que foi cadastrado na web.

### 2.2 Cadastro e administração (aba Oportunidades)
- Todo `@ctctech.com.br` vê, cadastra e edita. **Só o administrador** arquiva/restaura e administra listas e usuários.
- **Novo pré-vendas:** aba Oportunidades → *Listas e usuários* → Usuários → informar nome e **e-mail** (o e-mail é o que atribui o cartão no Planner).
- **Nova opção de lista** (modalidade, site, motivos…): *Listas e usuários* → Listas. Itens desativados somem do cadastro, mas continuam válidos em registros que já os usam.
- **Nova linha de serviço que não seja ITS:** incluir em `linhas_torre` (Neon → SQL Editor): `insert into linhas_torre (linha, torre) values ('Nome exato da linha', 'DIGITAL');` (ou `'HEALTH'`). Linha sem mapeamento resulta em **ITS**, como na planilha.
- **Consulta de CNPJ fora do ar:** o cadastro segue; a tela avisa e a razão social é consultada de novo ao salvar.
- **Pendências da migração:** a grade tem o filtro "Só com pendências"; corrigir o registro e salvar remove a pendência.

### 2.3 Integração com o Planner (a cada 30 minutos)
- Tarefa do Windows **`Radar-Planner integracao`**: seg–sex, 07h–19h, de 30 em 30 minutos, executa `planner-auto\rodar-integracao.cmd` (exportador → `processar-eventos --sim`).
- **Log:** `C:\Users\CTC\planner-auto\logs\integracao.log` (procure `[ERRO]`). Eventos com problema ficam em `eventos\erros\` com um `.erro.txt`.
- **Rodar agora:** `Start-ScheduledTask -TaskName "Radar-Planner integracao"`.
- **Pausar:** `Disable-ScheduledTask -TaskName "Radar-Planner integracao"` (reativar com `Enable-ScheduledTask`).
- **Ver o que seria feito sem gravar:** `python planner_auto.py processar-eventos --dry-run`.
- **Login do Microsoft expirado** (após ~90 dias sem uso): `python planner_auto.py login` e aprovar em `https://login.microsoft.com/device`.
- Regras, contrato e limitações: [INTEGRACAO-PLANNER.md](INTEGRACAO-PLANNER.md).

### 2.4 Backup e restauração
- **Diário (agendado 03:00 Brasília; na prática ~08:30, por atraso do GitHub)**, pelo GitHub Actions ("Backup do banco"): `pg_dump` criptografado enviado ao Google Drive (`diario/` por 14 dias; `semanal/` aos domingos, por 12 semanas). Falha → e-mail do GitHub.
- **Vigia do backup** (diário, 12:00): falha e avisa por e-mail se o último backup bem-sucedido tiver mais de 30 horas ou o último teste de restauração mais de 40 dias.
- **Teste de restauração:** mensal (dia 1) e sob demanda em *Actions → Teste de restauração do backup → Run workflow* (campo *alvo*: ambos, temporário ou neon). Restaura num Postgres temporário **e** no branch real `teste-restauracao` do Neon e confere linhas, códigos, soma, histórico, funções, gatilhos e um cadastro de teste.
- **Restaurar de verdade:** ver [BACKUP.md](BACKUP.md).

### 2.5 Dar ou tirar acesso ao painel
- **Todo o time `@ctctech.com.br` já entra.**
- **Liberar um e-mail de fora do domínio:** Zero Trust → Access → Applications → *Radar Pré-Vendas* → Policies → regra *Include → Emails*.
- **Derrubar a sessão de alguém:** Zero Trust → Access → *Users* (ou *Logs*) → revogar. A sessão dura 24 h.
- **Restringir a lista nominal:** trocar *Emails ending in* por *Emails* com os endereços permitidos.

### 2.6 Deploy
- Merge na `main` → o pipeline roda os testes e publica em produção automaticamente (~2 min).
- **Atenção:** se um commit for empurrado ao PR **depois** do merge, ele não entra na `main`. Confira que o PR foi mergeado com tudo ou abra um PR novo.
- **Rollback:** GitHub → Actions → *Pipeline* → *Run workflow* → campo `ref` com o commit ou tag anterior.
- Cada PR gera um preview `https://pr-N.radar-prevendas.pages.dev` (sem dados reais; o cadastro não funciona no preview).

## 3. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Painel pede login a cada acesso / não aceita o código | E-mail fora de `@ctctech.com.br` ou código no spam | Conferir a política do Access; olhar o spam |
| "Não foi possível carregar os dados" | API fora do ar ou 502 | Ver os erros abaixo |
| CNPJ: "Receita indisponível agora" | BrasilAPI fora do ar ou limite de consultas | Salvar mesmo assim (consulta refeita no salvamento) e conferir depois |
| Aba Oportunidades: "Não foi possível carregar o cadastro" | `DATABASE_URL_APP` ausente/errado, ou 401/503 | Ver a tabela abaixo |
| `/api/*` responde **401** | JWT do Access ausente/expirado (ex.: curl) | Esperado sem login. No navegador: sair e entrar de novo |
| `/api/*` responde **503** "Autenticação não configurada" | `CF_ACCESS_*` ausentes | Restaurar as variáveis e redeployar |
| `/api/*` responde **503** "Banco de dados não configurado" | Falta `DATABASE_URL` (painel) ou `DATABASE_URL_APP` (cadastro) | Criar o secret e **redeployar** (secret só vale para deploys novos) |
| `/api/*` responde **502** | Senha/URL errada ou Neon indisponível | Conferir a string (sem espaço/quebra de linha); testar no console do Neon |
| Cadastro: **409** "Outra pessoa alterou este registro" | Edição simultânea | Usar "Descartar e recarregar" e refazer a alteração |
| Cadastro: **422** com campos destacados | Regra de negócio violada | Corrigir os campos indicados |
| Cadastro: **403** ao arquivar | Usuário não é administrador | Marcar como admin em *Listas e usuários* (por um admin) |
| Painel com número de oportunidades acima do esperado | Linhas "ausentes" sendo contadas | Não deve ocorrer (a API as ignora); se ocorrer, verificar a versão publicada |
| "Última atualização" parada há dias | Agente não rodou | Ver o histórico da tarefa; rodar a carga manual |
| Carga recusada: "só N linhas (mínimo 400)" | Leitura parcial da planilha | Reler a planilha; conferir o OneDrive |
| Cartão não aparece no Planner | Tarefa parada, login expirado ou evento em `erros\` | Ver `logs\integracao.log` e a pasta `erros\`; `python planner_auto.py login` se preciso |
| Evento em `erros\`: "bucket/rótulo não encontrado" | Nome mudou no Planner | Atualizar `config/planner-mapa.json` (e rodar `inspecionar`) |
| Evento em `erros\`: "responsável não encontrado" | E-mail do pré-vendas errado | Corrigir o e-mail em *Listas e usuários* |
| Pipeline falha no `npm ci` ("Missing ... from lock file") | `package-lock.json` fora de sincronia | Regenerar o lockfile a partir do `package.json` limpo e validar com `npm ci` |
| Pipeline falha no "Deploy produção" | Token da Cloudflare sem permissão/expirado | Novo token *Pages: Edit* **sem filtro de IP**; atualizar `CLOUDFLARE_API_TOKEN` |
| Backup falha ao enviar | `RCLONE_DRIVE_TOKEN` inválido/expirado | Refazer `rclone authorize "drive"` e atualizar o secret |
| E-mail "Vigia do backup" falhou | Backup sem sucesso há mais de 30 h, ou teste de restauração com mais de 40 dias | Abrir *Actions → Backup do banco*, ver o erro e rodar de novo; rodar o teste de restauração |
| Teste de restauração falha no destino `neon` | Branch/papel `radar_restore` apagado ou secret `DATABASE_URL_RESTORE` antigo | Ver [BACKUP.md](BACKUP.md) (Manutenção do branch de teste) |

**Erro 9109 da Cloudflare** ("Cannot use the access token from location"): o token tem filtro de IP. Para o GitHub Actions o token não pode ter filtro de IP.

## 4. Manutenção de segurança

### 4.1 Trocar a senha de um papel do banco
Papéis com senha: `radar_leitor`, `radar_app`, `radar_escritor`, `radar_planner`, `radar_backup`.
1. Console do Neon → SQL Editor: `ALTER ROLE <papel> PASSWORD '<nova senha longa e aleatória>';` (sem aspas simples nem `@ : / ? #`).
2. Atualizar **onde o papel é usado**:

| Papel | Atualizar |
|---|---|
| `radar_leitor` | secret `DATABASE_URL` no Pages + redeploy |
| `radar_app` | secret `DATABASE_URL_APP` no Pages + redeploy |
| `radar_escritor` | `DATABASE_URL_WRITER` na máquina do agente |
| `radar_planner` | `DATABASE_URL_PLANNER` na máquina da integração |
| `radar_backup` | secret `DATABASE_URL_BACKUP` no GitHub |

3. Conferir: o painel carrega, o cadastro salva, a próxima carga/integração/backup funciona.

### 4.2 Trocar o token de deploy da Cloudflare
1. Cloudflare → Manage Account → Account API Tokens → *Create Token* → **Cloudflare Pages → Edit**, sem filtro de IP, com validade.
2. Atualizar `CLOUDFLARE_API_TOKEN` no GitHub; reexecutar o pipeline; só então revogar o antigo.

### 4.3 Trocar a senha de criptografia do backup
Trocar `BACKUP_PASSPHRASE` vale **só para backups novos**: guarde as senhas antigas no cofre enquanto houver backups feitos com elas (retenção de até 12 semanas).

### 4.4 Calendário sugerido
| Frequência | Ação |
|---|---|
| Mensal | O teste de restauração roda sozinho (dia 1): conferir o resumo; revisar PRs do Dependabot |
| Trimestral | Trocar as senhas dos papéis do banco |
| Antes do vencimento | Renovar o token do pipeline |
| ~90 dias | Refazer o login do `planner-auto` se ficar sem uso |
| Quando alguém sair do time | Conferir a política do Access, as sessões ativas, os usuários do Radar e as atribuições no Planner |

### 4.5 Se uma credencial vazar
1. **Banco:** trocar a senha do papel (4.1) imediatamente.
2. **Token da Cloudflare, do GitHub ou do Drive:** revogar no painel correspondente e criar outro.
3. **Dados:** o histórico do Neon (plano gratuito) é de 6 horas; se a base foi alterada indevidamente, restaurar pelo console do Neon dentro desse prazo ou pelo **backup diário** ([BACKUP.md](BACKUP.md)).

## 5. Recursos e limites (planos gratuitos)

| Serviço | Limite relevante | Situação |
|---|---|---|
| Neon | armazenamento e horas de computação; histórico de 6 h | ~610 linhas: folgado |
| Cloudflare Pages | builds e requisições da Function | uso interno: folgado |
| Cloudflare Zero Trust (Free) | até 50 usuários | confirmar se o time cabe |
| GitHub Actions | minutos mensais (repositório público: ilimitado) | folgado |
| Google Drive | cota da conta do backup | dumps de ~130 KB: irrelevante |

## 6. Referências
- [ARQUITETURA.md](ARQUITETURA.md): diagramas e decisões
- [ROADMAP.md](ROADMAP.md): melhorias futuras
- [CADASTRO-OPORTUNIDADES.md](CADASTRO-OPORTUNIDADES.md): especificação do cadastro web
- [INTEGRACAO-PLANNER.md](INTEGRACAO-PLANNER.md): Radar → Planner
- [BACKUP.md](BACKUP.md): backup e restauração
- [CARGA-DE-DADOS.md](CARGA-DE-DADOS.md) e [AGENTE-DE-CARGA.md](AGENTE-DE-CARGA.md): carga da planilha
- [`db/migrations/`](../db/migrations/): esquema, funções e privilégios
- [README.md](../README.md): visão do projeto e esteira CI/CD
