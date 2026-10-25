import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Segurança no navegador: dados hostis vindos da API (nomes de órgão, observações, histórico, Receita) nunca viram
 * HTML nem executam script, e entradas controladas pelo usuário (endereço, armazenamento local) não quebram a tela.
 */
const XSS = [
  '<img src=x onerror="window.__xss=\'img\'">',
  '<script>window.__xss="script"</script>',
  '"><svg onload="window.__xss=\'svg\'">',
  "javascript:window.__xss='js'",
  '<a href="javascript:window.__xss=1">clique</a>',
]

const opcoes = {
  listas: {
    status: ['Go', 'Win'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    torre: ['ITS'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    uf: ['DF'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
  },
  preVendas: ['Marcia'],
  linhasTorre: {},
}

const registro = (i: number, texto: string) => ({
  id: i, codigo: `2026-000${i}`, versao: 1, status: 'Go', orgao: texto, descritivo: texto, processo: texto, torre: 'ITS', uf: 'DF', analista: 'Marcia',
  data_pregao_dt: '2026-03-10', orcamento: 1000, orcamento_sigiloso: false, valor_ctc: null, pendencias: [], observacoes: texto, empresas_vencedoras: texto,
  empresa_vencedora_razao: texto, empresa_vencedora_cnpj: '00000000000191', empresa_vencedora_tipo: 'Matriz', atualizado_por: texto, atualizado_em: '2026-10-14T12:00:00Z',
})

async function api(page: Page, admin = false) {
  await page.route('**/api/me', (r) => r.fulfill({ json: { email: 'a@ctctech.com.br', nome: XSS[0], admin, preVendas: false, somenteLeitura: false, perfil: admin ? 'administrador' : 'editor' } }))
  await page.route('**/api/opcoes', (r) =>
    r.fulfill({
      json: admin
        ? { ...opcoes, usuarios: [{ nome: XSS[1], email: 'x@ctctech.com.br', admin: false, pre_vendas: true, ativo: true, somente_leitura: false }] }
        : opcoes,
    }),
  )
  await page.route('**/api/oportunidades**', (r) => {
    const url = new URL(r.request().url())
    if (url.pathname.endsWith('/historico')) {
      return r.fulfill({ json: { itens: [{ id: 1, versao: 2, acao: XSS[2], por: XSS[0], em: '2026-10-14T12:00:00Z', alteracoes: { orgao: [XSS[1], XSS[4]] } }] } })
    }
    return r.fulfill({ json: { rows: XSS.map((x, i) => registro(i + 1, x)) } })
  })
  await page.route('**/api/email-config', (r) =>
    r.fulfill({
      json: {
        ativo: false, avisar_pre_vendas: false, status: [], atualizado_por: XSS[0], atualizado_em: '2026-10-24T12:00:00Z',
        destinatarios: [{ email: 'x@ctctech.com.br', tipo: 'para', ativo: true }],
        recentes: [{ id: 1, tipo: 'nova', situacao: 'erro', tentativas: 5, ultimo_erro: XSS[0], criado_em: '2026-10-23T12:00:00Z', enviado_em: null, codigo: XSS[1], orgao: XSS[2] }],
      },
    }),
  )
}

const semXss = async (page: Page) => expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined()

test('texto hostil vindo da API é exibido como texto: grade, gaveta, histórico e administração', async ({ page }) => {
  const dialogos: string[] = []
  page.on('dialog', (d) => {
    dialogos.push(d.message())
    void d.dismiss()
  })
  await api(page, true)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Oportunidades' }).click()
  await expect(page.getByLabel('Buscar oportunidades')).toBeVisible()
  await expect(page.getByText(/5 de 5 oportunidades/)).toBeVisible()
  await semXss(page)

  // o texto aparece literalmente (escapado), não interpretado
  const visivel = await page.locator('body').innerText()
  expect(visivel).toContain('<img src=x')
  expect(await page.locator('img[src="x"]').count()).toBe(0)
  expect(await page.locator('table svg[onload], table script').count()).toBe(0)

  // abre a oportunidade e o histórico
  await page.getByText('2026-0001').first().click() // linha da tabela (desktop) ou cartão (celular)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('tab', { name: 'Histórico' }).click()
  await expect(page.getByText('Histórico', { exact: false }).first()).toBeVisible()
  await expect(page.getByText(/<script>window\.__xss/).first()).toBeVisible()
  await semXss(page)

  // administração: usuários e e-mails (envios recentes com erro hostil)
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Administração' }).click()
  await semXss(page)
  await page.getByRole('button', { name: 'E-mails' }).click()
  await expect(page.getByRole('heading', { name: 'E-mails de nova oportunidade' })).toBeVisible()
  await semXss(page)
  expect(await page.locator('img[src="x"], a[href^="javascript:"]').count()).toBe(0)
  expect(dialogos, 'nenhum alert/confirm/prompt foi disparado').toEqual([])
})

test('endereço (hash) e armazenamento local adulterados não quebram nem executam nada', async ({ page }) => {
  await api(page, true)
  await page.addInitScript(() => localStorage.setItem('radar-tema', '<img src=x onerror="window.__xss=1">'))
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))
  for (const hash of ['#admin/<img src=x onerror=window.__xss=1>', '#admin/../../etc/passwd', '#%3Cscript%3Ewindow.__xss=1%3C/script%3E', '#admin/' + 'a'.repeat(5000)]) {
    await page.goto('/' + hash)
    await expect(page.locator('body')).toBeVisible()
    await semXss(page)
  }
  expect(erros).toEqual([])
})

test('a aba de e-mails e a administração, com dados hostis, seguem acessíveis (WCAG A/AA)', async ({ page }) => {
  await api(page, true)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Administração' }).click()
  await page.getByRole('button', { name: 'E-mails' }).click()
  await expect(page.getByRole('heading', { name: 'E-mails de nova oportunidade' })).toBeVisible()
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations).toEqual([])
})

test('nada sensível vai para o armazenamento do navegador nem para cookies (só a preferência de tema)', async ({ page }) => {
  await api(page, true)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Oportunidades' }).click()
  await expect(page.getByLabel('Buscar oportunidades')).toBeVisible()
  const guardado = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    sessao: Object.keys(sessionStorage).filter((k) => !k.startsWith('msal.')),
    cookies: document.cookie,
  }))
  for (const k of [...guardado.local, ...guardado.sessao]) expect(k, 'chave no armazenamento do navegador').toMatch(/^radar-tema$/)
  expect(guardado.cookies).toBe('')
})

test('a tela não faz chamadas a servidores externos (tudo passa pelo próprio site)', async ({ page }) => {
  const externas: string[] = []
  const origem = new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:4173' : page.url()).origin
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) externas.push(r.url())
  })
  await api(page, true)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Oportunidades' }).click()
  await expect(page.getByLabel('Buscar oportunidades')).toBeVisible()
  await page.getByRole('tab', { name: 'Administração' }).click()
  expect(externas, `chamadas fora de ${origem}`).toEqual([])
})
