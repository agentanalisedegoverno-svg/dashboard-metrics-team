/**
 * Leitura somente-leitura do workbook via Microsoft Graph com o token DELEGADO do usuário
 * (repassado do navegador). Sem segredo no servidor: quem decide o acesso é o SharePoint,
 * conforme as permissões da própria pessoa.
 */
export type GraphEnv = {
  GRAPH_DRIVE_ID?: string
  GRAPH_ITEM_ID?: string
  GRAPH_SHEET_NAME?: string
}

export type SheetData = { values: (string | number | boolean | null)[][]; lastModified: string | null }

export class GraphError extends Error {
  constructor(readonly status: number) {
    super(`Graph respondeu HTTP ${status}`)
  }
}

export const missingGraphConfig = (env: GraphEnv): string[] =>
  (['GRAPH_DRIVE_ID', 'GRAPH_ITEM_ID'] as const).filter((k) => !env[k])

const GRAPH = 'https://graph.microsoft.com/v1.0'

async function graphGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new GraphError(res.status)
  return (await res.json()) as T
}

export async function fetchSheet(env: GraphEnv, token: string): Promise<SheetData> {
  const item = `${GRAPH}/drives/${encodeURIComponent(env.GRAPH_DRIVE_ID!)}/items/${encodeURIComponent(env.GRAPH_ITEM_ID!)}`
  const sheet = encodeURIComponent((env.GRAPH_SHEET_NAME || 'Base Governo').replace(/'/g, "''"))
  const [meta, range] = await Promise.all([
    graphGet<{ lastModifiedDateTime?: string }>(`${item}?$select=lastModifiedDateTime`, token),
    graphGet<{ values: SheetData['values'] }>(`${item}/workbook/worksheets('${sheet}')/usedRange(valuesOnly=true)?$select=values`, token),
  ])
  return { values: range.values, lastModified: meta.lastModifiedDateTime ?? null }
}
