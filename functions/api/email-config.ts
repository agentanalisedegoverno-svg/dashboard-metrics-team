import { lerEmailConfig, salvarEmailConfig } from '../_lib/emailConfig.ts'
import { comCorpo, rota } from '../_lib/rota.ts'

export const onRequest = rota({
  GET: ({ sql, email }) => lerEmailConfig(sql, email),
  PUT: ({ sql, email, corpo }) => comCorpo(corpo, (j) => salvarEmailConfig(sql, email, j)),
})
