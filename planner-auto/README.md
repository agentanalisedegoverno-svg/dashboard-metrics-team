# planner-auto

Aplica no Microsoft Planner os eventos gerados pelo Radar (`scripts/planner-eventos.mjs`). Contrato, regras e operação: [`docs/INTEGRACAO-PLANNER.md`](../docs/INTEGRACAO-PLANNER.md).

## Instalação (uma vez, na máquina que roda a integração)

```powershell
cd C:\Users\CTC\planner-auto            # cópia desta pasta
python -m pip install -r requirements.txt
copy config.exemplo.json config.json    # preencher client_id e tenant_id (não versionados)
python planner_auto.py login            # código em https://login.microsoft.com/device
python planner_auto.py inspecionar      # confere buckets/rótulos com config\planner-mapa.json do Radar
```

`config.json` fica **só na máquina** (tem os IDs do app e do tenant). O token fica em `%USERPROFILE%\.planner_auto\`, junto do log `acoes.jsonl` e do estado `estado_radar.json`.

## Comandos

| Comando | Função |
|---|---|
| `login` | login por código de dispositivo (app delegado, sem segredo) |
| `inspecionar [--plano ID]` | lista buckets e rótulos reais (só leitura) e confere com o mapa do Radar |
| `processar-eventos --dry-run` | mostra o que faria em cada cartão, sem gravar |
| `processar-eventos [--sim] [--arquivo NOME]` | aplica os eventos de `eventos\entrada`; sem `--sim`, pede confirmação |

## Agendamento

`rodar-integracao.cmd` roda o exportador do Radar e depois `processar-eventos --sim`, com log em `logs\integracao.log`. Tarefa do Windows: `Radar-Planner integracao` (seg–sex, 07h–19h, a cada 30 min). Ajuste os caminhos do `.cmd` se a pasta do Radar mudar.

## Testes

```powershell
python -m unittest discover -s tests
```

Cobrem validação do evento, resolução de bucket/rótulo por nome, versionamento, responsáveis e erros que vão para `erros\`. Não acessam a rede.
