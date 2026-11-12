# API Compras.gov.br (Dados Abertos) — mapa dos endpoints

Mapa dos **77 endpoints** da API pública de dados abertos do Compras.gov.br, gerado a partir da especificação oficial (OpenAPI) em 12/11/2026. Serve de referência para decidir o que o Radar pode consumir além do que já usa.

- **Base:** `https://dadosabertos.compras.gov.br`
- **Especificação:** `https://dadosabertos.compras.gov.br/v3/api-docs` (título "API Compras.gov.br", versão 1.0.0).
- **Acesso:** 70 endpoints são de consulta aberta (sem chave). Os outros 7 exigem token (`bearerAuth`): os 4 de usuários e os 3 do ALICE, marcados com 🔒. Nenhum deles serve ao Radar hoje.
- **Paginação:** as listagens aceitam `pagina` (a partir de 1) e `tamanhoPagina` (de 10 a 500, padrão 10). Esses dois filtros foram omitidos das tabelas para ficarem curtas.
- **Filtros:** "obrigatórios" e "opcionais" são parâmetros de consulta (query string). Datas no formato `AAAA-MM-DD`.
- Retrato de 12/11/2026: a API pode mudar. Reconferir a especificação antes de depender de um endpoint novo.

## O que o Radar já usa

Apenas 3 endpoints, por meio do proxy `functions/api/pncp/[[path]].ts` (lista de permissão `COMPRAS_ALLOWED`), no bloco "Fontes públicas" da aba Monitoramento das oportunidades:

| Endpoint | Uso no Radar |
|---|---|
| `/modulo-legado/1_consultarLicitacao` | Licitações do módulo legado |
| `/modulo-legado/3_consultarPregoes` | Pregões do módulo legado |
| `/modulo-contratacoes/1_consultarContratacoes_PNCP_14133` | Contratações da Lei 14.133 (cruzamento "No Radar") |

## O que **não** existe nesta API

Conferido na especificação: **nenhum endpoint ou campo trata de esclarecimento, impugnação ou questionamento** de certame. Esse conteúdo acontece no portal/chat do pregão e não é publicado de forma estruturada aqui. O PNCP também não tem (conferido em 12/11/2026: nenhum dos 41 tipos de documento é esclarecimento ou impugnação). Ver "Diligências e esclarecimentos dos certames" em [ROADMAP.md](ROADMAP.md).

## Resumo por grupo

| Grupo | Endpoints | O que traz |
|---|---:|---|
| 01 - CATÁLOGO - MATERIAL | 7 | Catálogo de materiais (CATMAT): grupos, classes, PDM e itens. |
| 02 - CATÁLOGO - SERVIÇO | 8 | Catálogo de serviços (CATSER): seções, divisões, grupos, classes e itens. |
| 03 - PESQUISA DE PREÇO - PREÇOS PRATICADOS | 8 | Preços praticados em compras (material e serviço), úteis como referência de precificação. |
| 04 - PGC | 6 | Plano de Contratações Anual (PGC): o que os órgãos planejam contratar. |
| 05 - UASG | 4 | Cadastro de UASGs e órgãos. |
| 06 - LEGADO | 13 | Módulo legado (Lei 8.666/Siasg): licitações, pregões, itens, compras sem licitação e RDC. |
| 07 - CONTRATAÇÕES | 6 | Contratações da Lei 14.133 publicadas no PNCP, com itens e resultados. |
| 08 - ARP | 8 | Atas de registro de preços e seus itens. |
| 09 - CONTRATOS | 5 | Contratos e seus itens. |
| 10 - FORNECEDOR | 1 | Cadastro de fornecedores. |
| 11 - OCDS | 1 | Dados no padrão Open Contracting. |
| 97 - INDICADORES | 2 | Indicadores agregados. |
| 98 - ALICE | 3 | Alertas de risco em licitações (ALICE). **Exigem token**: não servem ao Radar sem credencial. |
| 99 - USUARIOS | 4 | Gestão de usuários da API. **Exigem token**; não servem ao Radar. |
| AUTENTICACAO | 1 | Emissão do token de acesso da API. |
| **Total** | **77** | |

## 01 - CATÁLOGO - MATERIAL (7)

