// Conexão com o Postgres para os scripts do GitHub Actions (mesma forma `sql\`...\`` usada na API).
import postgres from 'postgres'

// O código passa o JSON já serializado (`${JSON.stringify(x)}::jsonb`); sem isto o driver serializaria de novo (JSON duplo).
const serializarJson = (x) => (typeof x === 'string' ? x : JSON.stringify(x))

export function neon(url) {
  return postgres(url, {
    max: 1, ssl: 'require', prepare: false, fetch_types: false, idle_timeout: 5, connect_timeout: 15,
    types: { json: { to: 114, from: [114, 3802], serialize: serializarJson, parse: (x) => JSON.parse(x) } },
  })
}
