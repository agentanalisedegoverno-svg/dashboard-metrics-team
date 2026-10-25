-- 010: avisar também o pré-vendas da oportunidade.
--  - Nova regra em email_config: avisar_pre_vendas. Ligada, o aviso vai também para o e-mail do pré-vendas escolhido na
--    oportunidade (se ele tiver e-mail cadastrado e estiver ativo), sem duplicar quem já está na lista.
--  - Com ela ligada, a lista de destinatários pode ficar vazia.
--  - O papel de envio passa a ler só nome, e-mail e ativo dos usuários (para achar o e-mail do pré-vendas).
--  - salvar_email_config ganha um 5º parâmetro com padrão false; a versão antiga de 4 parâmetros sai (chamadas antigas continuam valendo).

ALTER TABLE email_config ADD COLUMN IF NOT EXISTS avisar_pre_vendas boolean NOT NULL DEFAULT false;;
GRANT SELECT (nome, email, ativo) ON usuarios TO radar_email;;

DROP FUNCTION IF EXISTS salvar_email_config(boolean, text[], jsonb, text);;
CREATE OR REPLACE FUNCTION salvar_email_config(p_ativo boolean, p_status text[], p_destinatarios jsonb, p_por text, p_avisar_pre_vendas boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF p_ativo AND v_ativos = 0 AND NOT coalesce(p_avisar_pre_vendas, false) THEN
    v_erros := v_erros || jsonb_build_object('campo', 'destinatarios', 'mensagem', 'Cadastre ao menos um destinatário ativo (ou marque o aviso ao pré-vendas) para ligar o envio');
  END IF;
  IF jsonb_array_length(v_erros) > 0 THEN RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = v_erros::text; END IF;

  DELETE FROM email_destinatarios;
  INSERT INTO email_destinatarios (email, tipo, ativo)
  SELECT DISTINCT ON (lower(btrim(x ->> 'email'))) lower(btrim(x ->> 'email')), coalesce(x ->> 'tipo', 'para'), coalesce((x ->> 'ativo')::boolean, true)
  FROM jsonb_array_elements(p_destinatarios) AS x
  ORDER BY lower(btrim(x ->> 'email'));
  UPDATE email_config SET ativo = p_ativo, status_gatilho = v_status, avisar_pre_vendas = coalesce(p_avisar_pre_vendas, false), atualizado_por = lower(p_por), atualizado_em = now() WHERE id = 1;
END $$;;

REVOKE ALL ON FUNCTION salvar_email_config(boolean, text[], jsonb, text, boolean) FROM PUBLIC;;
GRANT EXECUTE ON FUNCTION salvar_email_config(boolean, text[], jsonb, text, boolean) TO radar_app;;
