-- 028: status Radar-TIC (oportunidades que vêm da API do Radar TIC) não envia e-mail.
--  - Registra o status na lista de status (em produção ele já existe; aqui fica versionado). Idempotente.
--  - E-mail de nova oportunidade: nunca para Radar-TIC, mesmo que alguém o marque nos gatilhos da configuração.
--  - E-mail de mudança de status: nunca quando o status NOVO é Radar-TIC. Sair do Radar-TIC (promover para Prospect, Go...) continua avisando.
--  - Quem veio da carga/sincronização (app.origem = 'sync') segue sem e-mail, como antes.
--  - As funções são as vigentes (016 e 009/010), só com a condição nova; o gatilho só grava na fila e nunca derruba a edição.

INSERT INTO opcoes (lista, valor, ordem, ativo)
SELECT 'status', 'Radar-TIC', 11, true
WHERE NOT EXISTS (SELECT 1 FROM opcoes WHERE lista = 'status' AND valor = 'Radar-TIC');;

CREATE OR REPLACE FUNCTION oportunidades_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.fonte = 'web' AND NEW.status IS DISTINCT FROM 'Radar-TIC'
     AND EXISTS (SELECT 1 FROM email_config WHERE ativo AND NEW.status = ANY (status_gatilho)) THEN
    INSERT INTO email_fila (tipo, oportunidade_id) VALUES ('nova', NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fila de e-mail: %', SQLERRM;
  RETURN NEW;
END $$;;
REVOKE ALL ON FUNCTION oportunidades_email() FROM PUBLIC;;

CREATE OR REPLACE FUNCTION oportunidades_email_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IS DISTINCT FROM 'Radar-TIC'
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
REVOKE ALL ON FUNCTION oportunidades_email_status() FROM PUBLIC;;
