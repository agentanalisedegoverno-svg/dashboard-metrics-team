-- 009: e-mail a cada nova oportunidade (módulo configurável pelo administrador).
--  - O cadastro NÃO envia e-mail: um gatilho só grava um pedido na fila (email_fila). Se algo falhar aqui, o cadastro segue normalmente.
--  - Só oportunidades criadas pela WEB entram na fila (a carga da planilha nunca envia).
--  - Quem envia é o workflow "Enviar e-mails" (GitHub Actions, SMTP do Gmail), com o papel radar_email.
--  - Regras (liga/desliga, status que disparam, destinatários) ficam no banco e são editadas só por administradores.
--  - Começa DESLIGADO e sem status marcado: nada é enviado até o administrador configurar.

CREATE TABLE IF NOT EXISTS email_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo boolean NOT NULL DEFAULT false,
  status_gatilho text[] NOT NULL DEFAULT '{}',
  atualizado_por text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);;
INSERT INTO email_config (id) VALUES (1) ON CONFLICT DO NOTHING;;

CREATE TABLE IF NOT EXISTS email_destinatarios (
  email text PRIMARY KEY CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  tipo text NOT NULL DEFAULT 'para' CHECK (tipo IN ('para', 'cc')),
  ativo boolean NOT NULL DEFAULT true
);;

CREATE TABLE IF NOT EXISTS email_fila (
  id bigserial PRIMARY KEY,
  tipo text NOT NULL DEFAULT 'nova' CHECK (tipo IN ('nova', 'teste')),
  oportunidade_id bigint REFERENCES oportunidades (id),
  destino_teste text,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'enviado', 'erro', 'ignorado')),
  tentativas int NOT NULL DEFAULT 0,
  ultimo_erro text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  CHECK ((tipo = 'nova' AND oportunidade_id IS NOT NULL) OR (tipo = 'teste' AND destino_teste IS NOT NULL))
);;
CREATE UNIQUE INDEX IF NOT EXISTS email_fila_nova_unica ON email_fila (oportunidade_id) WHERE tipo = 'nova';;
CREATE INDEX IF NOT EXISTS email_fila_pendente ON email_fila (id) WHERE situacao = 'pendente';;

