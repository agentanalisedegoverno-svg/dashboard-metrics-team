/**
 * Aciona o cron job do Render (ciclo Radar -> Planner) assim que uma oportunidade é cadastrada ou salva, para o cartão
 * sair em cerca de um minuto sem esperar os 5 minutos do agendamento. É só um "acorde": quem exporta e grava no Planner
 * é o job de sempre. Sem chave configurada não faz nada; nunca derruba nem atrasa o salvamento (erros só vão para o log).
 * Atenção: o Render cancela uma execução em andamento ao acionar outra; o job é idempotente e relê o Planner antes de criar.
 */
export type EnvPlanner = { RENDER_API_KEY?: string; RENDER_PLANNER_CRON_ID?: string }

export async function dispararPlanner(env: EnvPlanner, buscar: typeof fetch = fetch): Promise<boolean> {
  const chave = env.RENDER_API_KEY
  const id = env.RENDER_PLANNER_CRON_ID
  if (!chave || !id || !/^crn-[\w]+$/.test(id)) return false
  try {
    const r = await buscar(`https://api.render.com/v1/cron-jobs/${id}/runs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}`, accept: 'application/json', 'user-agent': 'radar-prevendas' },
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) console.error('Disparo do Planner recusado: HTTP', r.status)
    return r.ok
  } catch (e) {
    console.error('Disparo do Planner falhou:', e instanceof Error ? e.name : 'erro')
    return false
  }
}