Catálogo de materiais (CATMAT): grupos, classes, PDM e itens.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-material/7_consultarMaterialCaracteristicas` | — | `codigoItem` |  |
| GET | `/modulo-material/6_consultarMaterialUnidadeFornecimento` | — | `codigoPdm`, `statusUnidadeFornecimentoPdm` |  |
| GET | `/modulo-material/5_consultarMaterialNaturezaDespesa` | — | `codigoPdm`, `codigoNaturezaDespesa`, `statusNaturezaDespesa` |  |
| GET | `/modulo-material/4_consultarItemMaterial` | — | `codigoItem`, `codigoGrupo`, `codigoClasse`, `codigoPdm`, `descricaoItem`, `statusItem`, `bps`, `codigo_ncm` |  |
| GET | `/modulo-material/3_consultarPdmMaterial` | — | `statusPdm`, `codigoPdm`, `codigoGrupo`, `codigoClasse`, `bps` |  |
| GET | `/modulo-material/2_consultarClasseMaterial` | — | `codigoGrupo`, `codigoClasse`, `statusClasse`, `bps` |  |
| GET | `/modulo-material/1_consultarGrupoMaterial` | — | `codigoGrupo`, `statusGrupo` |  |

## 02 - CATÁLOGO - SERVIÇO (8)

Catálogo de serviços (CATSER): seções, divisões, grupos, classes e itens.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-servico/8_consultarNaturezaDespesaServico` | — | `codigoServico`, `codigoNaturezaDespesa`, `statusNaturezaDespesa` |  |
| GET | `/modulo-servico/7_consultarUndMedidaServico` | — | `codigoServico`, `statusUnidadeMedida` |  |
| GET | `/modulo-servico/6_consultarItemServico` | — | `codigoSecao`, `codigoDivisao`, `codigoGrupo`, `codigoClasse`, `codigoSubclasse`, `codigoCpc`, `codigoServico`, `exclusivoCentralCompras`, `statusServico` |  |
| GET | `/modulo-servico/5_consultarSubClasseServico` | — | `codigoClasse`, `codigoSubclasse`, `statusSubclasse` |  |
| GET | `/modulo-servico/4_consultarClasseServico` | — | `codigoGrupo`, `codigoClasse`, `statusGrupo` |  |
| GET | `/modulo-servico/3_consultarGrupoServico` | — | `codigoDivisao`, `codigoGrupo`, `statusGrupo` |  |
| GET | `/modulo-servico/2_consultarDivisaoServico` | — | `codigoSecao`, `codigoDivisao`, `statusDivisao` |  |
| GET | `/modulo-servico/1_consultarSecaoServico` | — | `codigoSecao`, `statusSecao` |  |

## 03 - PESQUISA DE PREÇO - PREÇOS PRATICADOS (8)

Preços praticados em compras (material e serviço), úteis como referência de precificação.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-pesquisa-preco/4_consultarServicoDetalhe` | `codigoItemCatalogo` | `dataCompraInicio`, `dataCompraFim` |  |
| GET | `/modulo-pesquisa-preco/4.1_consultarServicoDetalhe_CSV` | — | `codigoItemCatalogo`, `dataCompraInicio`, `dataCompraFim` |  |
| GET | `/modulo-pesquisa-preco/3_consultarServico` | `codigoItemCatalogo` | `codigoUasg`, `estado`, `codigoMunicipio`, `dataResultado`, `poder`, `esfera`, `dataCompraInicio`, `dataCompraFim`, `idCompra` |  |
| GET | `/modulo-pesquisa-preco/3.1_consultarServico_CSV` | `codigoItemCatalogo` | `codigoUasg`, `estado`, `codigoMunicipio`, `dataResultado`, `poder`, `esfera`, `dataCompraInicio`, `dataCompraFim`, `idCompra` |  |
| GET | `/modulo-pesquisa-preco/2_consultarMaterialDetalhe` | `codigoItemCatalogo` | `dataCompraInicio`, `dataCompraFim` |  |
| GET | `/modulo-pesquisa-preco/2.1_consultarMaterialDetalhe_CSV` | — | `codigoItemCatalogo`, `dataCompraInicio`, `dataCompraFim` |  |
| GET | `/modulo-pesquisa-preco/1_consultarMaterial` | `tipo`, `codigo` | `codigoUasg`, `estado`, `codigoMunicipio`, `dataResultado`, `codigoClasse`, `poder`, `esfera`, `idCompra`, `dataCompraInicio`, `dataCompraFim` |  |
| GET | `/modulo-pesquisa-preco/1.1_consultarMaterial_CSV` | `tipo`, `codigo` | `codigoUasg`, `estado`, `codigoMunicipio`, `dataResultado`, `codigoClasse`, `poder`, `esfera`, `idCompra`, `dataCompraInicio`, `dataCompraFim` |  |

## 04 - PGC (6)

Plano de Contratações Anual (PGC): o que os órgãos planejam contratar.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-pgc/3_consultarPgcAgregacao` | `orgao`, `ano` | — |  |
| GET | `/modulo-pgc/3.1_consultarPgcAgregacao_CSV` | `orgao`, `ano` | — |  |
| GET | `/modulo-pgc/2_consultarPgcDetalheCatalogo` | `anoPcaProjetoCompra`, `tipo`, `codigo` | — |  |
| GET | `/modulo-pgc/2.1_consultarPgcDetalheCatalogo_CSV` | `anoPcaProjetoCompra`, `tipo`, `codigo` | — |  |
| GET | `/modulo-pgc/1_consultarPgcDetalhe` | `orgao`, `anoPcaProjetoCompra` | `codigoUasg` |  |
| GET | `/modulo-pgc/1.1_consultarPgcDetalhe_CSV` | `orgao`, `anoPcaProjetoCompra` | `codigoUasg` |  |

