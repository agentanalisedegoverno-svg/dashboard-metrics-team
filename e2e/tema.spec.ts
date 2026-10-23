import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const tema = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
const fundo = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Radar Pré-Vendas' })).toBeVisible()
})

test('começa no tema do sistema e o botão escolhe claro ou escuro', async ({ page }) => {
  expect(await tema(page)).toBe('light')
  await expect(page.getByRole('button', { name: 'Tema do sistema' })).toHaveAttribute('aria-pressed', 'true')
  const claro = await fundo(page)
  await page.getByRole('button', { name: 'Tema escuro' }).click()
  expect(await tema(page)).toBe('dark')
  await expect(page.getByRole('button', { name: 'Tema escuro' })).toHaveAttribute('aria-pressed', 'true')
  expect(await fundo(page)).not.toBe(claro) // a cor de fundo mudou de verdade
  await page.getByRole('button', { name: 'Tema claro' }).click()
  expect(await tema(page)).toBe('light')
  expect(await fundo(page)).toBe(claro)
})

test('a escolha persiste ao recarregar e aplica sem piscar', async ({ page }) => {
  await page.getByRole('button', { name: 'Tema escuro' }).click()
  await page.reload()
  expect(await tema(page)).toBe('dark')
  await expect(page.getByRole('button', { name: 'Tema escuro' })).toHaveAttribute('aria-pressed', 'true')
  // a escolha manual vale mesmo com o sistema em claro; "sistema" volta a acompanhá-lo
  await page.getByRole('button', { name: 'Tema do sistema' }).click()
  expect(await tema(page)).toBe('light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => tema(page)).toBe('dark')
})

test('escolher claro mantém claro mesmo com o sistema em escuro', async ({ page }) => {
  await page.getByRole('button', { name: 'Tema claro' }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  expect(await tema(page)).toBe('light')
})

test('tema escuro escolhido à mão não tem violações de acessibilidade', async ({ page }) => {
  await page.getByRole('button', { name: 'Tema escuro' }).click()
  const r = await new AxeBuilder({ page }).include('header').analyze()
  expect(r.violations, JSON.stringify(r.violations.map((v) => v.id))).toEqual([])
})
