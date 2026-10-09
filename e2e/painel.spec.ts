import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const pickYear = async (page: Page, year: string) => {
  await page.getByRole('button', { name: 'Filtrar por Ano' }).click()
  await page.getByRole('checkbox', { name: new RegExp(`^${year}`) }).check()
  await page.keyboard.press('Escape')
}

const errors: string[] = []

test.beforeEach(async ({ page }) => {
  errors.length = 0
  page.on('pageerror', (e) => errors.push(e.message))
  // /api/* indisponível é esperado no build e2e (cai no fallback sintético).
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Radar Pré-Vendas' })).toBeVisible()
})

test.afterEach(() => {
  expect(errors, 'erros de console/página').toEqual([])
})

test('abre em branco até escolher um Ano', async ({ page }) => {
  await expect(page.getByText('Selecione um Ano', { exact: true })).toBeVisible()
  await pickYear(page, '2026')
  await expect(page.getByText(/oportunidades? no filtro/)).toBeVisible()
  await expect(page.getByText('Selecione um Ano', { exact: true })).toHaveCount(0)
})

test('sinaliza dados de demonstração no rodapé', async ({ page }) => {
  await expect(page.getByText(/dados sintéticos/)).toBeVisible()
})

test('cascata Ano → Mês e "Selecionar todos"', async ({ page }) => {
  await pickYear(page, '2026')
  await page.getByRole('button', { name: 'Filtrar por Mês' }).click()
  const popover = page.getByRole('dialog')
  await popover.getByText('Selecionar todos').click()
  await expect(popover.getByText('Desmarcar todos')).toBeVisible()
  // Meses de outros anos não aparecem.
  await expect(popover.getByText(/\/25$/)).toHaveCount(0)
})

test('drill-down de status abre a lista e fecha com Esc', async ({ page }) => {
  await pickYear(page, '2026')
  await page.getByRole('button', { name: /^Win/ }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/oportunidades? no recorte atual/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('as 5 abas renderizam', async ({ page }) => {
  await pickYear(page, '2026')
  for (const name of ['Visão Executiva', 'Intersetorial & Portfólio', 'Operacional', 'Metodologia & Maturidade', 'Plano de Ação']) {
    await page.getByRole('tab', { name }).click()
    await expect(page.getByRole('tabpanel')).toBeVisible()
  }
})

test('sem violações graves de acessibilidade (WCAG A/AA)', async ({ page }) => {
  await pickYear(page, '2026')
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
})

test('tema escuro também atende ao contraste', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await pickYear(page, '2026')
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
})

test('sem rolagem horizontal', async ({ page }) => {
  await pickYear(page, '2026')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
