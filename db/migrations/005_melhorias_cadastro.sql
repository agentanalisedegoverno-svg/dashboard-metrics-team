-- 005: melhorias do cadastro.
--  - descritivo sem limite de caracteres;
--  - torre calculada pela linha de serviço (mesma regra da planilha: Software Development/Key Talent = DIGITAL;
--    Lya Gov/AutoAtendimento Gov/Fastcomm Gov = HEALTH; demais = ITS);
--  - unidade de fornecimento passa a ser lista fechada (combo box);
--  - empresa vencedora identificada por CNPJ (razão social e matriz/filial vêm da consulta à Receita, feita pela API).

-- 1) campos novos
ALTER TABLE oportunidades
  ADD COLUMN IF NOT EXISTS empresa_vencedora_cnpj text,
  ADD COLUMN IF NOT EXISTS empresa_vencedora_razao text,
  ADD COLUMN IF NOT EXISTS empresa_vencedora_tipo text;;
DO $$ BEGIN
  ALTER TABLE oportunidades ADD CONSTRAINT oportunidades_cnpj_fmt CHECK (empresa_vencedora_cnpj IS NULL OR empresa_vencedora_cnpj ~ '^[0-9]{14}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;
DO $$ BEGIN
  ALTER TABLE oportunidades ADD CONSTRAINT oportunidades_cnpj_tipo CHECK (empresa_vencedora_tipo IS NULL OR empresa_vencedora_tipo IN ('Matriz','Filial'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;
DO $$ BEGIN
  ALTER TYPE oportunidade_campos ADD ATTRIBUTE empresa_vencedora_cnpj text, ADD ATTRIBUTE empresa_vencedora_razao text, ADD ATTRIBUTE empresa_vencedora_tipo text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;;

-- 2) torre calculada pela linha de serviço (exceções à regra padrão ITS)
CREATE TABLE IF NOT EXISTS linhas_torre (
  linha text PRIMARY KEY,
  torre text NOT NULL CHECK (torre IN ('ITS','DIGITAL','HEALTH'))
);;
INSERT INTO linhas_torre (linha, torre) VALUES
  ('Aplication Development','DIGITAL'),('Software Development','DIGITAL'),('Business Automation','DIGITAL'),('Key Talent','DIGITAL'),('Soluções Digitais','DIGITAL'),
  ('Lya Gov','HEALTH'),('AutoAtendimento Gov','HEALTH'),('Fastcomm Gov','HEALTH')
ON CONFLICT (linha) DO NOTHING;;
GRANT SELECT ON linhas_torre TO radar_app, radar_leitor;;

CREATE OR REPLACE FUNCTION torre_da_linha(p_linha text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p_linha IS NULL OR btrim(p_linha) = '' THEN NULL
              ELSE coalesce((SELECT torre FROM linhas_torre WHERE linha = p_linha), 'ITS') END
$$;;

-- Garantia no banco: qualquer caminho de gravação (web, agente) mantém a torre coerente com a linha.
CREATE OR REPLACE FUNCTION oportunidades_torre() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.linha_servico IS NOT NULL AND btrim(NEW.linha_servico) <> '' THEN
    NEW.torre := torre_da_linha(NEW.linha_servico);
  END IF;
  RETURN NEW;
END $$;;
DROP TRIGGER IF EXISTS oportunidades_torre_tg ON oportunidades;;
CREATE TRIGGER oportunidades_torre_tg BEFORE INSERT OR UPDATE ON oportunidades FOR EACH ROW EXECUTE FUNCTION oportunidades_torre();;

-- 3) unidade de fornecimento: lista fechada (valores existentes normalizados)
INSERT INTO opcoes (lista, valor, ordem) VALUES
  ('unidade_fornecimento','Serviço',1),('unidade_fornecimento','Posto de Trabalho',2),('unidade_fornecimento','Ponto de Função',3),('unidade_fornecimento','Hora',4)
ON CONFLICT (lista, valor) DO NOTHING;;
SELECT set_config('app.usuario', 'migracao-005', true);;
UPDATE oportunidades SET unidade_fornecimento = CASE
    WHEN lower(btrim(unidade_fornecimento)) IN ('hora','horas') THEN 'Hora'
    WHEN lower(btrim(unidade_fornecimento)) = 'ponto de função' THEN 'Ponto de Função'
    WHEN lower(btrim(unidade_fornecimento)) = 'posto de trabalho' THEN 'Posto de Trabalho'
    WHEN lower(btrim(unidade_fornecimento)) IN ('serviço','servico') THEN 'Serviço'
    ELSE unidade_fornecimento END
WHERE unidade_fornecimento IS NOT NULL
  AND unidade_fornecimento IS DISTINCT FROM CASE
    WHEN lower(btrim(unidade_fornecimento)) IN ('hora','horas') THEN 'Hora'
    WHEN lower(btrim(unidade_fornecimento)) = 'ponto de função' THEN 'Ponto de Função'
    WHEN lower(btrim(unidade_fornecimento)) = 'posto de trabalho' THEN 'Posto de Trabalho'
    WHEN lower(btrim(unidade_fornecimento)) IN ('serviço','servico') THEN 'Serviço'
    ELSE unidade_fornecimento END;;

-- 4) validação (sem limite de descritivo; unidade na lista; CNPJ com 14 dígitos) e funções de cadastro
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

CREATE OR REPLACE FUNCTION criar_oportunidade(p jsonb, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r oportunidade_campos; o oportunidades; e text := lower(p_email);
BEGIN
  IF e IS NULL OR e = '' THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Usuário não identificado'; END IF;
  PERFORM set_config('app.usuario', e, true);
  r := jsonb_populate_record(NULL::oportunidade_campos, p);
  IF r.linha_servico IS NOT NULL THEN r.torre := torre_da_linha(r.linha_servico); END IF;  -- torre é calculada pela linha de serviço
  IF r.empresa_vencedora_cnpj IS NULL THEN r.empresa_vencedora_razao := NULL; r.empresa_vencedora_tipo := NULL; END IF;
  PERFORM validar_oportunidade(r, NULL);
  INSERT INTO oportunidades (fonte, criado_por, atualizado_por, data_distribuicao, data_pregao_dt, status, orgao, descritivo, criterio, uf, processo,
      uasg, modalidade, tipo, modo_disputa, origem_oportunidade, analista, site, vistoria, linha_servico, torre, unidade_fornecimento, conta_vinculada,
      mc_ctc, simulacao_mc_arrematante, orcamento, orcamento_sigiloso, valor_vencedor, valor_ctc, custo_total_ctc, motivo_no_go, detalhe_no_go,
      empresas_vencedoras, motivo_lost, observacoes, posicao_lance, situacao_lance, pendencias,
      empresa_vencedora_cnpj, empresa_vencedora_razao, empresa_vencedora_tipo)
  VALUES ('web', e, e, r.data_distribuicao, r.data_pregao_dt, r.status, btrim(r.orgao), btrim(r.descritivo), r.criterio, r.uf, nullif(btrim(r.processo), ''),
      nullif(btrim(r.uasg), ''), r.modalidade, r.tipo, r.modo_disputa, r.origem_oportunidade, r.analista, r.site, r.vistoria, r.linha_servico, r.torre,
      r.unidade_fornecimento, r.conta_vinculada, r.mc_ctc, r.simulacao_mc_arrematante, r.orcamento, coalesce(r.orcamento_sigiloso, false), r.valor_vencedor,
      r.valor_ctc, r.custo_total_ctc, r.motivo_no_go, r.detalhe_no_go, r.empresas_vencedoras, r.motivo_lost, r.observacoes, r.posicao_lance,
      r.situacao_lance, coalesce(r.pendencias, '{}'),
      r.empresa_vencedora_cnpj, r.empresa_vencedora_razao, r.empresa_vencedora_tipo)
  RETURNING * INTO o;
  RETURN to_jsonb(o);
END $$;;

CREATE OR REPLACE FUNCTION atualizar_oportunidade(p_id bigint, p_versao int, p jsonb, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r oportunidade_campos; atual oportunidades; o oportunidades; e text := lower(p_email);
BEGIN
  IF e IS NULL OR e = '' THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Usuário não identificado'; END IF;
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
    mc_ctc = r.mc_ctc, simulacao_mc_arrematante = r.simulacao_mc_arrematante, orcamento = r.orcamento, orcamento_sigiloso = coalesce(r.orcamento_sigiloso, false),
    valor_vencedor = r.valor_vencedor, valor_ctc = r.valor_ctc, custo_total_ctc = r.custo_total_ctc, motivo_no_go = r.motivo_no_go,
    detalhe_no_go = r.detalhe_no_go, motivo_lost = r.motivo_lost, observacoes = r.observacoes,
    posicao_lance = r.posicao_lance, situacao_lance = r.situacao_lance, pendencias = coalesce(r.pendencias, '{}'),
    empresa_vencedora_cnpj = r.empresa_vencedora_cnpj, empresa_vencedora_razao = r.empresa_vencedora_razao, empresa_vencedora_tipo = r.empresa_vencedora_tipo,
    editado_na_web = true, atualizado_por = e, versao = atual.versao + 1
  WHERE id = p_id RETURNING * INTO o;
  RETURN to_jsonb(o);
END $$;;
