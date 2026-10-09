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

export async function verifyAccessJwt(
  token: string | null,
  opts: { teamDomain: string; audience: string },
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const header = json(parts[0]) as { alg: string; kid: string }
    const claims = json(parts[1]) as { aud?: string[] | string; exp?: number; iss?: string }
    if (header.alg !== 'RS256') return false
    if (!claims.exp || claims.exp * 1000 < now) return false
    if (claims.iss !== `https://${opts.teamDomain}`) return false
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!aud.includes(opts.audience)) return false

    const jwk = (await signingKeys(opts.teamDomain)).find((k) => k.kid === header.kid)
    if (!jwk) return false
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
  } catch {
    return false
  }
}
