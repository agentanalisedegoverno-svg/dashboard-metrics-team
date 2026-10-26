-- 013: campo Objeto (abaixo do Descritivo) e hora do pregão (data e hora).
--  - objeto: texto livre, até 5000 caracteres; hora_pregao: horário local de Brasília, sem fuso (time).
--  - Nenhum dos dois existe na planilha: ficam em branco nos registros importados e a carga por merge não os toca
--    (sincronizar_planilha não os lista). Nada muda para quem não preencher.
--  - data_pregao_dt continua sendo a data (código por ano, SLA, painel e planilha seguem iguais); a hora é um complemento opcional.
--  - O histórico (auditar) e a leitura (to_jsonb) enxergam as colunas sozinhos.

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS objeto text, ADD COLUMN IF NOT EXISTS hora_pregao time;;
DO $$ BEGIN
  ALTER TYPE oportunidade_campos ADD ATTRIBUTE objeto text, ADD ATTRIBUTE hora_pregao time;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;;

CREATE OR REPLACE FUNCTION validar_oportunidade(r oportunidade_campos, a oportunidades) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE
  j jsonb := to_jsonb(r); aj jsonb := coalesce(to_jsonb(a), '{}'::jsonb);
  erros jsonb := '[]'::jsonb; par record; obrig text;
BEGIN
  FOREACH obrig IN ARRAY ARRAY['status','data_pregao_dt','orgao','descritivo','torre'] LOOP
    IF j ->> obrig IS NULL OR btrim(j ->> obrig) = '' THEN
      erros := erros || jsonb_build_object('campo', obrig, 'mensagem', 'Campo obrigatório');
    END IF;
  END LOOP;
  FOR par IN SELECT * FROM (VALUES ('status','status'),('torre','torre'),('linha_servico','linha_servico'),('criterio','criterio'),('uf','uf'),
      ('modalidade','modalidade'),('modo_disputa','modo_disputa'),('origem_oportunidade','origem_oportunidade'),('site','site'),
      ('vistoria','vistoria'),('conta_vinculada','conta_vinculada'),('motivo_no_go','motivo_no_go'),('motivo_lost','motivo_lost'),
      ('situacao_lance','situacao_lance'),('unidade_fornecimento','unidade_fornecimento')) AS v(campo, lista) LOOP
    IF NOT _lista_ok(par.lista, j ->> par.campo, aj ->> par.campo) THEN
      erros := erros || jsonb_build_object('campo', par.campo, 'mensagem', 'Valor fora da lista: ' || (j ->> par.campo));
    END IF;
  END LOOP;
  IF r.analista IS NOT NULL AND r.analista IS DISTINCT FROM a.analista
     AND NOT EXISTS (SELECT 1 FROM usuarios WHERE nome = r.analista AND pre_vendas AND ativo) THEN
    erros := erros || jsonb_build_object('campo', 'analista', 'mensagem', 'Pré-vendas fora da lista: ' || r.analista);
  END IF;
  IF length(coalesce(r.orgao,'')) > 120 THEN erros := erros || jsonb_build_object('campo','orgao','mensagem','Máximo de 120 caracteres'); END IF;
  IF length(coalesce(r.processo,'')) > 60 THEN erros := erros || jsonb_build_object('campo','processo','mensagem','Máximo de 60 caracteres'); END IF;
  IF length(coalesce(r.detalhe_no_go,'')) > 4000 OR length(coalesce(r.observacoes,'')) > 4000 OR length(coalesce(r.empresas_vencedoras,'')) > 500 THEN
    erros := erros || jsonb_build_object('campo','texto','mensagem','Texto acima do limite (4000 / 500 caracteres)');
  END IF;
  IF r.orcamento < 0 OR r.valor_ctc < 0 OR r.valor_vencedor < 0 OR r.custo_total_ctc < 0 THEN
    erros := erros || jsonb_build_object('campo','valores','mensagem','Valores monetários não podem ser negativos');
  END IF;
  IF r.posicao_lance IS NOT NULL AND r.posicao_lance < 1 THEN erros := erros || jsonb_build_object('campo','posicao_lance','mensagem','Posição deve ser 1 ou maior'); END IF;
  IF r.mc_ctc IS NOT NULL AND (r.mc_ctc < -1 OR r.mc_ctc > 1) THEN erros := erros || jsonb_build_object('campo','mc_ctc','mensagem','Margem em fração entre -1 e 1 (ex.: 0,18 = 18%)'); END IF;
  IF r.simulacao_mc_arrematante IS NOT NULL AND (r.simulacao_mc_arrematante < -1 OR r.simulacao_mc_arrematante > 1) THEN
    erros := erros || jsonb_build_object('campo','simulacao_mc_arrematante','mensagem','Margem em fração entre -1 e 1');
  END IF;
  IF r.impostos IS NOT NULL AND (r.impostos < 0 OR r.impostos > 1) THEN
    erros := erros || jsonb_build_object('campo','impostos','mensagem','Impostos em fração entre 0 e 1 (ex.: 0,0865 = 8,65%)');
  END IF;
  IF length(coalesce(r.objeto,'')) > 5000 THEN erros := erros || jsonb_build_object('campo','objeto','mensagem','Máximo de 5000 caracteres'); END IF;
  IF r.data_distribuicao IS NOT NULL AND r.data_pregao_dt IS NOT NULL AND r.data_pregao_dt < r.data_distribuicao THEN
    erros := erros || jsonb_build_object('campo','data_pregao_dt','mensagem','A Data Pregão não pode ser anterior à data de distribuição');
  END IF;
  IF r.empresa_vencedora_cnpj IS NOT NULL AND r.empresa_vencedora_cnpj !~ '^[0-9]{14}$' THEN erros := erros || jsonb_build_object('campo','empresa_vencedora_cnpj','mensagem','CNPJ deve ter 14 dígitos'); END IF;
  IF r.orcamento_sigiloso AND r.orcamento IS NOT NULL THEN erros := erros || jsonb_build_object('campo','orcamento','mensagem','Orçamento sigiloso não tem valor'); END IF;
  IF r.status = 'No Go' AND coalesce(btrim(r.motivo_no_go), '') = '' THEN erros := erros || jsonb_build_object('campo','motivo_no_go','mensagem','Informe o motivo do No Go'); END IF;
  IF r.status = 'Lost' AND coalesce(btrim(r.motivo_lost), '') = '' THEN erros := erros || jsonb_build_object('campo','motivo_lost','mensagem','Informe o motivo do Lost'); END IF;
  IF r.status = 'Win' AND r.valor_ctc IS NULL THEN erros := erros || jsonb_build_object('campo','valor_ctc','mensagem','Informe o Valor CTC quando o status é Win'); END IF;
  IF jsonb_array_length(erros) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = erros::text;
  END IF;
