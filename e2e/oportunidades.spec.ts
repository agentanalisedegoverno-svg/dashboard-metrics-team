import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

type Reg = Record<string, unknown> & { id: number; versao: number }

const opcoes = {
  listas: {
    status: ['Prospect', 'Go', 'Win', 'Lost', 'No Go'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    torre: ['ITS', 'DIGITAL', 'HEALTH'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    uf: ['DF', 'GO', 'SP'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    motivo_no_go: [{ valor: 'Risco Jurídico', ativo: true, ordem: 1 }],
    linha_servico: ['Service Desk', 'Software Development', 'Lya Gov', 'Governança e gestão da TI', 'Outros'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
    unidade_fornecimento: ['Posto de Trabalho', 'Serviço (valor fixo)', 'UST'].map((valor, i) => ({ valor, ativo: true, ordem: i })),
  },
  preVendas: ['Flávio Santanna', 'Marcia'],
  linhasTorre: { 'Software Development': 'DIGITAL', 'Lya Gov': 'HEALTH' },
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
    hora_pregao: i === 0 ? '15:30:00' : null,
    objeto: null,
    sigla: null,
    orcamento: 1_000_000 + i,
    orcamento_sigiloso: false,
    valor_ctc: null,
    pendencias: i === 2 ? ['site'] : [],
    atualizado_por: 'joao.henrique@ctctech.com.br',
    atualizado_em: '2026-10-14T12:00:00Z',
  }))

async function api(page: Page, admin = false, forcarConflito = false, visualizador = false) {
  const base = semente(500)
  const enviados: Reg[] = []
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { email: 'joao.henrique@ctctech.com.br', nome: 'João Henrique', admin, preVendas: false, somenteLeitura: visualizador, perfil: admin ? 'administrador' : visualizador ? 'visualizador' : 'editor' } }),
  )
  const usuarios = [
    { nome: 'João Henrique', email: 'joao.henrique@ctctech.com.br', admin: true, pre_vendas: false, ativo: true, somente_leitura: false },
    { nome: 'Ana Admin', email: 'ana@ctctech.com.br', admin: true, pre_vendas: false, ativo: true, somente_leitura: false },
    { nome: 'Rodrigo A', email: null, admin: false, pre_vendas: true, ativo: true, somente_leitura: false },
    { nome: 'Vera Viewer', email: 'vera@ctctech.com.br', admin: false, pre_vendas: false, ativo: true, somente_leitura: true },
  ]
  await page.route('**/api/opcoes', (r) => {
    if (r.request().method() === 'PUT') {
      enviados.push(r.request().postDataJSON() as Reg)
      return r.fulfill({ json: { ok: true } })
    }
    return r.fulfill({ json: admin ? { ...opcoes, usuarios } : opcoes })
  })
  // E-mails de nova oportunidade (Administração -> E-mails)
  let emailCfg = {
    ativo: false,
    avisar_pre_vendas: false,
    status: [] as string[],
    destinatarios: [{ email: 'comercial@ctctech.com.br', tipo: 'para', ativo: true }],
    atualizado_por: null as string | null,
    atualizado_em: null as string | null,
    recentes: [{ id: 7, tipo: 'nova', situacao: 'enviado', tentativas: 1, ultimo_erro: null, criado_em: '2026-10-23T12:00:00Z', enviado_em: '2026-10-23T12:05:00Z', codigo: '2026-0007', orgao: 'Órgão Sete' }],
  }
  const clientesApi = [{ id: 1, nome: 'sistema-x', ativo: true, criado_em: '2026-10-28T12:00:00Z', criado_por: 'joao.henrique@ctctech.com.br', ultimo_uso_em: null, revogado_em: null }]
  await page.route('**/api/api-clientes/*', (r) => {
    const c = clientesApi.find((x) => x.id === Number(new URL(r.request().url()).pathname.split('/').pop()))
    if (c) c.ativo = false
    return r.fulfill({ json: { id: c?.id, ativo: false } })
  })
  await page.route('**/api/api-clientes', (r) => {
    if (r.request().method() === 'POST') {
      const { nome } = r.request().postDataJSON() as { nome: string }
      enviados.push({ api_cliente: nome } as unknown as Reg)
      clientesApi.push({ id: clientesApi.length + 1, nome, ativo: true, criado_em: '2026-10-28T13:00:00Z', criado_por: 'joao.henrique@ctctech.com.br', ultimo_uso_em: null, revogado_em: null })
      return r.fulfill({ status: 201, json: { cliente: clientesApi.at(-1), chave: 'rdr_CHAVE_DE_TESTE_MOSTRADA_UMA_VEZ' } })
    }
    return r.fulfill({ json: { clientes: clientesApi } })
  })
  await page.route('**/api/email-config/teste', (r) => {
    enviados.push({ teste: true } as unknown as Reg)
    return r.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/email-config', (r) => {
    if (r.request().method() === 'PUT') {
      const corpo = r.request().postDataJSON() as Reg
      enviados.push(corpo)
      emailCfg = { ...emailCfg, ...(corpo as unknown as Partial<typeof emailCfg>), atualizado_por: 'joao.henrique@ctctech.com.br', atualizado_em: '2026-10-24T12:00:00Z' }
      return r.fulfill({ json: { ok: true } })
    }
    return r.fulfill({ json: emailCfg })
  })
  await page.route('**/api/usuarios', (r) => {
    enviados.push(r.request().postDataJSON() as Reg)
    return r.fulfill({ json: { ok: true } })
  })
  // Receita (via API do Radar): 00000000000191 = matriz; qualquer outro CNPJ válido = não encontrado.
  await page.route('**/api/cnpj/*', (r) => {
    const cnpj = new URL(r.request().url()).pathname.split('/').pop()
    return cnpj === '00000000000191'
      ? r.fulfill({ json: { cnpj, razao_social: 'BANCO DO BRASIL SA', tipo: 'Matriz', situacao: 'ATIVA' } })
      : r.fulfill({ status: 404, json: { error: 'CNPJ não encontrado na Receita Federal.', motivo: 'nao_encontrado' } })
  })
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
  await page.getByLabel(/^Data do pregão/).fill('2099-05-20')
  await page.getByLabel(/^Orçamento \(R\$\)/).fill('1.234,50')
  await page.getByLabel(/^MC CTC/).fill('18,5')
  await page.getByLabel(/^Impostos/).fill('8,654')
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Oportunidade cadastrada.')).toBeVisible()
  expect(enviados[0]).toMatchObject({ orgao: 'Prefeitura X', orcamento: 1234.5, mc_ctc: 0.185, impostos: 0.0865, processo: null, orcamento_sigiloso: false })
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
  await page.getByRole('button', { name: 'Editar' }).click()
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
  await expect(page.getByRole('tab', { name: 'Administração' })).toHaveCount(0)
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

