-- 024: o mapeamento Linha de serviço → Torre passa a ser editável pela administração (antes só por SQL).
--  - salvar_linha_torre(linha, torre, quem): só administrador; a linha precisa existir na lista "linha_servico" e a torre na lista "torre"
--    (as duas já são editáveis em Administração → Listas), então uma torre nova cadastrada na lista já pode receber linhas.
--  - A restrição fixa (ITS, DIGITAL, HEALTH) da tabela linhas_torre é removida: quem decide as torres válidas é a lista "torre".
--  - Nada do que já existe muda: a regra continua sendo "linha mapeada vai para a torre mapeada, qualquer outra é ITS", aplicada no
--    cadastro e a cada salvamento. Oportunidades já gravadas só trocam de torre quando forem salvas de novo.

DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'linhas_torre'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE linhas_torre DROP CONSTRAINT %I', c);
  END LOOP;
END $$;;

CREATE OR REPLACE FUNCTION salvar_linha_torre(p_linha text, p_torre text, p_email text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT eh_admin(p_email) THEN RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'Somente administradores editam a torre das linhas'; END IF;
  IF NOT EXISTS (SELECT 1 FROM opcoes WHERE lista = 'linha_servico' AND valor = btrim(coalesce(p_linha, ''))) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"linha","mensagem":"Linha de serviço não cadastrada na lista"}]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM opcoes WHERE lista = 'torre' AND valor = btrim(coalesce(p_torre, '')) AND ativo) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = '[{"campo":"torre","mensagem":"Torre não cadastrada (ou inativa) na lista"}]';
  END IF;
  INSERT INTO linhas_torre (linha, torre) VALUES (btrim(p_linha), btrim(p_torre))
  ON CONFLICT (linha) DO UPDATE SET torre = EXCLUDED.torre;
END $$;;

REVOKE ALL ON FUNCTION salvar_linha_torre(text, text, text) FROM PUBLIC;;
GRANT EXECUTE ON FUNCTION salvar_linha_torre(text, text, text) TO radar_app;;
