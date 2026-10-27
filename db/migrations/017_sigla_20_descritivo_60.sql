-- 017: limites maiores nos campos de texto curto da oportunidade.
--  - Sigla: de 8 para 20 caracteres.
--  - Descritivo: de 50 para 60 caracteres (continua valendo só ao criar ou alterar o texto; registro antigo mais longo
--    segue salvando enquanto o descritivo não for mexido).
--  - Só a validação muda: a função validar_oportunidade é reescrita a partir da definição em vigor.

DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('validar_oportunidade(oportunidade_campos, oportunidades)'::regprocedure);
  def := replace(def, 'length(coalesce(btrim(r.sigla),'''')) > 8 THEN', 'length(coalesce(btrim(r.sigla),'''')) > 20 THEN');
  def := replace(def, '''campo'',''sigla'',''mensagem'',''Máximo de 8 caracteres''', '''campo'',''sigla'',''mensagem'',''Máximo de 20 caracteres''');
  def := replace(def, 'length(coalesce(r.descritivo,'''')) > 50 AND', 'length(coalesce(r.descritivo,'''')) > 60 AND');
  def := replace(def, '''campo'',''descritivo'',''mensagem'',''Máximo de 50 caracteres''', '''campo'',''descritivo'',''mensagem'',''Máximo de 60 caracteres''');
  IF position('btrim(r.sigla),'''')) > 20' IN def) = 0 OR position('Máximo de 20 caracteres' IN def) = 0
     OR position('r.descritivo,'''')) > 60' IN def) = 0 OR position('Máximo de 60 caracteres' IN def) = 0 THEN
    RAISE EXCEPTION 'validar_oportunidade: trecho não encontrado';
  END IF;
  EXECUTE def;
END $$;;
