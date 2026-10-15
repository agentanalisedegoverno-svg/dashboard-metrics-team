-- Migração 001 — cadastro de oportunidades na web (Fase 1: banco)
-- Aditiva e idempotente: o painel atual continua lendo as mesmas colunas.
-- Executar com o papel dono (neondb_owner). Divida por ";;" se usar um executor de uma instrução por vez.
-- Papéis:
--   radar_app      (a criar com senha fora do Git)  -> API do cadastro: SELECT + EXECUTE das funções abaixo
--   radar_escritor (já existe)                      -> agente: EXECUTE sincronizar_planilha
--   radar_leitor   (já existe)                      -> painel de métricas: SELECT

------------------------------------------------------------------ 1. usuários e listas
CREATE TABLE IF NOT EXISTS usuarios (
  id serial PRIMARY KEY,
  email text UNIQUE CHECK (email IS NULL OR email = lower(email)),
  nome text NOT NULL UNIQUE,
  admin boolean NOT NULL DEFAULT false,
  pre_vendas boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);;
INSERT INTO usuarios (email, nome, admin) VALUES ('joao.henrique@ctctech.com.br', 'João Henrique', true) ON CONFLICT DO NOTHING;;
INSERT INTO usuarios (nome, pre_vendas) VALUES ('Flávio Santanna', true), ('Júlio César', true), ('Sérgio', true), ('Rodrigo A', true), ('Miguel Oduber', true), ('Marcio Fagundes', true), ('Marcia', true) ON CONFLICT DO NOTHING;;

CREATE TABLE IF NOT EXISTS opcoes (
  lista text NOT NULL,
  valor text NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (lista, valor)
);;
INSERT INTO opcoes (lista, valor, ordem) VALUES
  ('status','Prospect',1),('status','Go',2),('status','On going',3),('status','Win',4),('status','Lost',5),('status','No Go',6),('status','Canceled',7),('status','Suspended',8),
  ('torre','ITS',1),('torre','DIGITAL',2),('torre','HEALTH',3),
  ('vistoria','Sim',1),('vistoria','Não',2),('vistoria','Opcional',3),('vistoria','Omissa',4),
  ('conta_vinculada','Sim',1),('conta_vinculada','Não',2),
  ('origem_oportunidade','Reativo',1),('origem_oportunidade','Proativo',2),
  ('criterio','Menor Preço',1),('criterio','Técnica e preço',2),
  ('modo_disputa','Aberto',1),('modo_disputa','Aberto e Fechado',2),('modo_disputa','Fechado',3),('modo_disputa','Dispensa com disputa',4),
  ('situacao_lance','Desclassificada',1),('situacao_lance','Não participamos',2)
