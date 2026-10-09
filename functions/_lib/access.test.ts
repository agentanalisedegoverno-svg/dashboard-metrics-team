import { describe, expect, it } from 'vitest'
import { verifyAccessJwt } from './access'

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const opts = { teamDomain: 'time.cloudflareaccess.com', audience: 'aud123' }
const token = (claims: object, header: object = { alg: 'RS256', kid: 'k' }) => `${enc(header)}.${enc(claims)}.assinatura`
const ok = { exp: 2_000_000_000, iss: 'https://time.cloudflareaccess.com', aud: ['aud123'] }

// Todas as recusas abaixo acontecem ANTES de qualquer chamada de rede.
describe('verifyAccessJwt — recusas', () => {
  const now = 1_900_000_000_000
  it.each([
    ['sem token', null],
    ['token malformado', 'abc'],
    ['expirado', token({ ...ok, exp: 1 })],
    ['issuer errado', token({ ...ok, iss: 'https://outro.cloudflareaccess.com' })],
    ['audience errada', token({ ...ok, aud: ['outra'] })],
    ['algoritmo none', token(ok, { alg: 'none', kid: 'k' })],
    ['algoritmo HS256', token(ok, { alg: 'HS256', kid: 'k' })],
  ])('%s', async (_n, t) => expect(await verifyAccessJwt(t as string | null, opts, now)).toBe(false))
})
