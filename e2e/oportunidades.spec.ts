import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

type Reg = Record<string, unknown> & { id: number; versao: number }

const opcoes = {
  listas: {
    status: ['Prospect', 'Go', 'Win', 'Lost', 'No Go'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    torre: ['ITS', 'DIGITAL', 'HEALTH'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    uf: ['DF', 'GO', 'SP'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    motivo_no_go: [{ valor: 'Risco Jurídico', ativo: true, ordem: 1 }],
  },
  preVendas: ['Flávio Santanna', 'Marcia'],
}

const semente = (n: number): Reg[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    codigo: `2026-${String(i + 1).padStart(4, '0')}`,
    versao: 1,
    status: i % 3 === 0 ? 'Win' : 'Go',
    orgao: `Órgão ${i + 1}`,
    descritivo: 'Link dedicado',
    processo: `${i + 1}/2026`,
    torre: 'ITS',
    uf: 'DF',
    analista: 'Marcia',
    data_pregao_dt: '2026-03-10',
    orcamento: 1_000_000 + i,
    orcamento_sigiloso: false,
    valor_ctc: null,
    pendencias: i === 2 ? ['site'] : [],
    atualizado_por: 'joao.henrique@ctctech.com.br',
    atualizado_em: '2026-10-14T12:00:00Z',
  }))

async function api(page: Page, admin = false, forcarConflito = false) {
  const base = semente(500)
  const enviados: Reg[] = []
  await page.route('**/api/me', (r) => r.fulfill({ json: { email: 'joao.henrique@ctctech.com.br', nome: 'João Henrique', admin, preVendas: false } }))
  await page.route('**/api/opcoes', (r) => r.fulfill({ json: opcoes }))
  await page.route('**/api/oportunidades**', async (r) => {
    const req = r.request()
    const url = new URL(req.url())
    if (req.method() === 'GET' && url.pathname.endsWith('/oportunidades')) return r.fulfill({ json: { rows: base } })
    if (req.method() === 'GET' && url.pathname.endsWith('/historico')) {
      return r.fulfill({ json: { itens: [{ id: 1, versao: 2, acao: 'editou', por: 'ana@ctctech.com.br', em: '2026-10-14T12:00:00Z', alteracoes: { status: ['Go', 'Win'] } }] } })
    }
    if (req.method() === 'POST') {
      const corpo = req.postDataJSON() as Reg
      enviados.push(corpo)
      return r.fulfill({ status: 201, json: { ...corpo, id: 999, versao: 1 } })
    }
    if (req.method() === 'PUT') {
      const corpo = req.postDataJSON() as Reg
      enviados.push(corpo)
      if (forcarConflito) return r.fulfill({ status: 409, json: { error: 'Outra pessoa alterou este registro.', versao_atual: 5, atual: { ...base[0], versao: 5, orgao: 'Alterado por outra pessoa' } } })
      return r.fulfill({ json: { ...corpo, id: 1, versao: 2 } })
    }
    return r.fulfill({ status: 404, json: { error: 'x' } })
  })
  return { enviados }
}

const abrirAba = async (page: Page) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Oportunidades' }).click()
  await expect(page.getByLabel('Buscar oportunidades')).toBeVisible()
}

test('lista virtualizada, busca e filtro', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  await expect(page.getByText(/500 de 500 oportunidades/)).toBeVisible()
  // Só uma janela de linhas existe no DOM (virtualização).
  expect(await page.locator('tbody tr[tabindex="0"], [role=listitem]').count()).toBeLessThan(80)
  await page.getByLabel('Buscar oportunidades').fill('Órgão 42')
  await expect(page.getByText(/oportunidades · logado/)).toContainText('de 500')
  await page.getByLabel('Buscar oportunidades').fill('2026-0042')
  await expect(page.getByText(/^1 de 500 oportunidades/)).toBeVisible()
  await expect(page.getByText('2026-0042').first()).toBeVisible()
  await page.getByLabel('Buscar oportunidades').fill('')
  await page.getByRole('checkbox', { name: /Só com pendências/ }).check()
  await expect(page.getByText(/1 de 500 oportunidades/)).toBeVisible()
})

test('cadastro: valida obrigatórios no cliente e envia números normalizados', async ({ page }) => {
  const { enviados } = await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Campo obrigatório').first()).toBeVisible()
  expect(enviados).toHaveLength(0)

  await page.getByLabel(/^Status/).selectOption('Go')
  await page.getByLabel(/^Instituição/).fill('Prefeitura X')
  await page.getByLabel(/^Descritivo/).fill('Link de internet')
  await page.getByLabel(/^Torre/).selectOption('ITS')
  await page.getByLabel(/^Data do pregão/).fill('2026-05-20')
  await page.getByLabel(/^Orçamento \(R\$\)/).fill('1.234,50')
  await page.getByLabel(/^MC CTC/).fill('18,5')
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Oportunidade cadastrada.')).toBeVisible()
  expect(enviados[0]).toMatchObject({ orgao: 'Prefeitura X', orcamento: 1234.5, mc_ctc: 0.185, processo: null, orcamento_sigiloso: false })
})

test('motivo do No Go aparece e é exigido só nesse status', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  await expect(page.getByLabel(/^Motivo do No Go/)).toHaveCount(0)
  await page.getByLabel(/^Status/).selectOption('No Go')
  await expect(page.getByLabel(/^Motivo do No Go/)).toBeVisible()
})

test('edição: conflito de versão oferece recarregar sem perder o outro trabalho', async ({ page }) => {
  await api(page, false, true)
  await abrirAba(page)
  await page.getByText('Órgão 2', { exact: true }).first().click()
  await page.getByLabel(/^Instituição/).fill('Meu ajuste')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Outra pessoa alterou este registro enquanto você editava.')).toBeVisible()
  await page.getByRole('button', { name: 'Descartar e recarregar' }).click()
  await expect(page.getByLabel(/^Instituição/)).toHaveValue('Alterado por outra pessoa')
})

test('histórico mostra quem alterou o quê', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  await page.getByText('Órgão 1', { exact: true }).first().click()
  await page.getByRole('tab', { name: 'Histórico' }).click()
  await expect(page.getByText(/ana@ctctech.com.br/)).toBeVisible()
  await expect(page.getByText('Go → Win')).toBeVisible()
})

test('somente administrador vê arquivar e a administração de listas', async ({ page }) => {
  await api(page, false)
  await abrirAba(page)
  await expect(page.getByRole('button', { name: /Listas e usuários/ })).toHaveCount(0)
  await page.getByText('Órgão 1', { exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Arquivar' })).toHaveCount(0)
})

test('acessibilidade da aba, do formulário e em tela de celular', async ({ page }) => {
  await api(page, true)
  await abrirAba(page)
  let r = await new AxeBuilder({ page }).include('section[aria-label="Cadastro de oportunidades"]').analyze()
  expect(r.violations, JSON.stringify(r.violations.map((v) => v.id))).toEqual([])
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  r = await new AxeBuilder({ page }).include('[role=dialog]').analyze()
  expect(r.violations, JSON.stringify(r.violations.map((v) => v.id))).toEqual([])
})
