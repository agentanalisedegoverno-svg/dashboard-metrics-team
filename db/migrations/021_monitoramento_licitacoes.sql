-- 021: módulo de monitoramento de licitações (aditivo; não altera o cadastro de oportunidades).
-- Oportunidades em Prospect, Go, Onboarding ou On going entram automaticamente na fila de triagem.
-- A consulta externa só é ativada depois de confirmar portal e identificador oficial; não inferimos IDs.

-- 'Onboarding' passa a ser uma etapa válida para a regra de elegibilidade deste módulo.
INSERT INTO opcoes (lista, valor, ordem, ativo) VALUES ('status', 'Onboarding', 4, true) ON CONFLICT (lista, valor) DO NOTHING;;

CREATE TABLE IF NOT EXISTS monitor_licitacoes (
  id bigserial PRIMARY KEY,
  oportunidade_id bigint NOT NULL UNIQUE REFERENCES oportunidades(id) ON DELETE CASCADE,
  portal text CHECK (portal IS NULL OR portal IN ('PNCP', 'COMPRAS_GOV')),
  identificador_externo text,
  url_oficial text,
  habilitado boolean NOT NULL DEFAULT true,
  estado_vinculo text NOT NULL DEFAULT 'pendente'
    CHECK (estado_vinculo IN ('pendente', 'vinculado', 'incompativel', 'pausado')),
  estado_coleta text NOT NULL DEFAULT 'nunca_coletado'
    CHECK (estado_coleta IN ('nunca_coletado', 'ok', 'parcial', 'falha', 'sem_dados')),
  ultima_tentativa_em timestamptz,
  ultima_sucesso_em timestamptz,
  proxima_coleta_em timestamptz NOT NULL DEFAULT now(),
  ultimo_erro text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (identificador_externo IS NULL OR length(identificador_externo) <= 200),
  CHECK (url_oficial IS NULL OR url_oficial ~ '^https?://')
);;

CREATE INDEX IF NOT EXISTS monitor_licitacoes_fila_idx
  ON monitor_licitacoes (proxima_coleta_em, id)
  WHERE habilitado AND estado_vinculo = 'vinculado';;

CREATE TABLE IF NOT EXISTS monitor_licitacoes_coletas (
  id bigserial PRIMARY KEY,
  monitor_id bigint NOT NULL REFERENCES monitor_licitacoes(id) ON DELETE CASCADE,
  portal text NOT NULL,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  finalizada_em timestamptz,
  resultado text NOT NULL CHECK (resultado IN ('em_andamento', 'ok', 'parcial', 'falha', 'sem_dados')),
  registros_lidos integer NOT NULL DEFAULT 0 CHECK (registros_lidos >= 0),
  detalhe text,
  request_id text
);;
CREATE INDEX IF NOT EXISTS monitor_licitacoes_coletas_monitor_idx
  ON monitor_licitacoes_coletas (monitor_id, iniciada_em DESC);;

CREATE TABLE IF NOT EXISTS monitor_licitacoes_snapshots (
  id bigserial PRIMARY KEY,
  monitor_id bigint NOT NULL REFERENCES monitor_licitacoes(id) ON DELETE CASCADE,
  portal text NOT NULL,
  tipo_registro text NOT NULL,
  chave_registro text NOT NULL,
  dados jsonb NOT NULL,
  hash_conteudo text NOT NULL,
  url_evidencia text,
  publicado_em timestamptz,
  observado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (monitor_id, chave_registro, hash_conteudo)
);;
CREATE INDEX IF NOT EXISTS monitor_licitacoes_snapshots_hist_idx
  ON monitor_licitacoes_snapshots (monitor_id, observado_em DESC);;

CREATE TABLE IF NOT EXISTS monitor_licitacoes_eventos (
  id bigserial PRIMARY KEY,
  monitor_id bigint NOT NULL REFERENCES monitor_licitacoes(id) ON DELETE CASCADE,
  snapshot_id bigint REFERENCES monitor_licitacoes_snapshots(id) ON DELETE SET NULL,
  tipo text NOT NULL,
  severidade text NOT NULL DEFAULT 'informativa'
    CHECK (severidade IN ('informativa', 'atencao', 'alta', 'critica')),
  titulo text NOT NULL,
  descricao text NOT NULL,
  fonte text NOT NULL,
  url_evidencia text,
  classificacao text NOT NULL DEFAULT 'publicado'
    CHECK (classificacao IN ('publicado', 'detectado_comparacao', 'a_validar')),
  dedupe_key text NOT NULL UNIQUE,
  ocorrido_em timestamptz,
  detectado_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now()
);;
CREATE INDEX IF NOT EXISTS monitor_licitacoes_eventos_hist_idx
  ON monitor_licitacoes_eventos (monitor_id, detectado_em DESC);;

