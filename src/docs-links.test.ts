/**
 * Integridade dos links da documentação: todo link relativo aponta para um arquivo que existe e, quando traz
 * âncora (#titulo), para um título que existe no arquivo de destino (regra de âncoras do GitHub).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'

const ancora = (titulo: string) =>
  titulo
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')

const markdowns = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && (f === 'README.md' || f.startsWith('docs/') || f === 'planner-auto/README.md') && existsSync(f))

const ancorasDe = (arquivo: string) => {
  const texto = readFileSync(arquivo, 'utf8').replace(/```[\s\S]*?```/g, '')
  return new Set([...texto.matchAll(/^#{1,6} (.+)$/gm)].map((m) => ancora(m[1].trim())))
}

describe('links da documentação', () => {
  it.each(markdowns)('%s: links relativos e âncoras existem', (arquivo) => {
    const texto = readFileSync(arquivo, 'utf8').replace(/```[\s\S]*?```/g, '')
    const quebrados: string[] = []
    for (const m of texto.matchAll(/\]\((?!https?:|mailto:)([^)\s]*)\)/g)) {
      const [caminho, ancoraDoLink] = m[1].split('#')
      const destino = caminho ? normalize(join(dirname(arquivo), caminho)) : arquivo
      if (!existsSync(destino)) {
        quebrados.push(`${m[1]} (arquivo não existe)`)
        continue
      }
      if (ancoraDoLink && destino.endsWith('.md') && !ancorasDe(destino).has(decodeURIComponent(ancoraDoLink).toLowerCase())) quebrados.push(`${m[1]} (título não existe)`)
    }
    expect(quebrados).toEqual([])
  })
})
