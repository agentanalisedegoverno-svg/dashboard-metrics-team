import { expect, test, type Page } from '@playwright/test'

const opcoes = {
  listas: {
    status: ['Prospect', 'Go'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    torre: ['ITS'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    uf: ['DF'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    motivo_no_go: [{ valor: 'Risco Jurídico', ativo: true, ordem: 1 }],
    linha_servico: ['Service Desk'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    unidade_fornecimento: ['UST'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
  },
  preVendas: ['Marcia'],
  linhasTorre: {},
}

const reg = (id: number, orgao: string, orcamento: number | null, extra: Record<string, unknown> = {}) => ({
  id,
  codigo: `2026-${String(id).padStart(4, '0')}`,
  versao: 1,
  status: 'Prospect',
  orgao,
  descritivo: 'Link dedicado',
  objeto: null,
  duracao_contrato_meses: null,
  processo: `${id}/2026`,
  torre: 'ITS',
  uf: 'DF',
  analista: 'Marcia',
  data_pregao_dt: '2026-03-10',
  hora_pregao: null,
  orcamento,
  orcamento_sigiloso: false,
  pendencias: [],
  atualizado_por: 'joao.henrique@ctctech.com.br',
  atualizado_em: '2026-10-14T12:00:00Z',
  ...extra,
})

const base = [
  reg(1, 'Prefeitura Municipal de Campinas', 500_000, { objeto: 'Contratação de link dedicado e firewall para as secretarias', duracao_contrato_meses: 36 }),
  reg(2, 'Governo do Estado de Goiás', 2_000_000, { duracao_contrato_meses: 1 }),
  reg(3, 'Ministério da Saúde', 9_000_000),
  reg(4, 'Acme Tecnologia Ltda', null),
  reg(5, 'Prefeitura de Niterói', 100_000, { orcamento_sigiloso: true }),
]

async function abrir(page: Page) {
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { email: 'joao.henrique@ctctech.com.br', nome: 'João Henrique', admin: false, preVendas: true, somenteLeitura: false, perfil: 'pre_vendas' } }),
  )
  await page.route('**/api/opcoes', (r) => r.fulfill({ json: opcoes }))
  await page.route('**/api/oportunidades**', (r) => r.fulfill({ json: { rows: base } }))
  await page.goto('/')
  await page.getByRole('tab', { name: 'Oportunidades', exact: true }).click()
  await expect(page.getByLabel('Buscar oportunidades')).toBeVisible()
}

// Tabela no desktop; lista de cartões no celular.
const linhas = (page: Page) => page.locator('tbody tr[tabindex="0"], [role="listitem"]')

test('filtra pela esfera do órgão (municipal, estadual, federal, não identificada)', async ({ page }) => {
  await abrir(page)
  await expect(linhas(page)).toHaveCount(5)
  const esfera = page.getByLabel('Filtrar por esfera do órgão')

  await esfera.selectOption('Municipal')
  await expect(linhas(page)).toHaveCount(2)
  await expect(page.getByText('Prefeitura Municipal de Campinas')).toBeVisible()

  await esfera.selectOption('Estadual')
  await expect(linhas(page)).toHaveCount(1)
  await expect(page.getByText('Governo do Estado de Goiás')).toBeVisible()

  await esfera.selectOption('Federal')
  await expect(linhas(page)).toHaveCount(1)

  await esfera.selectOption('Não identificada')
  await expect(linhas(page)).toHaveCount(1)
  await expect(page.getByText('Acme Tecnologia Ltda')).toBeVisible()
})

test('filtra pela faixa de valor estimado e avisa quando o mínimo passa do máximo', async ({ page }) => {
  await abrir(page)
  await page.getByLabel('Valor estimado mínimo').fill('1.000.000')
  await expect(linhas(page)).toHaveCount(2) // 2 mi e 9 mi; sem valor e sigiloso ficam de fora
  await page.getByLabel('Valor estimado máximo').fill('5000000')
  await expect(linhas(page)).toHaveCount(1)
  await expect(page.getByText('Governo do Estado de Goiás')).toBeVisible()

  await page.getByLabel('Valor estimado mínimo').fill('6.000.000')
  await expect(page.getByRole('alert').filter({ hasText: 'valor mínimo é maior que o máximo' })).toBeVisible()
  await expect(linhas(page)).toHaveCount(0)
})

test('passar o mouse mostra objeto, valor estimado e duração; sair esconde', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'mouse/hover não existe no celular')
  await abrir(page)
  const campinas = linhas(page).filter({ hasText: 'Prefeitura Municipal de Campinas' })
  await campinas.hover()
  const dica = page.getByRole('tooltip')
  await expect(dica).toBeVisible()
  await expect(dica).toContainText('Contratação de link dedicado e firewall')
  await expect(dica).toContainText('R$')
  await expect(dica).toContainText('500.000')
  await expect(dica).toContainText('36 meses')

  await page.getByLabel('Buscar oportunidades').hover()
  await expect(dica).toHaveCount(0)

  // Sem objeto e duração de 1 mês; orçamento sigiloso aparece como "Sigiloso".
  await linhas(page).filter({ hasText: 'Governo do Estado de Goiás' }).hover()
  await expect(dica).toContainText('1 mês')
  await expect(dica).toContainText('Objeto: —')
  await linhas(page).filter({ hasText: 'Prefeitura de Niterói' }).hover()
  await expect(dica).toContainText('Sigiloso')
})

test('a dica também aparece ao focar a linha com o teclado', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'sem tabela no celular')
  await abrir(page)
  await linhas(page).first().focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
})
