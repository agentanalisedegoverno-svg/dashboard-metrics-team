-- 018: estado do planner-auto guardado no banco (para rodar fora do computador do João, ex.: Render).
--  - O planner-auto guarda dois arquivos: o token do login Microsoft e as versões já aplicadas por oportunidade.
--    Num servidor sem disco fixo eles vão para esta tabela, CIFRADOS pelo próprio planner-auto (o banco só vê texto cifrado).
--  - O papel radar_planner (o mesmo do exportador) ganha só esta tabela; continua sem escrever em oportunidades.

CREATE TABLE IF NOT EXISTS planner_auto_estado (
  nome          text PRIMARY KEY,
  conteudo      text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);;
GRANT SELECT, INSERT, UPDATE ON planner_auto_estado TO radar_planner;;
