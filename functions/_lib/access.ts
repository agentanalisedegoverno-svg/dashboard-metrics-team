/**
 * Valida o JWT do Cloudflare Access (Cf-Access-Jwt-Assertion) com WebCrypto.
 * A API recusa qualquer requisição sem token válido: proteger só o front
 * não protegeria os dados.
 */
type Jwk = JsonWebKey & { kid: string }

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)))

let keyCache: { at: number; keys: Jwk[] } | null = null

async function signingKeys(teamDomain: string): Promise<Jwk[]> {
  if (keyCache && Date.now() - keyCache.at < 3_600_000) return keyCache.keys
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`Não foi possível obter as chaves do Access (HTTP ${res.status})`)
  const { keys } = (await res.json()) as { keys: Jwk[] }
  keyCache = { at: Date.now(), keys }
  return keys
}

export type AccessIdentity = { email: string | null }

/** Valida o JWT e devolve quem é o usuário (e-mail do Access); `null` se o token não for válido. */
export async function verifyAccessIdentity(
  token: string | null,
  opts: { teamDomain: string; audience: string },
  now = Date.now(),
): Promise<AccessIdentity | null> {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = json(parts[0]) as { alg: string; kid: string }
    const claims = json(parts[1]) as { aud?: string[] | string; exp?: number; iss?: string; email?: string }
    if (header.alg !== 'RS256') return null
    if (!claims.exp || claims.exp * 1000 < now) return null
    if (claims.iss !== `https://${opts.teamDomain}`) return null
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!aud.includes(opts.audience)) return null

    const jwk = (await signingKeys(opts.teamDomain)).find((k) => k.kid === header.kid)
    if (!jwk) return null
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
    if (!valid) return null
    return { email: typeof claims.email === 'string' && claims.email ? claims.email.toLowerCase() : null }
  } catch {
    return null
  }
}

export async function verifyAccessJwt(
  token: string | null,
  opts: { teamDomain: string; audience: string },
  now = Date.now(),
): Promise<boolean> {
  return (await verifyAccessIdentity(token, opts, now)) !== null
}
