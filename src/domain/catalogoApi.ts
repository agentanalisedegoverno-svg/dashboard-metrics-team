/**
 * Catálogo dos campos da API externa, gerado do formulário (`src/features/oportunidades/campos.ts`), e a especificação OpenAPI.
 * Fica em `src/domain` porque é usado pelo servidor (functions/) e pela tela de documentação da API (Administração → API).
 * Mudou um campo do formulário? Atualize `docs/API-EXTERNA.md` (um teste falha se faltar) e regenere `docs/api-externa.openapi.json`.
 */
import { CAMPO_LISTA } from './oportunidade.ts'
import { SECOES, type Campo } from '../features/oportunidades/campos.ts'

const FORMATO: Record<Campo['tipo'], string> = {
  texto: 'texto',
  longo: 'texto (pode ter várias linhas)',
  data: 'data no formato AAAA-MM-DD',
  hora: 'hora HH:MM (horário de Brasília)',
  dinheiro: 'número em reais, com ponto decimal (ex.: 1234.56)',
  percentual: 'fração (0.185 = 18,5%)',
  inteiro: 'número inteiro',
  lista: 'texto: um dos valores da lista indicada',
  preVendas: 'texto: nome(s) de pré-vendas ativos, separados por vírgula',
  bool: 'true ou false',
  cnpj: '14 dígitos (com ou sem máscara); razão social e matriz/filial vêm da Receita',
  link: 'link que começa com https:// (sem espaços, até 2000 caracteres)',
  segmento: 'texto: Corporate ou Público (aceita também sem acento e em minúsculas)',
}

export type CampoApi = {
  nome: string
  rotulo: string
  secao: string
  tipo: Campo['tipo']
  formato: string
  obrigatorio: boolean
  /** Obrigatório a menos que outro campo esteja informado (a torre é calculada pela linha de serviço). */
  obrigatorio_se_ausente?: string
  /** Campo que só faz sentido para estes status (o formulário só o mostra neles). */
  quando_status?: readonly string[]
  /** Obrigatório quando o status for um destes (regra do banco). */
  obrigatorio_se_status?: readonly string[]
  lista?: string
  valores?: string[]
  dica?: string
}

/** Campos que o banco exige conforme o status (mesmas regras do cadastro manual). */
const EXIGIDO_POR_STATUS: Record<string, readonly string[]> = { motivo_no_go: ['No Go'], detalhe_no_go: ['No Go'], motivo_lost: ['Lost'], valor_ctc: ['Win'] }

/** Catálogo dos campos aceitos, na ordem do formulário. `listas` traz as opções ativas (por nome de lista) para os campos do tipo lista. */
export function catalogoCampos(listas: Record<string, { valor: string; ativo: boolean }[]> = {}): CampoApi[] {
  return SECOES.flatMap((s) =>
    s.campos.map((c): CampoApi => {
      const lista = c.tipo === 'lista' ? (CAMPO_LISTA as Record<string, string>)[c.nome] : undefined
      return {
        nome: c.nome,
        rotulo: c.rotulo,
        secao: s.titulo,
        tipo: c.tipo,
        formato: FORMATO[c.tipo],
        obrigatorio: Boolean(c.obrigatorio) && !c.calculado,
        ...(c.calculado && c.obrigatorio ? { obrigatorio_se_ausente: 'linha_servico' } : {}),
        ...(c.quando ? { quando_status: c.quando } : {}),
        ...(EXIGIDO_POR_STATUS[c.nome] ? { obrigatorio_se_status: EXIGIDO_POR_STATUS[c.nome] } : {}),
        ...(lista ? { lista, valores: (listas[lista] ?? []).filter((o) => o.ativo).map((o) => o.valor) } : {}),
        ...(c.dica ? { dica: c.dica } : {}),
      }
    }),
  )
}

/** Regras que valem além do formato (as mesmas do cadastro manual; o banco é quem as impõe). */
export const REGRAS = [
  'status, orgao, descritivo e data_pregao_dt são obrigatórios; a torre é calculada pela linha_servico (informe torre só se não enviar linha_servico).',
  'Se status for "No Go", informe motivo_no_go e detalhe_no_go (a descrição); se for "Lost", motivo_lost; se for "Win", valor_ctc.',
  'data_pregao_dt não pode ser anterior a data_distribuicao.',
  'Campos de lista só aceitam valores cadastrados e ativos (veja "valores" em GET /api/externo/campos).',
  'analista aceita só pré-vendas ativos cadastrados (vários, separados por vírgula).',
  'Valores monetários não podem ser negativos; orcamento_sigiloso=true esconde o orçamento no e-mail e no Planner.',
] as const

