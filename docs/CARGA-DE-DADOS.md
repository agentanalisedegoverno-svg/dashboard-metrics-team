# Carga de dados (planilha → Postgres, por merge)

> **DESCONTINUADO em 27/10/2026.** O banco não é mais alimentado pela planilha do Excel; tudo é feito no Radar web. A tarefa foi desativada e os scripts removidos. Este documento fica **só como histórico**. Ver [DECISAO-FIM-DA-CARGA-DA-PLANILHA.md](DECISAO-FIM-DA-CARGA-DA-PLANILHA.md).


O banco é a fonte da verdade. Hoje há **duas portas de entrada**: o cadastro na aba **Oportunidades** (web) e a carga da planilha `BaseLicitacao.xlsx` (aba **Base Governo**) feita por um agente. A carga da planilha é um **merge**: não substitui a base.

## O que o merge faz (`sincronizar_planilha`)

| Situação da linha | O que acontece |
|---|---|
| Nova na planilha | inserida (`fonte = 'planilha'`) |
| Existe e mudou na planilha | atualizada |
| Foi **editada na web** ou criada na web | **intocada** (a edição web vence) |
| Sumiu da planilha | marcada `ausente_na_planilha` (não é apagada; painel e grade a ignoram) |
| Reapareceu na planilha | volta a ser vigente |

A identidade da linha é a `chave_planilha` = processo + órgão + data do pregão + torre (com contador para repetições). Se um desses campos for corrigido na planilha, o banco vê uma linha nova e marca a antiga como ausente (ver [ROADMAP.md](ROADMAP.md), item 8).

## Mapeamento da planilha

`functions/_lib/planilha.ts` converte as colunas da aba (34 de dados; as 6 colunas "(Pivot)" são auxiliares e ignoradas) nos campos do cadastro, **sem corrigir nada às escondidas**:
- normaliza grafias (Sim/SIM, variações de motivo, site, linha de serviço…);
- separa número de texto: orçamento "Sigiloso" vira a marca `orcamento_sigiloso`; "R$ 1.234,00" vira número; "19ª posição" vira posição 19; "Desclassificada" vira `situacao_lance`;
- converte margens digitadas como percentual (18 → 0,18);
- valores como "Validar" viram **pendência** (`pendencias`), não opção válida;
- gera um **relatório de qualidade** com avisos (Lost sem motivo, No Go sem motivo, pregão antes da distribuição, sem Pré-vendas, valor vencedor acima do orçamento, possível duplicata…). Avisos não impedem a carga: viram trabalho de correção pela web.

## Como carregar

```
DATABASE_URL_WRITER='postgresql://radar_escritor:<senha>@<host>/neondb?sslmode=require' \
  node scripts/sync-db.mjs aba.json --fonte "agente-claude"
```

- `aba.json` = matriz bruta da aba (`usedRange.values`; primeira linha = cabeçalho).
- `--dry-run` valida, mostra o relatório de qualidade e não grava. `--relatorio saida.json` salva os avisos.
- `--minimo 400` (padrão): recusa a carga se vierem menos linhas (leitura parcial marcaria o resto como ausente).
- `--substituir-legado`: só na **primeira** carga (troca as linhas antigas, sem chave, pelas já chaveadas). Já foi feito em 20/10/2026.
- A carga é **atômica** (uma transação): se algo falhar, nada muda. Array vazio é recusado.
- A última carga aparece no painel ("Última atualização") e em `carga_status`.

> `scripts/load-db.mjs` (carga total antiga) continua no repositório, mas o banco **a bloqueia** se existir qualquer linha criada na web, e a migração `002_revogar_carga_total.sql` a retira do `radar_escritor`.

## Segurança
- `radar_escritor` só executa `sincronizar_planilha`; não lê, não apaga e não cria objetos.
- `radar_leitor` (painel) só faz `SELECT`; `radar_app` (cadastro) só executa as funções de cadastro.
- Senhas ficam fora do Git: `DATABASE_URL_WRITER` no ambiente do agente; `DATABASE_URL` e `DATABASE_URL_APP` como *secrets* no Cloudflare Pages.
- A API só responde com um JWT válido do Cloudflare Access.

Roteiro do agente: [AGENTE-DE-CARGA.md](AGENTE-DE-CARGA.md). Arquitetura: [ARQUITETURA.md](ARQUITETURA.md).