test('logo da CTC no cabeçalho e bolinhas de status por cor', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  const logo = page.getByRole('img', { name: 'CTC' })
  await expect(logo).toBeVisible()
  expect(await logo.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  // semente: i % 3 === 0 é Win (verde), os demais são Go (azul)
  await expect(page.locator('[data-status="Win"]').first()).toBeVisible()
  await expect(page.locator('[data-status="Go"]').first()).toBeVisible()
})

test('torre acompanha a linha de serviço (campo calculado) e unidade é lista', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  const torre = page.getByLabel(/^Torre/)
  await expect(torre).toBeEnabled() // sem linha, a torre é escolhida à mão
  // a linha vem antes da torre no formulário
  const rotulos = await page.locator('dialog, [role=dialog]').getByText(/^(Linha de serviço|Torre)/).allTextContents()
  expect(rotulos[0]).toMatch(/Linha de serviço/)
  await page.getByLabel(/^Linha de serviço/).selectOption('Software Development')
  await expect(torre).toHaveValue('DIGITAL')
  await expect(torre).toBeDisabled()
  await page.getByLabel(/^Linha de serviço/).selectOption('Lya Gov')
  await expect(torre).toHaveValue('HEALTH')
  await page.getByLabel(/^Linha de serviço/).selectOption('Service Desk')
  await expect(torre).toHaveValue('ITS') // qualquer outra linha = ITS
  const unidade = page.getByLabel(/^Unidade de fornecimento/)
  expect(await unidade.evaluate((e) => e.tagName)).toBe('SELECT')
  await expect(unidade.locator('option')).toHaveText(['— selecione —', 'Posto de Trabalho', 'Serviço (valor fixo)', 'UST'])
})

