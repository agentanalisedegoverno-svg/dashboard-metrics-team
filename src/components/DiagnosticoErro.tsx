import { useState } from 'react'
import { toast } from 'sonner'
import { buscarDiagnostico } from '@/data/useRows'
import { ErroApi, explicarOrigem, falhasRecentes, montarRelatorio, type FalhaApi } from '@/data/erroApi'

/** A falha da API por trás do erro mostrado (o erro pode vir embrulhado em `cause`). */
function falhaDoErro(error: unknown): FalhaApi | undefined {
  for (let e: unknown = error, n = 0; e && n < 4; e = (e as { cause?: unknown }).cause, n++) if (e instanceof ErroApi) return e.falha
  return falhasRecentes().at(-1)
}

/**
 * Detalhes técnicos de uma falha de carregamento, para o usuário mandar ao suporte: de onde veio a resposta (Radar ou fora),
 * código da requisição, cf-ray, tempo e um botão que copia um relatório completo (inclui o diagnóstico feito no servidor).
 */
export function DiagnosticoErro({ error }: { error: unknown }) {
  const falha = falhaDoErro(error)
  const [ocupado, setOcupado] = useState(false)
  const [texto, setTexto] = useState<string | null>(null)

  async function gerar() {
    setOcupado(true)
    let servidor: unknown
    try {
      servidor = await buscarDiagnostico(new AbortController().signal)
    } catch (e) {
      const f = e instanceof ErroApi ? e.falha : null
      servidor = { indisponivel: true, motivo: f ? `${f.caminho} -> ${f.status} (origem: ${f.origem}, req: ${f.req ?? '-'})` : e instanceof Error ? e.name : 'erro' }
    }
    const relatorio = montarRelatorio({ falhas: falhasRecentes(), servidor, navegador: navigator.userAgent, online: navigator.onLine, pagina: window.location.origin + window.location.pathname })
    try {
      await navigator.clipboard.writeText(relatorio)
      toast.success('Diagnóstico copiado. Cole no chamado ou envie ao suporte.')
      setTexto(null)
    } catch {
      setTexto(relatorio) // sem permissão de área de transferência: mostra o texto para copiar à mão
    }
    setOcupado(false)
  }

  return (
    <details className="mt-3 text-xs text-muted">
      <summary className="cursor-pointer font-semibold text-ink-soft">Detalhes técnicos para o suporte</summary>
      <div className="mt-2 space-y-1">
        {falha ? (
          <>
            <p>{explicarOrigem(falha)}</p>
            <p>
              Rota: <b>{falha.caminho}</b> · Status: <b>{falha.status ?? 'sem resposta'}</b> · Origem: <b>{falha.origem}</b> · Tempo: {falha.ms} ms
            </p>
            <p>
              Código da requisição: <b>{falha.req ?? '—'}</b> · cf-ray: <b>{falha.ray ?? '—'}</b>
            </p>
            {falha.corpo && <p className="break-words">Resposta: {falha.corpo}</p>}
          </>
        ) : (
          <p>Nenhuma falha de rede registrada: o erro veio do processamento dos dados.</p>
        )}
        <button type="button" disabled={ocupado} onClick={gerar} className="mt-1 cursor-pointer rounded-md border border-line px-2.5 py-1 font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-60">
          {ocupado ? 'Gerando…' : 'Copiar diagnóstico completo'}
        </button>
        {texto && <textarea readOnly value={texto} rows={8} aria-label="Diagnóstico para copiar" onFocus={(e) => e.currentTarget.select()} className="mt-2 w-full rounded-md border border-line bg-surface p-2 font-mono text-[11px]" />}
      </div>
    </details>
  )
}
