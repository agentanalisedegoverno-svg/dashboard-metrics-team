import { expect, test, type Page } from '@playwright/test'

const opcoes = {
  listas: {
    status: ['Prospect', 'Go', 'Win', 'No Go', 'Radar-TIC'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    torre: ['ITS'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    uf: ['DF'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    motivo_no_go: [{ valor: 'Risco Jurídico', ativo: true, ordem: 1 }],
    linha_servico: ['Service Desk'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    unidade_fornecimento: ['UST'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
  },
  preVendas: ['Marcia'],
  linhasTorre: {},
}

const reg = (id: number, status: string) => ({
  id,
  codigo: `2026-${String(id).padStart(4, '0')}`,
  versao: 1,
  status,
  orgao: `Órgão ${id}`,
  descritivo: 'Link dedicado',
  processo: `${id}/2026`,
  torre: 'ITS',
  uf: 'DF',
  analista: 'Marcia',
  data_pregao_dt: '2026-03-10',
  hora_pregao: null,
  orcamento: 1_000_000,
  orcamento_sigiloso: false,
  pendencias: [],
  atualizado_por: 'joao.henrique@ctctech.com.br',
  atualizado_em: '2026-10-14T12:00:00Z',
})

// 1 e 2 são de outros status; 3, 4 e 5 são Radar-TIC.
const base = [reg(1, 'Go'), reg(2, 'Prospect'), reg(3, 'Radar-TIC'), reg(4, 'Radar-TIC'), reg(5, 'Radar-TIC')]

async function api(page: Page, admin: boolean) {
  const lotes: number[][] = []
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { email: 'joao.henrique@ctctech.com.br', nome: 'João Henrique', admin, preVendas: false, somenteLeitura: false, perfil: admin ? 'administrador' : 'pre_vendas' } }),
  )
  await page.route('**/api/opcoes', (r) => r.fulfill({ json: opcoes }))
  await page.route('**/api/oportunidades**', (r) => {
    const req = r.request()
    const url = new URL(req.url())
    if (req.method() === 'GET') return r.fulfill({ json: { rows: base } })
    if (req.method() === 'POST' && url.pathname.endsWith('/arquivar-lote')) {
      const { ids } = req.postDataJSON() as { ids: number[] }
      lotes.push(ids)
      return r.fulfill({ json: { arquivadas: ids.length } })
    }
    return r.fulfill({ status: 404, json: { error: 'x' } })
  })
  return { lotes }
}

const abrirAba = async (page: Page) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Oportunidades', exact: true }).click()
  await expect(page.getByLabel('Buscar oportunidades')).toBeVisible()
}

test('administrador seleciona só as Radar-TIC e arquiva tudo de uma vez', async ({ page }) => {
  const { lotes } = await api(page, true)
  await abrirAba(page)

  // Só as 3 linhas Radar-TIC têm caixa de seleção (as outras não).
  await expect(page.getByRole('checkbox', { name: /^Selecionar 2026-\d+ para arquivar$/ })).toHaveCount(3)
  await expect(page.getByRole('checkbox', { name: /Selecionar 2026-0001/ })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /Selecionar 2026-0002/ })).toHaveCount(0)

  // Marca duas de forma individual: a barra aparece.
  await page.getByRole('checkbox', { name: 'Selecionar 2026-0003 para arquivar' }).check()
  await page.getByRole('checkbox', { name: 'Selecionar 2026-0004 para arquivar' }).check()
  await expect(page.getByText('2 selecionadas (Radar-TIC)')).toBeVisible()

  // "Selecionar todas" marca as 3.
  await page.getByRole('checkbox', { name: 'Selecionar todas as Radar-TIC da lista para arquivar' }).check()
  await expect(page.getByText('3 selecionadas (Radar-TIC)')).toBeVisible()

  // Pede confirmação antes de arquivar.
  await page.getByRole('button', { name: 'Arquivar selecionadas' }).click()
  await expect(page.getByText(/Arquivar 3 oportunidades\?/)).toBeVisible()
  expect(lotes).toHaveLength(0)
  await page.getByRole('button', { name: 'Confirmar' }).click()

  await expect(page.getByText('3 oportunidades Radar-TIC arquivadas.')).toBeVisible()
  expect(lotes).toEqual([[3, 4, 5]])
  await expect(page.getByText(/selecionadas \(Radar-TIC\)/)).toHaveCount(0)
})

test('cancelar a confirmação não arquiva e "Limpar seleção" zera a barra', async ({ page }) => {
  const { lotes } = await api(page, true)
  await abrirAba(page)
  await page.getByRole('checkbox', { name: 'Selecionar 2026-0005 para arquivar' }).check()
  await page.getByRole('button', { name: 'Arquivar selecionadas' }).click()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  expect(lotes).toHaveLength(0)
  await page.getByRole('button', { name: 'Limpar seleção' }).click()
  await expect(page.getByRole('region', { name: 'Arquivar Radar-TIC em lote' })).toHaveCount(0)
})

test('quem não é administrador não vê a seleção em lote', async ({ page }) => {
  await api(page, false)
  await abrirAba(page)
  await expect(page.getByRole('checkbox', { name: /para arquivar/ })).toHaveCount(0)
})