test('empresa vencedora: só o CNPJ; razão social e matriz/filial vêm da Receita', async ({ page }) => {
  const { enviados } = await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  const cnpj = page.getByLabel(/^Empresa vencedora \(CNPJ\)/)
  await cnpj.fill('00000000000191')
  await expect(cnpj).toHaveValue('00.000.000/0001-91') // máscara
  await expect(page.getByText('BANCO DO BRASIL SA')).toBeVisible()
  await expect(page.getByText('Matriz', { exact: true })).toBeVisible()
  await cnpj.fill('00.000.000/0001-92')
  await expect(page.getByText('CNPJ inválido (confira os dígitos).')).toBeVisible()
  await cnpj.fill('33000167000101')
  await expect(page.getByText('CNPJ não encontrado na Receita Federal.')).toBeVisible()
  // salva com a empresa preenchida
  await cnpj.fill('00000000000191')
  await expect(page.getByText('BANCO DO BRASIL SA')).toBeVisible()
  await page.getByLabel(/^Status/).selectOption('Go')
  await page.getByLabel(/^Instituição/).fill('Prefeitura X')
  await page.getByLabel(/^Descritivo/).fill('Link')
  await page.getByLabel(/^Torre/).selectOption('ITS')
  await page.getByLabel(/^Data do pregão/).fill('2099-05-20')
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Oportunidade cadastrada.')).toBeVisible()
  expect(enviados[0]).toMatchObject({ empresa_vencedora_cnpj: '00000000000191', empresa_vencedora_razao: 'BANCO DO BRASIL SA', empresa_vencedora_tipo: 'Matriz' })
})

test('descritivo limitado a 60 caracteres; data de distribuição vem com a data do dia', async ({ page }) => {
  const { enviados } = await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  await expect(page.getByLabel(/^Data de distribuição/)).toHaveValue(hoje)
  await page.getByLabel(/^Status/).selectOption('Go')
  await page.getByLabel(/^Instituição/).fill('Prefeitura X')
  await page.getByLabel(/^Descritivo/).fill('x'.repeat(80)) // o campo corta em 60
  await expect(page.getByLabel(/^Descritivo/)).toHaveValue('x'.repeat(60))
  await page.getByLabel(/^Torre/).selectOption('ITS')
  await page.getByLabel(/^Data do pregão/).fill('2099-05-20')
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Oportunidade cadastrada.')).toBeVisible()
  expect((enviados[0].descritivo as string).length).toBe(60)
  expect(enviados[0].data_distribuicao).toBe(hoje)
})

test('campos de preenchimento em amarelo e rótulo Processo/Pregão', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  const fundo = (rotulo: RegExp) => page.getByLabel(rotulo).evaluate((e) => getComputedStyle(e).backgroundColor)
  for (const r of [/^Status/, /^Instituição/, /^Descritivo/, /^Objeto/, /^Processo\/Pregão/, /^UASG/, /^UF/, /^Data do pregão/, /^Hora do pregão/, /^Linha de serviço/, /^Unidade de fornecimento/, /^Orçamento \(R\$\)/]) {
    expect(await fundo(r), String(r)).toBe('rgb(255, 246, 168)')
  }
  expect(await fundo(/^Torre/)).not.toBe('rgb(255, 246, 168)') // campo calculado não é de preenchimento
})

test('abre em tela cheia, travado; Editar libera; Cancelar descarta; Salvar grava e volta para a lista', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  await page.getByText('Órgão 2', { exact: true }).first().click()
  const dialogo = page.getByRole('dialog')
  const caixa = await dialogo.boundingBox()
  const vp = page.viewportSize()!
  expect(caixa!.width).toBeGreaterThanOrEqual(vp.width - 2)
  expect(caixa!.height).toBeGreaterThanOrEqual(vp.height - 2)

  // travado: todos os campos desabilitados, botão Editar no topo, sem Cancelar/Salvar
  const orgao = page.getByLabel(/^Instituição/)
  await expect(orgao).toBeDisabled()
  await expect(page.getByLabel(/^Status/)).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Editar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0)

  // Editar: libera os campos e mostra Cancelar/Salvar embaixo
  await page.getByRole('button', { name: 'Editar' }).click()
  await expect(orgao).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancelar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeVisible()

  // Cancelar com alteração pede confirmação e descarta
  await orgao.fill('Alterado e descartado')
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByText('Há alterações não salvas. Descartar?')).toBeVisible()
  await page.getByRole('button', { name: 'Descartar', exact: true }).click()
  await expect(orgao).toBeDisabled()
  await expect(orgao).toHaveValue('Órgão 2')

  // Editar + Salvar grava e volta ao modo leitura com o novo valor
  await page.getByRole('button', { name: 'Editar' }).click()
  await orgao.fill('Órgão salvo')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('Alterações salvas.')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nova oportunidade' })).toBeVisible()
})

