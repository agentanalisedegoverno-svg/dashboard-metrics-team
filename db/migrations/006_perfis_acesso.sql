-- 006: perfis de acesso (administrador, editor, visualizador) e novos administradores.
--  - Administrador: tudo (arquivar, listas, usuários).            [usuarios.admin = true]
--  - Editor: cadastra e edita (como hoje). É o padrão de todo @ctctech.com.br que não esteja marcado como visualizador.
--  - Visualizador: só consulta (grade e histórico).                 [usuarios.somente_leitura = true]
-- Só o administrador cria ou remove alguém dos grupos (salvar_usuario já é restrita a administradores).

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS somente_leitura boolean NOT NULL DEFAULT false;;
DO $$ BEGIN
  ALTER TABLE usuarios ADD CONSTRAINT usuarios_perfil_exclusivo CHECK (NOT (admin AND somente_leitura));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;

-- A restrição vale mesmo que a linha esteja inativa (remover o perfil = desmarcar "somente leitura").
CREATE OR REPLACE FUNCTION eh_somente_leitura(p_email text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE email = lower(p_email) AND somente_leitura)
$$;;
REVOKE ALL ON FUNCTION eh_somente_leitura(text) FROM PUBLIC;;

-- Novos administradores
UPDATE usuarios SET admin = true, somente_leitura = false, ativo = true
 WHERE email IN ('jefferson.oliveira@ctctech.com.br', 'flavio.santanna@ctctech.com.br') AND NOT (admin AND ativo);;

