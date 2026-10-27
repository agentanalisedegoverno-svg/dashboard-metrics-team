#!/bin/sh
# Ciclo Radar -> Planner para rodar fora do computador do João (Render cron job). Mesmo fluxo do rodar-integracao.cmd:
# restaura o estado do banco, exporta os eventos, aplica no Planner e guarda o estado de volta (mesmo se algo falhar no meio).
# Variáveis: DATABASE_URL_PLANNER, PLANNER_ESTADO_CHAVE, PLANNER_CLIENT_ID, PLANNER_TENANT_ID.
set -u
export PYTHONUTF8=1
export PLANNER_EVENTOS_DIR=/tmp/eventos
rm -rf "$PLANNER_EVENTOS_DIR"
cd "$(dirname "$0")/.." || exit 1

python planner-auto/estado_db.py preparar || exit 1
python planner-auto/estado_db.py restaurar || exit 1

RC=0
node scripts/planner-eventos.mjs --saida "$PLANNER_EVENTOS_DIR/entrada" || RC=1
if [ "$RC" -eq 0 ]; then
  (cd planner-auto && python planner_auto.py processar-eventos --sim) || RC=1
fi

python planner-auto/estado_db.py guardar || RC=1
exit "$RC"