test('fechar sem alterar não pergunta nada; com alteração pergunta e fecha ao descartar', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  await page.getByText('Órgão 2', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Fechar' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByText('Órgão 2', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Editar' }).click()
  await page.getByLabel(/^Instituição/).fill('mudou')
  await page.getByRole('button', { name: 'Fechar' }).click()
  await expect(page.getByText('Há alterações não salvas. Descartar?')).toBeVisible()
  await page.getByRole('button', { name: 'Descartar', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('visualizador: só consulta (sem cadastrar, editar ou arquivar)', async ({ page }) => {
  await api(page, false, false, true)
  await abrirAba(page)
  await expect(page.getByText(/\(visualizador\)/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nova oportunidade' })).toHaveCount(0)
  await page.getByText('Órgão 2', { exact: true }).first().click()
  await expect(page.getByLabel(/^Instituição/)).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Arquivar' })).toHaveCount(0)
  // o histórico continua acessível
  await page.getByRole('tab', { name: 'Histórico' }).click()
  await expect(page.getByText(/ana@ctctech.com.br/)).toBeVisible()
})

test('editor mantém o que tem hoje: cadastra e edita, mas não arquiva nem administra', async ({ page }) => {
  await api(page, false)
  await abrirAba(page)
  await expect(page.getByText(/\(editor\)/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nova oportunidade' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Administração' })).toHaveCount(0)
  await page.getByText('Órgão 2', { exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Editar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Arquivar' })).toHaveCount(0)
})

test('Administração é uma aba própria (não uma janela) e só aparece para administrador', async ({ page }) => {
  await api(page, true)
  await abrirAba(page)
  // não existe mais o botão/janela "Listas e usuários" dentro de Oportunidades
  await expect(page.getByRole('button', { name: /Listas e usuários/ })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Administração' }).click()
  await expect(page.getByRole('navigation', { name: 'Seções da administração' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(new URL(page.url()).hash).toBe('#admin/usuarios') // endereço compartilhável
  await page.getByRole('button', { name: 'Listas de opções' }).click()
  expect(new URL(page.url()).hash).toBe('#admin/listas')
})

test('usuários e perfis: tabela com perfil único, sem autobloqueio e menor privilégio por padrão', async ({ page }) => {
  const { enviados } = await api(page, true)
  await abrirAba(page)
  await page.getByRole('tab', { name: 'Administração' }).click()
  await expect(page.getByRole('table', { name: /Usuários, e-mails e perfis/ })).toBeVisible()

  // a própria pessoa não altera o próprio perfil nem se desativa
  const meu = page.getByRole('row').filter({ hasText: 'João Henrique' })
  await expect(meu.getByLabel('Perfil de João Henrique')).toBeDisabled()
  await expect(meu.getByLabel('João Henrique está ativo')).toBeDisabled()
  await expect(meu.getByText('você', { exact: true })).toBeVisible()

  // muda o perfil de outra pessoa com um único seletor (administrador e visualizador são excludentes)
  await page.getByLabel('Perfil de Vera Viewer').selectOption('administrador')
  await expect.poll(() => enviados.find((e) => e.nome === 'Vera Viewer')).toMatchObject({ admin: true, somente_leitura: false })

  // quem não tem e-mail não pode ser visualizador (o perfil depende do e-mail)
  await expect(page.getByLabel('Perfil de Rodrigo A').locator('option', { hasText: 'Visualizador' })).toBeDisabled()

  // novo usuário nasce como Visualizador (menor privilégio)
  await page.getByRole('button', { name: 'Adicionar usuário' }).click()
  await expect(page.getByLabel('Perfil do novo usuário')).toHaveValue('visualizador')
  await page.getByLabel('Nome', { exact: true }).fill('Caio Consulta')
  await page.getByLabel('E-mail', { exact: true }).fill('caio@ctctech.com.br')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect.poll(() => enviados.find((e) => e.nome === 'Caio Consulta')).toMatchObject({ somente_leitura: true, admin: false, pre_vendas: false })

  // busca e filtro por perfil
  await page.getByLabel('Buscar usuário').fill('vera')
  await expect(page.getByRole('row').filter({ hasText: 'Vera Viewer' })).toHaveCount(1)
  await expect(page.getByRole('row').filter({ hasText: 'Rodrigo A' })).toHaveCount(0)
})

test('listas de opções e consulta linha → torre na Administração', async ({ page }) => {
  const { enviados } = await api(page, true)
  await abrirAba(page)
  await page.getByRole('tab', { name: 'Administração' }).click()
  await page.getByRole('button', { name: 'Listas de opções' }).click()
  await page.getByRole('button', { name: /^Unidade de fornecimento/ }).click()
  await expect(page.getByText('Posto de Trabalho')).toBeVisible()
  await page.getByLabel('Novo item da lista').fill('Licença')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect.poll(() => enviados.find((e) => e.valor === 'Licença')).toMatchObject({ lista: 'unidade_fornecimento', ativo: true })
  await page.getByRole('button', { name: 'Linha → Torre' }).click()
  const tabela = page.getByRole('table', { name: /Linha de serviço e a torre resultante/ })
  await expect(tabela.getByRole('row').filter({ hasText: 'Software Development' })).toContainText('DIGITAL')
  await expect(tabela.getByRole('row').filter({ hasText: 'Service Desk' })).toContainText('ITS')
})

test('acessibilidade da área de administração', async ({ page }) => {
  await api(page, true)
  await abrirAba(page)
  await page.getByRole('tab', { name: 'Administração' }).click()
  await expect(page.getByRole('table')).toBeVisible()
  const r = await new AxeBuilder({ page }).include('section[aria-label="Administração"]').analyze()
  expect(r.violations, JSON.stringify(r.violations.map((v) => v.id))).toEqual([])
})

test('Administração → E-mails: liga o envio, marca status e cadastra destinatários', async ({ page }) => {
  const { enviados } = await api(page, true)
  await abrirAba(page)
  await page.getByRole('tab', { name: 'Administração' }).click()
  await page.getByRole('button', { name: 'E-mails' }).click()
  expect(new URL(page.url()).hash).toBe('#admin/emails')
  await expect(page.getByRole('heading', { name: 'E-mails de nova oportunidade' })).toBeVisible()
  await expect(page.getByText('Órgão Sete')).toBeVisible()

  const salvar = page.getByRole('button', { name: 'Salvar configuração' })
  await expect(salvar).toBeDisabled() // nada alterado ainda

  await page.getByLabel('Enviar e-mail a cada nova oportunidade').check()
  await page.getByLabel(/Avisar também o pré-vendas da oportunidade/).check()
  await page.getByRole('group', { name: /Enviar quando o status/ }).getByLabel('Go', { exact: true }).check()
  await page.getByLabel('E-mail', { exact: true }).fill('sem-arroba')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByRole('alert')).toContainText('e-mail válido')
  await page.getByLabel('E-mail', { exact: true }).fill('Novo@CTCTech.com.br')
  await page.getByLabel('Tipo do novo destinatário').selectOption('cc')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByRole('cell', { name: 'novo@ctctech.com.br', exact: true })).toBeVisible()
  await expect(salvar).toBeEnabled()
  await salvar.click()
  await expect(page.getByText('Configuração de e-mails salva.')).toBeVisible()
  await expect
    .poll(() => enviados.find((e) => 'destinatarios' in e))
    .toMatchObject({ ativo: true, avisar_pre_vendas: true, status: ['Go'], destinatarios: [{ email: 'comercial@ctctech.com.br', tipo: 'para' }, { email: 'novo@ctctech.com.br', tipo: 'cc', ativo: true }] })

  await page.getByRole('button', { name: 'Enviar e-mail de teste para mim' }).click()
  await expect.poll(() => enviados.some((e) => (e as Record<string, unknown>).teste === true)).toBe(true)
})

test('aba E-mails passa na verificação de acessibilidade', async ({ page }) => {
  await api(page, true)
  await abrirAba(page)
  await page.getByRole('tab', { name: 'Administração' }).click()
  await page.getByRole('button', { name: 'E-mails' }).click()
  await expect(page.getByRole('heading', { name: 'E-mails de nova oportunidade' })).toBeVisible()
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations).toEqual([])
})

test('Objeto fica logo abaixo do Descritivo e a data do pregão ganha hora (opcionais, fora da planilha)', async ({ page }) => {
  const { enviados } = await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  const rotulos = await page.locator('label').allInnerTexts()
  const pos = (re: RegExp) => rotulos.findIndex((t) => re.test(t))
  expect(pos(/^Objeto/), 'Objeto vem logo depois do Descritivo').toBe(pos(/^Descritivo/) + 1)
  expect(pos(/^Hora do pregão/), 'Hora vem logo depois da data do pregão').toBe(pos(/^Data do pregão/) + 1)
  await expect(page.getByLabel(/^Hora do pregão/)).toHaveAttribute('type', 'time')
  await expect(page.getByLabel(/^Objeto/)).toHaveValue('') // em branco por padrão

  await page.getByLabel(/^Status/).selectOption('Go')
  await page.getByLabel(/^Instituição/).fill('Prefeitura X')
  await page.getByLabel(/^Descritivo/).fill('Descrição')
  await page.getByLabel(/^Objeto/).fill('Link dedicado de 1 Gbps')
  await page.getByLabel(/^Torre/).selectOption('ITS')
  await page.getByLabel(/^Data do pregão/).fill('2099-05-20')
  await page.getByLabel(/^Hora do pregão/).fill('15:30')
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Oportunidade cadastrada.')).toBeVisible()
  expect(enviados[0]).toMatchObject({ objeto: 'Link dedicado de 1 Gbps', hora_pregao: '15:30', data_pregao_dt: '2099-05-20' })
})

test('sem preencher objeto e hora, vão como nulos; a grade mostra data com hora só quando há hora', async ({ page }) => {
  const { enviados } = await api(page)
  await abrirAba(page)
  await expect(page.getByText('10/03/2026 15:30').first()).toBeVisible() // registro com hora
  await expect(page.getByText('10/03/2026', { exact: true }).first()).toBeVisible() // registros sem hora (como os da planilha)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  await page.getByLabel(/^Status/).selectOption('Go')
  await page.getByLabel(/^Instituição/).fill('Prefeitura Y')
  await page.getByLabel(/^Descritivo/).fill('Descrição')
  await page.getByLabel(/^Torre/).selectOption('ITS')
  await page.getByLabel(/^Data do pregão/).fill('2099-05-21')
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Oportunidade cadastrada.')).toBeVisible()
  expect(enviados[0]).toMatchObject({ objeto: null, hora_pregao: null })
})
test('filtro de período: Ano, Quarter e Mês (mês acompanha o quarter)', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  const ano = page.getByLabel('Filtrar por ano do pregão')
  const quarter = page.getByLabel('Filtrar por quarter do pregão')
  const mes = page.getByLabel('Filtrar por mês do pregão')
  await expect(page.getByText(/^500 de 500 oportunidades/)).toBeVisible()
  expect(await ano.locator('option').allInnerTexts()).toEqual(['Todos os anos', '2026']) // só anos que existem nos dados
  await ano.selectOption('2026')
  await expect(page.getByText(/^500 de 500 oportunidades/)).toBeVisible()
  await quarter.selectOption('Q2')
  await expect(page.getByText(/^0 de 500 oportunidades/)).toBeVisible() // as datas são de março (Q1)
  expect(await mes.locator('option').allInnerTexts()).toEqual(['Todos os meses', 'Abril', 'Maio', 'Junho'])
  await quarter.selectOption('Q1')
  expect(await mes.locator('option').allInnerTexts()).toEqual(['Todos os meses', 'Janeiro', 'Fevereiro', 'Março'])
  await expect(page.getByText(/^500 de 500 oportunidades/)).toBeVisible()
  await mes.selectOption({ label: 'Fevereiro' })
  await expect(page.getByText(/^0 de 500 oportunidades/)).toBeVisible()
  await mes.selectOption({ label: 'Março' })
  await expect(page.getByText(/^500 de 500 oportunidades/)).toBeVisible()
  await quarter.selectOption('Q3') // trocar o quarter limpa o mês escolhido
  await expect(mes).toHaveValue('')
})

test('filtro por linha de serviço traz as linhas novas (Governança e gestão da TI, Outros)', async ({ page }) => {
  await api(page)
  await abrirAba(page)
  const linha = page.getByLabel('Filtrar por linha de serviço')
  const opcoesLinha = await linha.locator('option').allInnerTexts()
  expect(opcoesLinha).toEqual(expect.arrayContaining(['Todas as linhas de serviço', 'Governança e gestão da TI', 'Outros']))
  await linha.selectOption('Outros')
  await expect(page.getByText(/^0 de 500 oportunidades/)).toBeVisible() // nenhuma da amostra tem essa linha
  await linha.selectOption('')
  await expect(page.getByText(/^500 de 500 oportunidades/)).toBeVisible()
})

test('pré-vendas aceita mais de um (caixas de marcar) e o filtro acha por qualquer um', async ({ page }) => {
  const { enviados } = await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  await page.getByLabel(/^Status/).selectOption('Go')
  await page.getByLabel(/^Instituição/).fill('Prefeitura Z')
  await page.getByLabel(/^Descritivo/).fill('Descrição')
  await page.getByLabel(/^Torre/).selectOption('ITS')
  await page.getByLabel(/^Data do pregão/).fill('2099-05-22')
  const grupo = page.getByRole('group', { name: 'Pré-vendas' })
  await grupo.getByLabel('Flávio Santanna').check()
  await grupo.getByLabel('Marcia').check()
  await grupo.getByLabel('Flávio Santanna').uncheck()
  await grupo.getByLabel('Flávio Santanna').check()
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Oportunidade cadastrada.')).toBeVisible()
  expect(enviados[0].analista).toBe('Flávio Santanna, Marcia')
})

test('Sigla (até 20 caracteres) vem antes de Instituição / Órgão e é destacada em amarelo', async ({ page }) => {
  const { enviados } = await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  const rotulos = await page.locator('label').allInnerTexts()
  const pos = (re: RegExp) => rotulos.findIndex((t) => re.test(t))
  expect(pos(/^Sigla/), 'Sigla vem logo antes da Instituição').toBe(pos(/^Instituição/) - 1)
  const sigla = page.getByLabel(/^Sigla/)
  expect(await sigla.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 246, 168)')
  await sigla.fill('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  await expect(sigla).toHaveValue('ABCDEFGHIJKLMNOPQRST')
  await page.getByLabel(/^Status/).selectOption('Go')
  await page.getByLabel(/^Instituição/).fill('Prefeitura S')
  await page.getByLabel(/^Descritivo/).fill('Descrição')
  await page.getByLabel(/^Torre/).selectOption('ITS')
  await page.getByLabel(/^Data do pregão/).fill('2099-06-01')
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Oportunidade cadastrada.')).toBeVisible()
  expect(enviados[0].sigla).toBe('ABCDEFGHIJKLMNOPQRST')
})

test('valores em reais com máscara (R$ 1.234,56) e Duração do contrato (meses) em amarelo no lugar do Tipo', async ({ page }) => {
  const { enviados } = await api(page)
  await abrirAba(page)
  await page.getByRole('button', { name: 'Nova oportunidade' }).click()
  await expect(page.getByLabel(/^Tipo$/)).toHaveCount(0)
  const duracao = page.getByLabel(/^Duração do contrato \(meses\)/)
  expect(await duracao.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 246, 168)')
  await duracao.fill('24')
  for (const [rotulo, digitado, esperado] of [
    [/^Orçamento \(R\$\)/, '123456', 'R$ 1.234,56'],
    [/^Valor CTC/, '5', 'R$ 0,05'],
    [/^Custo total CTC/, '100000000', 'R$ 1.000.000,00'],
    [/^Valor vencedor/, '9999', 'R$ 99,99'],
  ] as const) {
    const campo = page.getByLabel(rotulo)
    await campo.click()
    await campo.pressSequentially(digitado)
    await expect(campo).toHaveValue(esperado)
  }
  await page.getByLabel(/^Status/).selectOption('Go')
  await page.getByLabel(/^Instituição/).fill('Prefeitura R')
  await page.getByLabel(/^Descritivo/).fill('Descrição')
  await page.getByLabel(/^Torre/).selectOption('ITS')
  await page.getByLabel(/^Data do pregão/).fill('2099-06-02')
  await page.screenshot({ path: 'test-results/zz-moeda.png' })
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByText('Oportunidade cadastrada.')).toBeVisible()
  expect(enviados[0]).toMatchObject({ duracao_contrato_meses: 24, orcamento: 1234.56, valor_ctc: 0.05, custo_total_ctc: 1000000, valor_vencedor: 99.99 })
})

test('Administração → API: cria a chave de uma aplicação (mostrada uma vez) e revoga', async ({ page }) => {
  const { enviados } = await api(page, true)
  await abrirAba(page)
  await page.getByRole('tab', { name: 'Administração' }).click()
  await page.getByRole('button', { name: 'API', exact: true }).click()
  expect(new URL(page.url()).hash).toBe('#admin/api')
  await expect(page.getByRole('heading', { name: 'API para outras aplicações' })).toBeVisible()
  await expect(page.getByText('sistema-x')).toBeVisible()
  await page.getByLabel('Nome da aplicação').fill('Nome Inválido!')
  await page.getByRole('button', { name: 'Criar chave' }).click()
  await expect(page.getByRole('alert')).toContainText('letras minúsculas')
  await page.getByLabel('Nome da aplicação').fill('sistema-contratos')
  await page.getByRole('button', { name: 'Criar chave' }).click()
  await expect(page.getByText('rdr_CHAVE_DE_TESTE_MOSTRADA_UMA_VEZ')).toBeVisible()
  expect(enviados.at(-1)).toMatchObject({ api_cliente: 'sistema-contratos' })
  await page.getByRole('button', { name: 'Já guardei' }).click()
  await expect(page.getByText('rdr_CHAVE_DE_TESTE_MOSTRADA_UMA_VEZ')).toHaveCount(0) // some e não volta
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Revogar' }).first().click()
  await expect(page.getByText('Chave revogada.')).toBeVisible()
})

test('Administração → API → Como chamar: documentação gerada dos campos e painel de teste que simula por padrão', async ({ page }) => {
  await api(page, true)
  const chamadas: { url: string; auth: string | undefined; corpo: unknown }[] = []
  await page.route('**/api/externo/**', (r) => {
    chamadas.push({ url: r.request().url(), auth: r.request().headers()['authorization'], corpo: r.request().postDataJSON() })
    return r.fulfill({ json: { id: 1, codigo: '2026-0001', simulado: true, previa: { email: { assunto: '[Radar] Prospect | 2026-0001', texto: 'Nova oportunidade' }, planner: { titulo: '[RADAR 2026-0001] X', anotacao: 'Radar 2026-0001' } } } })
  })
  await abrirAba(page)
  await page.getByRole('tab', { name: 'Administração' }).click()
  await page.getByRole('button', { name: 'API', exact: true }).click()
  await page.getByRole('tab', { name: /Como chamar/ }).click()

  // Estilo Swagger: operações, parâmetros, respostas, exemplos e tabela de campos
  await expect(page.getByRole('region', { name: 'POST /oportunidades' })).toBeVisible()
  await expect(page.getByRole('button', { name: /GET \/campos/ })).toBeVisible()
  await expect(page.getByText('Idempotency-Key').first()).toBeVisible()
  await expect(page.getByRole('table', { name: 'Tabela de campos' }).getByText('data_pregao_dt').first()).toBeVisible()
  await expect(page.getByRole('table', { name: 'Tabela de campos' }).getByText('duracao_contrato_meses').first()).toBeVisible()
  await expect(page.getByRole('table', { name: 'Tabela de campos' }).getByText('Go ·', { exact: false }).first()).toBeVisible() // valores válidos vêm das listas do banco

  // Painel de teste: simula por padrão (query ?simular=true) e mostra a prévia
  const chave = 'rdr_' + 'T'.repeat(43)
  await page.getByLabel('Chave para testar POST /oportunidades').fill(chave)
  const simular = page.getByLabel(/Simular \(não grava/)
  await expect(simular).toBeChecked()
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  await expect(page.getByRole('status').getByText('200')).toBeVisible()
  await expect(page.getByRole('status').getByText('"simulado": true')).toBeVisible()
  expect(chamadas).toHaveLength(1)
  expect(chamadas[0].url).toContain('/api/externo/oportunidades?simular=true')
  expect(chamadas[0].auth).toBe(`Bearer ${chave}`)
  expect(chamadas[0].corpo).toMatchObject({ status: 'Prospect', torre: 'ITS' })

  // Sem simular: pede confirmação (e se o usuário recusa, nada é enviado)
  await simular.uncheck()
  page.once('dialog', (d) => d.dismiss())
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  expect(chamadas).toHaveLength(1)

  // Chave em formato errado nem chega à rede
  await page.getByLabel('Chave para testar POST /oportunidades').fill('qualquer')
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  expect(chamadas).toHaveLength(1)
})
