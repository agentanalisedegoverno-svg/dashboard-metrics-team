import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser'

/**
 * Login Microsoft (Entra ID) com fluxo de código + PKCE, sem segredo no navegador.
 * O token delegado é enviado à nossa API, que o repassa ao Graph: o acesso à planilha
 * segue as permissões do próprio usuário no SharePoint.
 * Sem `VITE_MS_CLIENT_ID` (dev/demo) a autenticação fica desligada.
 */
const CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID as string | undefined
const TENANT_ID = import.meta.env.VITE_MS_TENANT_ID as string | undefined
const SCOPES = ((import.meta.env.VITE_MS_SCOPES as string | undefined) || 'Files.Read.All').split(/[\s,]+/).filter(Boolean)

export const isAuthEnabled = Boolean(CLIENT_ID && TENANT_ID)

let app: PublicClientApplication | null = null

async function client(): Promise<PublicClientApplication> {
  if (!app) {
    // Carregado sob demanda: fora do bundle inicial e inexistente quando o login está desligado.
    const { PublicClientApplication } = await import('@azure/msal-browser')
    app = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID!,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    })
    await app.initialize()
  }
  return app
}

/** Conclui um redirect de login pendente e devolve a conta ativa (ou null). */
export async function restoreSession(): Promise<AccountInfo | null> {
  if (!isAuthEnabled) return null
  const msal = await client()
  const result = await msal.handleRedirectPromise()
  const account = result?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null
  if (account) msal.setActiveAccount(account)
  return account
}

export async function signIn(): Promise<void> {
  const msal = await client()
  await msal.loginRedirect({ scopes: SCOPES })
}

export async function signOut(): Promise<void> {
  const msal = await client()
  await msal.logoutRedirect({ account: msal.getActiveAccount() ?? undefined })
}

/** Token de acesso para a nossa API; renova em silêncio e, se preciso, volta ao login. */
export async function getAccessToken(): Promise<string | null> {
  if (!isAuthEnabled) return null
  const msal = await client()
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0]
  if (!account) throw new Error('Sessão expirada. Entre novamente.')
  try {
    return (await msal.acquireTokenSilent({ scopes: SCOPES, account })).accessToken
  } catch (error) {
    const { InteractionRequiredAuthError } = await import('@azure/msal-browser')
    if (error instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ scopes: SCOPES, account })
      return null
    }
    throw error
  }
}
