// Conexão com o Postgres (Azure Database for PostgreSQL). Mantém a forma `sql\`...\`` usada em todo o código
// (antes vinha do driver HTTP do Neon, aposentado): devolve um array de linhas; parâmetros sempre vinculados, nunca concatenados.
// No Cloudflare Pages Functions usa TCP (flag nodejs_compat). O cliente nasce por requisição.
import postgres from 'postgres'

/** O código passa o JSON já serializado (`${JSON.stringify(x)}::jsonb`). O driver, por padrão, serializaria de novo o texto
 *  (JSON duplo) e o banco receberia um valor escalar. Texto passa direto; objeto é serializado. */
export const serializarJson = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x))

/** Colunas de array (`text[]`) chegam do servidor como texto (`{Go,"No Go"}`): sem buscar os tipos a cada conexão
 *  (`fetch_types: false`, para poupar uma ida ao banco), o driver não as converte sozinho. Converte para lista. */
export function parseArrayTexto(entrada: string): (string | null)[] {
  const s = entrada.trim()
  if (s === '' || s === '{}') return []
  const itens: (string | null)[] = []
  let i = 1 // pula a chave de abertura
  while (i < s.length - 1) {
    let v = ''
    if (s[i] === '"') {
      i++
      while (s[i] !== '"') {
        if (s[i] === '\\') i++
        v += s[i++]
      }
      i++ // fecha as aspas
      itens.push(v)
    } else {
      while (i < s.length - 1 && s[i] !== ',') v += s[i++]
      itens.push(v === 'NULL' ? null : v)
    }
    if (s[i] === ',') i++
  }
  return itens
}

/** Lista -> literal de array do Postgres (`{"Go","No Go"}`). */
export const serializarArrayTexto = (x: unknown) =>
  Array.isArray(x) ? `{${x.map((v) => (v === null ? 'NULL' : `"${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)).join(',')}}` : String(x)

/** `hyperdrive`: a URL é a do binding do Hyperdrive (conexão local ao proxy do Cloudflare, sem TLS; o Hyperdrive fala TLS com o banco). */
export function conectar(url: string, opcoes: { hyperdrive?: boolean } = {}) {
  return postgres(url, {
    max: 1,
    ssl: opcoes.hyperdrive ? false : 'require',
    prepare: false,
    fetch_types: false,
    idle_timeout: 5,
    connect_timeout: 10,
    max_lifetime: 60,
    connection: { application_name: 'radar-prevendas' },
    types: {
      json: { to: 114, from: [114, 3802], serialize: serializarJson, parse: (x: string) => JSON.parse(x) },
      textArray: { to: 1009, from: [1009, 1015], serialize: serializarArrayTexto, parse: parseArrayTexto },
    },
  })
}
