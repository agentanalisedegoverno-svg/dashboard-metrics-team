-- 020: API externa para criar oportunidades (outra aplicação cadastra como se fosse manual).
--  - api_clientes: uma linha por aplicação autorizada; guarda só o HASH (SHA-256) da chave, nunca a chave.
--  - api_idempotencia: evita duplicar a oportunidade quando a aplicação repete a chamada (cabeçalho Idempotency-Key).
--  - oportunidades.solicitante: quem pediu a criação na aplicação externa (opcional); criado_por vira 'api:<cliente>'.
--  - criar_oportunidade_api: usa a MESMA criar_oportunidade (validações, gatilhos, histórico, e-mail e Planner iguais ao cadastro manual).
--  - O administrador gerencia as chaves por funções que checam eh_admin (criar, listar, revogar).

CREATE TABLE IF NOT EXISTS api_clientes (
  id            bigserial PRIMARY KEY,
  nome          text NOT NULL UNIQUE CHECK (nome ~ '^[a-z0-9][a-z0-9_-]{2,39}$'),
  chave_hash    text NOT NULL UNIQUE,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    text NOT NULL,
  ultimo_uso_em timestamptz,
  revogado_em   timestamptz
);;

CREATE TABLE IF NOT EXISTS api_idempotencia (
  cliente        text NOT NULL,
  chave          text NOT NULL,
  oportunidade_id bigint,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente, chave)
);;

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS solicitante text;;

CREATE OR REPLACE FUNCTION oportunidades_solicitante_antes_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Só a criação pela API define app.solicitante (local à transação); no cadastro manual fica vazio.
  NEW.solicitante := nullif(btrim(coalesce(current_setting('app.solicitante', true), '')), '');
  RETURN NEW;
END $$;;

DROP TRIGGER IF EXISTS oportunidades_solicitante_tg ON oportunidades;;
CREATE TRIGGER oportunidades_solicitante_tg BEFORE INSERT ON oportunidades
  FOR EACH ROW EXECUTE FUNCTION oportunidades_solicitante_antes_insert();;

-- Autentica pelo hash da chave. Devolve o nome do cliente, ou NULL se a chave não existe ou foi revogada.
CREATE OR REPLACE FUNCTION autenticar_api_cliente(p_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id bigint; v_nome text; v_uso timestamptz;
BEGIN
  SELECT id, nome, ultimo_uso_em INTO v_id, v_nome, v_uso FROM api_clientes WHERE chave_hash = p_hash AND ativo AND revogado_em IS NULL;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF v_uso IS NULL OR v_uso < now() - interval '1 minute' THEN UPDATE api_clientes SET ultimo_uso_em = now() WHERE id = v_id; END IF;
  RETURN v_nome;
END $$;;

-- Cria a oportunidade exatamente como o cadastro manual, só que a autoria é a aplicação ('api:<cliente>') e há o solicitante.
CREATE OR REPLACE FUNCTION criar_oportunidade_api(p jsonb, p_cliente text, p_solicitante text, p_idem text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o jsonb; oid bigint; n integer;
BEGIN
  IF p_cliente IS NULL OR p_cliente !~ '^[a-z0-9][a-z0-9_-]{2,39}$' THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Cliente da API não identificado'; END IF;
  IF p_solicitante IS NOT NULL AND length(p_solicitante) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"solicitante","mensagem":"Máximo de 120 caracteres"}]';
  END IF;
  IF p_idem IS NOT NULL THEN
    IF length(p_idem) < 1 OR length(p_idem) > 100 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"Idempotency-Key","mensagem":"Use de 1 a 100 caracteres"}]';
    END IF;
    -- Reserva a chave; se já existe (repetição ou chamada simultânea), devolve a oportunidade já criada em vez de duplicar.
    INSERT INTO api_idempotencia (cliente, chave) VALUES (p_cliente, p_idem) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      SELECT oportunidade_id INTO oid FROM api_idempotencia WHERE cliente = p_cliente AND chave = p_idem;
      SELECT to_jsonb(x) INTO o FROM oportunidades x WHERE x.id = oid;
      IF o IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = '{"error":"Chamada com esta Idempotency-Key ainda em andamento."}'; END IF;
      RETURN o || '{"idempotente": true}'::jsonb;
    END IF;
  END IF;
  PERFORM set_config('app.solicitante', coalesce(btrim(p_solicitante), ''), true);
  o := criar_oportunidade(p, 'api:' || p_cliente);
  IF p_idem IS NOT NULL THEN UPDATE api_idempotencia SET oportunidade_id = (o->>'id')::bigint WHERE cliente = p_cliente AND chave = p_idem; END IF;
  RETURN o;
END $$;;

-- Administração das chaves (só administrador do Radar).
CREATE OR REPLACE FUNCTION listar_api_clientes(p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT eh_admin(p_email) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Só administradores gerenciam as chaves da API'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ativo', ativo, 'criado_em', criado_em, 'criado_por', criado_por,
                                                       'ultimo_uso_em', ultimo_uso_em, 'revogado_em', revogado_em) ORDER BY id) FROM api_clientes), '[]'::jsonb);
END $$;;

CREATE OR REPLACE FUNCTION criar_api_cliente(p_nome text, p_hash text, p_email text) RETURNS jsonb
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
  IF EXISTS (SELECT 1 FROM api_clientes WHERE nome = p_nome) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"nome","mensagem":"Já existe um cliente com este nome"}]';
  END IF;
  INSERT INTO api_clientes (nome, chave_hash, criado_por) VALUES (p_nome, p_hash, lower(p_email)) RETURNING * INTO v;
  RETURN jsonb_build_object('id', v.id, 'nome', v.nome, 'ativo', v.ativo, 'criado_em', v.criado_em);
END $$;;

CREATE OR REPLACE FUNCTION revogar_api_cliente(p_id bigint, p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v api_clientes;
BEGIN
  IF NOT eh_admin(p_email) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Só administradores gerenciam as chaves da API'; END IF;
  UPDATE api_clientes SET ativo = false, revogado_em = coalesce(revogado_em, now()) WHERE id = p_id RETURNING * INTO v;
  IF v.id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'Cliente da API não encontrado'; END IF;
  RETURN jsonb_build_object('id', v.id, 'nome', v.nome, 'ativo', v.ativo, 'revogado_em', v.revogado_em);
END $$;;

REVOKE ALL ON FUNCTION autenticar_api_cliente(text), criar_oportunidade_api(jsonb, text, text, text), listar_api_clientes(text),
  criar_api_cliente(text, text, text), revogar_api_cliente(bigint, text), oportunidades_solicitante_antes_insert() FROM PUBLIC;;
GRANT EXECUTE ON FUNCTION autenticar_api_cliente(text), criar_oportunidade_api(jsonb, text, text, text), listar_api_clientes(text),
  criar_api_cliente(text, text, text), revogar_api_cliente(bigint, text) TO radar_app;;
