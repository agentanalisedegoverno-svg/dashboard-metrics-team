// Conexão com o Postgres (Azure Database for PostgreSQL). Mantém a forma `sql\`...\`` usada em todo o código
// (antes vinha do driver HTTP do Neon): devolve um array de linhas; parâmetros sempre vinculados, nunca concatenados.
// No Cloudflare Pages Functions usa TCP (flag nodejs_compat). O cliente nasce por requisição.
import postgres from 'postgres'

/** O código passa o JSON já serializado (`${JSON.stringify(x)}::jsonb`). O driver, por padrão, serializaria de novo o texto
 *  (JSON duplo) e o banco receberia um valor escalar. Texto passa direto; objeto é serializado. */
export const serializarJson = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x))

export function neon(url: string) {
  return postgres(url, {
    max: 1,
    ssl: 'require',
    prepare: false,
    fetch_types: false,
    idle_timeout: 5,
    connect_timeout: 10,
    max_lifetime: 60,
    connection: { application_name: 'radar-prevendas' },
    types: { json: { to: 114, from: [114, 3802], serialize: serializarJson, parse: (x: string) => JSON.parse(x) } },
  })
}
