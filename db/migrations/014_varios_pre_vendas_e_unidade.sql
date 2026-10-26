-- 014: mais de um pré-vendas por oportunidade e nova lista de Unidade de fornecimento.
--  - analista continua sendo um texto; vários nomes ficam separados por vírgula ("Ana, Marcia"). Cada nome precisa estar
--    na lista de pré-vendas ativos (a validação confere um por um; o que já estava gravado e não mudou continua valendo).
--  - Descritivo: no máximo 50 caracteres ao criar ou alterar o texto (registros antigos, mais longos, continuam salvando
--    enquanto o descritivo não for mexido; a carga da planilha não passa por esta validação).
--  - Unidade de fornecimento passa a ser: Posto de Trabalho, Serviço (valor fixo) e UST. "Serviço" vira "Serviço (valor fixo)"
--    (opções e registros); Ponto de Função e Hora ficam inativos (sem uso em nenhum registro).

DO $$
DECLARE sql_fonte text;
BEGIN
  sql_fonte := pg_get_functiondef('validar_oportunidade(oportunidade_campos, oportunidades)'::regprocedure);
  sql_fonte := replace(sql_fonte,
    'AND NOT EXISTS (SELECT 1 FROM usuarios WHERE nome = r.analista AND pre_vendas AND ativo) THEN',
    'AND EXISTS (SELECT 1 FROM unnest(regexp_split_to_array(r.analista, ''\s*[,;]\s*'')) AS n(nome) WHERE btrim(n.nome) <> '''' AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.nome = btrim(n.nome) AND u.pre_vendas AND u.ativo)) THEN');
  sql_fonte := replace(sql_fonte,
    '  IF length(coalesce(r.orgao,'''')) > 120 THEN',
    '  IF length(coalesce(r.descritivo,'''')) > 50 AND r.descritivo IS DISTINCT FROM a.descritivo THEN erros := erros || jsonb_build_object(''campo'',''descritivo'',''mensagem'',''Máximo de 50 caracteres''); END IF;' || chr(10) || '  IF length(coalesce(r.orgao,'''')) > 120 THEN');
  IF position('regexp_split_to_array' IN sql_fonte) = 0 OR position('Máximo de 50 caracteres' IN sql_fonte) = 0 THEN RAISE EXCEPTION 'validar_oportunidade: trecho do pré-vendas não encontrado'; END IF;
  EXECUTE sql_fonte;
END $$;;

DO $$
BEGIN
  PERFORM set_config('app.origem', 'sync', true);
  UPDATE opcoes SET valor = 'Serviço (valor fixo)', ordem = 2 WHERE lista = 'unidade_fornecimento' AND valor = 'Serviço'
    AND NOT EXISTS (SELECT 1 FROM opcoes WHERE lista = 'unidade_fornecimento' AND valor = 'Serviço (valor fixo)');
  INSERT INTO opcoes (lista, valor, ativo, ordem) VALUES ('unidade_fornecimento', 'Serviço (valor fixo)', true, 2), ('unidade_fornecimento', 'UST', true, 3)
    ON CONFLICT (lista, valor) DO UPDATE SET ativo = true;
  UPDATE opcoes SET ordem = 1 WHERE lista = 'unidade_fornecimento' AND valor = 'Posto de Trabalho';
  UPDATE opcoes SET ativo = false WHERE lista = 'unidade_fornecimento' AND valor IN ('Ponto de Função', 'Hora');
  UPDATE oportunidades SET unidade_fornecimento = 'Serviço (valor fixo)' WHERE unidade_fornecimento = 'Serviço';
END $$;;
