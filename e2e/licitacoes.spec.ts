import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const em = (dias: number) => iso(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + dias))

const base = { versao: 1, orgao: 'Órgão', descritivo: 'Link dedicado', torre: 'ITS', uf: 'DF', uasg: '1', processo: '1/2026', site: null, analista: 'Marcia', pendencias: [] }
const rows = [
  { ...base, id: 1, codigo: '2026-0001', status: 'Go', orgao: 'Prefeitura de Hoje', data_pregao_dt: em(0), hora_pregao: '09:30:00' },
  { ...base, id: 2, codigo: '2026-0002', status: 'Prospect', orgao: 'Câmara de Amanhã', data_pregao_dt: em(1), processo: '' },
  { ...base, id: 3, codigo: '2026-0003', status: 'Go', orgao: 'Tribunal da Semana', data_pregao_dt: em(4), site: 'https://pncp.gov.br/app/editais/1/2026/1' },
  { ...base, id: 4, codigo: '2026-0004', status: 'Prospect', orgao: 'Autarquia Distante', data_pregao_dt: em(30) },
  { ...base, id: 5, codigo: '2026-0005', status: 'Go', orgao: 'Fundação Esquecida', data_pregao_dt: em(-3) },
  { ...base, id: 6, codigo: '2026-0006', status: 'Prospect', orgao: 'Instituto Sem Data', data_pregao_dt: null },
  { ...base, id: 7, codigo: '2026-0007', status: 'On going', orgao: 'Contrato Rodando', data_pregao_dt: em(-200) },
  { ...base, id: 8, codigo: '2026-0008', status: 'Suspended', orgao: 'Contrato Suspenso', data_pregao_dt: em(-100) },
  { ...base, id: 9, codigo: '2026-0009', status: 'Win', orgao: 'Já Ganho (fora do painel)', data_pregao_dt: em(-10) },
]

async function abrir(page: Page, pncpItens: unknown[] = []) {
  const chamadas: string[] = []
  await page.route('**/api/me', (r) => r.fulfill({ json: { email: 'a@b.com', nome: 'Ana', admin: false, preVendas: false, somenteLeitura: false, perfil: 'editor' } }))
  await page.route('**/api/opcoes', (r) => r.fulfill({ json: { listas: { status: [], torre: [], uf: [], motivo_no_go: [], linha_servico: [], unidade_fornecimento: [] }, preVendas: [], linhasTorre: {} } }))
  await page.route('**/api/oportunidades**', (r) => r.fulfill({ json: { rows } }))
  await page.route('**/pncp/consulta/**', (r) => {
    chamadas.push(new URL(r.request().url()).search)
    return r.fulfill({ json: { data: pncpItens, totalPaginas: 1 } })
  })
  await page.route('**/comprasgov/**', (r) => { chamadas.push('comprasgov'); return r.fulfill({ json: { resultado: [] } }) })
  await page.route('**/conlicitacao', (r) => { chamadas.push('conlicitacao'); return r.fulfill({ json: { resultado: [] } }) })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Licitações' }).click()
  await expect(page.getByRole('heading', { name: 'Monitoramento de licitações' })).toBeVisible()
  return { chamadas }
}

