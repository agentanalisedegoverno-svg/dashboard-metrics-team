/**
 * Mantém o catálogo de diagramas (docs/DIAGRAMAS.md) íntegro: cada diagrama tem seu desenho em SVG, o SVG é válido,
 * o índice aponta para títulos que existem, os links relativos não estão quebrados e a sintaxe de sequência não
 * usa setas que o Mermaid não aceita. A sintaxe completa é validada ao gerar os SVG (`npm run diagramas`).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DOC = 'docs/DIAGRAMAS.md'
const doc = readFileSync(DOC, 'utf8')
const blocos = [...doc.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map((m) => m[1])

/** Âncora do GitHub para um título: minúsculas, sem pontuação (mantém letras, números, espaço e hífen), espaço vira hífen. */
const ancora = (titulo: string) =>
  titulo
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')

describe('catálogo de diagramas', () => {
  it('tem os 19 diagramas numerados (D1 a D19) com tipo, escopo e a pergunta que respondem', () => {
    const titulos = [...doc.matchAll(/^### (D\d+) · (.+)$/gm)]
    expect(titulos.map((t) => t[1])).toEqual(Array.from({ length: 19 }, (_, i) => `D${i + 1}`))
    const marcadores = [...doc.matchAll(/^\*Tipo: .+Pergunta.*\*$/gm)]
    expect(marcadores.length).toBeGreaterThanOrEqual(19)
  })

  it('cada bloco Mermaid tem o seu SVG em docs/diagramas, e vice-versa', () => {
    const svgs = readdirSync('docs/diagramas').filter((f) => f.endsWith('.svg'))
    expect(svgs.length).toBe(blocos.length)
    const nomes = readFileSync('scripts/gerar-diagramas.mjs', 'utf8').match(/export const NOMES = \[([\s\S]*?)\]/)![1].match(/'([^']+)'/g)!.map((n) => n.slice(1, -1))
    expect(nomes.length).toBe(blocos.length)
    expect(svgs.map((f) => f.replace(/\.svg$/, '')).sort()).toEqual([...nomes].sort())
  })

  it('todo SVG é um desenho válido (XML bem formado, com viewBox e texto)', () => {
    for (const f of readdirSync('docs/diagramas').filter((x) => x.endsWith('.svg'))) {
      const s = readFileSync(join('docs/diagramas', f), 'utf8')
      expect(s.trimStart().startsWith('<svg') || s.trimStart().startsWith('<?xml'), f).toBe(true)
      expect(s, f).toMatch(/viewBox="/)
      expect(s.trimEnd().endsWith('</svg>'), f).toBe(true)
      expect((s.match(/<svg\b/g) ?? []).length, `${f}: um único elemento raiz`).toBeGreaterThanOrEqual(1)
      expect(s.length, f).toBeGreaterThan(3000)
    }
  })

  it('o índice só aponta para títulos que existem', () => {
    const titulos = new Set([...doc.matchAll(/^#{2,3} (.+)$/gm)].map((m) => ancora(m[1])))
    const indice = [...doc.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1])
    expect(indice.length).toBeGreaterThanOrEqual(19)
    const quebradas = indice.filter((a) => !titulos.has(a))
    expect(quebradas).toEqual([])
  })

  it('links relativos para outros arquivos existem', () => {
    const quebrados: string[] = []
    for (const m of doc.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(#[^)]*)?\)/g)) {
      if (!existsSync(join(dirname(DOC), m[1]))) quebrados.push(m[1])
    }
    expect(quebrados).toEqual([])
  })

  it('diagramas de sequência não usam setas que o Mermaid não aceita (-.-> só vale em fluxogramas)', () => {
    for (const [i, b] of blocos.entries()) {
      if (b.trimStart().startsWith('sequenceDiagram')) expect(b, `bloco ${i}`).not.toMatch(/-\.->/)
    }
  })

  it('todo bloco declara o tipo de diagrama na primeira linha e não há ponto e vírgula solto em mensagens de sequência', () => {
    for (const [i, b] of blocos.entries()) {
      expect(b.trimStart().split(/\r?\n/)[0], `bloco ${i}`).toMatch(/^(flowchart (LR|TB)|sequenceDiagram|stateDiagram-v2|erDiagram)$/)
      if (b.trimStart().startsWith('sequenceDiagram')) {
        const comPontoEVirgula = b.split(/\r?\n/).filter((l) => /(->>|-->>)/.test(l) && /;/.test(l))
        expect(comPontoEVirgula, `bloco ${i}`).toEqual([])
      }
    }
  })
})
