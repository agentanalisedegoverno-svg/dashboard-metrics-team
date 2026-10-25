// Envia os e-mails pendentes da fila (email_fila) pelo SMTP do Gmail. Roda no GitHub Actions (workflow "Enviar e-mails").
//
// Variáveis de ambiente:
//   DATABASE_URL_EMAIL  string do papel radar_email (somente leitura + atualiza a fila)
//   SMTP_USER / SMTP_PASS   conta do Gmail e a "senha de app" (ou do Workspace)
//   SMTP_FROM           remetente exibido (opcional; padrão = SMTP_USER; o Gmail pode reescrever se não for um alias verificado)
//   SMTP_HOST / SMTP_PORT   padrão smtp.gmail.com / 465
//   APP_URL             endereço do Radar para o link do e-mail (padrão https://radar-prevendas.pages.dev)
//
// Uso: node scripts/enviar-emails.mjs [--simular]
//   --simular  conta o que seria enviado, sem enviar e sem gravar nada (não precisa de SMTP).
//
// O arquivo de log do GitHub é PÚBLICO: aqui só saem contagens, nunca endereços nem dados de oportunidades.
import { neon } from '@neondatabase/serverless'
import nodemailer from 'nodemailer'
import { processarFila } from '../functions/_lib/emailFila.ts'

const simular = process.argv.includes('--simular')
const url = process.env.DATABASE_URL_EMAIL
if (!url) {
  console.error('Falta DATABASE_URL_EMAIL.')
  process.exit(2)
}

let enviar = async () => {}
if (!simular) {
  const { SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_USER || !SMTP_PASS) {
    console.error('Faltam SMTP_USER e SMTP_PASS (secrets do GitHub).')
    process.exit(2)
  }
  const porta = Number(process.env.SMTP_PORT || 465)
  const transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: porta,
    secure: porta === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  })
  const from = process.env.SMTP_FROM || SMTP_USER
  enviar = (e) => transporte.sendMail({ from, to: e.to, cc: e.cc.length ? e.cc : undefined, subject: e.assunto, text: e.texto, html: e.html })
}

const r = await processarFila(neon(url), enviar, { url: process.env.APP_URL || 'https://radar-prevendas.pages.dev', simular })
console.log(`${simular ? '[simulação] ' : ''}pendentes ${r.pendentes} | enviados ${r.enviados} | ignorados ${r.ignorados} | nova tentativa ${r.novaTentativa} | falha definitiva ${r.falhaDefinitiva}`)
// Só falha o workflow (e dispara o e-mail de alerta do GitHub) quando uma mensagem esgotou as tentativas.
if (r.falhaDefinitiva > 0) {
  console.error('::error::Há e-mail(s) que esgotaram as tentativas de envio. Veja a aba E-mails na Administração do Radar.')
  process.exit(1)
}