## 05 - UASG (4)

Cadastro de UASGs e órgãos.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-uasg/2_consultarOrgao` | `statusOrgao` | `cnpjCpfOrgao`, `cnpjCpfOrgaoVinculado`, `cnpjCpfOrgaoSuperior`, `codigoOrgao`, `usoSisg` |  |
| GET | `/modulo-uasg/2.1_consultarOrgao_CSV` | `statusOrgao` | `cnpjCpfOrgao`, `cnpjCpfOrgaoVinculado`, `cnpjCpfOrgaoSuperior`, `codigoOrgao`, `usoSisg` |  |
| GET | `/modulo-uasg/1_consultarUasg` | `statusUasg` | `codigoUasg`, `usoSisg`, `cnpjCpfOrgao`, `cnpjCpfOrgaoVinculado`, `cnpjCpfOrgaoSuperior`, `siglaUf` |  |
| GET | `/modulo-uasg/1.1_consultarUasg_CSV` | `statusUasg` | `codigoUasg`, `usoSisg`, `cnpjCpfOrgao`, `cnpjCpfOrgaoVinculado`, `cnpjCpfOrgaoSuperior`, `siglaUf` |  |

## 06 - LEGADO (13)

Módulo legado (Lei 8.666/Siasg): licitações, pregões, itens, compras sem licitação e RDC.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-legado/7_consultarRdc` | `data_publicacao_min`, `data_publicacao_max` | `endereco_entrega_edital`, `forma_de_realizacao`, `funcao_responsavel`, `modalidade`, `nome_responsavel`, `numero_aviso`, `objeto`, `orgao`, `situacao_aviso`, `uasg`, `uf_uasg`, `valor_estimado_total_max`, `valor_estimado_total_min`, `valor_homologado_total_max`, `valor_homologado_total_min` |  |
| GET | `/modulo-legado/6_consultarCompraItensSemLicitacao` | `dt_ano_aviso_licitacao` | `co_uasg`, `co_orgao`, `co_modalidade_licitacao`, `co_conjunto_materiais`, `co_servico`, `nu_cpf_cnpj_fornecedor` |  |
| GET | `/modulo-legado/6.1_consultarItensComprasSemLicitacao_Id` | `id_compra` | `id_compra_item`, `dt_alteracao` |  |
| GET | `/modulo-legado/5_consultarComprasSemLicitacao` | `dt_ano_aviso` | `nu_aviso_licitacao`, `co_modalidade_licitacao`, `co_orgao`, `co_orgao_superior`, `co_uasg`, `dtDeclaracaoDispensaInicial`, `dtDeclaracaoDispensaFinal`, `dtRatificacao`, `dtPublicacao`, `pertence14133` |  |
| GET | `/modulo-legado/5.1_consultarCompraSemLicitacao_Id` | `idCompra` | — |  |
| GET | `/modulo-legado/4_consultarItensPregoes` | `dt_hom_inicial`, `dt_hom_final` | `co_uasg`, `decreto_7174`, `fornecedor_vencedor` |  |
| GET | `/modulo-legado/4.1_consultarItensPregoes_Id` | `id_compra` | `id_compra_item`, `dt_alteracao` |  |
| GET | `/modulo-legado/3_consultarPregoes` | `dt_data_edital_inicial`, `dt_data_edital_final` | `co_uasg`, `co_orgao`, `numero`, `ds_tipo_pregao_compra`, `pertence14133` | **em uso** |
| GET | `/modulo-legado/3.1_consultarPregoes_Id` | `id_compra` | `dt_alteracao` |  |
| GET | `/modulo-legado/2_consultarItemLicitacao` | `modalidade` | `uasg`, `numero_aviso`, `decreto_7174`, `codigo_item_material`, `codigo_item_servico`, `cnpj_fornecedor`, `cpfVencedor` |  |
| GET | `/modulo-legado/2.1_consultarItemLicitacao_Id` | `id_compra` | `id_compra_item`, `dt_alteracao` |  |
| GET | `/modulo-legado/1_consultarLicitacao` | `data_publicacao_inicial`, `data_publicacao_final` | `uasg`, `numero_aviso`, `modalidade`, `pertence14133` | **em uso** |
| GET | `/modulo-legado/1.1_consultarLicitacao_Id` | `id_compra` | `dt_alteracao` |  |

