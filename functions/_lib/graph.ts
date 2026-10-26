/**
 * Cliente mínimo do Microsoft Graph com credencial de APLICAÇÃO (client credentials), para o Planner em tempo real.
 * Roda no runtime Workers (fetch + crypto), sem biblioteca. O segredo do app só existe no servidor (secret do Pages ou do
 * GitHub); nunca vai para o navegador, para log nem para mensagem de erro.
 */
export type GraphLike = {
  get(caminho: string): Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  paginado(caminho: string): Promise<any[]> // eslint-disable-line @typescript-eslint/no-explicit-any
  post(caminho: string, corpo: unknown): Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  patch(caminho: string, corpo: unknown, etag: string): Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type CredenciaisGraph = { tenantId: string; clientId: string; clientSecret: string }

export class ErroGraph extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem)
  }
}

const GRAPH = 'https://graph.microsoft.com/v1.0'
const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function graphApp(cred: CredenciaisGraph, buscar: typeof fetch = fetch, dormir: (ms: number) => Promise<void> = espera): GraphLike {
  let token: { valor: string; expiraEm: number } | null = null

  async function obterToken(): Promise<string> {
    if (token && Date.now() < token.expiraEm - 60_000) return token.valor
    const res = await buscar(`https://login.microsoftonline.com/${encodeURIComponent(cred.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cred.clientId, client_secret: cred.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    })
    if (!res.ok) throw new ErroGraph(`Não foi possível obter o token do Graph (HTTP ${res.status})`, res.status) // sem o corpo: pode ecoar o client_id
    const j = (await res.json()) as { access_token: string; expires_in: number }
    token = { valor: j.access_token, expiraEm: Date.now() + j.expires_in * 1000 }
    return token.valor
  }

  async function chamar(metodo: string, caminho: string, opc: { corpo?: unknown; etag?: string } = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const url = caminho.startsWith('http') ? caminho : GRAPH + caminho
    for (let tentativa = 0; ; tentativa++) {
      const res = await buscar(url, {
        method: metodo,
        headers: {
          authorization: `Bearer ${await obterToken()}`,
          ...(opc.corpo !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(opc.etag ? { 'if-match': opc.etag } : {}),
          ...(metodo !== 'GET' ? { prefer: 'return=representation' } : {}),
        },
        body: opc.corpo !== undefined ? JSON.stringify(opc.corpo) : undefined,
      })
      if ((res.status === 429 || res.status === 503) && tentativa < 3) {
        await dormir(Math.min(Number(res.headers.get('retry-after') ?? 2), 10) * 1000)
        continue
      }
      if (res.status === 401 && tentativa < 1) {
        token = null // token revogado ou expirado antes da hora: renova uma vez
        continue
      }
      if (!res.ok) throw new ErroGraph(`${metodo} ${caminho.split('?')[0]} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status)
      const texto = await res.text()
      return texto ? JSON.parse(texto) : {}
    }
  }

  return {
    get: (c) => chamar('GET', c),
    post: (c, corpo) => chamar('POST', c, { corpo }),
    patch: (c, corpo, etag) => chamar('PATCH', c, { corpo, etag }),
    async paginado(caminho) {
      let url: string | undefined = caminho
      const itens: any[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
      while (url) {
        const j = await chamar('GET', url)
        itens.push(...(j.value ?? []))
        url = j['@odata.nextLink']
      }
      return itens
    },
  }
}
