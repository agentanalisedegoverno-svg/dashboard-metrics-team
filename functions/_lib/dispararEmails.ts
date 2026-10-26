/**
 * Aciona o workflow "Enviar e-mails" do GitHub assim que uma oportunidade é cadastrada, para o aviso sair em segundos
 * sem depender de nenhuma máquina do time. É só um "acorde": quem envia é o script de sempre (fila no banco + SMTP).
 * Sem token configurado não faz nada; nunca derruba nem atrasa o cadastro (erros só vão para o log, sem dados).
 */
export type EnvDisparo = { GITHUB_DISPATCH_TOKEN?: string; GITHUB_REPO?: string }

const REPO_PADRAO = 'agentanalisedegoverno-svg/dashboard-metrics-team'

export async function dispararEnvioEmails(env: EnvDisparo, buscar: typeof fetch = fetch): Promise<boolean> {
  const token = env.GITHUB_DISPATCH_TOKEN
  if (!token) return false
  const repo = /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO ?? '') ? (env.GITHUB_REPO as string) : REPO_PADRAO
  try {
    const r = await buscar(`https://api.github.com/repos/${repo}/actions/workflows/enviar-emails.yml/dispatches`, {
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
    if (!r.ok) console.error('Disparo do envio de e-mails recusado: HTTP', r.status)
    return r.ok
  } catch (e) {
    console.error('Disparo do envio de e-mails falhou:', e instanceof Error ? e.name : 'erro')
    return false
  }
}
