-- Aplicar SOMENTE depois que o agente agendado já rodou ao menos uma vez com `scripts/sync-db.mjs` (merge).
-- Tira do `radar_escritor` a carga total antiga (substitui tudo) para que nenhum agente desatualizado
-- apague registros cadastrados pela web. A função continua existindo (uso do dono, em emergência).
REVOKE EXECUTE ON FUNCTION carregar_oportunidades(jsonb, text) FROM radar_escritor;;
