# Diagramas do Radar Pré-Vendas

| | |
|---|---|
| **Propósito** | Catálogo visual de todos os fluxos da aplicação, do contexto ao detalhe, para quem desenvolve, opera, audita ou aprova mudanças |
| **Versão / atualização** | 1.3 · 28/10/2026 · cobre as migrações 001 a 020 |
| **Fonte** | Mermaid, neste arquivo (o GitHub desenha sozinho). Todo diagrama foi validado no conector do Mermaid antes de entrar. Versões em SVG em [diagramas/](diagramas/), geradas por `npm run diagramas` |
| **Padrão adotado** | Guia *Architecture design diagrams* da Microsoft (Well-Architected): camadas **contexto → contêiner → componente**, mais implantação, fluxo de dados com fronteiras de confiança (STRIDE), sequência por caso de uso, jornada do usuário, estado, ER e fluxo de identidade; vocabulário do **C4** (contexto/contêiner/componente) e do **UML** (sequência/estado) |
| **Relacionados** | [ARQUITETURA.md](ARQUITETURA.md) (decisões e narrativa), [OPERACAO.md](OPERACAO.md), [TESTES.md](TESTES.md) |

## Como ler

Convenções iguais em **todos** os diagramas (consistência é parte do padrão):

```mermaid
flowchart LR
  classDef pessoa fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef interno fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef externo fill:#f2f2f2,stroke:#555555,stroke-dasharray:4 3,color:#1a1a1a
  classDef dados fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef agenda fill:#fde9dc,stroke:#b4561d,color:#1a1a1a

  P(["Pessoa"]):::pessoa
  I["Componente nosso (interno)"]:::interno
  E["Sistema externo (borda tracejada)"]:::externo
  D[("Banco de dados ou arquivo")]:::dados
  A{{"Rotina agendada"}}:::agenda
  P -->|"chamada síncrona (linha cheia)"| I
  A -.->|"disparo agendado ou assíncrono (linha tracejada)"| I
  I -->|"a seta sai de quem inicia e chega a quem é chamado"| E
  I --> D
```

- **Forma + texto, não só cor:** pessoa = estádio, banco/arquivo = cilindro, rotina agendada = hexágono, externo = borda tracejada. A cor reforça, nunca é a única pista.
- **Setas** vão do iniciador para a dependência; a resposta, quando importa, aparece como seta separada.
- **Rótulo de papel de banco** (`radar_app`, `radar_leitor`…) indica com qual credencial o componente fala com o banco.

## Índice

