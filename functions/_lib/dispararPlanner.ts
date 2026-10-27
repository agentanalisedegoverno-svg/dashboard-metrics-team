/**
 * Aciona o workflow "Planner integração" do GitHub assim que uma oportunidade é cadastrada ou salva, para o cartão sair em
 * cerca de um minuto sem depender de nenhuma máquina do time. É só um "acorde": quem exporta e grava no Planner é o
 * workflow de sempre. Usa o mesmo token do envio de e-mails; sem token não faz nada; nunca derruba nem atrasa o salvamento
 * (erros só vão para o log, sem dados). Acionamentos seguidos entram em fila (o workflow nunca roda duas vezes ao mesmo tempo).
 */
export type EnvPlanner = { GITHUB_DISPATCH_TOKEN?: string; GITHUB_REPO?: string }

const REPO_PADRAO = 'agentanalisedegoverno-svg/dashboard-metrics-team'

export async function dispararPlanner(env: EnvPlanner, buscar: typeof fetch = fetch): Promise<boolean> {
  const token = env.GITHUB_DISPATCH_TOKEN
  if (!token) return false
  const repo = /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO ?? '') ? (env.GITHUB_REPO as string) : REPO_PADRAO
  try {
    const r = await buscar(`https://api.github.com/repos/${repo}/actions/workflows/planner-integracao.yml/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'radar-prevendas',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) console.error('Disparo do Planner recusado: HTTP', r.status)
    return r.ok
  } catch (e) {
    console.error('Disparo do Planner falhou:', e instanceof Error ? e.name : 'erro')
    return false
  }
}