test('painel por urgência: hoje, amanhã, semana, atrasado e sem data, com a próxima ação', async ({ page }) => {
  const { chamadas } = await abrir(page)
  await expect(page.getByRole('button', { name: /^Hoje/ })).toBeVisible()
  const cartao = (orgao: string) => page.locator('article').filter({ hasText: orgao })

  await expect(cartao('Prefeitura de Hoje')).toContainText('Pregão hoje às 09:30')
  await expect(cartao('Prefeitura de Hoje')).toContainText('Próxima ação')
  const d = new Date()
  await expect(cartao('Prefeitura de Hoje')).toContainText(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`) // data pura não pode voltar um dia
  await expect(cartao('Câmara de Amanhã')).toContainText('Pregão amanhã')
  await expect(cartao('Câmara de Amanhã')).toContainText('Sem nº do processo') // o que falta no cadastro
  await expect(cartao('Tribunal da Semana')).toContainText('Pregão em 4 dias')
  await expect(cartao('Autarquia Distante')).toContainText('Pregão em 30 dias')
  await expect(cartao('Fundação Esquecida')).toContainText('Pregão foi há 3 dias e o status segue Go')
  await expect(cartao('Instituto Sem Data')).toContainText('Sem data de pregão')
  // contratos e outros status não entram na visão de certames
  await expect(page.locator('article').filter({ hasText: 'Contrato Rodando' })).toHaveCount(0)
  await expect(page.locator('article').filter({ hasText: 'Já Ganho' })).toHaveCount(0)
  // ordem das faixas: atrasado, hoje, amanhã, 7 dias, adiante, sem data
  const titulos = await page.getByRole('heading', { level: 2 }).allInnerTexts()
  expect(titulos.map((t) => t.replace(/\s*\(\d+\)$/, ''))).toEqual(['Pregão já passou', 'Hoje', 'Amanhã', 'Próximos 7 dias', 'Mais adiante', 'Sem data de pregão'])
  // abrir a tela não dispara nenhuma consulta às fontes externas
  expect(chamadas).toEqual([])
})

test('placar por faixa: mostra a contagem, filtra ao clicar e volta ao clicar de novo', async ({ page }) => {
  await abrir(page)
  const placar = page.getByRole('group', { name: /Placar por urgência/ })
  const faixa = (nome: RegExp) => placar.getByRole('button', { name: nome })
  await expect(faixa(/^Hoje/)).toContainText('1')
  await expect(faixa(/^Amanhã/)).toContainText('1')
  await expect(faixa(/^Pregão já passou/)).toContainText('1')
  await expect(faixa(/^Precisam de ação/)).toContainText('5') // 4 certames (atrasado, hoje, amanhã sem processo, sem data) + o contrato suspenso
  await expect(page.locator('article')).toHaveCount(6)
  await faixa(/^Amanhã/).click()
  await expect(faixa(/^Amanhã/)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('article')).toHaveCount(1)
  await expect(page.locator('article')).toContainText('Câmara de Amanhã')
  await faixa(/^Amanhã/).click()
  await expect(page.locator('article')).toHaveCount(6)
  await faixa(/^Precisam de ação/).click()
  await expect(page.locator('article')).toHaveCount(4)
  await expect(page.getByText(/Atualizado às \d{2}:\d{2}/)).toBeVisible()
})

test('contratos em andamento ficam em outra visão, sem alerta de pregão; filtro "só o que precisa de ação" e busca', async ({ page }) => {
  await abrir(page)
  await page.getByRole('button', { name: /^Contratos/ }).click()
  await expect(page.locator('article')).toHaveCount(2)
  await expect(page.locator('article').filter({ hasText: 'Contrato Rodando' })).toContainText('Em andamento')
  await expect(page.locator('article').filter({ hasText: 'Contrato Suspenso' })).toContainText('Confirme com o órgão se há data de retomada')
  await page.getByLabel('Só o que precisa de ação').check()
  await expect(page.locator('article')).toHaveCount(1)
  await page.getByLabel('Só o que precisa de ação').uncheck()
  await page.getByLabel('Buscar nas licitações').fill('rodando')
  await expect(page.locator('article')).toHaveCount(1)
})

test('"Procurar edital no PNCP" é sob demanda: pregão eletrônico (6), 50 por página, e mostra o candidato', async ({ page }) => {
  const item = { numeroControlePNCP: '12345678000199-1-000123/2026', processo: '1/2026', objetoCompra: 'Link dedicado de internet', orgaoEntidade: { razaoSocial: 'Prefeitura de Hoje' }, unidadeOrgao: { nomeUnidade: 'Sede', codigoUnidade: '1' }, dataEncerramentoProposta: em(2) + 'T10:00:00' }
  const { chamadas } = await abrir(page, [item])
  expect(chamadas).toEqual([])
  const cartao = page.locator('article').filter({ hasText: 'Prefeitura de Hoje' })
  await cartao.getByRole('button', { name: 'Procurar edital no PNCP' }).click()
  await expect(cartao.getByText('Processo exato')).toBeVisible()
  await expect(cartao.getByRole('link', { name: /Ver no PNCP/ })).toHaveAttribute('href', 'https://pncp.gov.br/app/editais/12345678000199/2026/000123')
  expect(chamadas).toHaveLength(1) // as outras oportunidades do DF reaproveitam a mesma consulta
  expect(chamadas[0]).toContain('codigoModalidadeContratacao=6')
  expect(chamadas[0]).toContain('tamanhoPagina=50')
  expect(chamadas[0]).toContain('uf=DF')
})

test('as fontes públicas só são consultadas quando o bloco é aberto', async ({ page }) => {
  const { chamadas } = await abrir(page)
  expect(chamadas).toEqual([])
  await page.getByText('Fontes públicas (diagnóstico)').click()
  await expect(page.getByText('Compras.gov.br · últimos 45 dias')).toBeVisible()
  await expect.poll(() => chamadas.includes('conlicitacao')).toBe(true)
})

test('"Abrir cadastro" abre o formulário da oportunidade e o link do edital só aparece com https', async ({ page }) => {
  await abrir(page)
  const semana = page.locator('article').filter({ hasText: 'Tribunal da Semana' })
  await expect(semana.getByRole('link', { name: /Abrir edital/ })).toHaveAttribute('href', 'https://pncp.gov.br/app/editais/1/2026/1')
  await expect(page.locator('article').filter({ hasText: 'Prefeitura de Hoje' }).getByRole('link', { name: /Abrir edital/ })).toHaveCount(0)
  await semana.getByRole('button', { name: 'Abrir cadastro' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('acessibilidade do painel', async ({ page }) => {
  await abrir(page)
  const r = await new AxeBuilder({ page }).include('section[aria-label="Monitoramento de licitações"]').analyze()
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
})
