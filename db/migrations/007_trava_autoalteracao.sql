-- 007: trava de autoalteração em salvar_usuario (o administrador não rebaixa nem desativa a si mesmo).
-- Complementa a regra do último administrador (006). Aplicada no banco: vale para qualquer cliente da API.

CREATE OR REPLACE FUNCTION salvar_usuario(p_nome text, p_email text, p_admin boolean, p_pre_vendas boolean, p_ativo boolean, p_por text, p_somente_leitura boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nome text := btrim(p_nome);
BEGIN
  IF NOT eh_admin(p_por) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Somente administradores editam usuários'; END IF;
  -- Boa prática (evita o autobloqueio): a própria pessoa não rebaixa o seu perfil nem se desativa; outro administrador faz isso.
  IF lower(btrim(coalesce(p_email, ''))) = lower(p_por)
     AND EXISTS (SELECT 1 FROM usuarios WHERE usuarios.nome = v_nome AND admin AND ativo)
     AND NOT (p_admin AND p_ativo) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"admin","mensagem":"Você não pode remover o seu próprio perfil de administrador nem se desativar: peça a outro administrador"}]';
  END IF;
  IF p_admin AND p_somente_leitura THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"somente_leitura","mensagem":"Administrador não pode ser somente leitura"}]';
  END IF;
  IF p_somente_leitura AND nullif(btrim(coalesce(p_email, '')), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"email","mensagem":"Informe o e-mail: é por ele que o perfil somente leitura é aplicado"}]';
  END IF;
  IF EXISTS (SELECT 1 FROM usuarios WHERE usuarios.nome = v_nome AND admin AND ativo)
     AND NOT (p_admin AND p_ativo)
     AND NOT EXISTS (SELECT 1 FROM usuarios WHERE usuarios.nome <> v_nome AND admin AND ativo) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"admin","mensagem":"Deve existir ao menos um administrador ativo"}]';
  END IF;
  INSERT INTO usuarios (nome, email, admin, pre_vendas, ativo, somente_leitura)
  VALUES (v_nome, nullif(lower(btrim(coalesce(p_email, ''))), ''), p_admin, p_pre_vendas, p_ativo, p_somente_leitura)
  ON CONFLICT (nome) DO UPDATE SET email = EXCLUDED.email, admin = EXCLUDED.admin, pre_vendas = EXCLUDED.pre_vendas,
                                   ativo = EXCLUDED.ativo, somente_leitura = EXCLUDED.somente_leitura;
END $$;;
