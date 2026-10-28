import { ChevronDown, Copy, Play } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { catalogoCampos, REGRAS } from '@/domain/catalogoApi'
import { cn } from '@/lib/utils'
import type { Opcoes } from '../oportunidades/api'

const campoCls = 'rounded-lg border border-line bg-surface px-2.5 py-[7px] text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:opacity-60'

const copiar = async (texto: string) => {
  try {
    await navigator.clipboard.writeText(texto)
    toast.success('Copiado.')
  } catch {
    toast.error('Não foi possível copiar: selecione e copie manualmente.')
  }
}

function Codigo({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <div className="relative">
      <pre className="max-h-80 overflow-auto rounded-lg bg-line-soft p-3 pr-12 text-[12px] leading-relaxed text-ink" aria-label={rotulo}>
        <code>{texto}</code>
      </pre>
      <button
        type="button"
        onClick={() => copiar(texto)}
        aria-label={`Copiar ${rotulo}`}
        title="Copiar"
        className="absolute top-2 right-2 inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-gold"
      >
        <Copy className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/** Cartão de operação, no estilo Swagger: método colorido, caminho, resumo e conteúdo expansível. */
function Operacao({ metodo, caminho, resumo, aberta = false, children }: { metodo: 'GET' | 'POST'; caminho: string; resumo: string; aberta?: boolean; children: ReactNode }) {
  const [aberto, setAberto] = useState(aberta)
  const cor = metodo === 'POST' ? 'bg-[#1a7f4b] text-white' : 'bg-[#2563eb] text-white'
  return (
    <section className="rounded-[10px] border border-line bg-surface" aria-label={`${metodo} ${caminho}`}>
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} className="flex w-full cursor-pointer flex-wrap items-center gap-3 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-gold">
        <span className={cn('rounded px-2 py-0.5 text-[12px] font-bold', cor)}>{metodo}</span>
        <code className="text-[13px] font-semibold text-ink">{caminho}</code>
        <span className="text-xs text-muted">{resumo}</span>
        <ChevronDown className={cn('ml-auto size-4 text-muted transition-transform', aberto && 'rotate-180')} aria-hidden />
      </button>
      {aberto && <div className="space-y-4 border-t border-line p-4">{children}</div>}
    </section>
  )
}

const Titulo = ({ children }: { children: ReactNode }) => <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">{children}</h4>

const hojeMais = (dias: number) => new Date(Date.now() + dias * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

/** Painel "Try it out": chave só na memória desta tela; por padrão SIMULA (não grava, não envia e-mail, não cria cartão). */
function Testar({ base, metodo, caminho, corpoInicial }: { base: string; metodo: 'GET' | 'POST'; caminho: string; corpoInicial?: string }) {
  const [chave, setChave] = useState('')
  const [simular, setSimular] = useState(true)
  const [corpo, setCorpo] = useState(corpoInicial ?? '')
  const [resposta, setResposta] = useState<{ status: number; texto: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const ehPost = metodo === 'POST'

  const enviar = async () => {
    if (!/^rdr_[A-Za-z0-9_-]{20,80}$/.test(chave.trim())) return toast.error('Cole a chave da aplicação (começa com rdr_).')
    if (ehPost && !simular && !window.confirm('Isto vai CRIAR uma oportunidade REAL: dispara e-mail e cartão no Planner. Continuar?')) return
    let json: unknown
    if (ehPost) {
      try {
        json = JSON.parse(corpo)
      } catch {
        return toast.error('O corpo não é um JSON válido.')
      }
    }
    setEnviando(true)
    try {
      const res = await fetch(`${base}${caminho}${ehPost && simular ? '?simular=true' : ''}`, {
        method: metodo,
        redirect: 'manual',
        headers: { authorization: `Bearer ${chave.trim()}`, accept: 'application/json', ...(ehPost ? { 'content-type': 'application/json' } : {}) },
        body: ehPost ? JSON.stringify(json) : undefined,
      })
      const bruto = await res.text()
      let texto = bruto
      try {
        texto = JSON.stringify(JSON.parse(bruto), null, 2)
      } catch {
        /* não é JSON: mostra como veio */
      }
      setResposta({ status: res.status, texto: texto || '(sem corpo)' })
    } catch {
      setResposta({ status: 0, texto: 'Não foi possível chamar a API (rede ou redirecionamento do Access).' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-line p-3">
      <Titulo>Testar aqui</Titulo>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 text-xs font-semibold text-ink-soft">
          Chave da aplicação (não é guardada)
          <input type="password" autoComplete="off" spellCheck={false} className={cn(campoCls, 'mt-1 block w-full')} value={chave} onChange={(e) => setChave(e.target.value)} placeholder="rdr_..." aria-label={`Chave para testar ${metodo} ${caminho}`} />
        </label>
        {ehPost && (
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={simular} onChange={(e) => setSimular(e.target.checked)} />
            Simular (não grava, não envia e-mail, não cria cartão)
          </label>
        )}
        <Button type="button" onClick={enviar} disabled={enviando}>
          <Play className="size-4" aria-hidden /> {enviando ? 'Enviando…' : 'Enviar'}
        </Button>
      </div>
      {ehPost && !simular && <p className="mt-2 text-xs text-st-critical">Atenção: sem a simulação, a chamada cria uma oportunidade real.</p>}
      {ehPost && (
        <label className="mt-3 block text-xs font-semibold text-ink-soft">
          Corpo (JSON)
          <textarea className={cn(campoCls, 'mt-1 block w-full font-mono text-[12px]')} rows={12} value={corpo} onChange={(e) => setCorpo(e.target.value)} spellCheck={false} aria-label="Corpo da requisição" />
        </label>
      )}
      {resposta && (
        <div className="mt-3" role="status">
          <p className="text-xs font-semibold text-ink-soft">
            Resposta: <span className={cn('rounded px-1.5 py-0.5', resposta.status >= 200 && resposta.status < 300 ? 'bg-[#1a7f4b] text-white' : 'bg-st-critical text-white')}>{resposta.status || 'erro'}</span>
          </p>
          <pre className="mt-1 max-h-96 overflow-auto rounded-lg bg-line-soft p-3 text-[12px] text-ink">
            <code>{resposta.texto}</code>
          </pre>
        </div>
      )}
    </div>
  )
}

/** Administração → API → Como chamar: documentação interativa gerada dos campos do formulário (sempre em dia). */
export function ApiDocs({ opcoes }: { opcoes: Opcoes }) {
  const base = `${window.location.origin}/api/externo`
  const campos = useMemo(() => catalogoCampos(opcoes.listas ?? {}), [opcoes.listas])
  const statusLista = campos.find((c) => c.nome === 'status')?.valores ?? []
  const ufLista = campos.find((c) => c.nome === 'uf')?.valores ?? []
  const exemplo = useMemo(
    () => ({
      solicitante: 'Maria Souza (Contratos)',
      status: statusLista.includes('Prospect') ? 'Prospect' : (statusLista[0] ?? 'Prospect'),
      orgao: 'TESTE API (pode apagar)',
      descritivo: 'Link dedicado de 1 Gbps',
      data_pregao_dt: hojeMais(30),
      hora_pregao: '10:00',
      processo: '45/2026',
      ...(ufLista.includes('DF') ? { uf: 'DF' } : {}),
      torre: 'ITS',
      orcamento: 120000.5,
      duracao_contrato_meses: 24,
    }),
    [statusLista, ufLista],
  )
  const corpo = JSON.stringify(exemplo, null, 2)
  const curlPost = `curl -X POST "${base}/oportunidades" \\\n  -H "Authorization: Bearer $CHAVE_RADAR" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: pedido-2026-000123" \\\n  -d '${JSON.stringify(exemplo)}'`
  const curlSim = curlPost.replace(`${base}/oportunidades"`, `${base}/oportunidades?simular=true"`)
  const curlGet = `curl "${base}/campos" \\\n  -H "Authorization: Bearer $CHAVE_RADAR"`

  return (
    <div className="space-y-4">
      <p className="max-w-[80ch] text-xs text-muted">
        Documentação para quem vai chamar a API. Os campos e as listas abaixo saem direto do formulário do Radar e do banco, então estão sempre atuais. Texto completo e guia de entrada em
        produção: <code>docs/API-EXTERNA.md</code>; especificação para importar no Postman: <code>docs/api-externa.openapi.json</code>.
      </p>

      <section className="rounded-[10px] border border-line bg-surface p-4" aria-label="Como começar">
        <Titulo>Como começar</Titulo>
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-soft">
          <li>Um administrador cria a chave da aplicação na aba <strong>Chaves</strong> (mostrada uma única vez; trate como senha).</li>
          <li>
            Envie a chave em todas as chamadas: <code>Authorization: Bearer rdr_...</code>. Chame sempre de <strong>servidor</strong>, nunca do navegador.
          </li>
          <li>
            Antes de ligar de verdade, use <code>?simular=true</code>: valida tudo e mostra como ficaria (código, e-mail e cartão do Planner) <strong>sem gravar nada</strong>.
          </li>
          <li>Para criar de verdade, mande a <code>Idempotency-Key</code> (id do pedido na sua origem): repetir a chamada não duplica.</li>
        </ol>
        <p className="mt-2 text-xs text-muted">
          URL base: <code>{base}</code>
        </p>
      </section>

      <Operacao metodo="POST" caminho="/oportunidades" resumo="Cria uma oportunidade (como o cadastro manual)" aberta>
        <div>
          <Titulo>Parâmetros</Titulo>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-xs text-muted">
                <tr><th className="py-1 pr-3">Nome</th><th className="py-1 pr-3">Onde</th><th className="py-1 pr-3">Obrigatório</th><th className="py-1">Descrição</th></tr>
              </thead>
              <tbody className="text-ink-soft">
                <tr><td className="py-1 pr-3"><code>Authorization</code></td><td className="pr-3">header</td><td className="pr-3">sim</td><td><code>Bearer rdr_...</code> (a chave da aplicação)</td></tr>
                <tr><td className="py-1 pr-3"><code>Content-Type</code></td><td className="pr-3">header</td><td className="pr-3">sim</td><td><code>application/json</code></td></tr>
                <tr><td className="py-1 pr-3"><code>Idempotency-Key</code></td><td className="pr-3">header</td><td className="pr-3">recomendado</td><td>1 a 100 caracteres. Repetir devolve a mesma oportunidade (HTTP 200, <code>"idempotente": true</code>)</td></tr>
                <tr><td className="py-1 pr-3"><code>simular</code></td><td className="pr-3">query</td><td className="pr-3">não</td><td><code>true</code>: só valida e devolve como ficaria, com a prévia do e-mail e do cartão. <strong>Não grava, não envia e-mail, não cria cartão</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <Titulo>Corpo (JSON) · exemplo</Titulo>
          <Codigo texto={corpo} rotulo="exemplo de corpo" />
        </div>

        <div>
          <Titulo>Respostas</Titulo>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-xs text-muted"><tr><th className="py-1 pr-3">Código</th><th className="py-1">Significado</th></tr></thead>
              <tbody className="text-ink-soft">
                <tr><td className="py-1 pr-3"><code>201</code></td><td>Criada. Corpo: <code>id</code>, <code>codigo</code> (AAAA-NNNN), <code>versao</code>, <code>criado_por</code>, <code>solicitante</code>, <code>avisos</code>. Guarde o <code>codigo</code>.</td></tr>
                <tr><td className="py-1 pr-3"><code>200</code></td><td>Repetição com a mesma <code>Idempotency-Key</code> (<code>"idempotente": true</code>) ou simulação (<code>"simulado": true</code>, com <code>previa</code>).</td></tr>
                <tr><td className="py-1 pr-3"><code>400</code></td><td>Corpo que não é um objeto JSON.</td></tr>
                <tr><td className="py-1 pr-3"><code>401</code></td><td>Chave ausente, inválida ou revogada.</td></tr>
                <tr><td className="py-1 pr-3"><code>413</code></td><td>Corpo acima de 64 KB.</td></tr>
                <tr><td className="py-1 pr-3"><code>422</code></td><td>Dados inválidos: <code>{'{ "erros": [{ "campo", "mensagem" }] }'}</code>. Corrija e repita com a mesma <code>Idempotency-Key</code>.</td></tr>
                <tr><td className="py-1 pr-3"><code>5xx</code></td><td>Falha do Radar: repita com a mesma <code>Idempotency-Key</code>.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <Titulo>Exemplo com curl · simulação (não grava)</Titulo>
          <Codigo texto={curlSim} rotulo="curl de simulação" />
        </div>
        <div>
          <Titulo>Exemplo com curl · criação de verdade</Titulo>
          <Codigo texto={curlPost} rotulo="curl de criação" />
        </div>

        <Testar base={base} metodo="POST" caminho="/oportunidades" corpoInicial={corpo} />
      </Operacao>

      <Operacao metodo="GET" caminho="/campos" resumo="Catálogo dos campos, listas válidas e regras">
        <p className="text-[13px] text-ink-soft">Devolve os campos aceitos, as opções válidas de cada lista (sempre atuais) e as regras. Consulte em vez de fixar listas no código da aplicação.</p>
        <Codigo texto={curlGet} rotulo="curl do catálogo" />
        <Testar base={base} metodo="GET" caminho="/campos" />
      </Operacao>

      <section className="rounded-[10px] border border-line bg-surface p-4" aria-label="Campos da oportunidade">
        <Titulo>Campos da oportunidade ({campos.length} + solicitante)</Titulo>
        <p className="mb-2 text-xs text-muted">São os mesmos do formulário <em>Nova oportunidade</em>. Obrigatórios em destaque. Campos de lista só aceitam os valores indicados.</p>
        <div className="max-h-[32rem] overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12.5px]" aria-label="Tabela de campos">
            <thead className="sticky top-0 bg-surface-2 text-xs text-ink-soft">
              <tr><th className="px-2 py-1.5">Campo</th><th className="px-2 py-1.5">Obrigatório</th><th className="px-2 py-1.5">Formato</th><th className="px-2 py-1.5">Valores válidos / observação</th></tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-soft">
              {campos.map((c) => (
                <tr key={c.nome}>
                  <td className="px-2 py-1.5"><code className="text-ink">{c.nome}</code><span className="block text-[11px] text-muted">{c.rotulo}</span></td>
                  <td className="px-2 py-1.5">
                    {c.obrigatorio ? <strong className="text-ink">sim</strong> : c.obrigatorio_se_ausente ? `sim, se ${c.obrigatorio_se_ausente} não for enviado` : c.obrigatorio_se_status ? `sim, se status = ${c.obrigatorio_se_status.join(' ou ')}` : 'não'}
                  </td>
                  <td className="px-2 py-1.5">{c.formato}</td>
                  <td className="px-2 py-1.5">
                    {c.valores ? (c.valores.length ? c.valores.join(' · ') : '(lista vazia)') : (c.dica ?? '')}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-2 py-1.5"><code className="text-ink">solicitante</code><span className="block text-[11px] text-muted">Extra da API</span></td>
                <td className="px-2 py-1.5">não</td>
                <td className="px-2 py-1.5">texto até 120 caracteres</td>
                <td className="px-2 py-1.5">Quem pediu a criação na aplicação externa; aparece no e-mail e no Planner.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <Titulo>Regras além do formato</Titulo>
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-soft">
          {REGRAS.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