| Camada | Diagramas |
|---|---|
| **Visão geral** | [D1 Contexto](#d1--contexto-c4-nível-1) · [D2 Contêineres](#d2--contêineres-c4-nível-2) · [D3 Implantação](#d3--implantação-onde-cada-coisa-roda) · [D4 Componentes](#d4--componentes-c4-nível-3) |
| **Usuário e acesso** | [D5 Jornada do usuário](#d5--jornada-do-usuário) · [D6 Perfis e permissões](#d6--perfis-e-permissões-identidade-e-acesso) |
| **Cadastro** | [D7 Cadastro](#d7--cadastro-de-oportunidade) · [D8 Edição concorrente](#d8--edição-concorrente-versão-otimista) · [D9 Regras de validação](#d9--regras-de-validação) · [D10 Estados](#d10--ciclo-de-vida-estados) · [D11 Consulta de CNPJ](#d11--consulta-de-cnpj) |
| **Integrações** | [D12 Carga da planilha (descontinuada)](#d12--carga-da-planilha-descontinuada) · [D13 Planner](#d13--integração-com-o-microsoft-planner) · [D14 E-mail](#d14--e-mail-de-nova-oportunidade) |
| **Confiabilidade** | [D15 Backup e resiliência](#d15--backup-restauração-e-resiliência) · [D16 CI/CD e testes](#d16--entrega-e-testes-cicd) |
| **Segurança e dados** | [D17 Fluxo de dados e STRIDE](#d17--fluxo-de-dados-e-fronteiras-de-confiança-stride) · [D18 Papéis do banco](#d18--papéis-do-banco-e-privilégios) · [D19 Modelo de dados](#d19--modelo-de-dados-er) |

---

## Visão geral

### D1 · Contexto (C4 nível 1)

*Tipo: contexto · Escopo: o sistema como caixa-preta, com quem fala · Pergunta que responde: **quem usa e do que depende?***

```mermaid
flowchart TB
  classDef pessoa fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef interno fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef externo fill:#f2f2f2,stroke:#555555,stroke-dasharray:4 3,color:#1a1a1a

  adm(["Administrador<br/>gerencia perfis, listas, e-mails<br/>e arquiva"]):::pessoa
  edt(["Editor (pré-vendas)<br/>cadastra e edita"]):::pessoa
  vis(["Visualizador<br/>somente consulta"]):::pessoa
  dest(["Destinatários dos avisos<br/>nova oportunidade e mudança de status"]):::pessoa

  access["Cloudflare Access<br/>login por código no e-mail<br/>@ctctech.com.br"]:::externo

  subgraph fronteira["Fronteira do sistema"]
    radar["<b>Radar Pré-Vendas</b><br/>painel de métricas e cadastro de oportunidades<br/>de licitações do governo<br/>(o banco é alimentado só pelo Radar web)"]:::interno
  end

  gh["GitHub Actions<br/>rotinas na nuvem, sem máquina de pessoa"]:::externo
  ext["Aplicações externas<br/>criam oportunidades pela API<br/>(chave por aplicação)"]:::externo
  planner["Microsoft Planner<br/>planos ITS e Digital e Health"]:::externo
  gmail["Gmail (SMTP)"]:::externo
  receita["APIs públicas de CNPJ<br/>dados da Receita Federal"]:::externo
  drive["Google Drive<br/>backups criptografados"]:::externo
  supa["Supabase<br/>espelho diário do banco"]:::externo

  adm --> access
  edt --> access
  vis --> access
  access -->|"sessão autenticada"| radar
  ext -->|"HTTPS + chave: POST /api/externo/oportunidades"| radar
  radar -->|"consulta razão social e matriz/filial"| receita
  radar -.->|"ao salvar: aciona na hora"| gh
  gh -.->|"cria e atualiza cartões (sentido único)"| planner
  gh -.->|"envia os avisos"| gmail
  gmail -.->|"entrega o e-mail"| dest
  gh -.->|"dump diário criptografado"| drive
  gh -.->|"restaura o espelho diário"| supa
```

### D2 · Contêineres (C4 nível 2)

*Tipo: contêiner · Escopo: as peças executáveis, tecnologia e protocolo · Pergunta: **do que o sistema é feito e como as peças conversam?***

```mermaid
flowchart LR
  classDef pessoa fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef interno fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef externo fill:#f2f2f2,stroke:#555555,stroke-dasharray:4 3,color:#1a1a1a
  classDef dados fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef agenda fill:#fde9dc,stroke:#b4561d,color:#1a1a1a

  U(["Usuário"]):::pessoa
  ACC["Cloudflare Access<br/>código por e-mail, JWT RS256"]:::externo

  subgraph cf["Cloudflare Pages: radar-prevendas"]
    SPA["SPA<br/>React 19, TypeScript, Vite, Tailwind<br/>TanStack Query e Table"]:::interno
    API["Pages Functions /api/*<br/>TypeScript no runtime Workers<br/>valida JWT, CSRF e Zod"]:::interno
  end

  subgraph neon["Neon Postgres 17 (sa-east-1)"]
    DB[("tabelas, funções SECURITY DEFINER<br/>e gatilhos")]:::dados
  end

  subgraph gh["GitHub Actions (runners Ubuntu, sem máquina de pessoa)"]
    PLN{{"Planner integração<br/>disparo ao salvar + 5 min, seg a sex<br/>Node + Python"}}:::agenda
    MAIL{{"Enviar e-mails<br/>disparo ao salvar + 15 min<br/>nodemailer"}}:::agenda
    WF{{"Pipeline CI/CD"}}:::agenda
    BKP{{"Backup diário, restauração mensal e vigia"}}:::agenda
    ESP{{"Espelho no Supabase<br/>diário"}}:::agenda
    NF{{"Testes de carga e segurança<br/>semanal"}}:::agenda
  end

  subgraph sb["Supabase (us-east-1)"]
    DB2[("espelho do banco<br/>projeto radar-backup")]:::dados
  end

  PL["Microsoft Planner<br/>Graph API"]:::externo
  EXA["Aplicação externa<br/>outro sistema da empresa"]:::externo
  GM["Gmail SMTP 465"]:::externo
  RC["APIs de CNPJ<br/>BrasilAPI e outras"]:::externo
  DRV[("Google Drive")]:::externo

  U -->|"HTTPS"| ACC -->|"HTTPS + cookie de sessão"| SPA
  SPA -->|"fetch JSON com JWT e x-radar-csrf"| API
  API -->|"radar_leitor (painel)<br/>radar_app (cadastro)"| DB
  API -->|"HTTPS (servidor consulta)"| RC
  EXA -->|"HTTPS + chave de API<br/>POST /api/externo/oportunidades"| API
  API -.->|"workflow_dispatch ao cadastrar ou salvar<br/>(token restrito a Actions)"| PLN
  API -.->|"workflow_dispatch ao cadastrar ou salvar"| MAIL
  PLN -->|"radar_planner: lê oportunidades,<br/>grava exportação e estado cifrado"| DB
  PLN -->|"MS Graph (delegado)"| PL
  MAIL -->|"radar_email (lê + atualiza a fila)"| DB
  MAIL -->|"SMTP TLS"| GM
  BKP -->|"radar_backup (pg_dump)"| DB
  BKP -->|"rclone + AES-256"| DRV
  ESP -->|"radar_backup (pg_dump)"| DB
  ESP -->|"pg_restore (projeto dedicado)"| DB2
  WF -->|"wrangler deploy"| cf
  NF -->|"leitura e sondagem"| cf
```

### D3 · Implantação (onde cada coisa roda)

*Tipo: implantação · Escopo: infraestrutura, agendas e ambientes · Pergunta: **onde roda, quando e em que ambiente?***

```mermaid
flowchart TB
  classDef interno fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef dados fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef agenda fill:#fde9dc,stroke:#b4561d,color:#1a1a1a
  classDef externo fill:#f2f2f2,stroke:#555555,stroke-dasharray:4 3,color:#1a1a1a

  subgraph edge["Cloudflare (borda global)"]
    ACCESS["Access<br/>sessão de 24 h"]:::externo
    subgraph pages["Pages: projeto radar-prevendas"]
      PROD["Produção<br/>radar-prevendas.pages.dev"]:::interno
      PRV["Pré-visualização por PR<br/>pr-N.radar-prevendas.pages.dev<br/>(casca e dados de demonstração)"]:::interno
    end
  end

  subgraph nn["Neon (sa-east-1)"]
    MAIN[("branch main<br/>produção, banco neondb")]:::dados
    TESTE[("branch teste-restauracao<br/>banco restore_drill<br/>reescrito a cada drill mensal")]:::dados
  end

  subgraph sbx["Supabase (us-east-1, plano Free)"]
    ESPELHO[("projeto radar-backup<br/>espelho do estado mais recente")]:::dados
  end

  subgraph ghr["GitHub (runners efêmeros)"]
    P1{{"Planner integração<br/>ao salvar + 5 min, seg a sex 08h às 19h BRT"}}:::agenda
    S3{{"Enviar e-mails<br/>ao salvar + 15 min (dia), de hora em hora (noite e fins de semana)"}}:::agenda
    S1{{"Backup diário 03:00 BRT<br/>(na prática ~08:30)"}}:::agenda
    S7{{"Espelho no Supabase<br/>diário 04:30 BRT"}}:::agenda
    S2{{"Vigia 12:00 BRT"}}:::agenda
    S4{{"Restauração: dia 1 do mês"}}:::agenda
    S5{{"Carga e segurança: segunda 06:00 BRT"}}:::agenda
    S6{{"CodeQL: segunda"}}:::agenda
  end

  WIN["Tarefas do Windows (planilha e Planner)<br/>DESATIVADAS em 28/10/2026<br/>só contingência"]:::externo
  DRIVE[("Google Drive<br/>diario/ 14 dias · semanal/ 12 semanas")]:::externo

  ACCESS --> PROD
  ACCESS --> PRV
  PROD -->|"radar_leitor / radar_app"| MAIN
  PROD -.->|"workflow_dispatch ao salvar"| P1
  PROD -.->|"workflow_dispatch ao salvar"| S3
  P1 -->|"radar_planner"| MAIN
  S3 -->|"radar_email"| MAIN
  S1 -->|"radar_backup"| MAIN
  S1 --> DRIVE
  S7 -->|"radar_backup"| MAIN
  S7 --> ESPELHO
  S4 --> DRIVE
  S4 -->|"radar_restore (isolado)"| TESTE
  S2 -.->|"confere idade do backup e do teste de restauração"| MAIN
```

### D4 · Componentes (C4 nível 3)

*Tipo: componente · Escopo: módulos do código e como se ligam · Pergunta: **em que arquivo mora cada responsabilidade?***

```mermaid
flowchart LR
  classDef interno fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef dados fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef comum fill:#efe7ff,stroke:#5b3fa6,color:#1a1a1a

  subgraph spa["SPA (src/)"]
    APP["App.tsx<br/>abas e rota por #hash"]:::interno
    PNL["features/exec, inter, ops, meta, plano<br/>painéis de métricas<br/>(CardGrafico: clique amplia o gráfico)"]:::interno
    OPT["features/oportunidades<br/>Tab, Grid virtualizada, Drawer, campos, formato (máscara em R$), api.ts"]:::interno
    ADM["features/admin<br/>Usuários, Listas, Linha→Torre, E-mails"]:::interno
    DOM["domain/<br/>oportunidade.ts (Zod + regras), cnpj.ts, email.ts"]:::comum
  end

  subgraph fn["API (functions/)"]
    HTTP["_lib/http, access, rota<br/>JWT, CSRF, mapa de erros"]:::interno
    CAD["_lib/cadastro<br/>oportunidades, opções, usuários, me"]:::interno
    EMC["_lib/emailConfig<br/>regras de e-mail (admin)"]:::interno
    CNP["_lib/cnpj<br/>4 fontes em sequência"]:::interno
    DSP["_lib/dispararEmails + dispararPlanner<br/>acionam os workflows ao salvar"]:::interno
    EXT["_lib/apiExterna + api/externo/*<br/>chave, catálogo, idempotência"]:::interno
    ROWS["api/[[path]] + _lib/rows<br/>leitura do painel"]:::interno
  end

  subgraph scr["Rotinas (GitHub Actions)"]
    PLE["_lib/planner + plannerNota + planner-eventos.mjs<br/>planner-auto: planner_auto.py, estado_db.py"]:::interno
    EMF["_lib/emailFila + emailMsg (e-mail completo)<br/>+ enviar-emails.mjs"]:::interno
  end

  subgraph bd["Banco (db/migrations)"]
    FUN["funções: criar, atualizar, arquivar,<br/>salvar_usuario, salvar_opcao, salvar_email_config,<br/>criar_oportunidade_api e chaves da API"]:::dados
    TRG["gatilhos: derivar, torre, código,<br/>auditar, e-mail (nova e mudança de status)"]:::dados
    TAB[("tabelas<br/>inclui planner_auto_estado")]:::dados
  end

  APP --> PNL
  APP --> OPT
  APP --> ADM
  OPT --> DOM
  ADM --> DOM
  OPT -->|"api.ts: fetch"| HTTP
  ADM -->|"api.ts: fetch"| HTTP
  PNL -->|"/api/rows"| ROWS
  HTTP --> CAD
  HTTP --> EMC
  HTTP --> CNP
  HTTP -.->|"após 201 ou 200"| DSP
  EXT -->|"radar_app: criar_oportunidade_api"| FUN
  EXT -.->|"após 201"| DSP
  CAD --> DOM
  EMC --> DOM
  CAD -->|"radar_app"| FUN
  EMC -->|"radar_app"| FUN
  ROWS -->|"radar_leitor"| TAB
  FUN --> TAB
  TRG --> TAB
  DSP -.->|"workflow_dispatch"| PLE
  DSP -.->|"workflow_dispatch"| EMF
  PLE -->|"radar_planner"| TAB
  EMF -->|"radar_email"| TAB
```

---

## Usuário e acesso

### D5 · Jornada do usuário

*Tipo: fluxo de usuário · Escopo: do login às telas, por perfil · Pergunta: **o que cada pessoa consegue fazer e por onde?***

```mermaid
flowchart TB
  classDef passo fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef decisao fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef erro fill:#fde1e1,stroke:#a61f1f,color:#1a1a1a
  classDef ok fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a

  A(["Abre o endereço do Radar"]):::passo --> B["Cloudflare Access pede o e-mail @ctctech.com.br"]:::passo
  B --> C["Recebe o código de 6 dígitos e entra<br/>(sessão de 24 h)"]:::passo
  C --> D["Painel: Visão Executiva, Intersetorial, Operacional,<br/>Metodologia, Plano de Ação"]:::passo
  D --> E["Aba Oportunidades<br/>busca, filtros, ordenação, pendências"]:::passo
  E --> F{"O que fazer?"}:::decisao
  F -->|"Nova oportunidade<br/>(editor ou administrador)"| G["Formulário em tela cheia"]:::passo
  F -->|"Clicar numa linha"| H["Tela cheia, somente leitura<br/>aba Dados e aba Histórico"]:::passo
  H --> I{"Editar?<br/>(editor ou administrador)"}:::decisao
  I -->|"sim"| G
  G --> J["Preenche e clica em Salvar"]:::passo
  J --> K{"Validação no navegador<br/>(Zod + regras)"}:::decisao
  K -->|"falhou"| L["Erros por campo na própria tela"]:::erro --> G
  K -->|"passou"| M["API e banco validam de novo"]:::passo
  M --> N{"Resultado"}:::decisao
  N -->|"201/200"| O["Aviso de sucesso e grade atualizada"]:::ok
  N -->|"422 regra de negócio"| L
  N -->|"409 outra pessoa salvou antes"| P["Aviso de conflito: mostra a versão atual<br/>e a pessoa revisa e salva de novo"]:::erro --> G
  H --> Q{"Administrador?"}:::decisao
  Q -->|"arquivar ou restaurar"| R["Exclusão lógica reversível"]:::ok
  D --> S{"Administrador?"}:::decisao
  S -->|"sim"| T["Aba Administração (página inteira)"]:::passo
  T --> T1["Usuários e perfis"]:::passo
  T --> T2["Listas de opções"]:::passo
  T --> T3["Linha → Torre (consulta)"]:::passo
  T --> T4["E-mails: destinatários, status, pré-vendas, teste"]:::passo
```

### D6 · Perfis e permissões (identidade e acesso)

*Tipo: fluxo de identidade e acesso · Escopo: como o perfil é decidido e onde é imposto · Pergunta: **quem pode o quê, e quem garante?***

```mermaid
flowchart TB
  classDef passo fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef decisao fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef perfil fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef camada fill:#efe7ff,stroke:#5b3fa6,color:#1a1a1a

  JWT["E-mail vindo do JWT do Access<br/>(nunca do corpo da requisição)"]:::passo --> U{"Está em usuarios<br/>como administrador ativo?"}:::decisao
  U -->|"sim"| ADM["ADMINISTRADOR<br/>consulta, cadastra, edita, arquiva e restaura<br/>gerencia usuários, listas e e-mails"]:::perfil
  U -->|"não"| V{"Marcado como somente leitura?"}:::decisao
  V -->|"sim"| VIS["VISUALIZADOR<br/>só consulta: grade, detalhe e histórico"]:::perfil
  V -->|"não"| EDT["EDITOR (padrão, inclusive quem<br/>nem está na lista)<br/>consulta, cadastra e edita<br/>não arquiva nem administra"]:::perfil

  subgraph camadas["Onde a regra é imposta (defesa em camadas)"]
    C1["1. Tela: botões e abas escondidos"]:::camada
    C2["2. API: JWT, CSRF, 403 para quem não pode"]:::camada
    C3["3. Banco: funções recusam por perfil (P0403),<br/>papéis sem escrita direta"]:::camada
  end
  ADM --> camadas
  VIS --> camadas
  EDT --> camadas
```

Regras que o desenho resume: o administrador **não** pode ser somente leitura; o sistema **nunca** fica sem administrador ativo; a pessoa **não** rebaixa nem desativa a si mesma; só administrador cria ou remove alguém dos grupos.

---

## Cadastro

### D7 · Cadastro de oportunidade

*Tipo: sequência · Caso de uso: usuário cadastra uma oportunidade · Pergunta: **o que acontece, em ordem, do clique ao registro?***

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant S as SPA
  participant A as API (Pages Function)
  participant R as APIs de CNPJ
  participant B as Banco (criar_oportunidade)
  participant G as Gatilhos

  U->>S: preenche e clica em Cadastrar
  S->>S: Zod e regras do cliente (feedback imediato)
  S->>A: POST /api/oportunidades (JWT, x-radar-csrf)
  A->>A: valida JWT, Origin e CSRF
  A->>A: Zod: descarta campos desconhecidos
  opt CNPJ da empresa vencedora informado
    A->>R: consulta CNPJ (servidor)
    R-->>A: razão social e Matriz ou Filial
    A->>A: preenche os campos derivados, ignora o que veio do navegador
  end
  A->>B: criar_oportunidade(corpo, e-mail do JWT) como radar_app
  B->>B: perfil permite? visualizador é recusado (P0403)
  B->>B: calcula a torre pela linha de serviço
  B->>B: validar_oportunidade (D9)
  alt regra violada
    B-->>A: erro P0422 com campo e mensagem
    A-->>S: 422 com a lista de erros
    S-->>U: erros ao lado de cada campo
  else válida
    B->>G: INSERT em oportunidades
    G->>G: deriva ano, mês e SLA
    G->>G: atribui o código AAAA-NNNN (contador atômico por ano)
    G->>G: grava o histórico (criou, por quem)
    G->>G: se web, módulo ligado e status marcado, enfileira o e-mail
    B-->>A: registro completo
    A-->>S: 201 com o registro e avisos de duplicata
    S-->>U: aviso de sucesso e linha na grade
  end
```

### D8 · Edição concorrente (versão otimista)

*Tipo: sequência · Caso de uso: duas pessoas editam a mesma oportunidade · Pergunta: **como evitar que uma sobrescreva a outra sem perceber?***

```mermaid
sequenceDiagram
  autonumber
  actor A as Pessoa A
  actor B as Pessoa B
  participant S as SPA
  participant API as API
  participant DB as Banco

  A->>S: abre a oportunidade (versão 3)
  B->>S: abre a mesma oportunidade (versão 3)
  A->>S: altera e salva
  S->>API: PUT /api/oportunidades/:id com versao 3
  API->>DB: atualizar_oportunidade (trava a linha)
  DB->>DB: versão 3 confere, grava como versão 4, registra o histórico
  DB-->>API: registro v4
  API-->>S: 200
  B->>S: altera e salva (ainda com a versão 3)
  S->>API: PUT /api/oportunidades/:id com versao 3
  API->>DB: atualizar_oportunidade
  DB-->>API: conflito P0409 com a versão atual e o registro atual
  API-->>S: 409 com versao_atual e o registro de A
  S-->>B: aviso: outra pessoa alterou, mostra a versão atual
  B->>S: revisa e salva de novo (agora com a versão 4)
  S->>API: PUT com versao 4
  API->>DB: atualizar_oportunidade
  DB-->>API: registro v5
  API-->>S: 200
```

### D9 · Regras de validação

*Tipo: fluxograma de decisão · Escopo: tudo que `validar_oportunidade` confere, na ordem · Pergunta: **por que o sistema recusou?***

```mermaid
flowchart TB
  classDef passo fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef decisao fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef erro fill:#fde1e1,stroke:#a61f1f,color:#1a1a1a
  classDef ok fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a

  IN(["Dados recebidos"]):::passo --> O1{"Obrigatórios preenchidos?<br/>status, data do pregão, órgão,<br/>descritivo, torre"}:::decisao
  O1 -->|"não"| E["Erros acumulados por campo<br/>(P0422, HTTP 422)"]:::erro
  O1 -->|"sim"| L{"Valores de lista dentro das opções ativas?<br/>status, torre, UF, critério, modalidade, site,<br/>vistoria, conta vinculada, motivos, unidade"}:::decisao
  L -->|"não"| E
  L -->|"sim"| P{"Pré-vendas é um usuário pré-vendas ativo?"}:::decisao
  P -->|"não"| E
  P -->|"sim"| N{"Números na faixa?<br/>valores ≥ 0, MC e simulação entre -100% e 100%,<br/>impostos entre 0% e 100%, posição ≥ 1"}:::decisao
  N -->|"não"| E
  N -->|"sim"| D{"Data do pregão ≥ data de distribuição?"}:::decisao
  D -->|"não"| E
  D -->|"sim"| C{"CNPJ vencedor, se houver, tem 14 dígitos?"}:::decisao
  C -->|"não"| E
  C -->|"sim"| S{"Orçamento sigiloso tem valor?"}:::decisao
  S -->|"sim"| E
  S -->|"não"| ST{"Status"}:::decisao
  ST -->|"No Go sem motivo"| E
  ST -->|"Lost sem motivo"| E
  ST -->|"Win sem Valor CTC"| E
  ST -->|"demais casos"| OK["Grava, com histórico"]:::ok
  E --> R(["Tela mostra cada erro ao lado do campo"]):::passo
```

*Os erros são **acumulados**: o usuário vê todos de uma vez. A tela repete as regras principais só para feedback imediato; a fonte da verdade é o banco.*

### D10 · Ciclo de vida (estados)

*Tipo: estado (registro) e fluxograma (status) · Escopo: o ciclo de vida do registro e as exigências de cada status · Pergunta: **em que estados uma oportunidade pode estar, o que muda isso e o que cada status exige?***

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Vigente: criada na web (as antigas vieram da planilha)
  Vigente --> Arquivada: administrador arquiva
  Arquivada --> Vigente: administrador restaura
  Arquivada --> [*]
  note right of Arquivada
    nunca é apagada:
    sai da grade e do painel,
    o histórico permanece
  end note
```

```mermaid
flowchart LR
  classDef base fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef livre fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef exige fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef legado fill:#f2f2f2,stroke:#555555,stroke-dasharray:4 3,color:#1a1a1a
  classDef efeito fill:#efe7ff,stroke:#5b3fa6,color:#1a1a1a

  L["Status: lista fechada<br/>administrada em Administração, Listas de opções<br/>qualquer status pode ser escolhido a qualquer momento<br/>(o sistema não impõe uma ordem)"]:::base
  L --> S1["Prospect, Go, On going,<br/>Canceled, Suspended<br/>sem exigência extra"]:::livre
  L --> S2["No Go<br/>exige o motivo do No Go<br/>(o detalhe é opcional)"]:::exige
  L --> S3["Lost<br/>exige o motivo do Lost"]:::exige
  L --> S4["Win<br/>exige o Valor CTC"]:::exige
  L --> S5["Validar<br/>valor antigo da planilha, inativo<br/>aparece até ser corrigido"]:::legado
  S1 --> EF
  S2 --> EF
  S3 --> EF
  S4 --> EF
  EF["O status também define:<br/>o bucket e o progresso do cartão no Planner<br/>se o e-mail de nova oportunidade sai (status marcados em Administração, E-mails)<br/>as cores e as contagens da grade e do painel"]:::efeito
```

### D11 · Consulta de CNPJ

*Tipo: fluxograma · Escopo: preenchimento de razão social e matriz/filial · Pergunta: **como o servidor decide o resultado entre fontes instáveis?***

```mermaid
flowchart TB
  classDef passo fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef decisao fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef erro fill:#fde1e1,stroke:#a61f1f,color:#1a1a1a
  classDef ok fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef externo fill:#f2f2f2,stroke:#555555,stroke-dasharray:4 3,color:#1a1a1a

  IN(["CNPJ digitado"]):::passo --> V{"14 dígitos e dígitos<br/>verificadores corretos?"}:::decisao
  V -->|"não"| INV["422: CNPJ inválido<br/>(nenhuma chamada externa)"]:::erro
  V -->|"sim"| F1["1ª fonte: BrasilAPI"]:::externo
  F1 --> R1{"Resposta"}:::decisao
  R1 -->|"200 com razão social"| OK["Retorna razão social, Matriz ou Filial e situação"]:::ok
  R1 -->|"404"| N1["conta 1 não encontrado"]:::passo
  R1 -->|"erro, timeout ou sem razão social"| F2
  N1 --> F2["2ª fonte: minhareceita.org"]:::externo
  F2 --> R2{"Resposta"}:::decisao
  R2 -->|"200"| OK
  R2 -->|"404 de novo (2 fontes concordam)"| NF["404: CNPJ não encontrado na Receita"]:::erro
  R2 -->|"falha"| F3["3ª fonte: publica.cnpj.ws"]:::externo
  F3 --> R3{"Resposta"}:::decisao
  R3 -->|"200"| OK
  R3 -->|"falha"| F4["4ª fonte: receitaws"]:::externo
  F4 --> R4{"Resposta"}:::decisao
  R4 -->|"200"| OK
  R4 -->|"todas falharam"| IND["503: consulta indisponível<br/>(com o motivo de cada fonte)"]:::erro
```

*Duas respostas 404 (de quaisquer duas fontes) encerram como "não encontrado". Cada fonte tem tempo limite de 5 s. A tela nunca chama a Receita: a CSP só permite o próprio site, e o servidor faz a consulta. Se o CNPJ for apagado, razão social e tipo são zerados no banco.*

---

## Integrações

### D12 · Carga da planilha (descontinuada)

*Tipo: fluxo (histórico) · Escopo: o fim da carga da planilha · Pergunta: **a planilha ainda alimenta o banco?** Não: desde 27/10/2026 o Radar web é a única porta de entrada ([decisão](DECISAO-FIM-DA-CARGA-DA-PLANILHA.md)).*

```mermaid
flowchart LR
  classDef pessoa fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef dados fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef externo fill:#f2f2f2,stroke:#555555,stroke-dasharray:4 3,color:#1a1a1a
  classDef erro fill:#fde1e1,stroke:#a61f1f,color:#1a1a1a

  WEB(["Radar web<br/>cadastro e edição<br/>única porta de entrada"]):::pessoa -->|"criar, atualizar, arquivar"| DB[("Neon Postgres<br/>fonte da verdade")]:::dados
  XLS["BaseLicitacao.xlsx<br/>deixou de alimentar o banco"]:::externo
  OLD["Tarefa Radar-Carga-Planilha<br/>DESATIVADA em 27/10/2026<br/>scripts removidos"]:::erro
  LEG["Legado no banco, sem uso:<br/>sincronizar_planilha, carga_status,<br/>chave_planilha, ausente_na_planilha"]:::externo
  XLS --- OLD
  OLD -.->|"não roda mais"| DB
  DB --- LEG
```

### D13 · Integração com o Microsoft Planner

*Tipo: sequência · Caso de uso: oportunidade da web vira cartão · Pergunta: **como o cartão nasce e se atualiza, sem duplicar?***

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário
  participant CF as Radar (Cloudflare)
  participant DB as Banco
  participant GH as Workflow planner-integracao (GitHub Actions)
  participant EX as planner-eventos.mjs
  participant PA as planner_auto.py
  participant PL as Microsoft Planner

  U->>CF: cadastra ou salva pela web
  CF->>DB: criar ou atualizar (a versão aumenta)
  CF-->>GH: workflow_dispatch na hora (e agendamento de 5 em 5 min, seg a sex 08h às 19h, como rede de segurança)
  GH->>DB: restaura o estado cifrado (token Microsoft e versões aplicadas)
  GH->>EX: exporta
  EX->>DB: lê (radar_planner) as criadas pela web depois do marco, não arquivadas, com versão nova
  EX->>EX: monta o evento v2: torre define o plano, status define a coluna, pré-vendas vira responsável
  EX->>DB: registra planner_exportacao (versão exportada, chave)
  GH->>PA: processar-eventos (pasta temporária do runner)
  PA->>PL: Graph delegado: procura o cartão pela chave AAAA-NNNN
  alt cartão não existe
    PA->>PL: cria no plano e na coluna certos
  else existe e o evento é mais novo
    PA->>PL: atualiza (responsável vazio não altera)
  else evento mais antigo
    PA->>PA: ignora
  end
  GH->>DB: guarda o estado cifrado (planner_auto_estado)
  Note over GH: o log público mostra só contagens
```

*Sentido único (Radar → Planner). Nunca apaga cartão nem arquivo. As oportunidades vindas da planilha nunca são enviadas. **O que muda em cada campo do cartão a cada salvamento** (e o desenho da decisão) está em [INTEGRACAO-PLANNER.md](INTEGRACAO-PLANNER.md#regra-de-atualização-o-que-acontece-no-cartão).*

### D14 · E-mail de nova oportunidade

*Tipo: sequência + decisão · Caso de uso: aviso por e-mail ao cadastrar · Pergunta: **quando o e-mail sai, para quem, e o que acontece se falhar?***

```mermaid
sequenceDiagram
  autonumber
  actor ADM as Administrador
  actor U as Usuário
  participant S as SPA e API
  participant DB as Banco
  participant GA as Workflow enviar-emails (GitHub Actions)
  participant SMTP as Gmail SMTP

  Note over ADM,DB: Configuração (Administração, aba E-mails)
  ADM->>S: liga o envio, marca os status, cadastra destinatários e a opção de pré-vendas
  S->>DB: salvar_email_config (só administrador valida e grava)
  ADM->>S: Enviar e-mail de teste para mim
  S->>DB: enfileirar_email_teste (vai só ao próprio administrador)

  Note over U,DB: Cadastro ou mudança de status (não espera o e-mail)
  U->>S: cadastra uma oportunidade ou muda o status pela web
  S->>DB: criar_oportunidade ou atualizar_oportunidade
  DB->>DB: gatilho: nova (só da web) ou mudança de status (qualquer oportunidade, fora da carga), módulo ligado e status marcado?
  DB-->>DB: sim, grava pedido pendente em email_fila (tipo nova ou status, com de, para e quem alterou)
  DB-->>S: 201 ou 200 (a gravação nunca falha por causa do e-mail)
  S-->>GA: workflow_dispatch na hora (em segundo plano)

  Note over GA,SMTP: Envio assíncrono (também a cada 15 min como rede de segurança)
  GA->>DB: lê até 50 pedidos pendentes (radar_email)
  GA->>GA: regras valem agora: módulo ligado? tem destinatário Para?
  GA->>GA: destinatários = lista Para e Cc, mais o pré-vendas da oportunidade se a opção estiver ligada e ele tiver e-mail
  GA->>DB: pega o pedido e conta a tentativa (se outro processo já pegou, pula)
  GA->>SMTP: envia o e-mail completo, com todas as informações da oportunidade (TLS, porta 465)
  alt enviado
    GA->>DB: situação enviado
  else erro
    GA->>DB: volta a pendente com o motivo, até 5 tentativas
    GA->>GA: na 5ª falha: situação erro (aparece na aba E-mails) e o workflow falha, com aviso do GitHub
  end
```

```mermaid
flowchart TB
  classDef passo fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef decisao fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef erro fill:#fde1e1,stroke:#a61f1f,color:#1a1a1a
  classDef ok fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a

  N(["Oportunidade nova<br/>ou mudança de status"]):::passo --> W{"Nova: criada pela web?<br/>Status: qualquer oportunidade,<br/>fora da carga"}:::decisao
  W -->|"não"| X1["Nunca envia"]:::erro
  W -->|"sim"| L{"Módulo ligado?"}:::decisao
  L -->|"não"| X1
  L -->|"sim"| ST{"Status está entre os marcados?"}:::decisao
  ST -->|"não"| X1
  ST -->|"sim"| Q["Entra na fila (pendente)"]:::ok
  Q --> E{"No envio: ainda ligado<br/>e há destinatário Para<br/>(ou pré-vendas com e-mail)?"}:::decisao
  E -->|"não"| IG["Marcado como não enviado, com o motivo"]:::erro
  E -->|"sim"| ENV["Envia o e-mail<br/>(todas as informações da oportunidade)"]:::passo
  ENV --> R{"Resultado"}:::decisao
  R -->|"ok"| OK["Enviado"]:::ok
  R -->|"falha"| T{"Já foram 5 tentativas?"}:::decisao
  T -->|"não"| Q
  T -->|"sim"| F["Falhou: alerta do GitHub e motivo na aba E-mails"]:::erro
```

---

## Confiabilidade

### D15 · Backup, restauração e resiliência

*Tipo: mapa de disponibilidade e resiliência · Escopo: proteção dos dados e metas · Pergunta: **quanto dado posso perder e como sei que o backup funciona?***

```mermaid
flowchart LR
  classDef agenda fill:#fde9dc,stroke:#b4561d,color:#1a1a1a
  classDef dados fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef passo fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef alerta fill:#fde1e1,stroke:#a61f1f,color:#1a1a1a
  classDef meta fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a

  DB[("Neon: produção<br/>histórico de 6 h (plano gratuito)")]:::dados
  BK{{"Backup diário<br/>03:00 BRT, na prática ~08:30"}}:::agenda --> DUMP["pg_dump completo<br/>radar_backup, somente leitura"]:::passo
  DB --> DUMP
  DUMP --> CHK["verifica tamanho e tabelas"]:::passo --> ENC["AES-256 + PBKDF2<br/>+ hash SHA-256"]:::passo
  ENC --> DR[("Google Drive<br/>diario/ 14 dias<br/>semanal/ 12 semanas")]:::dados

  ESP{{"Espelho no Supabase<br/>diário 04:30 BRT"}}:::agenda --> DUMP2["pg_dump + guarda do destino<br/>(só projeto dedicado ao Radar)"]:::passo
  DB --> DUMP2
  DUMP2 --> SUPA[("Supabase radar-backup<br/>estado mais recente<br/>falha se a contagem não bater")]:::dados

  MES{{"Teste mensal<br/>dia 1"}}:::agenda --> DL["baixa o último, confere o hash, descriptografa"]:::passo
  DR --> DL
  DL --> R1["restaura em Postgres temporário"]:::passo
  DL --> R2["restaura no branch Neon de teste"]:::passo
  R1 --> CMP["compara com a produção e faz um cadastro de teste (desfeito)"]:::passo
  R2 --> CMP

  VIG{{"Vigia diário 12:00 BRT"}}:::agenda
  VIG -.-> A1["backup com mais de 30 h?"]:::alerta
  VIG -.-> A2["teste de restauração com mais de 40 dias?"]:::alerta
  A1 & A2 -.->|"falha do workflow: e-mail do GitHub"| N(["Quem administra é avisado"]):::alerta

  M1["RPO: até ~24 h pelo backup diário (o vigia tolera 30 h)<br/>e até 6 h para engano recente, pelo histórico do Neon"]:::meta
  M2["RTO: ainda não definido formalmente<br/>(o espelho do Supabase encurta a recuperação, mas ainda não foi testado como banco ativo)"]:::meta
```

### D16 · Entrega e testes (CI/CD)

*Tipo: fluxograma · Escopo: do código à produção e as rotinas de teste · Pergunta: **o que impede um erro de chegar à produção?***

```mermaid
flowchart LR
  classDef passo fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef gate fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef agenda fill:#fde9dc,stroke:#b4561d,color:#1a1a1a
  classDef ok fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a

  DEV(["Desenvolvimento"]):::passo -->|"Pull Request"| PIPE["Pipeline"]:::passo

  subgraph ci["CI (todo PR e push na main)"]
    Q["Qualidade<br/>tipos + unitários + banco do zero<br/>(regressão e segurança) + segurança estática + cobertura"]:::gate
    B["Build + orçamento de bundle<br/>+ guarda contra dados reais"]:::gate
    E["E2E no navegador, desktop e celular<br/>funcional, acessibilidade (WCAG AA),<br/>desempenho com 5.000 linhas, segurança (XSS)"]:::gate
    A["npm audit + assinaturas<br/>+ revisão de dependências do PR"]:::gate
    C["CodeQL + Dependabot"]:::gate
  end
  PIPE --> Q & B & E & A
  PIPE -.-> C
  Q & B & E & A --> OK{"CI ok<br/>(único check obrigatório)"}:::gate
  OK -->|"PR"| PRV["Pré-visualização pr-N"]:::passo
  OK -->|"merge na main"| DEP["Deploy em produção (wrangler)"]:::ok
  DEP --> SMK["Smoke test: Access na raiz e em /api"]:::ok
  DEP -.->|"rollback: rodar o pipeline com o commit anterior"| PIPE

  SEM{{"Semanal: carga e segurança"}}:::agenda --> NF["Carga do banco e da API<br/>sondagem de segurança do site (de fora)<br/>latência do banco real"]:::passo
  DIA{{"Diário: vigia"}}:::agenda --> VG["backup e teste de restauração em dia"]:::passo
  INT{{"Ao salvar na web + agenda<br/>Planner integração e Enviar e-mails"}}:::agenda --> RT["cartão no Planner e e-mail em cerca de 1 minuto<br/>(verificar: confere login e colunas sem gravar)"]:::passo
  ESD{{"Diário: espelho no Supabase"}}:::agenda --> ES["restaura o banco no projeto dedicado"]:::passo
```

---

## Segurança e dados

### D17 · Fluxo de dados e fronteiras de confiança (STRIDE)

*Tipo: fluxo de dados com fronteiras de confiança (DFD de modelagem de ameaças) · Pergunta: **por onde os dados passam, onde a confiança muda e o que protege cada travessia?***

```mermaid
flowchart LR
  classDef pessoa fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef proc fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef dados fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef externo fill:#f2f2f2,stroke:#555555,stroke-dasharray:4 3,color:#1a1a1a

  subgraph z0["Zona 0: Internet (não confiável)"]
    U(["Usuário e navegador"]):::pessoa
    ATK(["Qualquer desconhecido"]):::pessoa
    APX(["Aplicação externa<br/>com chave de API"]):::pessoa
  end

  subgraph z1["Zona 1: Borda Cloudflare (autentica)"]
    ACC["Access<br/>OTP por e-mail, domínio da empresa"]:::externo
  end

  subgraph z2["Zona 2: Aplicação (valida tudo)"]
    SPA["SPA<br/>só texto, sem HTML dinâmico, CSP restrita"]:::proc
    API["Funções /api/*<br/>JWT, CSRF, Zod, autor vem do JWT"]:::proc
  end

  subgraph z3["Zona 3: Dados (impõe regras e privilégios)"]
    DB[("Neon Postgres<br/>funções por perfil, histórico imutável,<br/>papéis de mínimo privilégio")]:::dados
  end

  subgraph z4["Zona 4: Rotinas confiáveis com credencial própria"]
    GHA["GitHub Actions<br/>Planner, e-mail, backup, espelho, testes<br/>(sem máquina de pessoa)"]:::proc
  end

  EXT["Serviços externos<br/>Receita, Planner, Gmail, Drive, Supabase"]:::externo

  ATK -.->|"sem login: 302 para o Access (testado de fora)"| ACC
  APX -->|"HTTPS + chave Bearer [dados da oportunidade] (caminho /api/externo/* sem Access; só a chave protege)"| API
  U -->|"HTTPS: e-mail e código"| ACC
  ACC -->|"HTTPS + JWT RS256 assinado [identidade]"| SPA
  SPA -->|"HTTPS JSON + x-radar-csrf [dados internos e e-mails]"| API
  API -->|"TLS, radar_app ou radar_leitor [dados internos]"| DB
  API -->|"HTTPS, só 14 dígitos vão na URL [CNPJ público]"| EXT
  API -.->|"workflow_dispatch, token só de Actions [aciona a rotina]"| GHA
  GHA -->|"TLS, radar_planner, radar_email e radar_backup"| DB
  GHA -->|"Graph delegado [título e responsável do cartão]"| EXT
  GHA -->|"AES-256 [dump cifrado], SMTP TLS [aviso] e pg_restore [espelho]"| EXT
```

| STRIDE | Ameaça no Radar | Controle | Onde é verificado |
|---|---|---|---|
| **S**poofing (falsificação) | Fingir ser outra pessoa ou administrador | JWT RS256 validado com as chaves do Access; autor sempre do JWT, nunca do corpo; JWT forjado (`alg none`) recusado | `functions/api/seguranca.test.ts`, sondagem externa |
| **T**ampering (adulteração) | Alterar dados sem permissão ou outro registro; XSS; injeção de SQL | CSRF (cabeçalho + Origin); Zod descarta campos desconhecidos; funções com `search_path` fixo; sem escrita direta; React escapa texto; CSP sem script inline | `db/testes/seguranca.test.ts`, `e2e/seguranca.spec.ts`, `src/seguranca-estatica.test.ts` |
| **R**epudiation (negação) | "Não fui eu que mudei" | Histórico por gatilho: quem, quando, campo, de → para; a aplicação não apaga nem reescreve o histórico | `db/testes/regressao.test.ts` e segurança |
| **I**nformation disclosure (vazamento) | Ver dados sem login; vazar senha em erro ou log público | Access na borda; falha fechada (503) sem configuração; erros genéricos; log do GitHub só com contagens; orçamento sigiloso sem valor | sondagem externa, testes de vazamento da API |
| **D**enial of service (negação de serviço) | Sobrecarga ou corpo gigante | Limites de tamanho no Zod; listagem e carga medidas; fila de e-mail em lotes de 50 | `npm run test:carga` |
| **E**levation of privilege (elevação) | Uma credencial de banco virar administrador | Papéis de mínimo privilégio; funções que recebem identidade só executáveis por `radar_app` (achado e corrigido na migração 011) | `db/testes/seguranca.test.ts` (escalonamento) |

### D18 · Papéis do banco e privilégios

*Tipo: componente/segurança · Escopo: o que cada credencial alcança · Pergunta: **se uma credencial vazar, até onde chega?** (Reflete exatamente a matriz verificada nos testes.)*

```mermaid
flowchart LR
  classDef papel fill:#fff4d6,stroke:#8a6d00,color:#1a1a1a
  classDef tab fill:#e6f6e6,stroke:#2d7a2d,color:#1a1a1a
  classDef fun fill:#e3f0ff,stroke:#1f5fa8,color:#1a1a1a
  classDef nega fill:#fde1e1,stroke:#a61f1f,color:#1a1a1a

  LEI["radar_leitor<br/>API do painel"]:::papel
  APP["radar_app<br/>API do cadastro"]:::papel
  ESC["radar_escritor<br/>sem uso: carga descontinuada"]:::papel
  PLN["radar_planner<br/>exportador do Planner"]:::papel
  EML["radar_email<br/>envio de e-mail"]:::papel
  BKP["radar_backup<br/>backup e espelho"]:::papel

  T1[("oportunidades<br/>opcoes, usuarios, carga_status, linhas_torre")]:::tab
  T2[("oportunidades_historico")]:::tab
  T3[("email_config<br/>email_destinatarios")]:::tab
  T4[("email_fila")]:::tab
  T5[("planner_marco<br/>planner_exportacao<br/>planner_auto_estado (cifrado)")]:::tab
  F1["criar, atualizar, arquivar<br/>salvar_usuario, salvar_opcao<br/>salvar_email_config, enfileirar_email_teste, eh_admin"]:::fun
  F2["sincronizar_planilha<br/>(legado)"]:::fun
  F3["criar_oportunidade_api, autenticar_api_cliente<br/>criar, listar e revogar_api_cliente<br/>(chaves só como hash; administrador gerencia)"]:::fun
  N["Ninguém tem DELETE ou TRUNCATE.<br/>A carga total antiga foi revogada."]:::nega

  LEI -->|"SELECT"| T1
  APP -->|"SELECT"| T1
  APP -->|"SELECT"| T2
  APP -->|"SELECT"| T3
  APP -->|"SELECT"| T4
  APP -->|"EXECUTE"| F1
  APP -->|"EXECUTE"| F3
  ESC -->|"EXECUTE"| F2
  PLN -->|"SELECT em oportunidades e usuários"| T1
  PLN -->|"SELECT, INSERT, UPDATE"| T5
  EML -->|"SELECT (usuarios: só nome, e-mail, ativo)"| T1
  EML -->|"SELECT"| T3
  EML -->|"SELECT, UPDATE"| T4
  BKP -->|"leitura de tudo (pg_read_all_data)"| T1
```

### D19 · Modelo de dados (ER)

*Tipo: entidade-relacionamento (físico, resumido) · Escopo: todas as tabelas · Pergunta: **o que é guardado e como se relaciona?***

```mermaid
erDiagram
  oportunidades ||--o{ oportunidades_historico : "audita"
  oportunidades ||--o| planner_exportacao : "exportada"
  oportunidades ||--o{ email_fila : "pede aviso"
  oportunidades ||--o| api_idempotencia : "criada pela API"
  usuarios ||--o{ oportunidades : "pré-vendas (por nome)"
  linhas_torre ||--o{ oportunidades : "define a torre"
  codigo_sequencia ||--o{ oportunidades : "numera o código por ano"

  oportunidades {
    bigint id PK
    text codigo "AAAA-NNNN, único e imutável"
    text status
    text torre "calculada pela linha"
    text linha_servico
    text orgao
    text descritivo "sem limite"
    text sigla "até 20 caracteres, fora da planilha"
    text solicitante "quem pediu na aplicação externa (API)"
    text objeto "o que se contrata, fora da planilha"
    int duracao_contrato_meses "1 a 600, opcional"
    date data_pregao_dt
    time hora_pregao "opcional, horário de Brasília, fora da planilha"
    text analista "pré-vendas"
    numeric orcamento
    bool orcamento_sigiloso
    numeric valor_ctc
    numeric mc_ctc "fração"
    numeric impostos "fração, duas casas no percentual"
    text empresa_vencedora_cnpj "14 dígitos"
    text empresa_vencedora_razao "da Receita"
    text empresa_vencedora_tipo "Matriz ou Filial"
    text fonte "web (planilha: legado)"
    text chave_planilha
    bool editado_na_web
    bool ausente_na_planilha
    int versao "bloqueio otimista"
    text[] pendencias
    timestamptz arquivado_em
  }
  oportunidades_historico {
    bigint id PK
    bigint oportunidade_id FK
    int versao
    text acao "criou editou arquivou restaurou sincronizou importou"
    text por
    jsonb alteracoes "campo: antes, depois"
  }
  usuarios {
    int id PK
    text nome
    text email
    bool admin
    bool somente_leitura "visualizador"
    bool pre_vendas
    bool ativo
  }
  opcoes {
    text lista PK
    text valor PK
    bool ativo
    int ordem
  }
  linhas_torre {
    text linha PK
    text torre "DIGITAL ou HEALTH"
  }
  codigo_sequencia {
    int ano PK
    int ultimo
  }
  carga_status {
    int id PK "sempre 1"
    timestamptz ultima_carga_em
    int total_linhas
    text fonte
    text erro
  }
  planner_marco {
    int id PK "sempre 1"
    timestamptz marco "NULL = desligado"
  }
  planner_exportacao {
    bigint oportunidade_id PK
    int versao_exportada
    text chave
  }
  api_clientes {
    bigint id PK
    text nome "único, vira api:nome na autoria"
    text chave_hash "SHA-256, nunca a chave"
    bool ativo
    timestamptz ultimo_uso_em
  }
  api_idempotencia {
    text cliente PK
    text chave PK "Idempotency-Key"
    bigint oportunidade_id
  }
  planner_auto_estado {
    text nome PK "token_cache.json ou estado_radar.json"
    text conteudo "cifrado (Fernet)"
    timestamptz atualizado_em
  }
  email_config {
    int id PK "sempre 1"
    bool ativo
    bool avisar_pre_vendas
    text[] status_gatilho
    text atualizado_por
  }
  email_destinatarios {
    text email PK
    text tipo "para ou cc"
    bool ativo
  }
  email_fila {
    bigint id PK
    text tipo "nova, status ou teste"
    text status_anterior
    text status_novo
    text alterado_por
    bigint oportunidade_id FK
    text situacao "pendente enviado erro ignorado"
    int tentativas
    text ultimo_erro
  }
```

*A tabela `oportunidades` tem ~56 colunas (as 34 da planilha, as derivadas `ano`, `mes`, `sla`, os campos novos e os metadados). As relações com `usuarios`, `linhas_torre` e `codigo_sequencia` são lógicas (aplicadas por função e gatilho), não chaves estrangeiras.*

## Desenhos prontos (SVG)

Os mesmos diagramas como imagens, para abrir no navegador, colar em apresentação ou anexar a um documento. São **artefatos gerados** a partir do Mermaid deste arquivo (a fonte da verdade): não edite o SVG à mão.

| Diagrama | Arquivo |
|---|---|
| Legenda e convenções | [diagramas/00-legenda.svg](diagramas/00-legenda.svg) |
| D1 Contexto | [diagramas/D01-contexto.svg](diagramas/D01-contexto.svg) |
| D2 Contêineres | [diagramas/D02-conteineres.svg](diagramas/D02-conteineres.svg) |
| D3 Implantação | [diagramas/D03-implantacao.svg](diagramas/D03-implantacao.svg) |
| D4 Componentes | [diagramas/D04-componentes.svg](diagramas/D04-componentes.svg) |
| D5 Jornada do usuário | [diagramas/D05-jornada-do-usuario.svg](diagramas/D05-jornada-do-usuario.svg) |
| D6 Perfis e permissões | [diagramas/D06-perfis-e-permissoes.svg](diagramas/D06-perfis-e-permissoes.svg) |
| D7 Cadastro de oportunidade | [diagramas/D07-cadastro.svg](diagramas/D07-cadastro.svg) |
| D8 Edição concorrente | [diagramas/D08-edicao-concorrente.svg](diagramas/D08-edicao-concorrente.svg) |
| D9 Regras de validação | [diagramas/D09-regras-de-validacao.svg](diagramas/D09-regras-de-validacao.svg) |
| D10a Estados do registro | [diagramas/D10a-estados-do-registro.svg](diagramas/D10a-estados-do-registro.svg) |
| D10b Status de negócio | [diagramas/D10b-status-de-negocio.svg](diagramas/D10b-status-de-negocio.svg) |
| D11 Consulta de CNPJ | [diagramas/D11-consulta-de-cnpj.svg](diagramas/D11-consulta-de-cnpj.svg) |
| D12 Carga da planilha (descontinuada) | [diagramas/D12-carga-da-planilha.svg](diagramas/D12-carga-da-planilha.svg) |
| D13 Integração com o Planner | [diagramas/D13-planner.svg](diagramas/D13-planner.svg) |
| D14a E-mail: sequência | [diagramas/D14a-email-sequencia.svg](diagramas/D14a-email-sequencia.svg) |
| D14b E-mail: decisão | [diagramas/D14b-email-decisao.svg](diagramas/D14b-email-decisao.svg) |
| D15 Backup e resiliência | [diagramas/D15-backup-e-resiliencia.svg](diagramas/D15-backup-e-resiliencia.svg) |
| D16 Entrega e testes | [diagramas/D16-cicd-e-testes.svg](diagramas/D16-cicd-e-testes.svg) |
| D17 Fluxo de dados e STRIDE | [diagramas/D17-fluxo-de-dados-stride.svg](diagramas/D17-fluxo-de-dados-stride.svg) |
| D18 Papéis do banco | [diagramas/D18-papeis-do-banco.svg](diagramas/D18-papeis-do-banco.svg) |
| D19 Modelo de dados (ER) | [diagramas/D19-modelo-de-dados.svg](diagramas/D19-modelo-de-dados.svg) |

Para regenerar depois de mudar um diagrama: `npm run diagramas` (usa o Chromium do Playwright e baixa o `mermaid-cli` sob demanda). Um teste (`src/diagramas.test.ts`) falha se o número de SVG não bater com o de diagramas, se um SVG estiver malformado ou se o índice apontar para um título que não existe.

---

## Como manter estes diagramas

- **Mudou um fluxo, atualize o diagrama no mesmo PR.** Diagrama desatualizado é pior que nenhum (o guia da Microsoft manda aposentar o que não responde mais a uma pergunta real).
- **Mantenha as convenções** da seção *Como ler* (formas, linhas, classes de cor) e **a seta saindo de quem inicia**.
- **Valide a sintaxe** antes de commitar: colar o bloco no editor do Mermaid, ou usar o conector do Mermaid (foi o que se fez aqui). Evite `;` em mensagens de diagrama de sequência (encerra a instrução).
- **Camadas:** não empilhe detalhe de caso de uso em D1 a D4; crie um diagrama de sequência ou de decisão novo e ligue-o no índice.
- Cada diagrama traz **tipo, escopo e a pergunta que responde**: se não souber a pergunta, o diagrama provavelmente não é necessário.

### Histórico de mudanças

| Versão | Data | Mudança |
|---|---|---|
| 1.3 | 28/10/2026 | API externa para criar oportunidades (D1, D2, D4, D17, D18, D19): chave por aplicação, autoria `api:<cliente>`, solicitante e idempotência |
| 1.2 | 28/10/2026 | Rotinas na nuvem (GitHub Actions disparado pelo Radar ao salvar; sem máquina de pessoa); fim da carga da planilha (D12); espelho diário no Supabase (D2, D3, D15, D17); e-mail também na mudança de status e com todas as informações (D14); estado do Planner cifrado no banco (D13, D18, D19); novos campos (sigla, duração do contrato) |
| 1.1 | 25/10/2026 | D10b deixa de sugerir um ciclo de status e passa a mostrar só o que o sistema faz: lista fechada sem ordem imposta, exigências por status e efeitos do status (Planner, e-mail, painel) |
| 1.0 | 25/10/2026 | Catálogo inicial com 19 diagramas (D1 a D19), cobrindo contexto, contêineres, implantação, componentes, jornada, perfis, cadastro, concorrência, validação, estados, CNPJ, carga, Planner, e-mail, backup, CI/CD, STRIDE, papéis do banco e ER |
