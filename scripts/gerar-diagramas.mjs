// Gera os desenhos (SVG) de docs/diagramas/ a partir dos blocos Mermaid de docs/DIAGRAMAS.md, que é a FONTE da verdade.
// Os SVG são artefatos gerados: não edite à mão; mude o diagrama no documento e rode `npm run diagramas`.
//
// Requisitos: o Chromium do Playwright (npx playwright install chromium; já usado nos testes e2e) e o mermaid-cli,
// baixado sob demanda pelo npx (não é dependência do projeto). Para usar uma cópia local do mmdc: MMDC=caminho\mmdc.
//
// Uso: node scripts/gerar-diagramas.mjs [--verificar]
//   --verificar  não grava nada: só confere se a lista de nomes abaixo bate com os blocos do documento.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

/** Um nome de arquivo por bloco Mermaid, na ordem em que aparecem em docs/DIAGRAMAS.md. */
export const NOMES = [
  '00-legenda',
  'D01-contexto',
  'D02-conteineres',
  'D03-implantacao',
  'D04-componentes',
  'D05-jornada-do-usuario',
  'D06-perfis-e-permissoes',
  'D07-cadastro',
  'D08-edicao-concorrente',
  'D09-regras-de-validacao',
  'D10a-estados-do-registro',
  'D10b-status-de-negocio',
  'D11-consulta-de-cnpj',
  'D12-carga-da-planilha',
  'D13-planner',
  'D14a-email-sequencia',
  'D14b-email-decisao',
  'D15-backup-e-resiliencia',
  'D16-cicd-e-testes',
  'D17-fluxo-de-dados-stride',
  'D18-papeis-do-banco',
  'D19-modelo-de-dados',
]

const doc = readFileSync('docs/DIAGRAMAS.md', 'utf8')
const blocos = [...doc.matchAll(/```mermaid\r?\n/g)].length
if (blocos !== NOMES.length) {
  console.error(`docs/DIAGRAMAS.md tem ${blocos} blocos Mermaid, mas a lista NOMES tem ${NOMES.length}. Atualize a lista em scripts/gerar-diagramas.mjs.`)
  process.exit(1)
}
if (process.argv.includes('--verificar')) {
  console.log(`ok: ${blocos} blocos, ${NOMES.length} nomes`)
  process.exit(0)
}

const tmp = mkdtempSync(join(tmpdir(), 'radar-diagramas-'))
try {
  const config = join(tmp, 'puppeteer.json')
  writeFileSync(config, JSON.stringify({ executablePath: chromium.executablePath(), args: ['--no-sandbox'] }))
  const entrada = join(tmp, 'diagramas.md')
  writeFileSync(entrada, doc)

  const mmdc = process.env.MMDC
  const args = ['-i', entrada, '-o', join(tmp, 'saida.md'), '-e', 'svg', '-p', config, '-q']
  if (mmdc) execFileSync(mmdc, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  else execFileSync('npx', ['--yes', '@mermaid-js/mermaid-cli@11', ...args], { stdio: 'inherit', shell: process.platform === 'win32' })

  const gerados = readdirSync(tmp)
    .filter((f) => /^saida-\d+\.svg$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)) - Number(b.match(/\d+/)))
  if (gerados.length !== NOMES.length) throw new Error(`O mermaid-cli gerou ${gerados.length} SVG, esperados ${NOMES.length}.`)

  mkdirSync('docs/diagramas', { recursive: true })
  gerados.forEach((arquivo, i) => {
    const svg = readFileSync(join(tmp, arquivo), 'utf8')
    if (!svg.trimStart().startsWith('<svg') && !svg.trimStart().startsWith('<?xml')) throw new Error(`${arquivo} não é um SVG.`)
    writeFileSync(join('docs/diagramas', `${NOMES[i]}.svg`), svg)
  })
  console.log(`${gerados.length} SVG gravados em docs/diagramas/`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
