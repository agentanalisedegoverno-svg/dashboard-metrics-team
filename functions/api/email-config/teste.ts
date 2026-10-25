import { pedirEmailTeste } from '../../_lib/emailConfig.ts'
import { rota } from '../../_lib/rota.ts'

export const onRequest = rota({ POST: ({ sql, email }) => pedirEmailTeste(sql, email) })
