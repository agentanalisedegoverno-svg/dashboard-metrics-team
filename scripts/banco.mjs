// Conexão com o Postgres para os scripts do GitHub Actions (mesma forma `sql\`...\`` usada na API).
import postgres from 'postgres'

export function neon(url) {
  return postgres(url, { max: 1, ssl: 'require', prepare: false, fetch_types: false, idle_timeout: 5, connect_timeout: 15 })
}
