/**
 * Falhas da API, com o que é preciso para descobrir a causa: de ONDE veio a resposta (do Radar ou de fora), o código da requisição
 * (x-radar-req, que se procura no log do Cloudflare), o cf-ray, o tempo e um pedaço do corpo. Ver docs/DIAGNOSTICO.md.
 */
export type OrigemErro =
  | 'radar' // a resposta foi gerada pelo código do Radar (tem o cabeçalho x-radar-origem)
  | 'fora-do-radar' // houve resposta HTTP, mas NÃO passou pelo Radar: Cloudflare (Access, limites do Worker), proxy/firewall ou plataforma
  | 'rede' // o navegador nem recebeu resposta
  | 'tempo' // o servidor não respondeu a tempo

export type FalhaApi = {
  quando: string
  caminho: string
  status: number | null
  origem: OrigemErro
  req: string | null
  ray: string | null
  ms: number
  tipoCorpo: string | null
  corpo: string | null
  servidor: string | null
}

/** Erro com os detalhes anexados. A mensagem continua `Falha na API (HTTP n)` (outras partes do app reconhecem esse texto). */
export class ErroApi extends Error {
  readonly falha: FalhaApi
  constructor(falha: FalhaApi) {
    super(`Falha na API (HTTP ${falha.status})`)
    this.name = 'ErroApi'
    this.falha = falha
  }
}

const MAX_FALHAS = 10
const falhas: FalhaApi[] = []

export function registrarFalha(f: FalhaApi) {
  falhas.push(f)
  if (falhas.length > MAX_FALHAS) falhas.shift()
}
export const falhasRecentes = (): FalhaApi[] => [...falhas]
export const limparFalhas = () => void (falhas.length = 0)

const agoraIso = () => new Date().toISOString()

/** Resume o corpo para o relatório: sem quebras de linha, no máximo 200 caracteres. HTML é só sinalizado. */
export function resumirCorpo(texto: string, tipo: string | null): string | null {
  const t = texto.replace(/\s+/g, ' ').trim()
  if (!t) return null
  if ((tipo ?? '').includes('html') || /^<(!doctype|html)/i.test(t)) return `[página HTML] ${t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`
  return t.slice(0, 200)
}

export async function falhaDeResposta(res: Response, caminho: string, inicio: number): Promise<FalhaApi> {
  const tipoCorpo = res.headers.get('content-type')
  const texto = await res.text().catch(() => '')
  return {
    quando: agoraIso(),
    caminho,
    status: res.status,
    origem: res.headers.get('x-radar-origem') ? 'radar' : 'fora-do-radar',
    req: res.headers.get('x-radar-req'),
    ray: res.headers.get('cf-ray'),
    ms: Math.round(performance.now() - inicio),
    tipoCorpo,
    corpo: resumirCorpo(texto, tipoCorpo),
    servidor: res.headers.get('server-timing'),
  }
}

export function falhaDeExcecao(caminho: string, inicio: number, estourouTempo: boolean): FalhaApi {
  return { quando: agoraIso(), caminho, status: null, origem: estourouTempo ? 'tempo' : 'rede', req: null, ray: null, ms: Math.round(performance.now() - inicio), tipoCorpo: null, corpo: null, servidor: null }
}

/** Frase para o usuário: o que a origem do erro indica e por onde seguir. */
export function explicarOrigem(f: Pick<FalhaApi, 'origem' | 'status'>): string {
  switch (f.origem) {
    case 'radar':
      return `O servidor do Radar respondeu com erro (HTTP ${f.status}). Informe o código da requisição ao suporte.`
    case 'fora-do-radar':
      return `A resposta (HTTP ${f.status}) NÃO veio do Radar: veio do Cloudflare, de um proxy/firewall da sua rede ou de uma queda da plataforma. Teste em outra rede (ex.: 4G) ou numa janela anônima.`
    case 'tempo':
      return 'O servidor não respondeu em 5 segundos. Tente novamente; se repetir, envie o diagnóstico ao suporte.'
    default:
      return 'O navegador não recebeu resposta: verifique a conexão, VPN, proxy ou extensões que bloqueiam o site.'
  }
}

export type EntradaRelatorio = {
  falhas: FalhaApi[]
  /** Resposta do /api/diagnostico, ou o motivo de ele ter falhado. */
  servidor: unknown
  agora?: string
  navegador?: string
  online?: boolean
  pagina?: string
}

/** Texto único, pronto para colar no chamado: contexto do navegador, falhas recentes e o diagnóstico feito no servidor. */
export function montarRelatorio(e: EntradaRelatorio): string {
  const linhas: string[] = [
    'DIAGNÓSTICO RADAR PRÉ-VENDAS',
    `Gerado em: ${e.agora ?? agoraIso()}`,
    `Página: ${e.pagina ?? '-'}`,
    `Navegador: ${e.navegador ?? '-'}`,
    `Online: ${e.online === undefined ? '-' : e.online ? 'sim' : 'não'}`,
    '',
    `FALHAS RECENTES (${e.falhas.length})`,
  ]
  if (e.falhas.length === 0) linhas.push('(nenhuma registrada nesta sessão)')
  for (const f of e.falhas) {
    linhas.push(
      `- ${f.quando} ${f.caminho} -> ${f.status ?? 'sem resposta'} | origem: ${f.origem} | req: ${f.req ?? '-'} | cf-ray: ${f.ray ?? '-'} | ${f.ms} ms`,
      `  ${explicarOrigem(f)}`,
    )
    if (f.servidor) linhas.push(`  server-timing: ${f.servidor}`)
    if (f.corpo) linhas.push(`  resposta: ${f.corpo}`)
  }
  linhas.push('', 'DIAGNÓSTICO DO SERVIDOR (/api/diagnostico)', JSON.stringify(e.servidor, null, 2))
  return linhas.join('\n')
}
