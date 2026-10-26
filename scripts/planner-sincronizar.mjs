// Rotina de SEGURANÇA do Planner em tempo real (modo nuvem): refaz o que a API não conseguiu aplicar no instante do Salvar
// (falha passageira do Graph, deploy no meio, edição perdida) e avisa quando uma oportunidade esgotou as tentativas.
// A atualização normal NÃO passa por aqui: acontece na própria API, em segundos. Roda no GitHub Actions (planner-sincronizar.yml).
//
// Variáveis: DATABASE_URL_PLANNER (papel radar_planner), PLANNER_TENANT_ID, PLANNER_CLIENT_ID, PLANNER_CLIENT_SECRET,
//            PLANNER_RESPONSAVEIS_EXTRAS (opcional: e-mails separados por vírgula).
// Uso: node scripts/planner-sincronizar.mjs [--simular]
//   --simular  só conta o que está pendente (não chama o Planner nem grava).
//
// O log do GitHub é PÚBLICO: aqui só saem contagens, nunca códigos de oportunidade, e-mails nem títulos.
import { depsDoAmbiente, emFalhaDefinitiva, lerModo, pendentes, plannerNuvemConfigurado, sincronizarPendentes } from '../functions/_lib/plannerNuvem.ts'

if (!plannerNuvemConfigurado(process.env)) {
  console.log('Modo nuvem do Planner não configurado (faltam variáveis): nada a fazer.')
  process.exit(0)
}

const deps = depsDoAmbiente(process.env)
const cfg = await lerModo(deps.sql)
if (!cfg?.marco || cfg.modo !== 'nuvem') {
  console.log(`Planner em modo "${cfg?.modo ?? 'desconhecido'}": a rotina da máquina Windows é quem atualiza. Nada a fazer.`)
  process.exit(0)
}

if (process.argv.includes('--simular')) {
  console.log(`[simulação] pendentes: ${(await pendentes(deps.sql)).length}`)
  process.exit(0)
}

const rodada = await sincronizarPendentes(deps)
const conta = (estado) => rodada.filter((r) => r.resultado.estado === estado).length
console.log(`pendentes ${rodada.length} | aplicados ${conta('aplicado')} | sem plano ${conta('sem_plano')} | arquivadas ${conta('arquivada')} | erros ${conta('erro')}`)

const definitivas = await emFalhaDefinitiva(deps.sql)
if (definitivas.length > 0) {
  console.error(`::error::${definitivas.length} oportunidade(s) esgotaram as tentativas de atualizar o Planner. Veja planner_exportacao.ultimo_erro (coluna tentativas >= 5) e docs/TEMPO-REAL.md.`)
  process.exit(1)
}
