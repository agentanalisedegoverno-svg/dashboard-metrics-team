/** Leitura somente-leitura do workbook no SharePoint via Microsoft Graph (app-only). */
export type GraphEnv = {
  GRAPH_TENANT_ID?: string
  GRAPH_CLIENT_ID?: string
  GRAPH_CLIENT_SECRET?: string
  GRAPH_DRIVE_ID?: string
  GRAPH_ITEM_ID?: string
  GRAPH_SHEET_NAME?: string
}

export const missingGraphConfig = (env: GraphEnv): string[] =>
  (['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_DRIVE_ID', 'GRAPH_ITEM_ID'] as const).filter(
    (k) => !env[k],
  )

async function accessToken(env: GraphEnv): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GRAPH_CLIENT_ID!,
      client_secret: env.GRAPH_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) throw new Error(`Falha de autenticação no Graph (HTTP ${res.status})`)
  return ((await res.json()) as { access_token: string }).access_token
}

export async function fetchSheetValues(env: GraphEnv): Promise<(string | number | boolean | null)[][]> {
  const token = await accessToken(env)
  const sheet = encodeURIComponent(env.GRAPH_SHEET_NAME || 'Base Governo')
  const url =
    `https://graph.microsoft.com/v1.0/drives/${env.GRAPH_DRIVE_ID}/items/${env.GRAPH_ITEM_ID}` +
    `/workbook/worksheets('${sheet}')/usedRange(valuesOnly=true)?$select=values`
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Falha ao ler a planilha no Graph (HTTP ${res.status})`)
  return ((await res.json()) as { values: (string | number | boolean | null)[][] }).values
}
