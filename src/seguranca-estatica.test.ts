/**
 * Segurança estática: regras sobre os arquivos do repositório (cabeçalhos, CSP, workflows, segredos, padrões perigosos,
 * cadeia de suprimentos). Roda no `npm test` e no CI; falha antes de um deslize virar publicação.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ler = (p: string) => readFileSync(p, 'utf8')
const arquivosVersionados = (): string[] =>
  execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => existsSync(f))
const workflows = () =>
  readdirSync('.github/workflows').filter((f) => f.endsWith('.yml')).map((f) => ({ nome: f, texto: ler(join('.github/workflows', f)) }))

describe('cabeçalhos de segurança (public/_headers)', () => {
  const h = ler('public/_headers')
  const csp = /Content-Security-Policy:\s*(.+)/.exec(h)?.[1] ?? ''
  const diretiva = (n: string) => new RegExp(`(?:^|;)\\s*${n}\\s+([^;]+)`).exec(csp)?.[1].trim()

  it('CSP restrita ao próprio site, sem script inline nem eval', () => {
    expect(diretiva('default-src')).toBe("'self'")
    expect(diretiva('script-src')).toBe("'self'")
    expect(csp).not.toMatch(/unsafe-eval|unsafe-hashes/)
    expect(diretiva('script-src')).not.toMatch(/unsafe-inline|\*|https?:/)
    expect(diretiva('object-src')).toBe("'none'")
    expect(diretiva('base-uri')).toBe("'self'")
    expect(diretiva('frame-ancestors')).toBe("'none'")
    expect(diretiva('form-action')).toBe("'self'")
  })
  it('conexões, imagens e fontes só do próprio site (mais o login da Microsoft)', () => {
    expect(diretiva('connect-src')).toMatch(/^'self'( https:\/\/login\.microsoftonline\.com)?$/)
    expect(diretiva('img-src')).toMatch(/^'self' data:$/)
    expect(diretiva('font-src')).toBe("'self'")
  })
  it('demais cabeçalhos: sem iframe, sem sniffing, HTTPS forçado, sem indexação, referrer e permissões restritos', () => {
    expect(h).toMatch(/X-Frame-Options:\s*DENY/)
    expect(h).toMatch(/X-Content-Type-Options:\s*nosniff/)
    expect(h).toMatch(/Strict-Transport-Security:\s*max-age=(\d{8,})/)
    expect(h).toMatch(/X-Robots-Tag:\s*noindex/)
    expect(h).toMatch(/Referrer-Policy:\s*(strict-origin|no-referrer|same-origin)/)
    expect(h).toMatch(/Permissions-Policy:.*camera=\(\).*microphone=\(\).*geolocation=\(\)/)
  })
  it('a página não carrega script inline (a CSP o bloquearia)', () => {
    const html = ler('index.html')
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) expect(m[1], 'script sem src').toMatch(/\bsrc=/)
  })
  it('robots.txt bloqueia indexação', () => {
    expect(ler('public/robots.txt')).toMatch(/Disallow:\s*\//)
  })
})

describe('workflows do GitHub Actions', () => {
  it('toda action de terceiros está presa a um commit (40 hex), não a uma tag que pode ser movida', () => {
    for (const w of workflows()) {
      for (const m of w.texto.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
        const ref = m[1]
        if (ref.startsWith('./')) continue
        expect(ref, `${w.nome}: ${ref}`).toMatch(/@[0-9a-f]{40}$/)
      }
    }
  })
  it('todo workflow declara permissões mínimas explicitamente', () => {
    for (const w of workflows()) expect(w.texto, w.nome).toMatch(/^permissions:/m)
  })
  it('nenhum workflow usa pull_request_target (executaria código de forks com acesso a segredos)', () => {
    for (const w of workflows()) expect(w.texto, w.nome).not.toMatch(/pull_request_target/)
  })
  it('nenhum texto livre do evento (título, corpo, branch, mensagem) é interpolado em comandos de shell', () => {
    const perigosos = /\$\{\{\s*github\.(event\.(issue|pull_request|comment|review|head_commit|pages|discussion|release|workflow_run)[\w.]*\.(title|body|name|label|message|email|head_ref|ref|default_branch|page_name)|head_ref)\s*\}\}/
    for (const w of workflows()) expect(w.texto, w.nome).not.toMatch(perigosos)
  })
  it('segredos nunca são impressos nem o shell roda em modo de depuração', () => {
    for (const w of workflows()) {
      expect(w.texto, w.nome).not.toMatch(/echo\s+["']?\$\{\{\s*secrets\./)
      expect(w.texto, w.nome).not.toMatch(/^\s*(run:\s*)?set\s+-x/m)
    }
  })
  it('os segredos do envio de e-mail só entram como variáveis de ambiente (nunca na linha de comando)', () => {
    const t = ler('.github/workflows/enviar-emails.yml')
    for (const m of t.matchAll(/^\s*run:.*$/gm)) expect(m[0]).not.toMatch(/secrets\./)
  })
  it('o workflow de e-mail não imprime endereços nem dados de oportunidades (o log do repositório é público)', () => {
    for (const arq of ['scripts/enviar-emails.mjs', 'functions/_lib/emailFila.ts']) {
      for (const l of ler(arq).split('\n').filter((x) => /console\.(log|error|warn|info)/.test(x))) {
        expect(l, `${arq}: ${l.trim()}`).not.toMatch(/\b(to|cc|email|emails|assunto|texto|html|orgao|destino_teste|dest|para)\b\s*[,)}.\]]/)
        expect(l, `${arq}: ${l.trim()}`).not.toMatch(/\$\{[^}]*(\.to|\.cc|email|assunto|orgao|dest)/)
      }
    }
  })
})

describe('segredos e dados reais no repositório', () => {
  const PADROES: [string, RegExp][] = [
    ['string de conexão com senha', /postgres(?:ql)?:\/\/[^\s:@/'"`]+:(?!\.{3}|<|SENHA|senha|xxx|\$\{|\$\(|%s|password|placeholder|\*+)[^\s@/'"`]{6,}@/i],
    ['chave privada', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
    ['chave de acesso AWS', /\bAKIA[0-9A-Z]{16}\b/],
    ['token do GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
    ['token do Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
    ['chave de API do Google', /\bAIza[0-9A-Za-z_-]{35}\b/],
    ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
    ['token de API da Cloudflare', /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/],
  ]
  const IGNORAR = new Set(['package-lock.json', 'src/seguranca-estatica.test.ts'])
  // SVG dos diagramas são gerados a partir do Mermaid de docs/DIAGRAMAS.md (que é varrido): ficam de fora para a varredura ser rápida.
  const texto = (f: string) => !/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|xlsx?|pdf|zip)$/i.test(f) && !IGNORAR.has(f) && !/^docs\/diagramas\/.*\.svg$/.test(f)
  let conteudos: [string, string][] | null = null
  const todos = () => (conteudos ??= arquivosVersionados().filter(texto).map((f): [string, string] => [f, ler(f)])) // lê cada arquivo uma vez só

  it.each(PADROES)('nenhum arquivo versionado contém %s', (_nome, re) => {
    const achados = todos().filter(([, t]) => re.test(t)).map(([f]) => f)
    expect(achados).toEqual([])
  }, 30_000)
  it('planilhas e arquivos de segredos locais não são versionados', () => {
    const proibidos = arquivosVersionados().filter((f) => /\.(xlsx|xlsm|xls|csv|pem|key|p12|pfx)$/i.test(f) || /(^|\/)\.(env|dev\.vars)(\.|$)/.test(f) && !/\.example$|\.e2e$|\.demo$/.test(f))
    expect(proibidos).toEqual([])
  })
  it('.gitignore protege segredos locais do Wrangler e dados reais', () => {
    const g = ler('.gitignore')
    for (const item of ['.env', '.dev.vars', '*.xlsx', '*.xlsm']) expect(g, item).toContain(item)
  })
  it('wrangler.toml não carrega segredos (só identificadores públicos do Access)', () => {
    const vars = ler('wrangler.toml').split('[vars]')[1] ?? ''
    for (const l of vars.split('\n').filter((x) => /^\s*\w+\s*=/.test(x))) {
      expect(l, l).not.toMatch(/PASSWORD|SECRET|TOKEN|DATABASE_URL|API_KEY|PRIVATE/i)
    }
  })
  it('o front não usa as variáveis do banco nem segredos (VITE_* vai para o navegador)', () => {
    for (const f of arquivosVersionados().filter((x) => x.startsWith('src/') && /\.(ts|tsx)$/.test(x) && !x.endsWith('.test.ts'))) {
      expect(ler(f), f).not.toMatch(/DATABASE_URL|SMTP_PASS|SMTP_USER|BACKUP_PASSPHRASE|RCLONE/)
    }
  })
})

describe('padrões perigosos no código do front', () => {
  const fontes = () => arquivosVersionados().filter((f) => f.startsWith('src/') && /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'))
  it.each([
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['eval()', /\beval\s*\(/],
    ['new Function()', /new\s+Function\s*\(/],
    ['document.write', /document\.write\s*\(/],
    ['atribuição a innerHTML/outerHTML', /\.(inner|outer)HTML\s*=/],
    ['setTimeout/setInterval com texto', /set(?:Timeout|Interval)\s*\(\s*["'`]/],
  ])('nenhum uso de %s', (_n, re) => {
    expect(fontes().filter((f) => re.test(ler(f)))).toEqual([])
  })
  it('links que abrem em nova aba usam rel="noopener noreferrer"', () => {
    for (const f of fontes()) {
      for (const m of ler(f).matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/g)) expect(m[0], f).toMatch(/rel=["'][^"']*noopener/)
    }
  })
  it('armazenamento no navegador só guarda a preferência de tema (nenhum token ou dado de negócio)', () => {
    const usos: string[] = []
    for (const f of fontes()) {
      for (const m of ler(f).matchAll(/localStorage\.setItem\(\s*([^,)]+)/g)) usos.push(`${f}: ${m[1]}`)
    }
    expect(usos).toEqual(['src/lib/tema.ts: CHAVE'])
    expect(ler('src/lib/tema.ts')).toMatch(/const CHAVE = 'radar-tema'/)
  })
  it('a API não é chamada com credenciais de outra origem nem com a identidade vinda da tela', () => {
    const t = ler('src/features/oportunidades/api.ts')
    expect(t).toContain("credentials: 'same-origin'")
    expect(t).not.toMatch(/credentials:\s*['"]include['"]/)
    expect(t).toContain("'x-radar-csrf': '1'")
  })
})

describe('cadeia de suprimentos', () => {
  it('nenhum script de instalação (preinstall/install/postinstall) roda código de terceiros no npm ci do projeto', () => {
    const scripts = JSON.parse(ler('package.json')).scripts as Record<string, string>
    for (const k of ['preinstall', 'install', 'postinstall', 'prepare']) expect(scripts[k], k).toBeUndefined()
  })
  it('todas as dependências do lockfile vêm do registro oficial do npm, por HTTPS e com hash de integridade', () => {
    const lock = JSON.parse(ler('package-lock.json')) as { packages: Record<string, { resolved?: string; integrity?: string; link?: boolean }> }
    const ruins: string[] = []
    for (const [nome, p] of Object.entries(lock.packages)) {
      if (!nome || p.link || !p.resolved) continue
      if (!p.resolved.startsWith('https://registry.npmjs.org/')) ruins.push(`${nome}: ${p.resolved}`)
      if (!p.integrity) ruins.push(`${nome}: sem integridade`)
    }
    expect(ruins).toEqual([])
  })
  it('nenhuma dependência aponta para git, URL ou caminho local', () => {
    const pkg = JSON.parse(ler('package.json')) as Record<string, Record<string, string> | undefined>
    const ruins: string[] = []
    for (const grupo of ['dependencies', 'devDependencies']) {
      for (const [nome, versao] of Object.entries(pkg[grupo] ?? {})) if (/^(git|github:|http|file:|link:|\.\.?\/)/.test(versao)) ruins.push(`${nome}@${versao}`)
    }
    expect(ruins).toEqual([])
  })
  it('só há arquivos de texto/código nos diretórios de código (nada executável binário versionado)', () => {
    const bins = arquivosVersionados().filter((f) => /\.(exe|dll|so|dylib|bat|ps1|msi|jar|apk)$/i.test(f) && extname(f) !== '')
    expect(bins).toEqual([])
  })
})
