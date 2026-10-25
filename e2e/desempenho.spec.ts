import { expect, test, type Page } from '@playwright/test'

/**
 * Desempenho do front no navegador (bundle de produção): a aba Oportunidades com 5.000 linhas (hoje são ~650).
 * Os orçamentos são folgados para o CI; o que se quer pegar é regressão grande (virtualização quebrada, filtro lento,
 * tarefa longa travando a tela). BUDGET_FATOR=2 dobra todos.
 */
const FATOR = Number(process.env.BUDGET_FATOR || 1)
const N = 5000

const opcoes = {
  listas: {
    status: ['Prospect', 'Go', 'Win', 'Lost', 'No Go'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    torre: ['ITS', 'DIGITAL', 'HEALTH'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    uf: ['DF', 'GO', 'SP'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
  },
  preVendas: ['Marcia'],
  linhasTorre: {},
}

const linhas = Array.from({ length: N }, (_, i) => ({
  id: i + 1, codigo: `2026-${String(i + 1).padStart(4, '0')}`, versao: 1, status: ['Go', 'Win', 'Prospect', 'Lost'][i % 4], orgao: `Órgão ${i + 1}`,
  descritivo: 'Link dedicado de internet '.repeat(8), processo: `${i + 1}/2026`, torre: ['ITS', 'DIGITAL', 'HEALTH'][i % 3], linha_servico: 'Service Desk', uf: 'DF',
  analista: 'Marcia', data_pregao_dt: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, orcamento: 1_000_000 + i,
  orcamento_sigiloso: false, valor_ctc: null, impostos: 0.0865, pendencias: [], atualizado_por: 'a@ctctech.com.br', atualizado_em: '2026-10-14T12:00:00Z',
}))

async function api(page: Page) {
  await page.route('**/api/me', (r) => r.fulfill({ json: { email: 'a@ctctech.com.br', nome: 'A', admin: false, preVendas: false, somenteLeitura: false, perfil: 'editor' } }))
  await page.route('**/api/opcoes', (r) => r.fulfill({ json: opcoes }))
  await page.route('**/api/oportunidades**', (r) => r.fulfill({ json: { rows: linhas } }))
}

const orc = (ms: number) => ms * FATOR

// Medições de tempo oscilam quando vários navegadores rodam juntos (CI, máquina ocupada): uma repetição automática.
test.describe.configure({ retries: 2 })
const registra = (descricao: string) => {
  test.info().annotations.push({ type: 'desempenho', description: descricao })
  process.stdout.write(`desempenho [${test.info().project.name}]: ${descricao}
`)
}

test('abre a aba com 5.000 linhas dentro do orçamento e só desenha as linhas visíveis (virtualização)', async ({ page }) => {
  await api(page)
  await page.goto('/')
  const t0 = Date.now()
  await page.getByRole('tab', { name: 'Oportunidades' }).click()
  await expect(page.getByText(new RegExp(`${N} de ${N} oportunidades`))).toBeVisible({ timeout: 15_000 })
  const ms = Date.now() - t0
  registra(`5.000 linhas visíveis em ${ms} ms`)
  expect(ms, `abrir a aba com ${N} linhas`).toBeLessThan(orc(10_000))

  const desenhadas = await page.locator('tbody tr[aria-rowindex], [role="listitem"]').count()
  expect(desenhadas, 'linhas no DOM (deve ser só a janela visível)').toBeLessThan(150)
  expect(desenhadas).toBeGreaterThan(0)
})

test('rolar até o fim, ordenar e buscar continuam fluidos, sem tarefas longas que travem a tela', async ({ page }) => {
  await api(page)
  await page.addInitScript(() => {
    const w = window as unknown as { __longtasks: number[] }
    w.__longtasks = []
    new PerformanceObserver((lista) => lista.getEntries().forEach((e) => w.__longtasks.push(e.duration))).observe({ entryTypes: ['longtask'] })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Oportunidades' }).click()
  await expect(page.getByText(new RegExp(`${N} de ${N} oportunidades`))).toBeVisible({ timeout: 15_000 })

  // rolar até o final da lista
  const rolagem = page.locator('div.overflow-auto').first()
  let t0 = Date.now()
  await rolagem.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.waitForFunction(() => document.querySelectorAll('tbody tr[aria-rowindex], [role="listitem"]').length > 0)
  const msRolar = Date.now() - t0
  expect(msRolar, 'rolar até o fim').toBeLessThan(orc(3000))

  // buscar um órgão específico entre 5.000
  t0 = Date.now()
  await page.getByLabel('Buscar oportunidades').fill('Órgão 4999')
  await expect(page.getByText(new RegExp(`1 de ${N} oportunidades`))).toBeVisible({ timeout: 5000 })
  const msBusca = Date.now() - t0
  expect(msBusca, 'buscar entre 5.000 linhas').toBeLessThan(orc(4000))

  // limpar e filtrar por status
  await page.getByLabel('Buscar oportunidades').fill('')
  t0 = Date.now()
  await page.getByLabel('Filtrar por status').selectOption('Win')
  await expect(page.getByText(new RegExp(`${N / 4} de ${N} oportunidades`))).toBeVisible({ timeout: 5000 })
  const msFiltro = Date.now() - t0
  expect(msFiltro, 'filtrar por status').toBeLessThan(orc(4000))

  const longas = await page.evaluate(() => (window as unknown as { __longtasks: number[] }).__longtasks)
  const maior = Math.max(0, ...longas)
  registra(`rolar ${msRolar} ms · buscar ${msBusca} ms · filtrar ${msFiltro} ms · maior tarefa longa ${Math.round(maior)} ms`)
  expect(maior, 'maior tarefa longa do thread principal').toBeLessThan(orc(2500))
})

test('consumo de memória do navegador com 5.000 linhas fica sob controle', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'performance.memory só existe no Chromium')
  await api(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Oportunidades' }).click()
  await expect(page.getByText(new RegExp(`${N} de ${N} oportunidades`))).toBeVisible({ timeout: 15_000 })
  const mb = await page.evaluate(() => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1024 / 1024)
  registra(`heap JS: ${mb.toFixed(0)} MB`)
  expect(mb, 'memória JS usada').toBeLessThan(orc(120))
})

test('a página inicial não baixa mais JavaScript do que o orçamento de produção (peso da transferência)', async ({ page }) => {
  let bytesJs = 0
  page.on('response', async (r) => {
    if (r.url().endsWith('.js')) bytesJs += (await r.body().catch(() => Buffer.alloc(0))).length
  })
  await api(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  const kb = bytesJs / 1024
  registra(`JS carregado na abertura: ${kb.toFixed(0)} kB (sem compressão)`)
  expect(kb, 'JS (sem gzip) carregado na abertura').toBeLessThan(orc(800))
})
