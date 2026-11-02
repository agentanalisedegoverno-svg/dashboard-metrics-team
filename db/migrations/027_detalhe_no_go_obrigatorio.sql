-- 027: a descrição do No Go (detalhe_no_go) passa a ser obrigatória quando o status é No Go, além do motivo da lista.
--  - Só a validação muda: validar_oportunidade é reescrita a partir da definição em vigor (depois da 025), com uma linha nova.
--  - Registros No Go antigos sem descrição (19 em 02/11/2026) continuam como estão; a exigência vale na próxima gravação de cada um.
--  - O formulário, o catálogo da API externa e o e-mail (que destaca motivo e descrição) já acompanham a regra no código.
--  - Depende da migração 025; aplicar na ordem.

DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('validar_oportunidade(oportunidade_campos, oportunidades)'::regprocedure);
  def := replace(def, '  IF r.status = ''Lost'' AND coalesce(btrim(r.motivo_lost), '''') = '''' THEN',
    '  IF r.status = ''No Go'' AND coalesce(btrim(r.detalhe_no_go), '''') = '''' THEN erros := erros || jsonb_build_object(''campo'',''detalhe_no_go'',''mensagem'',''Informe a descrição do No Go''); END IF;' || chr(10) ||
    '  IF r.status = ''Lost'' AND coalesce(btrim(r.motivo_lost), '''') = '''' THEN');
  IF position('Informe a descrição do No Go' IN def) = 0 THEN RAISE EXCEPTION 'validar_oportunidade: trecho não encontrado (aplique a 025 antes)'; END IF;
  EXECUTE def;
END $$;;
