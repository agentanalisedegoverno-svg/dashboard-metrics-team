-- 025: campo Segmento (Corporate ou Público), ao lado da sigla, no formulário e na API externa.
--  - Coluna segmento (texto, opcional): só 'Corporate' ou 'Público'. Registros antigos ficam em branco (a informação não existe na planilha).
--  - A carga da planilha não toca nesta coluna.
--  - O histórico, o e-mail e o cartão do Planner enxergam o campo sozinhos (leem a lista de campos do Radar).
--  - criar/atualizar/validar são reescritas a partir da definição em vigor (depois da 023), trocando só os trechos do campo.
--  - Depende da migração 023 (usa as mesmas âncoras de texto); aplicar na ordem.

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS segmento text;;
DO $$ BEGIN
  ALTER TYPE oportunidade_campos ADD ATTRIBUTE segmento text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;;

DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('criar_oportunidade(jsonb, text)'::regprocedure);
  def := replace(def, 'documentos_nome, documentos_url)', 'documentos_nome, documentos_url, segmento)');
  def := replace(def, 'nullif(btrim(r.documentos_url), ''''))', 'nullif(btrim(r.documentos_url), ''''), nullif(btrim(r.segmento), ''''))');
  IF position('documentos_url, segmento)' IN def) = 0 OR position('nullif(btrim(r.segmento)' IN def) = 0 THEN RAISE EXCEPTION 'criar_oportunidade: trecho não encontrado (aplique a 023 antes)'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('atualizar_oportunidade(bigint, integer, jsonb, text)'::regprocedure);
  def := replace(def, 'documentos_url = nullif(btrim(r.documentos_url), ''''),', 'documentos_url = nullif(btrim(r.documentos_url), ''''), segmento = nullif(btrim(r.segmento), ''''),');
  IF position('segmento = nullif' IN def) = 0 THEN RAISE EXCEPTION 'atualizar_oportunidade: trecho não encontrado (aplique a 023 antes)'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('validar_oportunidade(oportunidade_campos, oportunidades)'::regprocedure);
  def := replace(def, '  IF length(coalesce(r.orgao,'''')) > 120 THEN',
    '  IF nullif(btrim(r.segmento), '''') IS NOT NULL AND btrim(r.segmento) NOT IN (''Corporate'', ''Público'') THEN erros := erros || jsonb_build_object(''campo'',''segmento'',''mensagem'',''Use Corporate ou Público''); END IF;' || chr(10) ||
    '  IF length(coalesce(r.orgao,'''')) > 120 THEN');
  IF position('Use Corporate ou Público' IN def) = 0 THEN RAISE EXCEPTION 'validar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;
END $$;;
