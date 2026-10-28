// Teste ponta a ponta da API externa de criação de oportunidades (contra o ambiente real).
//
// Uso (PowerShell):
//   $env:RADAR_API_CHAVE = Read-Host "Cole a chave"      # a chave nunca é impressa nem gravada
//   node scripts/teste-api-externa.mjs                    # roda tudo (CRIA UMA OPORTUNIDADE DE TESTE)
//   node scripts/teste-api-externa.mjs --sem-criar        # só leitura: chave, catálogo e validações (não cria nada)
//
// Variáveis: RADAR_API_CHAVE (obrigatória), RADAR_URL (padrão https://radar-prevendas.pages.dev).
// ATENÇÃO: sem --sem-criar, cria uma oportunidade REAL (órgão "TESTE API (pode apagar)"): dispara e-mail e cartão no Planner.
// Avise o time antes. Depois, arquive a oportunidade no Radar e apague o cartão do Planner (o script lembra no final).

const URL_BASE = (process.env.RADAR_URL || 'https://radar-prevendas.pages.dev').replace(/\/$/, '')
const CHAVE = process.env.RADAR_API_CHAVE || ''
const SO_LEITURA = process.argv.includes('--sem-criar')

if (!/^rdr_[A-Za-z0-9_-]{20,80}$/.test(CHAVE)) {
  console.error('Defina RADAR_API_CHAVE com a chave da aplicação (formato rdr_...). Ex.: $env:RADAR_API_CHAVE = Read-Host "Cole a chave"')
  process.exit(2)
}

let falhas = 0
const ok = (nome, cond, detalhe = '') => {
  if (!cond) falhas++
  console.log(`${cond ? '  OK ' : ' FALHA'}  ${nome}${!cond && detalhe ? `\n         ${detalhe}` : ''}`)
}

async function chamar(caminho, { metodo = 'GET', corpo, cabecalhos = {}, comChave = true } = {}) {
  const res = await fetch(`${URL_BASE}/api/externo${caminho}`, {
    method: metodo,
    redirect: 'manual',
    headers: { accept: 'application/json', ...(comChave ? { authorization: `Bearer ${CHAVE}` } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}), ...cabecalhos },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* corpo vazio ou não JSON */
  }
  return { status: res.status, json }
}

console.log(`\nAPI externa do Radar: ${URL_BASE}${SO_LEITURA ? '  (somente leitura)' : '  (vai criar 1 oportunidade de teste)'}\n`)

// 1. Segurança básica
console.log('1. Segurança')
const semChave = await chamar('/campos', { comChave: false })
ok('sem chave -> 401 (se aparecer 302, falta o Bypass do Cloudflare Access em /api/externo/*)', semChave.status === 401, `HTTP ${semChave.status}`)
const chaveRuim = await fetch(`${URL_BASE}/api/externo/campos`, { redirect: 'manual', headers: { authorization: `Bearer rdr_${'B'.repeat(43)}` } })
ok('chave inexistente -> 401', chaveRuim.status === 401, `HTTP ${chaveRuim.status}`)

// 2. Catálogo
console.log('\n2. Catálogo de campos (a chave informada funciona?)')
const campos = await chamar('/campos')
ok('chave válida -> 200', campos.status === 200, `HTTP ${campos.status} ${JSON.stringify(campos.json)}`)
if (campos.status === 401) {
  console.error('\nA chave foi RECUSADA (401). Confira se foi copiada inteira, sem espaços, e se não foi revogada em Administração -> API. Nada mais foi testado.')
  process.exit(1)
}
const lista = campos.json?.campos ?? []
ok('catálogo traz os campos do formulário', lista.length >= 30, `${lista.length} campos`)
const obrigatorios = lista.filter((c) => c.obrigatorio).map((c) => c.nome)
console.log(`         obrigatórios: ${obrigatorios.join(', ')}`)
const status = lista.find((c) => c.nome === 'status')
ok('lista de status vem do banco (inclui Prospect)', Array.isArray(status?.valores) && status.valores.includes('Prospect'), JSON.stringify(status?.valores))