CREATE TABLE IF NOT EXISTS monitor_licitacoes_alertas (
  id bigserial PRIMARY KEY,
  evento_id bigint NOT NULL UNIQUE REFERENCES monitor_licitacoes_eventos(id) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto', 'em_analise', 'resolvido', 'descartado')),
  responsavel text,
  observacao text,
  atualizado_por text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);;

CREATE OR REPLACE FUNCTION monitor_licitacoes_sincronizar_oportunidade() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_portal text;
  v_url text;
  v_identificador text;
  v_match text[];
  v_ativa boolean;
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status IS NOT DISTINCT FROM NEW.status
    AND OLD.site IS NOT DISTINCT FROM NEW.site
    AND OLD.processo IS NOT DISTINCT FROM NEW.processo
    AND OLD.uasg IS NOT DISTINCT FROM NEW.uasg
    AND OLD.arquivado_em IS NOT DISTINCT FROM NEW.arquivado_em THEN
    RETURN NEW;
  END IF;
  v_status := lower(btrim(coalesce(NEW.status, '')));
  v_ativa := NEW.arquivado_em IS NULL AND v_status IN ('prospect', 'go', 'onboarding', 'on going', 'ongoing', 'suspenso', 'suspensa', 'suspended');
  v_url := nullif(btrim(coalesce(NEW.site, '')), '');
  v_portal := CASE
    WHEN coalesce(v_url, '') ~* 'pncp\.gov\.br' THEN 'PNCP'
    WHEN coalesce(v_url, '') ~* 'compras\.gov\.br|comprasnet\.gov\.br' THEN 'COMPRAS_GOV'
    ELSE NULL
  END;

  v_identificador := NULL;
  IF v_portal = 'PNCP' THEN
    v_match := regexp_match(v_url, '/app/editais/(\d{14})/(\d{4})/(\d+)');
    IF v_match IS NULL THEN v_match := regexp_match(v_url, '/orgaos/(\d{14})/compras/(\d{4})/(\d+)'); END IF;
    IF v_match IS NOT NULL THEN v_identificador := v_match[1] || '-1-' || v_match[3] || '/' || v_match[2]; END IF;
  END IF;

  IF v_ativa THEN
    INSERT INTO monitor_licitacoes (oportunidade_id, portal, identificador_externo, url_oficial, estado_vinculo, habilitado)
    VALUES (NEW.id, v_portal, v_identificador, CASE WHEN v_url ~* '^https?://' THEN v_url ELSE NULL END,
      CASE WHEN v_identificador IS NOT NULL THEN 'vinculado' ELSE 'pendente' END, true)
    ON CONFLICT (oportunidade_id) DO UPDATE SET
      habilitado = true,
      estado_vinculo = CASE WHEN monitor_licitacoes.identificador_externo IS NOT NULL THEN 'vinculado' ELSE 'pendente' END,
      portal = coalesce(EXCLUDED.portal, monitor_licitacoes.portal),
      identificador_externo = coalesce(EXCLUDED.identificador_externo, monitor_licitacoes.identificador_externo),
      url_oficial = coalesce(EXCLUDED.url_oficial, monitor_licitacoes.url_oficial),
      estado_vinculo = CASE WHEN coalesce(EXCLUDED.identificador_externo, monitor_licitacoes.identificador_externo) IS NOT NULL THEN 'vinculado' ELSE 'pendente' END,
      atualizado_em = now();
  ELSIF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM monitor_licitacoes WHERE oportunidade_id = NEW.id) THEN
    UPDATE monitor_licitacoes SET habilitado = false, estado_vinculo = 'pausado', atualizado_em = now()
    WHERE oportunidade_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;;

DROP TRIGGER IF EXISTS oportunidades_monitor_licitacoes_tg ON oportunidades;;
CREATE TRIGGER oportunidades_monitor_licitacoes_tg
AFTER INSERT OR UPDATE ON oportunidades
FOR EACH ROW EXECUTE FUNCTION monitor_licitacoes_sincronizar_oportunidade();;

