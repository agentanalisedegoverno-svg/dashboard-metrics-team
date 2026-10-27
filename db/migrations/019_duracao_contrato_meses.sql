-- 019: campo "Duração do contrato (meses)" no lugar do campo "Tipo" do formulário.
--  - Coluna nova duracao_contrato_meses (inteiro, opcional, de 1 a 600). Aparece em amarelo, no lugar do antigo "Tipo".
--  - A coluna antiga `tipo` NÃO é apagada (veio da planilha e quase não era usada): continua no banco e na carga, mas o
--    formulário deixa de mostrá-la e o salvamento não a altera mais.
--  - criar/atualizar/validar são reescritas a partir da definição em vigor, trocando só os trechos do campo.

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS duracao_contrato_meses integer;;
DO $$ BEGIN
  ALTER TYPE oportunidade_campos ADD ATTRIBUTE duracao_contrato_meses integer;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;;

DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('criar_oportunidade(jsonb, text)'::regprocedure);
  def := replace(def, 'hora_pregao, sigla)', 'hora_pregao, sigla, duracao_contrato_meses)');
  def := replace(def, 'nullif(btrim(r.sigla), ''''))', 'nullif(btrim(r.sigla), ''''), r.duracao_contrato_meses)');
  IF position('duracao_contrato_meses)' IN def) = 0 OR position('r.duracao_contrato_meses)' IN def) = 0 THEN RAISE EXCEPTION 'criar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('atualizar_oportunidade(bigint, integer, jsonb, text)'::regprocedure);
  def := replace(def, 'modalidade = r.modalidade, tipo = r.tipo,', 'modalidade = r.modalidade,');
  def := replace(def, 'sigla = nullif(btrim(r.sigla), ''''),', 'sigla = nullif(btrim(r.sigla), ''''), duracao_contrato_meses = r.duracao_contrato_meses,');
  IF position('duracao_contrato_meses = r.duracao_contrato_meses' IN def) = 0 OR position('tipo = r.tipo' IN def) > 0 THEN RAISE EXCEPTION 'atualizar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;

  def := pg_get_functiondef('validar_oportunidade(oportunidade_campos, oportunidades)'::regprocedure);
  def := replace(def, '  IF length(coalesce(r.orgao,'''')) > 120 THEN',
    '  IF r.duracao_contrato_meses IS NOT NULL AND (r.duracao_contrato_meses < 1 OR r.duracao_contrato_meses > 600) THEN erros := erros || jsonb_build_object(''campo'',''duracao_contrato_meses'',''mensagem'',''Informe de 1 a 600 meses''); END IF;' || chr(10) || '  IF length(coalesce(r.orgao,'''')) > 120 THEN');
  IF position('Informe de 1 a 600 meses' IN def) = 0 THEN RAISE EXCEPTION 'validar_oportunidade: trecho não encontrado'; END IF;
  EXECUTE def;
END $$;;