// 3. Validação
console.log('\n3. Validação (não grava nada)')
const invalido = await chamar('/oportunidades', { metodo: 'POST', corpo: { status: 'Prospect' } })
ok('sem os obrigatórios -> 422 com a lista de erros', invalido.status === 422 && Array.isArray(invalido.json?.erros) && invalido.json.erros.length > 0, `HTTP ${invalido.status} ${JSON.stringify(invalido.json)}`)
const naoObjeto = await chamar('/oportunidades', { metodo: 'POST', corpo: [] })
ok('corpo que não é objeto -> 400', naoObjeto.status === 400, `HTTP ${naoObjeto.status}`)
const listaErrada = await chamar('/oportunidades', { metodo: 'POST', corpo: { status: 'Inventado', orgao: 'TESTE', descritivo: 'x', torre: 'ITS', data_pregao_dt: '2099-12-31' } })
ok('valor fora da lista -> 422 apontando o campo status', listaErrada.status === 422 && JSON.stringify(listaErrada.json).includes('status'), `HTTP ${listaErrada.status}`)

if (SO_LEITURA) {
  console.log('\nModo somente leitura: nada foi criado.')
} else {
  // 4. Criação + idempotência
  console.log('\n4. Criação e idempotência (CRIA uma oportunidade real)')
  const idem = `teste-${Date.now()}`
  const dados = {
    solicitante: 'Teste da integração',
    status: 'Prospect',
    orgao: 'TESTE API (pode apagar)',
    descritivo: 'Teste da API externa',
    data_pregao_dt: '2099-12-31',
    torre: 'ITS',
    observacoes: 'Criada pelo scripts/teste-api-externa.mjs. Pode arquivar.',
  }
  const a = await chamar('/oportunidades', { metodo: 'POST', corpo: dados, cabecalhos: { 'idempotency-key': idem } })
  ok('criação -> 201', a.status === 201, `HTTP ${a.status} ${JSON.stringify(a.json)}`)
  ok('código AAAA-NNNN gerado', /^\d{4}-\d{4}$/.test(String(a.json?.codigo)), String(a.json?.codigo))
  ok('autoria é a aplicação (api:<nome>)', String(a.json?.criado_por).startsWith('api:'), String(a.json?.criado_por))
  ok('solicitante gravado', a.json?.solicitante === 'Teste da integração', String(a.json?.solicitante))
  ok('entrou como cadastro da web (e-mail e Planner seguem o fluxo normal)', a.json?.fonte === 'web', String(a.json?.fonte))
  const b = await chamar('/oportunidades', { metodo: 'POST', corpo: dados, cabecalhos: { 'idempotency-key': idem } })
  ok('repetir com a mesma Idempotency-Key -> 200, idempotente, mesma oportunidade', b.status === 200 && b.json?.idempotente === true && b.json?.id === a.json?.id, `HTTP ${b.status} id ${b.json?.id} vs ${a.json?.id}`)
  console.log(`\n         Oportunidade criada: código ${a.json?.codigo} (id ${a.json?.id})`)
  console.log('\nO QUE CONFERIR AGORA (me avise que eu confiro no banco):')
  console.log(`  - O e-mail "Nova oportunidade" chegou (assunto com ${a.json?.codigo}) e mostra "Cadastrada por: api:..." e "Solicitante (via API)"`)
  console.log('  - Em até ~1 minuto surgiu o cartão no Planner (plano ITS, coluna PROSPECT)')
  console.log('  - Só UM e-mail e UM cartão (a repetição não duplicou)')
  console.log('\nLIMPEZA: no Radar, arquive a oportunidade de teste; no Planner, apague o cartão; revogue a chave de teste em Administração -> API.')
}

console.log(`\n${falhas === 0 ? 'RESULTADO: tudo certo.' : `RESULTADO: ${falhas} verificação(ões) falharam.`}\n`)
process.exit(falhas === 0 ? 0 : 1)
