-- 012: Planner em tempo real (modo nuvem).
--  - planner_marco.modo é o INTERRUPTOR de quem atualiza o Planner: 'maquina' (padrão: rotina do Windows a cada 30 min,
--    como sempre foi) ou 'nuvem' (a própria API atualiza o cartão no instante do Salvar, mais uma rotina de segurança).
--    Só um dos dois age por vez: no modo nuvem o exportador da máquina sai sem fazer nada; no modo máquina a nuvem não age.
--    Trocar de modo é um UPDATE (e voltar também), então o rollback é imediato.
--  - planner_exportacao ganha o controle do caminho em nuvem: id do cartão, concessão (lease) para dois processos nunca
--    atualizarem a mesma oportunidade ao mesmo tempo, e contagem de tentativas com o último erro.
-- Nada muda enquanto o modo for 'maquina'. As permissões do radar_planner já cobrem as colunas novas.

ALTER TABLE planner_marco ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'maquina';;
DO $$ BEGIN
  ALTER TABLE planner_marco ADD CONSTRAINT planner_marco_modo CHECK (modo IN ('maquina', 'nuvem'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;;

ALTER TABLE planner_exportacao
  ADD COLUMN IF NOT EXISTS tarefa_id text,
  ADD COLUMN IF NOT EXISTS plano_id text,
  ADD COLUMN IF NOT EXISTS em_processamento_ate timestamptz,
  ADD COLUMN IF NOT EXISTS tentativas int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_erro text,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();;