/**
 * OpenAPI 3.0 SÓ DE LEITURA (docs/api-leitura.openapi.json), para importar em um GPT personalizado (Actions) ou em qualquer ferramenta
 * que deva apenas consultar: sem o POST, com `operationId` e descrições curtas (o GPT limita o texto de cada operação).
 */
export function openApiLeitura(catalogo: CampoApi[]) {
  const base = openApi(catalogo)
  const lista = base.paths['/oportunidades'].get
  return {
    openapi: base.openapi,
    info: { title: 'Radar Pré-Vendas: consulta de oportunidades', version: base.info.version, description: 'Somente leitura. Exige chave de LEITURA (Bearer rdr_...).' },
    servers: base.servers,
    security: base.security,
    components: { securitySchemes: base.components.securitySchemes, schemas: { Erro: base.components.schemas.Erro } },
    paths: {
      '/oportunidades': {
        get: { ...lista, operationId: 'listarOportunidades', summary: 'Lista oportunidades (todos os campos, paginado)', description: 'Filtros por texto, status, torre, UF, órgão, valor e período. Use proximo_offset para a próxima página.' },
      },
      '/oportunidades/{codigo}': {
        get: { ...base.paths['/oportunidades/{codigo}'].get, operationId: 'verOportunidade', summary: 'Uma oportunidade pelo código AAAA-NNNN ou id', description: 'Devolve a oportunidade com todos os campos.' },
      },
      '/campos': {
        get: { ...base.paths['/campos'].get, operationId: 'listarCampos', summary: 'Campos e valores válidos dos filtros', description: 'Catálogo de campos e listas válidas (status, torre, UF, linha de serviço).' },
      },
    },
  }
}

