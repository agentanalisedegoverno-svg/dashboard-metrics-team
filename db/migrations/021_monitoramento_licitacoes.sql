-- 021: módulo de monitoramento de licitações (aditivo; não altera o cadastro de oportunidades).
-- Oportunidades em Prospect, Go, Onboarding ou On going entram automaticamente na fila de triagem.
-- A consulta externa só é ativada depois de confirmar portal e identificador oficial; não inferimos IDs.

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
  v_ativa boolean;
BEGIN
  v_status := lower(btrim(coalesce(NEW.status, '')));
  v_ativa := NEW.arquivado_em IS NULL AND v_status IN ('prospect', 'go', 'onboarding', 'on going');
  v_url := nullif(btrim(coalesce(NEW.site, '')), '');
  v_portal := CASE
    WHEN coalesce(v_url, '') ~* 'pncp\.gov\.br' THEN 'PNCP'
    WHEN coalesce(v_url, '') ~* 'compras\.gov\.br|comprasnet\.gov\.br' THEN 'COMPRAS_GOV'
    ELSE NULL
  END;

  IF v_ativa THEN
    INSERT INTO monitor_licitacoes (oportunidade_id, portal, url_oficial, estado_vinculo, habilitado)
    VALUES (NEW.id, v_portal, CASE WHEN v_url ~* '^https?://' THEN v_url ELSE NULL END,
      CASE WHEN v_portal IS NULL THEN 'pendente' ELSE 'pendente' END, true)
    ON CONFLICT (oportunidade_id) DO UPDATE SET
      habilitado = true,
      portal = coalesce(monitor_licitacoes.portal, EXCLUDED.portal),
      url_oficial = coalesce(monitor_licitacoes.url_oficial, EXCLUDED.url_oficial),
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
  AND lower(btrim(coalesce(o.status, ''))) IN ('prospect', 'go', 'onboarding', 'on going')
ON CONFLICT (oportunidade_id) DO NOTHING;;

COMMENT ON TABLE monitor_licitacoes IS 'Fila e configuração de acompanhamento de licitações vinculadas a oportunidades do Radar.';
COMMENT ON TABLE monitor_licitacoes_snapshots IS 'Histórico imutável das observações normalizadas das fontes oficiais.';
COMMENT ON TABLE monitor_licitacoes_eventos IS 'Eventos deduplicados; fato publicado separado de comparação e item a validar.';