-- Semeia registros existentes; não inventa identificadores nem inicia consulta sem vínculo oficial.
INSERT INTO monitor_licitacoes (oportunidade_id, portal, url_oficial)
SELECT o.id,
  CASE WHEN coalesce(o.site, '') ~* 'pncp\.gov\.br' THEN 'PNCP'
       WHEN coalesce(o.site, '') ~* 'compras\.gov\.br|comprasnet\.gov\.br' THEN 'COMPRAS_GOV'
       ELSE NULL END,
  CASE WHEN coalesce(o.site, '') ~* '^https?://' THEN o.site ELSE NULL END
FROM oportunidades o
WHERE o.arquivado_em IS NULL
  AND lower(btrim(coalesce(o.status, ''))) IN ('prospect', 'go', 'onboarding', 'on going', 'ongoing', 'suspenso', 'suspensa', 'suspended')
ON CONFLICT (oportunidade_id) DO NOTHING;;

-- Atualiza registros preexistentes: URLs oficiais PNCP canônicas podem ser vinculadas sem intervenção.
WITH candidatos AS (
  SELECT m.id AS monitor_id, o.site,
    regexp_match(coalesce(o.site, ''), '/app/editais/(\d{14})/(\d{4})/(\d+)') AS p
  FROM monitor_licitacoes m
  JOIN oportunidades o ON o.id = m.oportunidade_id
  WHERE o.arquivado_em IS NULL
    AND lower(btrim(coalesce(o.status, ''))) IN ('prospect','go','onboarding','on going','ongoing','suspenso','suspensa','suspended')
    AND coalesce(o.site, '') ~* 'pncp\.gov\.br'
)
UPDATE monitor_licitacoes m SET
  portal = 'PNCP',
  url_oficial = c.site,
  identificador_externo = c.p[1] || '-1-' || c.p[3] || '/' || c.p[2],
  estado_vinculo = 'vinculado',
  habilitado = true,
  atualizado_em = now()
FROM candidatos c
WHERE m.id = c.monitor_id AND c.p IS NOT NULL;;

COMMENT ON TABLE monitor_licitacoes IS 'Fila e configuração de acompanhamento de licitações vinculadas a oportunidades do Radar.';
COMMENT ON TABLE monitor_licitacoes_snapshots IS 'Histórico imutável das observações normalizadas das fontes oficiais.';
COMMENT ON TABLE monitor_licitacoes_eventos IS 'Eventos deduplicados; fato publicado separado de comparação e item a validar.';


CREATE TABLE IF NOT EXISTS monitor_licitacoes_auditoria (
  id bigserial PRIMARY KEY,
  monitor_id bigint NOT NULL REFERENCES monitor_licitacoes(id) ON DELETE CASCADE,
  acao text NOT NULL,
  por text NOT NULL,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);;

CREATE INDEX IF NOT EXISTS monitor_licitacoes_auditoria_hist_idx
  ON monitor_licitacoes_auditoria (monitor_id, criado_em DESC);;

-- Permissões mínimas para a API autenticada do Radar e para o coletor agendado.
-- DATABASE_URL_MONITOR deve usar o papel radar_app (ou papel dedicado equivalente), nunca o proprietário.
GRANT SELECT, INSERT, UPDATE ON monitor_licitacoes, monitor_licitacoes_coletas,
  monitor_licitacoes_snapshots, monitor_licitacoes_eventos, monitor_licitacoes_alertas TO radar_app;;
GRANT USAGE, SELECT ON SEQUENCE monitor_licitacoes_id_seq, monitor_licitacoes_coletas_id_seq,
  monitor_licitacoes_snapshots_id_seq, monitor_licitacoes_eventos_id_seq, monitor_licitacoes_alertas_id_seq TO radar_app;;
GRANT INSERT ON oportunidades_historico TO radar_app;;
GRANT USAGE, SELECT ON SEQUENCE oportunidades_historico_id_seq TO radar_app;;
GRANT SELECT ON monitor_licitacoes, monitor_licitacoes_coletas, monitor_licitacoes_snapshots,
  monitor_licitacoes_eventos, monitor_licitacoes_alertas TO radar_leitor;;
GRANT SELECT, INSERT ON monitor_licitacoes_auditoria TO radar_app;;
GRANT USAGE, SELECT ON SEQUENCE monitor_licitacoes_auditoria_id_seq TO radar_app;;
GRANT SELECT ON monitor_licitacoes_auditoria TO radar_leitor;;
