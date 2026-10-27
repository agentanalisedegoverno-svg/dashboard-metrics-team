import { secoesNota } from './plannerNota.ts'

/**
 * Texto do e-mail de nova oportunidade ou de mudança de status. Função pura (sem rede), usada pelo script de envio e testada à parte.
 * Todo valor vindo do cadastro é escapado no HTML e limpo de quebras de linha no assunto (sem injeção de cabeçalho).
 */
export type DadosEmail = {
  codigo: string | null
  orgao: string | null
  descritivo?: string | null
  objeto?: string | null
  processo?: string | null
  uasg?: string | null
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
  /** Só no aviso de mudança de status: o que era antes, o que ficou e quem mudou. */
  status_anterior?: string | null
  alterado_por?: string | null
  /** Linha completa da oportunidade (to_jsonb): quando vem, o e-mail leva TODAS as informações, como a anotação do Planner. */
  dados?: Record<string, unknown>
}

export type Mensagem = { assunto: string; texto: string; html: string }

const limpa = (v: unknown, max = 200) => String(v ?? '').replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Valor com quebras de linha preservadas (observações, objeto), sem caracteres de controle. */
const valorCheio = (v: string) => v.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim()

const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
const brl = (n: number | null) => (n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }))

/** Assunto: [Radar] Status | código | órgão | torre | linha de serviço | descrição | PE: processo UASG: uasg | data/hora do pregão. */
export function montarAssunto(o: DadosEmail) {
  const descricao = limpa(o.descritivo, 400)
  const pregao = o.data_pregao_dt && o.hora_pregao ? `${dataBr(o.data_pregao_dt)} ${String(o.hora_pregao).slice(0, 5)}` : dataBr(o.data_pregao_dt)
  const mudou = o.status_anterior !== undefined && o.status_anterior !== null
  const partes = [
    mudou ? `${limpa(o.status_anterior) || 'sem status'} → ${limpa(o.status) || 'sem status'}` : limpa(o.status) || 'sem status',
    limpa(o.codigo) || 'sem código',
    limpa(o.orgao, 80) || 'sem órgão',
    limpa(o.torre, 40) || '—',
    limpa(o.linha_servico, 60) || '—',
    descricao.length > 90 ? `${descricao.slice(0, 89).trimEnd()}…` : descricao || '—',
    `PE: ${limpa(o.processo, 40) || '—'} UASG: ${limpa(o.uasg, 20) || '—'}`,
    pregao,
  ]
  return `[Radar] ${partes.join(' | ')}`
}

const RODAPE = 'Aviso automático. Quem administra o Radar define quem recebe e a partir de quais status.'
const celula = 'border:1px solid #ddd;vertical-align:top'

/** E-mail com todos os campos do formulário, nas mesmas seções e rótulos da anotação do Planner. */
function montarEmailCompleto(o: DadosEmail, url: string, assunto: string, titulo: string, mudou: boolean): Mensagem {
  const d: Record<string, unknown> = { ...o.dados, status: o.status } // o status vale o do momento do aviso
  const cabecalho: [string, string][] = mudou
    ? [['Status', `${limpa(o.status_anterior) || 'sem status'} → ${limpa(o.status) || 'sem status'}`], ['Alterado por', limpa(o.alterado_por) || '—']]
    : []
  const secoes = secoesNota(d)
  const primeira = `Radar ${limpa(o.codigo) || '—'} (v${limpa(d.versao)}) — dados da oportunidade`
  const texto = [
    titulo,
    '',
    ...cabecalho.map(([k, v]) => `${k}: ${v}`),
    ...(mudou ? [''] : []),
    primeira,
    ...secoes.flatMap((s) => ['', ...(s.titulo ? [s.titulo.toUpperCase()] : []), ...s.itens.map(([k, v]) => `${k}: ${valorCheio(v)}`)]),
    '',
    `Abrir o Radar: ${url}`,
  ].join('\n')
  const tabela = (itens: [string, string][]) =>
    `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #ddd;width:100%;max-width:900px">\n${itens
      .map(([k, v]) => `<tr><td style="${celula};background:#f6f6f6;width:32%"><strong>${esc(k)}</strong></td><td style="${celula};white-space:pre-line">${esc(valorCheio(v))}</td></tr>`)
      .join('\n')}\n</table>`
  const bloco = (s: { titulo: string; itens: [string, string][] }) =>
    `${s.titulo ? `<p style="margin:16px 0 4px"><strong>${esc(s.titulo.toUpperCase())}</strong></p>\n` : '<p style="margin:8px 0 0"></p>\n'}${tabela(s.itens)}`
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:14px">
<p><strong>${esc(titulo)}</strong></p>
${cabecalho.length ? `${tabela(cabecalho)}\n` : ''}<p style="color:#555">${esc(primeira)}</p>
${secoes.map(bloco).join('\n')}
<p><a href="${esc(url)}">Abrir o Radar</a></p>
<p style="color:#777;font-size:12px">${RODAPE}</p>
</body></html>`
  return { assunto, texto, html }
}

export function montarEmail(o: DadosEmail, url: string): Mensagem {
  const mudou = o.status_anterior !== undefined && o.status_anterior !== null
  const assunto = montarAssunto(o)
  const titulo = mudou ? 'Status de oportunidade alterado no Radar Pré-Vendas.' : 'Nova oportunidade cadastrada no Radar Pré-Vendas.'
  if (o.dados) return montarEmailCompleto(o, url, assunto, titulo, mudou)
  const linhas: [string, string][] = [
    ['Código', limpa(o.codigo) || '—'],
    ['Órgão', limpa(o.orgao) || '—'],
    ['Objeto', limpa(o.objeto, 300) || '—'],
    ['Status', mudou ? `${limpa(o.status_anterior) || 'sem status'} → ${limpa(o.status) || '—'}` : limpa(o.status) || '—'],
    ['Torre', limpa(o.torre) || '—'],
    ['Linha de serviço', limpa(o.linha_servico) || '—'],
    ['UF', limpa(o.uf) || '—'],
    ['Data do pregão', o.data_pregao_dt && o.hora_pregao ? `${dataBr(o.data_pregao_dt)} ${String(o.hora_pregao).slice(0, 5)}` : dataBr(o.data_pregao_dt)],
    ['Pré-vendas', limpa(o.analista) || '—'],
    ['Orçamento', o.orcamento_sigiloso ? 'Sigiloso' : brl(o.orcamento)],
    mudou ? ['Alterado por', limpa(o.alterado_por) || '—'] : ['Cadastrada por', limpa(o.criado_por) || '—'],
  ]
  const texto = [titulo, '', ...linhas.map(([k, v]) => `${k}: ${v}`), '', `Abrir o Radar: ${url}`].join('\n')
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:14px">
<p><strong>${esc(titulo)}</strong></p>
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
