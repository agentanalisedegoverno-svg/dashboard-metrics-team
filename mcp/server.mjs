#!/usr/bin/env node
// Servidor MCP SOMENTE LEITURA do Radar Pré-Vendas (transporte stdio). Só repassa consultas à API de leitura
// (docs/API-LEITURA.md) com uma chave de leitura; não tem acesso ao banco e não possui nenhuma ferramenta de escrita.
//
// Configuração (variáveis de ambiente): RADAR_API_KEY (obrigatória, chave de LEITURA) e RADAR_API_URL (opcional).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ErroRadar, LIMITE_MAXIMO, LIMITE_PADRAO, criarCliente, lerConfig, listarCampos, listarOportunidades, verOportunidade } from './lib.mjs'

let cliente
try {
  cliente = criarCliente(lerConfig(process.env))
} catch (e) {
  console.error(`radar-prevendas-mcp: ${e instanceof ErroRadar ? e.message : 'configuração inválida.'}`)
  process.exit(1)
}

const SOMENTE_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const texto = (dados) => ({ content: [{ type: 'text', text: JSON.stringify(dados, null, 2) }] })
const erro = (e) => ({ isError: true, content: [{ type: 'text', text: e instanceof ErroRadar ? e.message : 'Erro inesperado ao consultar o Radar.' }] })
const executar = (fn) => async (args) => {
  try {
    return texto(await fn(args))
  } catch (e) {
    return erro(e)
  }
}

const servidor = new McpServer({ name: 'radar-prevendas', version: '1.0.0' })

servidor.registerTool(
  'listar_oportunidades',
  {
    title: 'Listar oportunidades',
    description:
      'Lista oportunidades do Radar Pré-Vendas (todos os campos de cada uma), com filtros e paginação. Somente leitura. ' +
      `Retorna no máximo ${LIMITE_MAXIMO} por chamada (padrão ${LIMITE_PADRAO}); use proximo_offset para a página seguinte. ` +
      'Sem filtros devolve as ativas (arquivadas ficam de fora). Use listar_campos para ver os valores válidos de status, torre, etc.',
    inputSchema: {
      q: z.string().max(100).optional().describe('Busca de texto em código, sigla, órgão, processo, descritivo, objeto, UASG, pré-vendas e linha de serviço'),
      status: z.string().max(60).optional().describe('Ex.: Go, Win, Prospect (sem diferenciar maiúsculas)'),
      torre: z.string().max(60).optional(),
      uf: z.string().length(2).optional().describe('Sigla do estado, ex.: DF'),
      linha_servico: z.string().max(100).optional(),
      segmento: z.enum(['Corporate', 'Público']).optional(),
      analista: z.string().max(100).optional().describe('Pré-vendas responsável (contém o nome)'),
      orgao: z.string().max(100).optional().describe('Órgão (contém o texto)'),
      pregao_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Data do pregão a partir de (AAAA-MM-DD)'),
      pregao_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Data do pregão até (AAAA-MM-DD)'),
      valor_min: z.number().nonnegative().optional().describe('Orçamento mínimo em reais; sem valor ou sigiloso não entra quando há faixa'),
      valor_max: z.number().nonnegative().optional().describe('Orçamento máximo em reais'),
      atualizado_desde: z.string().max(40).optional().describe('Só o que mudou desde essa data/hora ISO'),
      arquivadas: z.boolean().optional().describe('true para incluir as arquivadas'),
      limite: z.number().int().min(1).max(LIMITE_MAXIMO).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: SOMENTE_LEITURA,
  },
  executar((args) => listarOportunidades(cliente, args)),
)

servidor.registerTool(
  'ver_oportunidade',
  {
    title: 'Ver uma oportunidade',
    description: 'Mostra uma oportunidade com todos os campos, pelo código (AAAA-NNNN, ex.: 2026-0001) ou pelo id numérico. Somente leitura.',
    inputSchema: { codigo: z.string().min(1).max(20).describe('Código AAAA-NNNN ou id numérico') },
    annotations: SOMENTE_LEITURA,
  },
  executar((args) => verOportunidade(cliente, args)),
)

servidor.registerTool(
  'listar_campos',
  {
    title: 'Listar campos e valores válidos',
    description: 'Catálogo dos campos das oportunidades e as listas de valores válidos (status, torre, UF, linha de serviço etc.). Somente leitura.',
    inputSchema: {},
    annotations: SOMENTE_LEITURA,
  },
  executar(() => listarCampos(cliente)),
)

await servidor.connect(new StdioServerTransport())
console.error('radar-prevendas-mcp: pronto (somente leitura).')