-- Gestão de usuários com perfil (só administrador), sem deixar o sistema sem nenhum administrador
DROP FUNCTION IF EXISTS salvar_usuario(text, text, boolean, boolean, boolean, text);;
CREATE OR REPLACE FUNCTION salvar_usuario(p_nome text, p_email text, p_admin boolean, p_pre_vendas boolean, p_ativo boolean, p_por text, p_somente_leitura boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nome text := btrim(p_nome);
BEGIN
  IF NOT eh_admin(p_por) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Somente administradores editam usuários'; END IF;
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
GRANT EXECUTE ON FUNCTION salvar_usuario(text, text, boolean, boolean, boolean, text, boolean) TO radar_app;;

-- Cadastro e edição recusam o perfil somente leitura (a regra vale no banco, não só na tela)
CREATE OR REPLACE FUNCTION criar_oportunidade(p jsonb, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r oportunidade_campos; o oportunidades; e text := lower(p_email);
BEGIN
  IF e IS NULL OR e = '' THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Usuário não identificado'; END IF;
  IF eh_somente_leitura(e) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Seu perfil é somente leitura: não é possível cadastrar ou editar'; END IF;
  PERFORM set_config('app.usuario', e, true);
  r := jsonb_populate_record(NULL::oportunidade_campos, p);
  IF r.linha_servico IS NOT NULL THEN r.torre := torre_da_linha(r.linha_servico); END IF;  -- torre é calculada pela linha de serviço
  IF r.empresa_vencedora_cnpj IS NULL THEN r.empresa_vencedora_razao := NULL; r.empresa_vencedora_tipo := NULL; END IF;
  PERFORM validar_oportunidade(r, NULL);
  INSERT INTO oportunidades (fonte, criado_por, atualizado_por, data_distribuicao, data_pregao_dt, status, orgao, descritivo, criterio, uf, processo,
      uasg, modalidade, tipo, modo_disputa, origem_oportunidade, analista, site, vistoria, linha_servico, torre, unidade_fornecimento, conta_vinculada,
      mc_ctc, simulacao_mc_arrematante, orcamento, orcamento_sigiloso, valor_vencedor, valor_ctc, custo_total_ctc, motivo_no_go, detalhe_no_go,
      empresas_vencedoras, motivo_lost, observacoes, posicao_lance, situacao_lance, pendencias,
      empresa_vencedora_cnpj, empresa_vencedora_razao, empresa_vencedora_tipo)
  VALUES ('web', e, e, r.data_distribuicao, r.data_pregao_dt, r.status, btrim(r.orgao), btrim(r.descritivo), r.criterio, r.uf, nullif(btrim(r.processo), ''),
      nullif(btrim(r.uasg), ''), r.modalidade, r.tipo, r.modo_disputa, r.origem_oportunidade, r.analista, r.site, r.vistoria, r.linha_servico, r.torre,
      r.unidade_fornecimento, r.conta_vinculada, r.mc_ctc, r.simulacao_mc_arrematante, r.orcamento, coalesce(r.orcamento_sigiloso, false), r.valor_vencedor,
      r.valor_ctc, r.custo_total_ctc, r.motivo_no_go, r.detalhe_no_go, r.empresas_vencedoras, r.motivo_lost, r.observacoes, r.posicao_lance,
      r.situacao_lance, coalesce(r.pendencias, '{}'),
      r.empresa_vencedora_cnpj, r.empresa_vencedora_razao, r.empresa_vencedora_tipo)
  RETURNING * INTO o;
  RETURN to_jsonb(o);
END $$;;

CREATE OR REPLACE FUNCTION atualizar_oportunidade(p_id bigint, p_versao int, p jsonb, p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r oportunidade_campos; atual oportunidades; o oportunidades; e text := lower(p_email);
BEGIN
  IF e IS NULL OR e = '' THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Usuário não identificado'; END IF;
  IF eh_somente_leitura(e) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Seu perfil é somente leitura: não é possível cadastrar ou editar'; END IF;
  PERFORM set_config('app.usuario', e, true);
  SELECT * INTO atual FROM oportunidades WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR atual.arquivado_em IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'Oportunidade não encontrada'; END IF;
  IF atual.versao <> p_versao THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = jsonb_build_object('versao_atual', atual.versao, 'atual', to_jsonb(atual))::text;
  END IF;
  r := jsonb_populate_record(NULL::oportunidade_campos, p);
  IF r.linha_servico IS NOT NULL THEN r.torre := torre_da_linha(r.linha_servico); END IF;  -- torre é calculada pela linha de serviço
  IF r.empresa_vencedora_cnpj IS NULL THEN r.empresa_vencedora_razao := NULL; r.empresa_vencedora_tipo := NULL; END IF;
  PERFORM validar_oportunidade(r, atual);
  UPDATE oportunidades SET
    data_distribuicao = r.data_distribuicao, data_pregao_dt = r.data_pregao_dt, status = r.status, orgao = btrim(r.orgao), descritivo = btrim(r.descritivo),
    criterio = r.criterio, uf = r.uf, processo = nullif(btrim(r.processo), ''), uasg = nullif(btrim(r.uasg), ''), modalidade = r.modalidade, tipo = r.tipo,
    modo_disputa = r.modo_disputa, origem_oportunidade = r.origem_oportunidade, analista = r.analista, site = r.site, vistoria = r.vistoria,
    linha_servico = r.linha_servico, torre = r.torre, unidade_fornecimento = r.unidade_fornecimento, conta_vinculada = r.conta_vinculada,
    mc_ctc = r.mc_ctc, simulacao_mc_arrematante = r.simulacao_mc_arrematante, orcamento = r.orcamento, orcamento_sigiloso = coalesce(r.orcamento_sigiloso, false),
    valor_vencedor = r.valor_vencedor, valor_ctc = r.valor_ctc, custo_total_ctc = r.custo_total_ctc, motivo_no_go = r.motivo_no_go,
    detalhe_no_go = r.detalhe_no_go, motivo_lost = r.motivo_lost, observacoes = r.observacoes,
    posicao_lance = r.posicao_lance, situacao_lance = r.situacao_lance, pendencias = coalesce(r.pendencias, '{}'),
    empresa_vencedora_cnpj = r.empresa_vencedora_cnpj, empresa_vencedora_razao = r.empresa_vencedora_razao, empresa_vencedora_tipo = r.empresa_vencedora_tipo,
    editado_na_web = true, atualizado_por = e, versao = atual.versao + 1
  WHERE id = p_id RETURNING * INTO o;
  RETURN to_jsonb(o);
END $$;;
