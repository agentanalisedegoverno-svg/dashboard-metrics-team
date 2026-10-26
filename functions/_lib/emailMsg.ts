/**
 * Texto do e-mail de nova oportunidade. Função pura (sem rede), usada pelo script de envio e testada à parte.
 * Todo valor vindo do cadastro é escapado no HTML e limpo de quebras de linha no assunto (sem injeção de cabeçalho).
 */
export type DadosEmail = {
  codigo: string | null
  orgao: string | null
  objeto?: string | null
  status: string | null
  torre: string | null
  linha_servico: string | null
  uf: string | null
  data_pregao_dt: string | null
  hora_pregao?: string | null
  analista: string | null
  orcamento: number | null
  orcamento_sigiloso: boolean
  criado_por: string | null
}

export type Mensagem = { assunto: string; texto: string; html: string }

const limpa = (v: unknown, max = 200) => String(v ?? '').replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
const brl = (n: number | null) => (n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }))

export function montarEmail(o: DadosEmail, url: string): Mensagem {
  const linhas: [string, string][] = [
    ['Código', limpa(o.codigo) || '—'],
    ['Órgão', limpa(o.orgao) || '—'],
    ['Objeto', limpa(o.objeto, 300) || '—'],
    ['Status', limpa(o.status) || '—'],
    ['Torre', limpa(o.torre) || '—'],
    ['Linha de serviço', limpa(o.linha_servico) || '—'],
    ['UF', limpa(o.uf) || '—'],
    ['Data do pregão', o.data_pregao_dt && o.hora_pregao ? `${dataBr(o.data_pregao_dt)} ${String(o.hora_pregao).slice(0, 5)}` : dataBr(o.data_pregao_dt)],
    ['Pré-vendas', limpa(o.analista) || '—'],
    ['Orçamento', o.orcamento_sigiloso ? 'Sigiloso' : brl(o.orcamento)],
    ['Cadastrada por', limpa(o.criado_por) || '—'],
  ]
  const assunto = limpa(`[Radar] Nova oportunidade ${o.codigo ?? ''} — ${o.orgao ?? 'sem órgão'} (${o.status ?? 'sem status'})`, 180)
  const texto = [`Nova oportunidade cadastrada no Radar Pré-Vendas.`, '', ...linhas.map(([k, v]) => `${k}: ${v}`), '', `Abrir o Radar: ${url}`].join('\n')
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:14px">
<p><strong>Nova oportunidade cadastrada no Radar Pré-Vendas.</strong></p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #ddd">
${linhas.map(([k, v]) => `<tr><td style="border:1px solid #ddd;background:#f6f6f6"><strong>${esc(k)}</strong></td><td style="border:1px solid #ddd">${esc(v)}</td></tr>`).join('\n')}
</table>
<p><a href="${esc(url)}">Abrir o Radar</a></p>
<p style="color:#777;font-size:12px">Aviso automático. Quem administra o Radar define quem recebe e a partir de quais status.</p>
</body></html>`
  return { assunto, texto, html }
}

export function montarEmailTeste(url: string): Mensagem {
  const texto = `Este é um e-mail de teste do Radar Pré-Vendas.\nSe você recebeu, o envio está funcionando.\n\nAbrir o Radar: ${url}`
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px"><p><strong>E-mail de teste do Radar Pré-Vendas.</strong></p><p>Se você recebeu, o envio está funcionando.</p><p><a href="${esc(url)}">Abrir o Radar</a></p></body></html>`
  return { assunto: '[Radar] E-mail de teste', texto, html }
}
