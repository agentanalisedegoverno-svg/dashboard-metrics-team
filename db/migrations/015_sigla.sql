-- 015: campo Sigla (antes de Instituição / Órgão): texto de até 8 caracteres, opcional.
--  - Não existe na planilha: fica em branco nos registros importados e a carga por merge não o toca.
--  - O histórico (auditar) e a leitura (to_jsonb) enxergam a coluna sozinhos.
--  - criar/atualizar/validar são reescritas a partir da definição em vigor, trocando só os trechos do campo novo.

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS sigla text;;
DO $$ BEGIN
  ALTER TYPE oportunidade_campos ADD ATTRIBUTE sigla text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;;

DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('criar_oportunidade(jsonb, text)'::regprocedure);
  def := replace(def, 'empresa_vencedora_tipo, objeto, hora_pregao)', 'empresa_vencedora_tipo, objeto, hora_pregao, sigla)');
  def := replace(def, 'r.empresa_vencedora_tipo, r.objeto, r.hora_pregao)', 'r.empresa_vencedora_tipo, r.objeto, r.hora_pregao, nullif(btrim(r.sigla), ''''))');
  IF position('nullif(btrim(r.sigla)' IN def) = 0 OR position(', sigla)' IN def) = 0 THEN RAISE EXCEPTION 'criar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('atualizar_oportunidade(bigint, integer, jsonb, text)'::regprocedure);
  def := replace(def, 'objeto = r.objeto, hora_pregao = r.hora_pregao,', 'objeto = r.objeto, hora_pregao = r.hora_pregao, sigla = nullif(btrim(r.sigla), ''''),');
  IF position('sigla = nullif' IN def) = 0 THEN RAISE EXCEPTION 'atualizar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('validar_oportunidade(oportunidade_campos, oportunidades)'::regprocedure);
  def := replace(def, '  IF length(coalesce(r.orgao,'''')) > 120 THEN',
    '  IF length(coalesce(btrim(r.sigla),'''')) > 8 THEN erros := erros || jsonb_build_object(''campo'',''sigla'',''mensagem'',''Máximo de 8 caracteres''); END IF;' || chr(10) || '  IF length(coalesce(r.orgao,'''')) > 120 THEN');
  IF position('Máximo de 8 caracteres' IN def) = 0 THEN RAISE EXCEPTION 'validar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;
END $$;;