END $$;;

-- Cadastro e edição com os campos novos (mantêm a recusa do perfil somente leitura e a torre calculada)
CREATE OR REPLACE FUNCTION criar_oportunidade(p jsonb, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r oportunidade_campos; o oportunidades; e text := lower(p_email);
BEGIN
  IF e IS NULL OR e = '' THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Usuário não identificado'; END IF;
  IF eh_somente_leitura(e) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Seu perfil é somente leitura: não é possível cadastrar ou editar'; END IF;
  PERFORM set_config('app.usuario', e, true);
  r := jsonb_populate_record(NULL::oportunidade_campos, p);
  IF r.linha_servico IS NOT NULL THEN r.torre := torre_da_linha(r.linha_servico); END IF;  -- torre é calculada pela linha de serviço
  IF r.empresa_vencedora_cnpj IS NULL THEN r.empresa_vencedora_razao := NULL; r.empresa_vencedora_tipo := NULL; END IF;
  PERFORM validar_oportunidade(r, NULL);
  INSERT INTO oportunidades (fonte, criado_por, atualizado_por, data_distribuicao, data_pregao_dt, status, orgao, descritivo, criterio, uf, processo,
      uasg, modalidade, tipo, modo_disputa, origem_oportunidade, analista, site, vistoria, linha_servico, torre, unidade_fornecimento, conta_vinculada,
      mc_ctc, simulacao_mc_arrematante, impostos, orcamento, orcamento_sigiloso, valor_vencedor, valor_ctc, custo_total_ctc, motivo_no_go, detalhe_no_go,
      empresas_vencedoras, motivo_lost, observacoes, posicao_lance, situacao_lance, pendencias,
      empresa_vencedora_cnpj, empresa_vencedora_razao, empresa_vencedora_tipo, objeto, hora_pregao)
  VALUES ('web', e, e, r.data_distribuicao, r.data_pregao_dt, r.status, btrim(r.orgao), btrim(r.descritivo), r.criterio, r.uf, nullif(btrim(r.processo), ''),
      nullif(btrim(r.uasg), ''), r.modalidade, r.tipo, r.modo_disputa, r.origem_oportunidade, r.analista, r.site, r.vistoria, r.linha_servico, r.torre,
      r.unidade_fornecimento, r.conta_vinculada, r.mc_ctc, r.simulacao_mc_arrematante, r.impostos, r.orcamento, coalesce(r.orcamento_sigiloso, false), r.valor_vencedor,
      r.valor_ctc, r.custo_total_ctc, r.motivo_no_go, r.detalhe_no_go, r.empresas_vencedoras, r.motivo_lost, r.observacoes, r.posicao_lance,
      r.situacao_lance, coalesce(r.pendencias, '{}'),
      r.empresa_vencedora_cnpj, r.empresa_vencedora_razao, r.empresa_vencedora_tipo, r.objeto, r.hora_pregao)
  RETURNING * INTO o;
  RETURN to_jsonb(o);
END $$;;

CREATE OR REPLACE FUNCTION atualizar_oportunidade(p_id bigint, p_versao int, p jsonb, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r oportunidade_campos; atual oportunidades; o oportunidades; e text := lower(p_email);
BEGIN
  IF e IS NULL OR e = '' THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Usuário não identificado'; END IF;
  IF eh_somente_leitura(e) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Seu perfil é somente leitura: não é possível cadastrar ou editar'; END IF;
  PERFORM set_config('app.usuario', e, true);
  SELECT * INTO atual FROM oportunidades WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR atual.arquivado_em IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'Oportunidade não encontrada'; END IF;
  IF atual.versao <> p_versao THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = jsonb_build_object('versao_atual', atual.versao, 'atual', to_jsonb(atual))::text;
  END IF;
  r := jsonb_populate_record(NULL::oportunidade_campos, p);
  IF r.linha_servico IS NOT NULL THEN r.torre := torre_da_linha(r.linha_servico); END IF;  -- torre é calculada pela linha de serviço
  IF r.empresa_vencedora_cnpj IS NULL THEN r.empresa_vencedora_razao := NULL; r.empresa_vencedora_tipo := NULL; END IF;
  PERFORM validar_oportunidade(r, atual);
  UPDATE oportunidades SET
    data_distribuicao = r.data_distribuicao, data_pregao_dt = r.data_pregao_dt, status = r.status, orgao = btrim(r.orgao), descritivo = btrim(r.descritivo),
    criterio = r.criterio, uf = r.uf, processo = nullif(btrim(r.processo), ''), uasg = nullif(btrim(r.uasg), ''), modalidade = r.modalidade, tipo = r.tipo,
    modo_disputa = r.modo_disputa, origem_oportunidade = r.origem_oportunidade, analista = r.analista, site = r.site, vistoria = r.vistoria,
    linha_servico = r.linha_servico, torre = r.torre, unidade_fornecimento = r.unidade_fornecimento, conta_vinculada = r.conta_vinculada,
    mc_ctc = r.mc_ctc, simulacao_mc_arrematante = r.simulacao_mc_arrematante, impostos = r.impostos, orcamento = r.orcamento, orcamento_sigiloso = coalesce(r.orcamento_sigiloso, false),
    valor_vencedor = r.valor_vencedor, valor_ctc = r.valor_ctc, custo_total_ctc = r.custo_total_ctc, motivo_no_go = r.motivo_no_go,
    detalhe_no_go = r.detalhe_no_go, motivo_lost = r.motivo_lost, observacoes = r.observacoes,
    posicao_lance = r.posicao_lance, situacao_lance = r.situacao_lance, pendencias = coalesce(r.pendencias, '{}'),
    empresa_vencedora_cnpj = r.empresa_vencedora_cnpj, empresa_vencedora_razao = r.empresa_vencedora_razao, empresa_vencedora_tipo = r.empresa_vencedora_tipo,
    objeto = r.objeto, hora_pregao = r.hora_pregao,
    editado_na_web = true, atualizado_por = e, versao = atual.versao + 1
  WHERE id = p_id RETURNING * INTO o;
  RETURN to_jsonb(o);
END $$;;
