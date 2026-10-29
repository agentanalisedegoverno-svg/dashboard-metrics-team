-- 023: pasta de documentação da oportunidade (nome + link), preenchida no formulário ou pela API externa.
--  - documentos_nome: nome da pasta (até 80 caracteres, opcional; ex.: "Pasta XPTO").
--  - documentos_url: link https da pasta (OneDrive, SharePoint ou outra), até 2000 caracteres, opcional. Quem tem o nome precisa ter o link.
--  - Aparece no formulário, no histórico, no e-mail e no cartão do Planner (todos leem a lista de campos do Radar).
--  - A carga da planilha não toca nestas colunas (não existem na planilha).
--  - criar/atualizar/validar são reescritas a partir da definição em vigor, trocando só os trechos do campo.

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS documentos_nome text;;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS documentos_url text;;
DO $$ BEGIN
  ALTER TYPE oportunidade_campos ADD ATTRIBUTE documentos_nome text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;;
DO $$ BEGIN
  ALTER TYPE oportunidade_campos ADD ATTRIBUTE documentos_url text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;;

DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('criar_oportunidade(jsonb, text)'::regprocedure);
  def := replace(def, 'hora_pregao, sigla, duracao_contrato_meses)', 'hora_pregao, sigla, duracao_contrato_meses, documentos_nome, documentos_url)');
  def := replace(def, 'r.duracao_contrato_meses)', 'r.duracao_contrato_meses, nullif(btrim(r.documentos_nome), ''''), nullif(btrim(r.documentos_url), ''''))');
  IF position('documentos_nome, documentos_url)' IN def) = 0 OR position('nullif(btrim(r.documentos_url)' IN def) = 0 THEN RAISE EXCEPTION 'criar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('atualizar_oportunidade(bigint, integer, jsonb, text)'::regprocedure);
  def := replace(def, 'duracao_contrato_meses = r.duracao_contrato_meses,', 'duracao_contrato_meses = r.duracao_contrato_meses, documentos_nome = nullif(btrim(r.documentos_nome), ''''), documentos_url = nullif(btrim(r.documentos_url), ''''),');
  IF position('documentos_url = nullif' IN def) = 0 THEN RAISE EXCEPTION 'atualizar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('validar_oportunidade(oportunidade_campos, oportunidades)'::regprocedure);
  def := replace(def, '  IF length(coalesce(r.orgao,'''')) > 120 THEN',
    '  IF length(coalesce(btrim(r.documentos_nome),'''')) > 80 THEN erros := erros || jsonb_build_object(''campo'',''documentos_nome'',''mensagem'',''Máximo de 80 caracteres''); END IF;' || chr(10) ||
    '  IF nullif(btrim(r.documentos_url), '''') IS NOT NULL AND (length(btrim(r.documentos_url)) > 2000 OR btrim(r.documentos_url) !~ ''^https://[^[:space:]]+$'') THEN erros := erros || jsonb_build_object(''campo'',''documentos_url'',''mensagem'',''Informe um link que comece com https://''); END IF;' || chr(10) ||
    '  IF nullif(btrim(r.documentos_nome), '''') IS NOT NULL AND nullif(btrim(r.documentos_url), '''') IS NULL THEN erros := erros || jsonb_build_object(''campo'',''documentos_url'',''mensagem'',''Informe o link da pasta de documentação''); END IF;' || chr(10) ||
    '  IF length(coalesce(r.orgao,'''')) > 120 THEN');
  IF position('Informe o link da pasta de documentação' IN def) = 0 THEN RAISE EXCEPTION 'validar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;
END $$;;
