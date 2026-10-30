-- 026: papel dedicado do coletor de licitações (workflow "Monitoramento de licitações", secret DATABASE_URL_MONITOR).
--  - Privilégio mínimo: só o que scripts/monitor-licitacoes.mjs usa. Não lê dados do cadastro além de id e arquivado_em,
--    não escreve em oportunidades, histórico, usuários nem e-mails.
--  - Começa NOLOGIN, como o radar_email: o login e a senha são definidos à parte (fora do Git).
--  - Depende da migração 021.

DO $$ BEGIN
  CREATE ROLE radar_monitor NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;

GRANT USAGE ON SCHEMA public TO radar_monitor;;
GRANT SELECT, UPDATE ON monitor_licitacoes TO radar_monitor;;
GRANT SELECT, INSERT, UPDATE ON monitor_licitacoes_coletas TO radar_monitor;;
GRANT SELECT, INSERT ON monitor_licitacoes_snapshots, monitor_licitacoes_eventos, monitor_licitacoes_alertas TO radar_monitor;;
GRANT USAGE, SELECT ON SEQUENCE monitor_licitacoes_coletas_id_seq, monitor_licitacoes_snapshots_id_seq,
  monitor_licitacoes_eventos_id_seq, monitor_licitacoes_alertas_id_seq TO radar_monitor;;
GRANT SELECT (id, arquivado_em) ON oportunidades TO radar_monitor;;
