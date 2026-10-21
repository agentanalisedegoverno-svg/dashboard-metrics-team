-- Integração Radar -> Planner (só oportunidades CRIADAS PELA WEB depois da ativação).
-- Controle do que já foi exportado e papel de leitura para o exportador (scripts/planner-eventos.mjs).

CREATE TABLE IF NOT EXISTS planner_marco (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  marco timestamptz              -- NULL = integração desligada; preenchido por `planner-eventos.mjs --ativar`
);;
INSERT INTO planner_marco (id, marco) VALUES (1, NULL) ON CONFLICT DO NOTHING;;

CREATE TABLE IF NOT EXISTS planner_exportacao (
  oportunidade_id bigint PRIMARY KEY REFERENCES oportunidades (id),
  versao_exportada int NOT NULL,
  chave text NOT NULL,
  exportado_em timestamptz NOT NULL DEFAULT now()
);;

DO $$ BEGIN
  CREATE ROLE radar_planner NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;

GRANT USAGE ON SCHEMA public TO radar_planner;;
GRANT SELECT ON oportunidades, usuarios TO radar_planner;;
GRANT SELECT, UPDATE ON planner_marco TO radar_planner;;
GRANT SELECT, INSERT, UPDATE ON planner_exportacao TO radar_planner;;
