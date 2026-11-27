/**
 * Prazo até o pregão em DIAS ÚTEIS (segunda a sexta, sem feriados nacionais). Funções puras: o "hoje" entra como parâmetro.
 *
 * Feriados considerados: os nacionais fixos (inclui o 20/11, Consciência Negra, nacional desde 2024), a Sexta-feira Santa e,
 * por serem dias sem sessão na prática, a segunda e a terça de Carnaval e o Corpus Christi (pontos facultativos). Feriados
 * estaduais e municipais NÃO entram: o órgão pode ter um a mais, e então o prazo real é um dia menor que o mostrado.
 */

const DIA = 86_400_000
const ISO = /^(\d{4})-(\d{2})-(\d{2})/
const utc = (ano: number, mes: number, dia: number) => Date.UTC(ano, mes - 1, dia)

/** Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher), como dia UTC. */
function pascoa(ano: number): number {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return utc(ano, mes, dia)
}

const cacheFeriados = new Map<number, Set<number>>()
/** Dias (UTC, meia-noite) sem expediente no ano: feriados nacionais, Sexta Santa, Carnaval (seg/ter) e Corpus Christi. */
export function feriadosDoAno(ano: number): Set<number> {
  const guardado = cacheFeriados.get(ano)
  if (guardado) return guardado
  const p = pascoa(ano)
  const s = new Set<number>([
    utc(ano, 1, 1), utc(ano, 4, 21), utc(ano, 5, 1), utc(ano, 9, 7), utc(ano, 10, 12), utc(ano, 11, 2), utc(ano, 11, 15), utc(ano, 11, 20), utc(ano, 12, 25),
    p - 48 * DIA, p - 47 * DIA, // segunda e terça de Carnaval
    p - 2 * DIA, // Sexta-feira Santa
    p + 60 * DIA, // Corpus Christi
  ])
  cacheFeriados.set(ano, s)
  return s
}

/** Segunda a sexta e fora dos feriados acima. `dia` é um dia UTC (meia-noite). */
export function ehDiaUtil(dia: number): boolean {
  const d = new Date(dia)
  const semana = d.getUTCDay()
  return semana !== 0 && semana !== 6 && !feriadosDoAno(d.getUTCFullYear()).has(dia)
}

/**
 * Dias úteis entre hoje (não conta) e a data do pregão (conta, se for útil): pregão amanhã, num dia útil, = 1. Se o pregão é
 * hoje ou já passou, 0. Sem data válida, null. Acima de um ano devolve os dias corridos (só importa até 5; evita laço longo).
 */
export function diasUteisAte(data: string | null | undefined, hoje: Date): number | null {
  const m = ISO.exec(data ?? '')
  if (!m) return null
  const alvo = utc(Number(m[1]), Number(m[2]), Number(m[3]))
  const base = utc(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate())
  const corridos = Math.round((alvo - base) / DIA)
  if (corridos <= 0) return 0
  if (corridos > 366) return corridos
  let n = 0
  for (let dia = base + DIA; dia <= alvo; dia += DIA) if (ehDiaUtil(dia)) n++
  return n
}

/** Limites do alerta, em dias úteis até o pregão: até 5 = amarelo, até 3 = vermelho. */
export const LIMITE_AMARELO_UTEIS = 5
export const LIMITE_VERMELHO_UTEIS = 3

export type CorPrazo = 'vermelho' | 'amarelo' | null
export const corDoPrazo = (uteis: number | null): CorPrazo =>
  uteis === null ? null : uteis <= LIMITE_VERMELHO_UTEIS ? 'vermelho' : uteis <= LIMITE_AMARELO_UTEIS ? 'amarelo' : null