-- Gatilho: nova oportunidade da web com status marcado e módulo ligado -> entra na fila. Nunca derruba o cadastro.
CREATE OR REPLACE FUNCTION oportunidades_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.fonte = 'web' AND EXISTS (SELECT 1 FROM email_config WHERE ativo AND NEW.status = ANY (status_gatilho)) THEN
    INSERT INTO email_fila (tipo, oportunidade_id) VALUES ('nova', NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fila de e-mail: %', SQLERRM;
  RETURN NEW;
END $$;;
DROP TRIGGER IF EXISTS oportunidades_email_tg ON oportunidades;;
CREATE TRIGGER oportunidades_email_tg AFTER INSERT ON oportunidades FOR EACH ROW EXECUTE FUNCTION oportunidades_email();;

-- Salva as regras de uma vez (liga/desliga + status + destinatários). Só administrador.
-- p_destinatarios: [{"email":"a@b.com","tipo":"para"|"cc","ativo":true}]
CREATE OR REPLACE FUNCTION salvar_email_config(p_ativo boolean, p_status text[], p_destinatarios jsonb, p_por text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d jsonb; v_email text; v_tipo text; v_erros jsonb := '[]'::jsonb; v_status text[]; v_qtd int := 0; v_ativos int := 0;
BEGIN
  IF NOT eh_admin(p_por) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Somente administradores configuram o envio de e-mails'; END IF;
  IF p_destinatarios IS NULL OR jsonb_typeof(p_destinatarios) <> 'array' THEN p_destinatarios := '[]'::jsonb; END IF;

  SELECT coalesce(array_agg(DISTINCT s), '{}') INTO v_status FROM unnest(coalesce(p_status, '{}')) AS s;
  IF EXISTS (SELECT 1 FROM unnest(v_status) AS s WHERE NOT EXISTS (SELECT 1 FROM opcoes o WHERE o.lista = 'status' AND o.valor = s)) THEN
    v_erros := v_erros || jsonb_build_object('campo', 'status', 'mensagem', 'Há status fora da lista de opções');
  END IF;
  IF jsonb_array_length(p_destinatarios) > 30 THEN
    v_erros := v_erros || jsonb_build_object('campo', 'destinatarios', 'mensagem', 'No máximo 30 destinatários');
  END IF;

  FOR d IN SELECT * FROM jsonb_array_elements(p_destinatarios) LOOP
    v_email := lower(btrim(coalesce(d ->> 'email', '')));
    v_tipo := coalesce(d ->> 'tipo', 'para');
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
      v_erros := v_erros || jsonb_build_object('campo', 'destinatarios', 'mensagem', 'E-mail inválido: ' || left(v_email, 60));
    END IF;
    IF v_tipo NOT IN ('para', 'cc') THEN
      v_erros := v_erros || jsonb_build_object('campo', 'destinatarios', 'mensagem', 'Tipo deve ser para ou cc');
    END IF;
    v_qtd := v_qtd + 1;
    IF coalesce((d ->> 'ativo')::boolean, true) THEN v_ativos := v_ativos + 1; END IF;
  END LOOP;

  IF p_ativo AND cardinality(v_status) = 0 THEN
    v_erros := v_erros || jsonb_build_object('campo', 'status', 'mensagem', 'Marque ao menos um status para ligar o envio');
  END IF;
  IF p_ativo AND v_ativos = 0 THEN
    v_erros := v_erros || jsonb_build_object('campo', 'destinatarios', 'mensagem', 'Cadastre ao menos um destinatário ativo para ligar o envio');
  END IF;
  IF jsonb_array_length(v_erros) > 0 THEN RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = v_erros::text; END IF;

  DELETE FROM email_destinatarios;
  INSERT INTO email_destinatarios (email, tipo, ativo)
  SELECT DISTINCT ON (lower(btrim(x ->> 'email'))) lower(btrim(x ->> 'email')), coalesce(x ->> 'tipo', 'para'), coalesce((x ->> 'ativo')::boolean, true)
  FROM jsonb_array_elements(p_destinatarios) AS x
  ORDER BY lower(btrim(x ->> 'email'));
  UPDATE email_config SET ativo = p_ativo, status_gatilho = v_status, atualizado_por = lower(p_por), atualizado_em = now() WHERE id = 1;
END $$;;

-- E-mail de teste: vai só para quem pediu (nunca para a lista de destinatários).
CREATE OR REPLACE FUNCTION enfileirar_email_teste(p_por text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT eh_admin(p_por) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Somente administradores configuram o envio de e-mails'; END IF;
  IF EXISTS (SELECT 1 FROM email_fila WHERE tipo = 'teste' AND destino_teste = lower(p_por) AND situacao = 'pendente') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"teste","mensagem":"Já há um e-mail de teste aguardando envio: aguarde alguns minutos"}]';
  END IF;
  INSERT INTO email_fila (tipo, destino_teste) VALUES ('teste', lower(p_por));
END $$;;

REVOKE ALL ON FUNCTION salvar_email_config(boolean, text[], jsonb, text), enfileirar_email_teste(text), oportunidades_email() FROM PUBLIC;;
GRANT EXECUTE ON FUNCTION salvar_email_config(boolean, text[], jsonb, text), enfileirar_email_teste(text) TO radar_app;;
GRANT SELECT ON email_config, email_destinatarios, email_fila TO radar_app;;

-- Papel do envio (workflow "Enviar e-mails"): lê o que precisa e só atualiza a fila.
-- Começa NOLOGIN; o login/senha é definido à parte (fora do Git).
DO $$ BEGIN
  CREATE ROLE radar_email NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;
GRANT USAGE ON SCHEMA public TO radar_email;;
GRANT SELECT ON oportunidades, email_config, email_destinatarios TO radar_email;;
GRANT SELECT, UPDATE ON email_fila TO radar_email;;