## 07 - CONTRATAÇÕES (6)

Contratações da Lei 14.133 publicadas no PNCP, com itens e resultados.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-contratacoes/3_consultarResultadoItensContratacoes_PNCP_14133` | `dataResultadoPncpInicial`, `dataResultadoPncpFinal` | `unidadeOrgaoCodigoUnidade`, `orgaoEntidadeCnpj`, `niFornecedor`, `codigoPais`, `porteFornecedorId`, `naturezaJuridicaId`, `situacaoCompraItemResultadoId`, `valorUnitarioHomologadoInicial`, `valorUnitarioHomologadoFinal`, `valorTotalHomologadoInicial`, `valorTotalHomologadoFinal`, `aplicacaoMargemPreferencia`, `aplicacaoBeneficioMeepp`, `aplicacaoCriterioDesempate` |  |
| GET | `/modulo-contratacoes/3.1_consultarResultadoItensContratacoes_PNCP_14133_Id` | `tipo`, `codigo` | `idCompraItem`, `dataAtualizacaoPncp` |  |
| GET | `/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133` | `dataInclusaoPncpInicial`, `dataInclusaoPncpFinal` | `unidadeOrgaoCodigoUnidade`, `orgaoEntidadeCnpj`, `situacaoCompraItem`, `materialOuServico`, `codigoClasse`, `codigoGrupo`, `codItemCatalogo`, `temResultado`, `codFornecedor`, `dataAtualizacaoPncp`, `bps`, `margemPreferenciaNormal`, `codigoNCM`, `codigoPdm` |  |
| GET | `/modulo-contratacoes/2.1_consultarItensContratacoes_PNCP_14133_Id` | `tipo`, `codigo` | `idCompraItem`, `dataAtualizacaoPncp` |  |
| GET | `/modulo-contratacoes/1_consultarContratacoes_PNCP_14133` | `dataPublicacaoPncpInicial`, `dataPublicacaoPncpFinal`, `codigoModalidade` | `unidadeOrgaoCodigoUnidade`, `codigoOrgao`, `orgaoEntidadeCnpj`, `unidadeOrgaoCodigoIbge`, `unidadeOrgaoUfSigla`, `dataAualizacaoPncp`, `amparoLegalCodigoPncp`, `contratacaoExcluida` | **em uso** |
| GET | `/modulo-contratacoes/1.1_consultarContratacoes_PNCP_14133_Id` | `tipo`, `codigo` | `dataAtualizacaoPncp` |  |

## 08 - ARP (8)

Atas de registro de preços e seus itens.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-arp/5_consultarAdesoesItem` | `numeroAta`, `unidadeGerenciadora`, `numeroItem` | `unidade`, `dataAtualizacao` |  |
| GET | `/modulo-arp/4_consultarEmpenhosSaldoItem` | `numeroAta`, `unidadeGerenciadora` | `dataAtualizacao` |  |
| GET | `/modulo-arp/3_consultarUnidadesItem` | `numeroAta`, `unidadeGerenciadora`, `numeroItem` | `dataAtualizacao` |  |
| GET | `/modulo-arp/2_consultarARPItem` | `dataVigenciaInicialMin`, `dataVigenciaInicialMax` | `codigoUnidadeGerenciadora`, `codigoModalidadeCompra`, `dataAssinaturaInicial`, `dataAssinaturaFinal`, `numeroItem`, `codigoItem`, `tipoItem`, `niFornecedor`, `codigoPdm`, `numeroCompra` |  |
| GET | `/modulo-arp/2.1_consultarARPItem_Id` | `numeroControlePncpAta` | `dataAtualizacao` |  |
| GET | `/modulo-arp/1_consultarARP` | `dataVigenciaInicialMin`, `dataVigenciaInicialMax` | `codigoUnidadeGerenciadora`, `codigoModalidadeCompra`, `numeroAtaRegistroPreco`, `dataAssinaturaInicial`, `dataAssinaturaFinal` |  |
| GET | `/modulo-arp/1.2_consultarARP_FimVigencia` | `dataVigenciaFinalMin`, `dataVigenciaFinalMax` | `codigoUnidadeGerenciadora`, `codigoModalidadeCompra`, `numeroAtaRegistroPreco`, `dataAssinaturaInicial`, `dataAssinaturaFinal` |  |
| GET | `/modulo-arp/1.1_consultarARP_Id` | `numeroControlePncpAta` | `dataAtualizacao` |  |

