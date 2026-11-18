// Conexão com o Postgres (Azure Database for PostgreSQL). Mantém a forma `sql\`...\`` usada em todo o código
// (antes vinha do driver HTTP do Neon): devolve um array de linhas; parâmetros sempre vinculados, nunca concatenados.
// No Cloudflare Pages Functions usa TCP (flag nodejs_compat). O cliente nasce por requisição; a conexão vai pelo
// PgBouncer do servidor (porta 6432), então conexões que ficarem ociosas não pesam no limite do banco.
import postgres from 'postgres'

export function neon(url: string) {
  return postgres(url, {
    max: 1,
    ssl: 'require',
    prepare: false, // exigido pelo PgBouncer em modo transação
    fetch_types: false,
    idle_timeout: 5,
    connect_timeout: 10,
    max_lifetime: 60,
    connection: { application_name: 'radar-prevendas' },
  })
}
