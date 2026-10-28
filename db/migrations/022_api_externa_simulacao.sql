-- 022: modo de simulação da API externa ("testar sem sujar a base real").
--  - simular_oportunidade_api roda a criação COMPLETA (mesmas validações, gatilhos, código, histórico e pedido de e-mail) e desfaz tudo
--    no fim, devolvendo a oportunidade como ela ficaria (com o código que receberia). Nada é gravado: nem oportunidade, nem histórico,
--    nem pedido de e-mail, nem chave de idempotência, nem o número do código.
--  - Erros de validação saem iguais aos da criação de verdade (P0422 etc.).
--  - Só radar_app executa (como as demais funções da API).

CREATE OR REPLACE FUNCTION simular_oportunidade_api(p jsonb, p_cliente text, p_solicitante text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o jsonb;
BEGIN
  BEGIN
    o := criar_oportunidade_api(p, p_cliente, p_solicitante, NULL);
    -- Força o erro de propósito: o bloco inteiro é desfeito, mas a variável local `o` mantém o resultado.
    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'simulacao';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    NULL;
  END;
  RETURN o || '{"simulado": true}'::jsonb;
END $$;;

REVOKE ALL ON FUNCTION simular_oportunidade_api(jsonb, text, text) FROM PUBLIC;;
GRANT EXECUTE ON FUNCTION simular_oportunidade_api(jsonb, text, text) TO radar_app;;
