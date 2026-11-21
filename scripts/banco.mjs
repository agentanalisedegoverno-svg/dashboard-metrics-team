// Conexão com o Postgres para os scripts do GitHub Actions (mesma forma `sql\`...\`` usada na API).
import postgres from 'postgres'

// O código passa o JSON já serializado (`${JSON.stringify(x)}::jsonb`); sem isto o driver serializaria de novo (JSON duplo).
const serializarJson = (x) => (typeof x === 'string' ? x : JSON.stringify(x))

// Colunas de array (`text[]`) chegam como texto (`{Go,"No Go"}`) porque não buscamos os tipos a cada conexão; converte para lista.
function parseArrayTexto(entrada) {
  const s = entrada.trim()
  if (s === '' || s === '{}') return []
  const itens = []
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

const serializarArrayTexto = (x) =>
  Array.isArray(x) ? `{${x.map((v) => (v === null ? 'NULL' : `"${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)).join(',')}}` : String(x)

export function conectar(url) {
  return postgres(url, {
    max: 1, ssl: 'require', prepare: false, fetch_types: false, idle_timeout: 5, connect_timeout: 15,
    types: {
      json: { to: 114, from: [114, 3802], serialize: serializarJson, parse: (x) => JSON.parse(x) },
      textArray: { to: 1009, from: [1009, 1015], serialize: serializarArrayTexto, parse: parseArrayTexto },
    },
  })
}
