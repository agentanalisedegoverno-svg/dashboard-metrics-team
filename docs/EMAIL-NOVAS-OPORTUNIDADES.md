# E-mail a cada nova oportunidade

Aviso por e-mail quando uma oportunidade é **cadastrada pelo Radar**. Quem recebe e a partir de quais status são configurados pelo administrador, na própria tela: **Administração → E-mails**.

## Como funciona

1. Ao cadastrar uma oportunidade pela web, um gatilho do banco confere as regras. Se o módulo está **ligado** e o status da oportunidade está entre os **marcados**, grava um pedido na fila (`email_fila`). O cadastro nunca espera nem falha por causa do e-mail.
2. O envio ([`scripts/enviar-emails.mjs`](../scripts/enviar-emails.mjs)) lê a fila e manda pelo **SMTP do Gmail**, **sem depender de nenhuma máquina do time**. O workflow do GitHub ([`Enviar e-mails`](../.github/workflows/enviar-emails.yml)) é acionado de três formas: (a) **na hora em que a oportunidade é cadastrada** (o Radar chama a API do GitHub; o aviso sai em cerca de um minuto), (b) de **15 em 15 minutos, seg a sex, 08h às 19h**, e (c) de hora em hora à noite e nos fins de semana, como rede de segurança (o agendamento do GitHub é "melhor esforço": atrasa ou pula, por isso o disparo ao cadastrar é o caminho principal). A rotina do Windows (a cada 5 minutos) também envia, se tiver as variáveis; é opcional. Se vários rodarem ao mesmo tempo, o banco garante que cada e-mail sai **uma vez só**.
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


**Assunto** (formato fixo): `[Radar] Status | código | órgão | torre | linha de serviço | descrição | PE: processo UASG: uasg | data/hora do pregão`. Campo em branco vira `—`; a descrição é cortada em 90 caracteres para o assunto não ficar enorme.

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
3. **Disparo ao cadastrar e ao salvar (recomendado; já configurado em 27/10/2026)**: a função aciona o envio de e-mails e o ciclo do Planner. Como criar o token: no **Cloudflare Pages** do Radar (Settings → Variables and Secrets, produção) crie o segredo `GITHUB_DISPATCH_TOKEN` com um *fine-grained personal access token* do GitHub restrito a **este repositório**, com a única permissão **Actions: Read and write**. Opcional: variável `GITHUB_REPO` (`dono/repositório`; o padrão é este). Sem o token, o disparo é ignorado e o e-mail sai pelos agendamentos (até 15 minutos de espera no horário comercial). O token só aciona o workflow; não lê código nem segredos.
4. **(Opcional) Variáveis na máquina do time**, para a rotina do Windows também enviar a cada 5 minutos (não é necessário: o GitHub já cobre). No Windows, como **variáveis de usuário** (fora do Git; a tarefa as enxerga no próximo login): `DATABASE_URL_EMAIL`, `SMTP_USER`, `SMTP_PASS` e, opcionalmente, `SMTP_FROM` e `APP_URL`, com os mesmos valores dos segredos do passo 2. Exemplo, no PowerShell: `[Environment]::SetEnvironmentVariable("SMTP_PASS", "<valor>", "User")`. A etapa de e-mail do `rodar-integracao.cmd` só roda se `SMTP_PASS` existir. Detalhes em [OPERACAO.md](OPERACAO.md) §2.3.
5. Na tela, **Administração → E-mails**: cadastre os destinatários, marque os status, ligue o módulo e use **Enviar e-mail de teste para mim**.

Enquanto os segredos não existirem, o workflow apenas registra um aviso e não faz nada (não falha).

## Alertas e falhas

- Falha ao enviar: o pedido volta para a fila e tenta de novo na próxima rodada (15 minutos no horário comercial; de hora em hora à noite e nos fins de semana; ou na hora, se o disparo ao cadastrar estiver ativo), **até 5 vezes**. Esgotadas as tentativas, ele fica como **Falhou** (com o motivo, sem endereços) e o workflow falha, o que gera o **e-mail de alerta do GitHub**.
- Causas comuns: senha de app revogada ou errada (`EAUTH 535`), conta bloqueada pelo Google, limite diário do Gmail (500/dia em contas gratuitas, 2.000 no Workspace; o uso esperado é de 15 a 20 por dia).
- O log do workflow é **público** (repositório público): o script imprime só contagens, nunca endereços nem dados de oportunidades.
- Testar sem enviar: *Actions → Enviar e-mails → Run workflow* com **simular** marcado (só conta o que está na fila).

## Segurança

- O papel `radar_email` lê só o necessário e atualiza só a fila; não altera oportunidades.
- Só administradores veem e editam as regras (API e funções do banco recusam os demais).
- O e-mail de teste vai apenas para o administrador que o pediu.
- A senha de app do Gmail fica só nos segredos do GitHub. Para trocar: gere outra senha de app, atualize `SMTP_PASS` e revogue a antiga.

## Aviso de mudança de status (migração 016)

- Quando o **status** de uma oportunidade muda pela web, entra um pedido `tipo = 'status'` na fila (guarda status anterior, novo e quem alterou). Vale para qualquer oportunidade, da planilha ou criada na web, e para qualquer status novo.
- **Só status.** Qualquer outra edição não envia e-mail.
- A carga/sincronização da planilha (`app.origem = 'sync'`) nunca envia.
- Mesmas regras de sempre: módulo ligado, destinatários e pré-vendas da oportunidade. O assunto vira `[Radar] Status anterior → Status novo | código | …`.
- O Planner não muda: só recebe o que foi criado na web.
