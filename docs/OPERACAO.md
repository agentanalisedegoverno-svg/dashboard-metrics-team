# Operação do Radar Pré-Vendas

Guia do dia a dia: como o sistema roda, onde ficam as configurações, como resolver problemas e como fazer manutenção. A visão de arquitetura está em [ARQUITETURA.md](ARQUITETURA.md).

> **Regra de ouro:** nenhuma senha, token ou string de conexão vai para o Git. Este repositório é público.

## 1. Mapa de configuração

| O quê | Onde fica | Tipo | Quem altera |
|---|---|---|---|
| `DATABASE_URL` (papel `radar_leitor`) | Cloudflare Pages → `radar-prevendas` → Settings → Variables and Secrets (Production) | **Secret** | Administrador |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | `wrangler.toml` `[vars]` | público | Pull request |
| `ACESSO_PUBLICO` | `wrangler.toml` (ausente = API protegida) | público | Pull request (**não usar**) |
| `DATABASE_URL_WRITER` (papel `radar_escritor`) | variável de ambiente do usuário Windows da máquina do agente | **Segredo** | Administrador |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub → Settings → Secrets and variables → Actions | **Secret** | Administrador |
| `DEMO_MODE` | GitHub → Actions → Variables (ausente = produção real) | variável | Administrador |
| Política de acesso (quem entra) | Cloudflare Zero Trust → Access → Applications → Radar Pré-Vendas → Policies | configuração | Administrador |

## 2. Rotinas

### 2.1 Carga automática (a cada 2 dias)
- A tarefa `RadarPreVendas-Carga` (Agendador de Tarefas do Windows) roda o agente, que copia a planilha para o banco. Roteiro: [AGENTE-DE-CARGA.md](AGENTE-DE-CARGA.md).
- **Pré-condições:** máquina ligada, OneDrive sincronizado (arquivo "sempre neste dispositivo") e `DATABASE_URL_WRITER` definida.
- **Verificar a última carga:** o painel mostra "Última atualização". No console do Neon (SQL Editor):
  ```sql
  select ultima_carga_em, total_linhas, fonte, erro from carga_status;
  ```
- **Carga manual:** na pasta do projeto, com a planilha exportada em `aba.json`:
  ```
  node scripts/sync-db.mjs aba.json --dry-run        # valida sem gravar (merge)
  node scripts/sync-db.mjs aba.json --fonte "manual"
  ```

### 2.2 Dar ou tirar acesso ao painel
- **Todo o time `@ctctech.com.br` já entra.** Não precisa fazer nada para novos colegas.
- **Liberar um e-mail de fora do domínio:** Zero Trust → Access → Applications → *Radar Pré-Vendas* → Policies → adicionar regra *Include → Emails*.
- **Derrubar a sessão de alguém:** Zero Trust → Access → *Users* (ou *Logs*) → revogar a sessão. A sessão dura 24 h.
- **Restringir a lista nominal:** trocar a regra *Emails ending in* por *Emails* com os endereços permitidos.

### 2.3 Deploy
- Merge na `main` → o pipeline roda os testes e publica em produção automaticamente.
- **Rollback:** GitHub → Actions → *Pipeline* → *Run workflow* → campo `ref` com o commit ou tag anterior.
- Cada PR gera um preview `https://pr-N.radar-prevendas.pages.dev` (build de demonstração, sem dados reais).