ON CONFLICT DO NOTHING;;
INSERT INTO opcoes (lista, valor, ordem, ativo) VALUES ('status','Validar',99,false) ON CONFLICT DO NOTHING;;
INSERT INTO opcoes (lista, valor, ordem)
SELECT 'uf', u, row_number() OVER (ORDER BY u)
FROM unnest(ARRAY['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) AS u
ON CONFLICT DO NOTHING;;

------------------------------------------------------------------ 2. colunas novas em oportunidades
ALTER TABLE oportunidades
  ADD COLUMN IF NOT EXISTS data_distribuicao date,
  ADD COLUMN IF NOT EXISTS data_pregao_dt date,
  ADD COLUMN IF NOT EXISTS criterio text,
  ADD COLUMN IF NOT EXISTS uasg text,
  ADD COLUMN IF NOT EXISTS modalidade text,
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS modo_disputa text,
  ADD COLUMN IF NOT EXISTS origem_oportunidade text,
  ADD COLUMN IF NOT EXISTS site text,
  ADD COLUMN IF NOT EXISTS unidade_fornecimento text,
  ADD COLUMN IF NOT EXISTS mc_ctc numeric(9,4),
  ADD COLUMN IF NOT EXISTS simulacao_mc_arrematante numeric(9,4),
  ADD COLUMN IF NOT EXISTS custo_total_ctc numeric(18,2),
  ADD COLUMN IF NOT EXISTS detalhe_no_go text,
  ADD COLUMN IF NOT EXISTS empresas_vencedoras text,
  ADD COLUMN IF NOT EXISTS observacoes text,
  ADD COLUMN IF NOT EXISTS posicao_lance int,
  ADD COLUMN IF NOT EXISTS situacao_lance text,
  ADD COLUMN IF NOT EXISTS orcamento_sigiloso boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pendencias text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fonte text NOT NULL DEFAULT 'planilha',
  ADD COLUMN IF NOT EXISTS chave_planilha text,
  ADD COLUMN IF NOT EXISTS editado_na_web boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ausente_na_planilha boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS criado_por text,
  ADD COLUMN IF NOT EXISTS criado_em timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS atualizado_por text,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS versao int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS arquivado_em timestamptz,
  ADD COLUMN IF NOT EXISTS arquivado_por text;;
DO $$ BEGIN
  ALTER TABLE oportunidades ADD CONSTRAINT oportunidades_fonte_ck CHECK (fonte IN ('planilha','web'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;
DO $$ BEGIN
  ALTER TABLE oportunidades ADD CONSTRAINT oportunidades_valores_ck CHECK (
    (orcamento IS NULL OR orcamento >= 0) AND (valor_ctc IS NULL OR valor_ctc >= 0) AND (valor_vencedor IS NULL OR valor_vencedor >= 0)
    AND (custo_total_ctc IS NULL OR custo_total_ctc >= 0) AND (posicao_lance IS NULL OR posicao_lance >= 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;
CREATE UNIQUE INDEX IF NOT EXISTS oportunidades_chave_planilha_uq ON oportunidades (chave_planilha) WHERE chave_planilha IS NOT NULL;;
CREATE INDEX IF NOT EXISTS oportunidades_data_pregao_idx ON oportunidades (data_pregao_dt);;
CREATE INDEX IF NOT EXISTS oportunidades_status_idx ON oportunidades (status);;
CREATE INDEX IF NOT EXISTS oportunidades_ativas_idx ON oportunidades (arquivado_em) WHERE arquivado_em IS NULL;;

------------------------------------------------------------------ 3. histórico (auditoria)
CREATE TABLE IF NOT EXISTS oportunidades_historico (
  id bigserial PRIMARY KEY,
  oportunidade_id bigint NOT NULL,
  versao int NOT NULL,
  acao text NOT NULL,
  por text NOT NULL,
  em timestamptz NOT NULL DEFAULT now(),
  alteracoes jsonb NOT NULL DEFAULT '{}'
);;
CREATE INDEX IF NOT EXISTS oportunidades_historico_op_idx ON oportunidades_historico (oportunidade_id, em DESC);;

------------------------------------------------------------------ 4. tipos de entrada (campos editáveis)
DO $$ BEGIN
  CREATE TYPE oportunidade_campos AS (
    data_distribuicao date, data_pregao_dt date, status text, orgao text, descritivo text, criterio text, uf text, processo text,
    uasg text, modalidade text, tipo text, modo_disputa text, origem_oportunidade text, analista text, site text, vistoria text,
    linha_servico text, torre text, unidade_fornecimento text, conta_vinculada text, mc_ctc numeric, simulacao_mc_arrematante numeric,
    orcamento numeric, orcamento_sigiloso boolean, valor_vencedor numeric, valor_ctc numeric, custo_total_ctc numeric,
    motivo_no_go text, detalhe_no_go text, empresas_vencedoras text, motivo_lost text, observacoes text,
    posicao_lance int, situacao_lance text, pendencias text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;
DO $$ BEGIN
  CREATE TYPE oportunidade_sync AS (
    chave_planilha text,
    data_distribuicao date, data_pregao_dt date, status text, orgao text, descritivo text, criterio text, uf text, processo text,
    uasg text, modalidade text, tipo text, modo_disputa text, origem_oportunidade text, analista text, site text, vistoria text,
    linha_servico text, torre text, unidade_fornecimento text, conta_vinculada text, mc_ctc numeric, simulacao_mc_arrematante numeric,
    orcamento numeric, orcamento_sigiloso boolean, valor_vencedor numeric, valor_ctc numeric, custo_total_ctc numeric,
    motivo_no_go text, detalhe_no_go text, empresas_vencedoras text, motivo_lost text, observacoes text,
    posicao_lance int, situacao_lance text, pendencias text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;

------------------------------------------------------------------ 5. derivação (ano, mês, data legada, SLA)
CREATE OR REPLACE FUNCTION oportunidades_derivar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data_pregao_dt IS NULL AND NEW.data_pregao ~ '^\d{2}/\d{2}/\d{4}$' THEN
    NEW.data_pregao_dt := to_date(NEW.data_pregao, 'DD/MM/YYYY');
  END IF;
  IF NEW.data_pregao_dt IS NOT NULL THEN
    NEW.data_pregao := to_char(NEW.data_pregao_dt, 'DD/MM/YYYY');
    NEW.ano := to_char(NEW.data_pregao_dt, 'YYYY');
    NEW.mes := to_char(NEW.data_pregao_dt, 'YYYY-MM');
  ELSE
    NEW.ano := NULL; NEW.mes := NULL;
  END IF;
  IF NEW.data_distribuicao IS NOT NULL AND NEW.data_pregao_dt IS NOT NULL THEN
    NEW.sla := CASE WHEN NEW.data_pregao_dt >= NEW.data_distribuicao THEN NEW.data_pregao_dt - NEW.data_distribuicao END;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;;
DROP TRIGGER IF EXISTS oportunidades_derivar_tg ON oportunidades;;
CREATE TRIGGER oportunidades_derivar_tg BEFORE INSERT OR UPDATE ON oportunidades FOR EACH ROW EXECUTE FUNCTION oportunidades_derivar();;
-- Preenche data_pregao_dt/ano/mes dos registros existentes (antes de ligar a auditoria, para não gerar ruído no histórico).
UPDATE oportunidades SET data_pregao = data_pregao WHERE data_pregao_dt IS NULL AND data_pregao IS NOT NULL;;

------------------------------------------------------------------ 6. auditoria por trigger
CREATE OR REPLACE FUNCTION oportunidades_auditar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ruido text[] := ARRAY['carregado_em','atualizado_em','versao','ano','mes','sla','data_pregao','editado_na_web','ausente_na_planilha'];
  antes jsonb; depois jsonb; diff jsonb; quem text; acao text;
BEGIN
  quem := coalesce(nullif(current_setting('app.usuario', true), ''), NEW.atualizado_por, NEW.criado_por, 'sistema');
  IF TG_OP = 'INSERT' THEN
    INSERT INTO oportunidades_historico (oportunidade_id, versao, acao, por, alteracoes)
    VALUES (NEW.id, NEW.versao, CASE NEW.fonte WHEN 'web' THEN 'criou' ELSE 'importou' END, quem, '{}');
    RETURN NEW;
  END IF;
  antes := to_jsonb(OLD) - ruido;
  depois := to_jsonb(NEW) - ruido;
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_array(antes -> k, depois -> k)), '{}')
    INTO diff FROM jsonb_object_keys(depois) AS k WHERE (antes -> k) IS DISTINCT FROM (depois -> k);
  IF diff = '{}'::jsonb THEN RETURN NEW; END IF;
  IF OLD.arquivado_em IS NULL AND NEW.arquivado_em IS NOT NULL THEN acao := 'arquivou';
  ELSIF OLD.arquivado_em IS NOT NULL AND NEW.arquivado_em IS NULL THEN acao := 'restaurou';
  ELSIF coalesce(current_setting('app.origem', true), '') = 'sync' THEN acao := 'sincronizou';
  ELSE acao := 'editou'; END IF;
  INSERT INTO oportunidades_historico (oportunidade_id, versao, acao, por, alteracoes) VALUES (NEW.id, NEW.versao, acao, quem, diff);
  RETURN NEW;
END $$;;
DROP TRIGGER IF EXISTS oportunidades_auditar_tg ON oportunidades;;
CREATE TRIGGER oportunidades_auditar_tg AFTER INSERT OR UPDATE ON oportunidades FOR EACH ROW EXECUTE FUNCTION oportunidades_auditar();;

------------------------------------------------------------------ 7. validação
CREATE OR REPLACE FUNCTION _lista_ok(p_lista text, p_valor text, p_antigo text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_valor IS NULL OR p_valor IS NOT DISTINCT FROM p_antigo OR EXISTS (SELECT 1 FROM opcoes WHERE lista = p_lista AND valor = p_valor AND ativo)
$$;;
CREATE OR REPLACE FUNCTION eh_admin(p_email text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE email = lower(p_email) AND admin AND ativo)
$$;;
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
      ('situacao_lance','situacao_lance')) AS v(campo, lista) LOOP
    IF NOT _lista_ok(par.lista, j ->> par.campo, aj ->> par.campo) THEN
      erros := erros || jsonb_build_object('campo', par.campo, 'mensagem', 'Valor fora da lista: ' || (j ->> par.campo));
    END IF;
  END LOOP;
  IF r.analista IS NOT NULL AND r.analista IS DISTINCT FROM a.analista
     AND NOT EXISTS (SELECT 1 FROM usuarios WHERE nome = r.analista AND pre_vendas AND ativo) THEN
    erros := erros || jsonb_build_object('campo', 'analista', 'mensagem', 'Pré-vendas fora da lista: ' || r.analista);
  END IF;
  IF length(coalesce(r.orgao,'')) > 120 THEN erros := erros || jsonb_build_object('campo','orgao','mensagem','Máximo de 120 caracteres'); END IF;
  IF length(coalesce(r.descritivo,'')) > 300 THEN erros := erros || jsonb_build_object('campo','descritivo','mensagem','Máximo de 300 caracteres'); END IF;
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
  IF r.orcamento_sigiloso AND r.orcamento IS NOT NULL THEN erros := erros || jsonb_build_object('campo','orcamento','mensagem','Orçamento sigiloso não tem valor'); END IF;
  IF r.status = 'No Go' AND coalesce(btrim(r.motivo_no_go), '') = '' THEN erros := erros || jsonb_build_object('campo','motivo_no_go','mensagem','Informe o motivo do No Go'); END IF;
  IF r.status = 'Lost' AND coalesce(btrim(r.motivo_lost), '') = '' THEN erros := erros || jsonb_build_object('campo','motivo_lost','mensagem','Informe o motivo do Lost'); END IF;
  IF r.status = 'Win' AND r.valor_ctc IS NULL THEN erros := erros || jsonb_build_object('campo','valor_ctc','mensagem','Informe o Valor CTC quando o status é Win'); END IF;
  IF jsonb_array_length(erros) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = erros::text;
  END IF;
END $$;;

------------------------------------------------------------------ 8. funções de cadastro (usadas pela API)
CREATE OR REPLACE FUNCTION criar_oportunidade(p jsonb, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r oportunidade_campos; o oportunidades; e text := lower(p_email);
BEGIN
  IF e IS NULL OR e = '' THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Usuário não identificado'; END IF;
  PERFORM set_config('app.usuario', e, true);
  r := jsonb_populate_record(NULL::oportunidade_campos, p);
  PERFORM validar_oportunidade(r, NULL);
  INSERT INTO oportunidades (fonte, criado_por, atualizado_por, data_distribuicao, data_pregao_dt, status, orgao, descritivo, criterio, uf, processo,
      uasg, modalidade, tipo, modo_disputa, origem_oportunidade, analista, site, vistoria, linha_servico, torre, unidade_fornecimento, conta_vinculada,
      mc_ctc, simulacao_mc_arrematante, orcamento, orcamento_sigiloso, valor_vencedor, valor_ctc, custo_total_ctc, motivo_no_go, detalhe_no_go,
      empresas_vencedoras, motivo_lost, observacoes, posicao_lance, situacao_lance, pendencias)
  VALUES ('web', e, e, r.data_distribuicao, r.data_pregao_dt, r.status, btrim(r.orgao), btrim(r.descritivo), r.criterio, r.uf, nullif(btrim(r.processo), ''),
      nullif(btrim(r.uasg), ''), r.modalidade, r.tipo, r.modo_disputa, r.origem_oportunidade, r.analista, r.site, r.vistoria, r.linha_servico, r.torre,
      r.unidade_fornecimento, r.conta_vinculada, r.mc_ctc, r.simulacao_mc_arrematante, r.orcamento, coalesce(r.orcamento_sigiloso, false), r.valor_vencedor,
      r.valor_ctc, r.custo_total_ctc, r.motivo_no_go, r.detalhe_no_go, r.empresas_vencedoras, r.motivo_lost, r.observacoes, r.posicao_lance,
      r.situacao_lance, coalesce(r.pendencias, '{}'))
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
  PERFORM validar_oportunidade(r, atual);
  UPDATE oportunidades SET
    data_distribuicao = r.data_distribuicao, data_pregao_dt = r.data_pregao_dt, status = r.status, orgao = btrim(r.orgao), descritivo = btrim(r.descritivo),
    criterio = r.criterio, uf = r.uf, processo = nullif(btrim(r.processo), ''), uasg = nullif(btrim(r.uasg), ''), modalidade = r.modalidade, tipo = r.tipo,
    modo_disputa = r.modo_disputa, origem_oportunidade = r.origem_oportunidade, analista = r.analista, site = r.site, vistoria = r.vistoria,
    linha_servico = r.linha_servico, torre = r.torre, unidade_fornecimento = r.unidade_fornecimento, conta_vinculada = r.conta_vinculada,
    mc_ctc = r.mc_ctc, simulacao_mc_arrematante = r.simulacao_mc_arrematante, orcamento = r.orcamento, orcamento_sigiloso = coalesce(r.orcamento_sigiloso, false),
    valor_vencedor = r.valor_vencedor, valor_ctc = r.valor_ctc, custo_total_ctc = r.custo_total_ctc, motivo_no_go = r.motivo_no_go,
    detalhe_no_go = r.detalhe_no_go, empresas_vencedoras = r.empresas_vencedoras, motivo_lost = r.motivo_lost, observacoes = r.observacoes,
    posicao_lance = r.posicao_lance, situacao_lance = r.situacao_lance, pendencias = coalesce(r.pendencias, '{}'),
    editado_na_web = true, atualizado_por = e, versao = atual.versao + 1
  WHERE id = p_id RETURNING * INTO o;
  RETURN to_jsonb(o);
END $$;;

CREATE OR REPLACE FUNCTION arquivar_oportunidade(p_id bigint, p_email text, p_restaurar boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o oportunidades; e text := lower(p_email);
BEGIN
  IF NOT eh_admin(e) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Somente administradores arquivam ou restauram'; END IF;
  PERFORM set_config('app.usuario', e, true);
  UPDATE oportunidades SET
    arquivado_em = CASE WHEN p_restaurar THEN NULL ELSE now() END,
    arquivado_por = CASE WHEN p_restaurar THEN NULL ELSE e END,
    atualizado_por = e, versao = versao + 1, editado_na_web = true
  WHERE id = p_id RETURNING * INTO o;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'Oportunidade não encontrada'; END IF;
  RETURN to_jsonb(o);
END $$;;

CREATE OR REPLACE FUNCTION salvar_opcao(p_lista text, p_valor text, p_ativo boolean, p_ordem int, p_email text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT eh_admin(p_email) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Somente administradores editam as listas'; END IF;
  IF btrim(coalesce(p_valor, '')) = '' OR length(p_valor) > 120 THEN RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"valor","mensagem":"Valor inválido"}]'; END IF;
  INSERT INTO opcoes (lista, valor, ativo, ordem) VALUES (p_lista, btrim(p_valor), p_ativo, coalesce(p_ordem, 0))
  ON CONFLICT (lista, valor) DO UPDATE SET ativo = EXCLUDED.ativo, ordem = EXCLUDED.ordem;
END $$;;

CREATE OR REPLACE FUNCTION salvar_usuario(p_nome text, p_email text, p_admin boolean, p_pre_vendas boolean, p_ativo boolean, p_por text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT eh_admin(p_por) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Somente administradores editam usuários'; END IF;
  INSERT INTO usuarios (nome, email, admin, pre_vendas, ativo) VALUES (btrim(p_nome), nullif(lower(btrim(coalesce(p_email, ''))), ''), p_admin, p_pre_vendas, p_ativo)
  ON CONFLICT (nome) DO UPDATE SET email = EXCLUDED.email, admin = EXCLUDED.admin, pre_vendas = EXCLUDED.pre_vendas, ativo = EXCLUDED.ativo;
END $$;;

------------------------------------------------------------------ 9. sincronização por merge (agente)
CREATE OR REPLACE FUNCTION sincronizar_planilha(p_rows jsonb, p_fonte text DEFAULT 'agent', p_substituir_legado boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inseridas int := 0; atualizadas int := 0; protegidas int := 0; ausentes int := 0; total int; chaves text[];
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN RAISE EXCEPTION 'p_rows deve ser um array JSON não vazio'; END IF;
  PERFORM set_config('app.usuario', 'sincronizacao', true);
  PERFORM set_config('app.origem', 'sync', true);
  DROP TABLE IF EXISTS _entrada;
  CREATE TEMP TABLE _entrada ON COMMIT DROP AS SELECT * FROM jsonb_populate_recordset(NULL::oportunidade_sync, p_rows);
  total := (SELECT count(*) FROM _entrada);
  IF EXISTS (SELECT 1 FROM _entrada WHERE chave_planilha IS NULL) THEN RAISE EXCEPTION 'Todas as linhas precisam de chave_planilha'; END IF;
  IF p_substituir_legado THEN DELETE FROM oportunidades WHERE fonte = 'planilha' AND chave_planilha IS NULL; END IF;
  -- listas: valores observados na planilha entram como opções ativas (admin pode desativar)
  INSERT INTO opcoes (lista, valor) SELECT 'modalidade', modalidade FROM _entrada WHERE modalidade IS NOT NULL GROUP BY 2 ON CONFLICT DO NOTHING;
  INSERT INTO opcoes (lista, valor) SELECT 'site', site FROM _entrada WHERE site IS NOT NULL GROUP BY 2 ON CONFLICT DO NOTHING;
  INSERT INTO opcoes (lista, valor) SELECT 'linha_servico', linha_servico FROM _entrada WHERE linha_servico IS NOT NULL GROUP BY 2 ON CONFLICT DO NOTHING;
  INSERT INTO opcoes (lista, valor) SELECT 'motivo_no_go', motivo_no_go FROM _entrada WHERE motivo_no_go IS NOT NULL GROUP BY 2 ON CONFLICT DO NOTHING;
  INSERT INTO opcoes (lista, valor) SELECT 'motivo_lost', motivo_lost FROM _entrada WHERE motivo_lost IS NOT NULL GROUP BY 2 ON CONFLICT DO NOTHING;
  chaves := ARRAY(SELECT chave_planilha FROM _entrada);
  SELECT count(*) INTO protegidas FROM oportunidades o JOIN _entrada e USING (chave_planilha) WHERE o.editado_na_web OR o.fonte <> 'planilha' OR o.arquivado_em IS NOT NULL;
  WITH up AS (
    INSERT INTO oportunidades AS o (fonte, chave_planilha, data_distribuicao, data_pregao_dt, status, orgao, descritivo, criterio, uf, processo, uasg, modalidade, tipo,
        modo_disputa, origem_oportunidade, analista, site, vistoria, linha_servico, torre, unidade_fornecimento, conta_vinculada, mc_ctc, simulacao_mc_arrematante,
        orcamento, orcamento_sigiloso, valor_vencedor, valor_ctc, custo_total_ctc, motivo_no_go, detalhe_no_go, empresas_vencedoras, motivo_lost, observacoes,
        posicao_lance, situacao_lance, pendencias, criado_por, atualizado_por)
    SELECT 'planilha', chave_planilha, data_distribuicao, data_pregao_dt, status, orgao, descritivo, criterio, uf, processo, uasg, modalidade, tipo, modo_disputa,
        origem_oportunidade, analista, site, vistoria, linha_servico, torre, unidade_fornecimento, conta_vinculada, mc_ctc, simulacao_mc_arrematante, orcamento,
        coalesce(orcamento_sigiloso, false), valor_vencedor, valor_ctc, custo_total_ctc, motivo_no_go, detalhe_no_go, empresas_vencedoras, motivo_lost, observacoes,
        posicao_lance, situacao_lance, coalesce(pendencias, '{}'), 'sincronizacao', 'sincronizacao'
    FROM _entrada
    ON CONFLICT (chave_planilha) WHERE chave_planilha IS NOT NULL DO UPDATE SET
        data_distribuicao = EXCLUDED.data_distribuicao, data_pregao_dt = EXCLUDED.data_pregao_dt, status = EXCLUDED.status, orgao = EXCLUDED.orgao,
        descritivo = EXCLUDED.descritivo, criterio = EXCLUDED.criterio, uf = EXCLUDED.uf, processo = EXCLUDED.processo, uasg = EXCLUDED.uasg,
        modalidade = EXCLUDED.modalidade, tipo = EXCLUDED.tipo, modo_disputa = EXCLUDED.modo_disputa, origem_oportunidade = EXCLUDED.origem_oportunidade,
        analista = EXCLUDED.analista, site = EXCLUDED.site, vistoria = EXCLUDED.vistoria, linha_servico = EXCLUDED.linha_servico, torre = EXCLUDED.torre,
        unidade_fornecimento = EXCLUDED.unidade_fornecimento, conta_vinculada = EXCLUDED.conta_vinculada, mc_ctc = EXCLUDED.mc_ctc,
        simulacao_mc_arrematante = EXCLUDED.simulacao_mc_arrematante, orcamento = EXCLUDED.orcamento, orcamento_sigiloso = EXCLUDED.orcamento_sigiloso,
        valor_vencedor = EXCLUDED.valor_vencedor, valor_ctc = EXCLUDED.valor_ctc, custo_total_ctc = EXCLUDED.custo_total_ctc, motivo_no_go = EXCLUDED.motivo_no_go,
        detalhe_no_go = EXCLUDED.detalhe_no_go, empresas_vencedoras = EXCLUDED.empresas_vencedoras, motivo_lost = EXCLUDED.motivo_lost,
        observacoes = EXCLUDED.observacoes, posicao_lance = EXCLUDED.posicao_lance, situacao_lance = EXCLUDED.situacao_lance, pendencias = EXCLUDED.pendencias,
        atualizado_por = 'sincronizacao', versao = o.versao + 1
      WHERE o.fonte = 'planilha' AND NOT o.editado_na_web AND o.arquivado_em IS NULL
        AND (o.data_distribuicao, o.data_pregao_dt, o.status, o.orgao, o.descritivo, o.criterio, o.uf, o.processo, o.uasg, o.modalidade, o.tipo, o.modo_disputa,
             o.origem_oportunidade, o.analista, o.site, o.vistoria, o.linha_servico, o.torre, o.unidade_fornecimento, o.conta_vinculada, o.mc_ctc,
             o.simulacao_mc_arrematante, o.orcamento, o.orcamento_sigiloso, o.valor_vencedor, o.valor_ctc, o.custo_total_ctc, o.motivo_no_go, o.detalhe_no_go,
             o.empresas_vencedoras, o.motivo_lost, o.observacoes, o.posicao_lance, o.situacao_lance, o.pendencias)
        IS DISTINCT FROM
            (EXCLUDED.data_distribuicao, EXCLUDED.data_pregao_dt, EXCLUDED.status, EXCLUDED.orgao, EXCLUDED.descritivo, EXCLUDED.criterio, EXCLUDED.uf, EXCLUDED.processo,
             EXCLUDED.uasg, EXCLUDED.modalidade, EXCLUDED.tipo, EXCLUDED.modo_disputa, EXCLUDED.origem_oportunidade, EXCLUDED.analista, EXCLUDED.site, EXCLUDED.vistoria,
             EXCLUDED.linha_servico, EXCLUDED.torre, EXCLUDED.unidade_fornecimento, EXCLUDED.conta_vinculada, EXCLUDED.mc_ctc, EXCLUDED.simulacao_mc_arrematante,
             EXCLUDED.orcamento, EXCLUDED.orcamento_sigiloso, EXCLUDED.valor_vencedor, EXCLUDED.valor_ctc, EXCLUDED.custo_total_ctc, EXCLUDED.motivo_no_go,
             EXCLUDED.detalhe_no_go, EXCLUDED.empresas_vencedoras, EXCLUDED.motivo_lost, EXCLUDED.observacoes, EXCLUDED.posicao_lance, EXCLUDED.situacao_lance,
             EXCLUDED.pendencias)
    RETURNING (xmax = 0) AS inserida
  )
  SELECT count(*) FILTER (WHERE inserida), count(*) FILTER (WHERE NOT inserida) INTO inseridas, atualizadas FROM up;
  UPDATE oportunidades SET ausente_na_planilha = false WHERE ausente_na_planilha AND chave_planilha = ANY (chaves);
  UPDATE oportunidades SET ausente_na_planilha = true
   WHERE fonte = 'planilha' AND chave_planilha IS NOT NULL AND NOT (chave_planilha = ANY (chaves)) AND NOT ausente_na_planilha AND arquivado_em IS NULL;
  GET DIAGNOSTICS ausentes = ROW_COUNT;
  UPDATE carga_status SET ultima_carga_em = now(), total_linhas = (SELECT count(*) FROM oportunidades WHERE arquivado_em IS NULL), fonte = p_fonte, erro = NULL WHERE id = 1;
  RETURN jsonb_build_object('recebidas', total, 'inseridas', inseridas, 'atualizadas', atualizadas, 'protegidas_edicao_web', protegidas, 'marcadas_ausentes', ausentes);
END $$;;

------------------------------------------------------------------ 10. trava da carga antiga (substituição total)
CREATE OR REPLACE FUNCTION _carga_total_permitida() RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM oportunidades WHERE fonte = 'web') THEN
    RAISE EXCEPTION 'Há oportunidades cadastradas na web: a carga total apagaria esses registros. Use sincronizar_planilha().';
  END IF;
END $$;;

CREATE OR REPLACE FUNCTION carregar_oportunidades(p_rows jsonb, p_fonte text DEFAULT 'agent') RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows deve ser um array JSON nao vazio';
  END IF;
  PERFORM _carga_total_permitida();
  DELETE FROM oportunidades;
  INSERT INTO oportunidades (ano, mes, status, uf, torre, linha_servico, vistoria, analista, motivo_no_go, motivo_lost,
                             conta_vinculada, orcamento, valor_ctc, valor_vencedor, sla, processo, orgao, descritivo, data_pregao, acao_ia)
  SELECT r."ano", r."mes", r."status", r."uf", r."torre", r."linhaServico", r."vistoria", r."analista", r."motivoNoGo", r."motivoLost",
         r."contaVinculada", r."orcamento", r."valorCtc", r."valorVencedor", r."sla", r."processo", r."orgao", r."descritivo", r."dataPregao", r."acaoIA"
  FROM jsonb_to_recordset(p_rows) AS r("ano" text, "mes" text, "status" text, "uf" text, "torre" text, "linhaServico" text, "vistoria" text,
       "analista" text, "motivoNoGo" text, "motivoLost" text, "contaVinculada" text, "orcamento" numeric, "valorCtc" numeric,
       "valorVencedor" numeric, "sla" numeric, "processo" text, "orgao" text, "descritivo" text, "dataPregao" text, "acaoIA" jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE carga_status SET ultima_carga_em = now(), total_linhas = n, fonte = p_fonte, erro = NULL WHERE id = 1;
  RETURN n;
END $$;;

------------------------------------------------------------------ 11. permissões
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'radar_app') THEN CREATE ROLE radar_app NOLOGIN; END IF;
END $$;;
REVOKE ALL ON FUNCTION criar_oportunidade(jsonb, text), atualizar_oportunidade(bigint, int, jsonb, text), arquivar_oportunidade(bigint, text, boolean),
  salvar_opcao(text, text, boolean, int, text), salvar_usuario(text, text, boolean, boolean, boolean, text), sincronizar_planilha(jsonb, text, boolean),
  eh_admin(text), validar_oportunidade(oportunidade_campos, oportunidades), _lista_ok(text, text, text) FROM PUBLIC;;
GRANT USAGE ON SCHEMA public TO radar_app;;
GRANT SELECT ON oportunidades, oportunidades_historico, opcoes, usuarios, carga_status TO radar_app;;
GRANT EXECUTE ON FUNCTION criar_oportunidade(jsonb, text), atualizar_oportunidade(bigint, int, jsonb, text), arquivar_oportunidade(bigint, text, boolean),
  salvar_opcao(text, text, boolean, int, text), salvar_usuario(text, text, boolean, boolean, boolean, text), eh_admin(text) TO radar_app;;
GRANT EXECUTE ON FUNCTION sincronizar_planilha(jsonb, text, boolean) TO radar_escritor;;
GRANT SELECT ON opcoes, usuarios TO radar_leitor;;