/** Esquema OpenAPI 3.0 da API externa, gerado do catálogo (docs/api-externa.openapi.json; um teste confere que está em dia). */
export function openApi(catalogo: CampoApi[]) {
  const tipoJson = (c: CampoApi): Record<string, unknown> => {
    const base: Record<string, unknown> = { description: [c.rotulo, c.dica, c.formato].filter(Boolean).join('. ') }
    switch (c.tipo) {
      case 'data': return { ...base, type: 'string', format: 'date', example: '2026-12-10' }
      case 'hora': return { ...base, type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', example: '10:00' }
      case 'dinheiro': return { ...base, type: 'number', minimum: 0, example: 1234.56 }
      case 'percentual': return { ...base, type: 'number', example: 0.185 }
      case 'inteiro': return { ...base, type: 'integer' }
      case 'bool': return { ...base, type: 'boolean' }
      case 'cnpj': return { ...base, type: 'string', example: '00000000000191' }
      default: return { ...base, type: 'string' }
    }
  }
  const erro = { type: 'object', properties: { error: { type: 'string' }, erros: { type: 'array', items: { type: 'object', properties: { campo: { type: 'string' }, mensagem: { type: 'string' } } } } } }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Radar Pré-Vendas: API externa',
      version: '1.0.0',
      description: 'Chave de leitura: consulta as oportunidades, só para visualização. Chave de escrita: cria oportunidades no Radar como o cadastro manual (e-mail e cartão no Planner seguem o fluxo normal). Autenticação por chave de API (Bearer rdr_...). Texto completo: docs/API-EXTERNA.md.',
    },
    servers: [{ url: 'https://radar-prevendas.pages.dev/api/externo' }],
    security: [{ chaveApi: [] }],
    components: {
      securitySchemes: { chaveApi: { type: 'http', scheme: 'bearer', description: 'Chave rdr_... criada em Administração → API (alternativa: cabeçalho x-api-key).' } },
      schemas: {
        Oportunidade: {
          type: 'object',
          required: catalogo.filter((c) => c.obrigatorio).map((c) => c.nome),
          properties: {
            ...Object.fromEntries(catalogo.map((c) => [c.nome, tipoJson(c)])),
            solicitante: { type: 'string', maxLength: 120, description: 'Quem pediu a criação na aplicação externa (opcional).' },
          },
        },
        Erro: erro,
      },
    },
    paths: {
      '/oportunidades': {
        get: {
          summary: 'Lista as oportunidades (só leitura; exige chave de LEITURA)',
          description: 'Todos os campos de cada oportunidade, ordenados por id e paginados. Parâmetros desconhecidos ou inválidos são recusados com 422. Arquivadas ficam de fora, salvo arquivadas=true.',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Busca em código, sigla, órgão, processo, descritivo, objeto, UASG, pré-vendas e linha de serviço.' },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'torre', in: 'query', schema: { type: 'string' } },
            { name: 'uf', in: 'query', schema: { type: 'string', maxLength: 2 } },
            { name: 'linha_servico', in: 'query', schema: { type: 'string' } },
            { name: 'segmento', in: 'query', schema: { type: 'string', enum: ['Corporate', 'Público'] } },
            { name: 'analista', in: 'query', schema: { type: 'string' }, description: 'Contém o nome informado.' },
            { name: 'orgao', in: 'query', schema: { type: 'string' }, description: 'Contém o texto informado.' },
            { name: 'pregao_de', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'pregao_ate', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'valor_min', in: 'query', schema: { type: 'number' }, description: 'Orçamento mínimo em reais, com ponto decimal. Sem orçamento (ou sigiloso) não entra quando há faixa.' },
            { name: 'valor_max', in: 'query', schema: { type: 'number' } },
            { name: 'atualizado_desde', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Para sincronizar só o que mudou.' },
            { name: 'arquivadas', in: 'query', schema: { type: 'boolean' } },
            { name: 'limite', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          ],
          responses: {
            '200': { description: '{ total, limite, offset, proximo_offset (null no fim), itens: [oportunidade com todos os campos] }' },
            '401': { description: 'Chave ausente, inválida ou revogada.' },
            '403': { description: 'A chave é de escrita: use uma chave de leitura.' },
            '422': { description: 'Parâmetros inválidos (lista "erros" com campo e mensagem).', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
          },
        },
        post: {
          summary: 'Cria uma oportunidade',
          parameters: [
            { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', minLength: 1, maxLength: 100 }, description: 'Repetir com a mesma chave devolve a oportunidade já criada, sem duplicar.' },
            { name: 'simular', in: 'query', required: false, schema: { type: 'boolean' }, description: 'true: só valida e devolve como ficaria (campo "simulado": true e "previa" do e-mail e do cartão do Planner). NÃO grava, não envia e-mail e não cria cartão.' },
          ],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Oportunidade' } } } },
          responses: {
            '201': { description: 'Criada (o corpo é a oportunidade, com id, codigo AAAA-NNNN, versao, criado_por, solicitante e avisos).' },
            '200': { description: 'Repetição com a mesma Idempotency-Key ("idempotente": true) ou simulação com ?simular=true ("simulado": true e "previa").' },
            '400': { description: 'Corpo que não é um objeto JSON.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
            '401': { description: 'Chave ausente, inválida ou revogada.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
            '413': { description: 'Corpo acima de 64 KB.' },
            '422': { description: 'Dados inválidos (lista "erros" com campo e mensagem).', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
          },
        },
      },
      '/oportunidades/{codigo}': {
        get: {
          summary: 'Uma oportunidade pelo código (AAAA-NNNN) ou id (só leitura; exige chave de LEITURA)',
          parameters: [{ name: 'codigo', in: 'path', required: true, schema: { type: 'string' }, example: '2026-0001' }],
          responses: {
            '200': { description: 'A oportunidade com todos os campos.' },
            '401': { description: 'Chave ausente, inválida ou revogada.' },
            '403': { description: 'A chave é de escrita: use uma chave de leitura.' },
            '404': { description: 'Oportunidade não encontrada.' },
          },
        },
      },
      '/campos': {
        get: {
          summary: 'Catálogo dos campos, listas válidas e regras',
          responses: { '200': { description: 'campos, extras e regras' }, '401': { description: 'Chave ausente, inválida ou revogada.' } },
        },
      },
    },
  }
}
