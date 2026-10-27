-- 016: e-mail quando o STATUS de uma oportunidade muda (só status; nenhuma outra edição envia e-mail).
--  - Vale para qualquer oportunidade alterada pela web (da planilha ou criada na web), para qualquer status novo.
--  - A carga/sincronização da planilha (app.origem = 'sync') NÃO gera e-mail.
--  - Mesmas regras de sempre: módulo ligado, destinatários e pré-vendas da oportunidade; o gatilho só grava na fila e nunca derruba a edição.
--  - Cada mudança vira um pedido próprio (guarda o status anterior e o novo no momento da mudança).

ALTER TABLE email_fila ADD COLUMN IF NOT EXISTS status_anterior text, ADD COLUMN IF NOT EXISTS status_novo text, ADD COLUMN IF NOT EXISTS alterado_por text;;

ALTER TABLE email_fila DROP CONSTRAINT IF EXISTS email_fila_tipo_check;;
ALTER TABLE email_fila DROP CONSTRAINT IF EXISTS email_fila_check;;
ALTER TABLE email_fila ADD CONSTRAINT email_fila_tipo_check CHECK (tipo IN ('nova', 'status', 'teste'));;
ALTER TABLE email_fila ADD CONSTRAINT email_fila_check CHECK (
  (tipo IN ('nova', 'status') AND oportunidade_id IS NOT NULL) OR (tipo = 'teste' AND destino_teste IS NOT NULL)
);;

CREATE OR REPLACE FUNCTION oportunidades_email_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(current_setting('app.origem', true), '') <> 'sync'
     AND EXISTS (SELECT 1 FROM email_config WHERE ativo) THEN
    INSERT INTO email_fila (tipo, oportunidade_id, status_anterior, status_novo, alterado_por)
    VALUES ('status', NEW.id, OLD.status, NEW.status, NEW.atualizado_por);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fila de e-mail (status): %', SQLERRM;
  RETURN NEW;
END $$;;
DROP TRIGGER IF EXISTS oportunidades_email_status_tg ON oportunidades;;
CREATE TRIGGER oportunidades_email_status_tg AFTER UPDATE OF status ON oportunidades FOR EACH ROW EXECUTE FUNCTION oportunidades_email_status();;
REVOKE ALL ON FUNCTION oportunidades_email_status() FROM PUBLIC;;
