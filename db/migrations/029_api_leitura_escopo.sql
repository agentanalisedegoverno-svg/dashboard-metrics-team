-- 029: escopo das chaves da API externa (leitura x escrita), para consumir as oportunidades só para visualização.
--  - api_clientes.escopo: 'escrita' (cria oportunidades; é o que todas as chaves existentes já fazem) ou 'leitura' (só consulta).
--    Uma chave de leitura NÃO cria nada e uma chave de escrita NÃO lê a listagem: a separação é exigida pela API.
--  - autenticar_api_chave: devolve {nome, escopo} (a autenticar_api_cliente antiga continua existindo, para o código publicado antes
--    desta migração seguir funcionando durante o deploy).
--  - criar_api_cliente ganha o parâmetro de escopo (padrão 'escrita', compatível com quem chama com 3 argumentos).
--  - listar_api_clientes passa a mostrar o escopo.

ALTER TABLE api_clientes ADD COLUMN IF NOT EXISTS escopo text NOT NULL DEFAULT 'escrita';;
DO $$ BEGIN
  ALTER TABLE api_clientes ADD CONSTRAINT api_clientes_escopo_ck CHECK (escopo IN ('escrita', 'leitura'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;

CREATE OR REPLACE FUNCTION autenticar_api_chave(p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id bigint; v_nome text; v_escopo text; v_uso timestamptz;
BEGIN
  SELECT id, nome, escopo, ultimo_uso_em INTO v_id, v_nome, v_escopo, v_uso FROM api_clientes WHERE chave_hash = p_hash AND ativo AND revogado_em IS NULL;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF v_uso IS NULL OR v_uso < now() - interval '1 minute' THEN UPDATE api_clientes SET ultimo_uso_em = now() WHERE id = v_id; END IF;
  RETURN jsonb_build_object('nome', v_nome, 'escopo', v_escopo);
END $$;;

DROP FUNCTION IF EXISTS criar_api_cliente(text, text, text);;
CREATE OR REPLACE FUNCTION criar_api_cliente(p_nome text, p_hash text, p_email text, p_escopo text DEFAULT 'escrita') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v api_clientes;
BEGIN
  IF NOT eh_admin(p_email) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Só administradores gerenciam as chaves da API'; END IF;
  IF p_nome IS NULL OR p_nome !~ '^[a-z0-9][a-z0-9_-]{2,39}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"nome","mensagem":"Use de 3 a 40 caracteres: letras minúsculas, números, - e _"}]';
  END IF;
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"chave","mensagem":"Hash inválido"}]';
  END IF;
  IF p_escopo IS NULL OR p_escopo NOT IN ('escrita', 'leitura') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"escopo","mensagem":"Use escrita ou leitura"}]';
  END IF;
  IF EXISTS (SELECT 1 FROM api_clientes WHERE nome = p_nome) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"nome","mensagem":"Já existe um cliente com este nome"}]';
  END IF;
  INSERT INTO api_clientes (nome, chave_hash, criado_por, escopo) VALUES (p_nome, p_hash, lower(p_email), p_escopo) RETURNING * INTO v;
  RETURN jsonb_build_object('id', v.id, 'nome', v.nome, 'escopo', v.escopo, 'ativo', v.ativo, 'criado_em', v.criado_em);
END $$;;

CREATE OR REPLACE FUNCTION listar_api_clientes(p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT eh_admin(p_email) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Só administradores gerenciam as chaves da API'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'escopo', escopo, 'ativo', ativo, 'criado_em', criado_em, 'criado_por', criado_por,
                                                       'ultimo_uso_em', ultimo_uso_em, 'revogado_em', revogado_em) ORDER BY id) FROM api_clientes), '[]'::jsonb);
END $$;;

REVOKE ALL ON FUNCTION autenticar_api_chave(text), criar_api_cliente(text, text, text, text) FROM PUBLIC;;
GRANT EXECUTE ON FUNCTION autenticar_api_chave(text), criar_api_cliente(text, text, text, text) TO radar_app;;