## 3. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Painel pede login a cada acesso / não aceita o código | E-mail fora de `@ctctech.com.br` ou código no spam | Conferir a política do Access; olhar a pasta de spam |
| Painel mostra "Não foi possível carregar os dados" | API fora do ar ou 502 | Ver o erro abaixo |
| `/api/*` responde **401** | JWT do Access ausente/expirado (ex.: usando curl) | Esperado sem login. No navegador: sair e entrar de novo |
| `/api/*` responde **503** "Autenticação não configurada" | `CF_ACCESS_*` ausentes no `wrangler.toml` | Restaurar as variáveis e redeployar |
| `/api/*` responde **503** "Banco de dados não configurado" | Secret `DATABASE_URL` ausente no ambiente Production | Criar o secret e **redeployar** (secret só vale para deploys novos) |
| `/api/*` responde **502** "Não foi possível ler o banco" | Senha/URL do `DATABASE_URL` errada, ou banco do Neon indisponível | Conferir a string (sem espaço/quebra de linha); testar o banco no console do Neon |
| "Última atualização" parada há dias | Agente não rodou (máquina desligada, OneDrive offline, erro de validação) | Ver o histórico da tarefa no Agendador; rodar a carga manual |
| Total de oportunidades menor que o esperado | Carga parcial (leitura incompleta) | Rodar o `--dry-run`, conferir as linhas e recarregar |
| Pipeline falha no "Deploy produção" | Token da Cloudflare sem permissão/expirado | Criar novo token *Pages: Edit* **sem filtro de IP** e atualizar o secret `CLOUDFLARE_API_TOKEN` |
| Smoke test falha "Resposta inesperada na raiz" | Access ou Pages fora do ar | Abrir o site; ver o painel da Cloudflare |

**Erro 9109 da Cloudflare** ("Cannot use the access token from location"): o token tem filtro de IP. Para uso no GitHub Actions o token não pode ter filtro de IP.

## 4. Manutenção de segurança

### 4.1 Trocar a senha de um papel do banco
1. Console do Neon → projeto `radar-prevendas` → SQL Editor:
   ```sql
   ALTER ROLE radar_leitor   PASSWORD '<nova senha longa e aleatória>';
   ALTER ROLE radar_escritor PASSWORD '<nova senha longa e aleatória>';
   ```
   Sem aspas simples nem `@ : / ? #` na senha (quebram a URL).
2. **radar_leitor:** atualizar o secret `DATABASE_URL` no Pages e **redeployar** (Actions → Pipeline → Re-run).
3. **radar_escritor:** atualizar `DATABASE_URL_WRITER` na máquina do agente (variável de ambiente do usuário) e reabrir o terminal.
4. Conferir: o painel carrega (leitor) e a próxima carga funciona (escritor).

### 4.2 Trocar o token de deploy da Cloudflare
1. Cloudflare → Manage Account → Account API Tokens → *Create Token* → permissão **Account → Cloudflare Pages → Edit**, sem filtro de IP, com validade.
2. Atualizar o secret `CLOUDFLARE_API_TOKEN` no GitHub.
3. Reexecutar o pipeline para validar e só então revogar o token antigo.

### 4.3 Calendário sugerido
| Frequência | Ação |
|---|---|
| Trimestral | Trocar as senhas do `radar_leitor` e `radar_escritor` |
| Antes do vencimento | Renovar o token do pipeline (validade definida na criação) |
| Mensal | Revisar os PRs do Dependabot e a revisão de dependências |
| Quando alguém sair do time | Conferir a política do Access e as sessões ativas |

### 4.4 Se uma credencial vazar
1. **Banco:** trocar a senha do papel (4.1) imediatamente.
2. **Token da Cloudflare ou do GitHub:** revogar no painel correspondente e criar outro.
3. **Dados:** a retenção de histórico do Neon (plano gratuito) é de 6 horas; se a base foi alterada indevidamente, restaurar pelo console do Neon (*Restore*) dentro desse prazo ou recarregar a planilha.

## 5. Recursos e limites (plano gratuito)

| Serviço | Limite relevante | Situação |
|---|---|---|
| Neon | armazenamento e horas de computação mensais; histórico de 6 h | ~590 linhas: folgado |
| Cloudflare Pages | builds e requisições da Function | uso interno: folgado |
| Cloudflare Zero Trust (Free) | até 50 usuários | confirmar se o time cabe |
| GitHub Actions | minutos mensais (repositório público: ilimitado) | folgado |

## 6. Referências
- [ARQUITETURA.md](ARQUITETURA.md): diagramas e decisões
- [CARGA-DE-DADOS.md](CARGA-DE-DADOS.md): contrato de dados e `load-db.mjs`
- [AGENTE-DE-CARGA.md](AGENTE-DE-CARGA.md): prompt e agendamento do agente
- [../db/schema.sql](../db/schema.sql): esquema, função e privilégios do banco
- [../README.md](../README.md): visão do projeto e esteira CI/CD
