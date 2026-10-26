# E-mail a cada nova oportunidade

Aviso por e-mail quando uma oportunidade é **cadastrada pelo Radar**. Quem recebe e a partir de quais status são configurados pelo administrador, na própria tela: **Administração → E-mails**.

## Como funciona

1. Ao cadastrar uma oportunidade pela web, um gatilho do banco confere as regras. Se o módulo está **ligado** e o status da oportunidade está entre os **marcados**, grava um pedido na fila (`email_fila`). O cadastro nunca espera nem falha por causa do e-mail.
2. O envio ([`scripts/enviar-emails.mjs`](../scripts/enviar-emails.mjs)) lê a fila e manda pelo **SMTP do Gmail**. Roda em **dois lugares**: (a) na **rotina do Windows, de 5 em 5 minutos, seg a sex, 08h às 19h** (mesma tarefa do Planner; é o caminho principal, então o aviso chega **em até ~5 minutos**), e (b) no GitHub Actions ([`Enviar e-mails`](../.github/workflows/enviar-emails.yml)), de **hora em hora, só à noite e nos fins de semana**, como rede de segurança. O agendamento do GitHub é "melhor esforço" (atrasa ou pula), por isso não é ele o caminho principal. Se os dois rodarem ao mesmo tempo, o banco garante que cada e-mail sai **uma vez só**.
3. As regras valem **na hora do envio**: se o módulo for desligado, ou ficar sem destinatário, depois de o pedido entrar na fila, o pedido é marcado como "Não enviado".

Só entram na fila oportunidades **criadas pela web**. A carga automática da planilha **nunca** envia e-mail, e editar uma oportunidade também não.

## Configuração na tela (só administradores)

| Campo | O que faz |
|---|---|
| **Enviar e-mail a cada nova oportunidade** | Liga e desliga o módulo. Vem **desligado**. |
| **Avisar também o pré-vendas da oportunidade** | Além da lista, o aviso vai ao e-mail do pré-vendas escolhido naquela oportunidade. Só se ele estiver ativo e tiver e-mail em *Usuários e perfis*; quem já está na lista (Para ou Cc) não recebe duas vezes. Com esta opção ligada, a lista de destinatários pode ficar vazia. O e-mail de teste nunca vai ao pré-vendas. |
| **Status** | Marque os status que disparam o aviso (ex.: só *Go*, ou *Go* e *On going*). Precisa de ao menos um para ligar. |
| **Destinatários** | Lista de e-mails, cada um **Para** ou **Cópia (Cc)**, com ativo/inativo e remover. Até 30. Precisa de ao menos um ativo para ligar. |
| **Enviar e-mail de teste para mim** | Envia uma mensagem de teste **só para quem clicou** (nunca para a lista). |
| **Envios recentes** | Últimos 15 pedidos: aguardando, enviado, falhou ou não enviado, com o motivo. |

As regras ficam no banco; a validação vale mesmo para quem chamar a API direto (não só na tela).

## O que vai no e-mail

Código, órgão, objeto, status, torre, linha de serviço, UF, data e hora do pregão, pré-vendas, orçamento (ou "Sigiloso"), quem cadastrou e um link para o Radar. O descritivo **não** vai. Todo texto vindo do cadastro é escapado (sem HTML nem injeção de cabeçalho).

## Ativação (uma vez)

1. **Banco:** aplicar a migração [`009_email_novas_oportunidades.sql`](../db/migrations/009_email_novas_oportunidades.sql) (cria as tabelas, o gatilho, as funções e o papel `radar_email`) e dar login ao papel `radar_email` com senha própria (fora do Git).
2. **Segredos do GitHub** (Settings → Secrets and variables → Actions):

   | Segredo | Conteúdo |
   |---|---|
   | `DATABASE_URL_EMAIL` | connection string do papel `radar_email` |
   | `SMTP_USER` | conta do Gmail que envia |
   | `SMTP_PASS` | **senha de app** do Gmail (exige verificação em duas etapas) ou a credencial do relay do Workspace |
   | `SMTP_FROM` | opcional: remetente exibido (o Gmail pode reescrever se não for um alias verificado) |

   E, opcionalmente, a variável (não segredo) `APP_URL` com o endereço do Radar para o link do e-mail (padrão `https://radar-prevendas.pages.dev`).
3. **Variáveis na máquina do time** (para o envio de 5 em 5 minutos no horário comercial; sem elas o e-mail só sai pelo GitHub, à noite e nos fins de semana). No Windows, como **variáveis de usuário** (fora do Git; a tarefa as enxerga no próximo login): `DATABASE_URL_EMAIL`, `SMTP_USER`, `SMTP_PASS` e, opcionalmente, `SMTP_FROM` e `APP_URL`, com os mesmos valores dos segredos do passo 2. Exemplo, no PowerShell: `[Environment]::SetEnvironmentVariable("SMTP_PASS", "<valor>", "User")`. A etapa de e-mail do `rodar-integracao.cmd` só roda se `SMTP_PASS` existir. Detalhes em [OPERACAO.md](OPERACAO.md) §2.3.
4. Na tela, **Administração → E-mails**: cadastre os destinatários, marque os status, ligue o módulo e use **Enviar e-mail de teste para mim**.

Enquanto os segredos não existirem, o workflow apenas registra um aviso e não faz nada (não falha).

## Alertas e falhas

- Falha ao enviar: o pedido volta para a fila e tenta de novo na próxima rodada (5 minutos no horário comercial; de hora em hora à noite e nos fins de semana), **até 5 vezes**. Esgotadas as tentativas, ele fica como **Falhou** (com o motivo, sem endereços) e o workflow falha, o que gera o **e-mail de alerta do GitHub**.
- Causas comuns: senha de app revogada ou errada (`EAUTH 535`), conta bloqueada pelo Google, limite diário do Gmail (500/dia em contas gratuitas, 2.000 no Workspace; o uso esperado é de 15 a 20 por dia).
- O log do workflow é **público** (repositório público): o script imprime só contagens, nunca endereços nem dados de oportunidades.
- Testar sem enviar: *Actions → Enviar e-mails → Run workflow* com **simular** marcado (só conta o que está na fila).

## Segurança

- O papel `radar_email` lê só o necessário e atualiza só a fila; não altera oportunidades.
- Só administradores veem e editam as regras (API e funções do banco recusam os demais).
- O e-mail de teste vai apenas para o administrador que o pediu.
- A senha de app do Gmail fica só nos segredos do GitHub. Para trocar: gere outra senha de app, atualize `SMTP_PASS` e revogue a antiga.