## 09 - CONTRATOS (5)

Contratos e seus itens.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-contratos/2_consultarContratosItem` | `codigoOrgao`, `dataVigenciaInicialMin`, `dataVigenciaInicialMax` | `codigoUnidadeGestora`, `codigoUnidadeGestoraOrigemContrato`, `codigoUnidadeRealizadoraCompra`, `numeroContrato`, `codigoModalidadeCompra`, `tipoItem`, `codigoItem`, `niFornecedor`, `poder`, `esfera`, `idCompra` |  |
| GET | `/modulo-contratos/2.1_consultarContratosItem_Id` | `tipo`, `codigo` | — |  |
| GET | `/modulo-contratos/1_consultarContratos` | `codigoOrgao`, `dataVigenciaInicialMin`, `dataVigenciaInicialMax` | `codigoUnidadeGestora`, `codigoUnidadeGestoraOrigemContrato`, `codigoUnidadeRealizadoraCompra`, `numeroContrato`, `codigoModalidadeCompra`, `codigoTipo`, `codigoCategoria`, `niFornecedor` |  |
| GET | `/modulo-contratos/1.2_consultarContratos_FimVigencia` | `codigoOrgao`, `dataVigenciaFinalMin`, `dataVigenciaFinalMax` | `codigoUnidadeGestora`, `codigoUnidadeGestoraOrigemContrato`, `codigoUnidadeRealizadoraCompra`, `numeroContrato`, `codigoModalidadeCompra`, `codigoTipo`, `codigoCategoria`, `niFornecedor` |  |
| GET | `/modulo-contratos/1.1_consultarContratos_Id` | `codigo`, `tipo` | — |  |

## 10 - FORNECEDOR (1)

Cadastro de fornecedores.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-fornecedor/1_consultarFornecedor` | `ativo` | `cnpj`, `cpf`, `naturezaJuridicaId`, `porteEmpresaId`, `codigoCnae` |  |

## 11 - OCDS (1)

Dados no padrão Open Contracting.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-ocds/1_releases` | `buyerID`, `releaseStartDate`, `releaseEndDate` | `page`, `offSet` |  |

## 97 - INDICADORES (2)

Indicadores agregados.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET | `/modulo-indicadores/2_consultarIndicadoresPorPeriodo` | `ano` | `mes` |  |
| GET | `/modulo-indicadores/1_consultarIndicadoresConsolidados` | — | — |  |

## 98 - ALICE (3)

Alertas de risco em licitações (ALICE). **Exigem token**: não servem ao Radar sem credencial.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| GET 🔒 | `/alice/tickets` | `tickets` | — |  |
| GET 🔒 | `/alice/compras` | `chavesCompra` | — |  |
| GET 🔒 | `/alice/avisos-restritos` | `dataInicioIntervalo`, `dataFimIntervalo` | — |  |

## 99 - USUARIOS (4)

Gestão de usuários da API. **Exigem token**; não servem ao Radar.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| POST 🔒 | `/usuarios/criar` | — | — |  |
| PATCH 🔒 | `/usuarios/resetSenha/{id}` | `id` | — |  |
| PATCH 🔒 | `/usuarios/atualizar/{id}` | `id` | — |  |
| GET 🔒 | `/usuarios/consultar` | — | `id` |  |

## AUTENTICACAO (1)

Emissão do token de acesso da API.

| Método | Caminho | Filtros obrigatórios | Filtros opcionais | Radar |
|---|---|---|---|---|
| POST | `/autenticacao/login` | — | — |  |

🔒 = exige token de autenticação.
