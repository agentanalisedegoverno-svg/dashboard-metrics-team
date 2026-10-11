-- Esquema do banco do Radar Pré-Vendas (Neon Postgres). Já aplicado no projeto "radar-prevendas".
-- Papéis (criados por SQL, NÃO pela API do Neon, que os coloca em neon_superuser):
--   radar_leitor   -> SELECT nas tabelas (usado pela API do painel)
--   radar_escritor -> EXECUTE em carregar_oportunidades() apenas (usado pelo agente de carga)
-- CREATE ROLE radar_leitor   LOGIN PASSWORD '...' NOINHERIT;
-- CREATE ROLE radar_escritor LOGIN PASSWORD '...' NOINHERIT;

CREATE TABLE IF NOT EXISTS oportunidades (
  id bigserial PRIMARY KEY,
  ano text, mes text, status text, uf text, torre text, linha_servico text, vistoria text, analista text,
  motivo_no_go text, motivo_lost text, conta_vinculada text,
  orcamento numeric(18,2), valor_ctc numeric(18,2), valor_vencedor numeric(18,2), sla numeric,
  processo text, orgao text, descritivo text, data_pregao text, acao_ia jsonb,
  carregado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oportunidades_ano_mes_idx ON oportunidades (ano, mes);

CREATE TABLE IF NOT EXISTS carga_status (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_carga_em timestamptz, total_linhas int NOT NULL DEFAULT 0, fonte text, erro text
);
INSERT INTO carga_status (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Substitui TODAS as linhas de forma atômica (uma única transação) e registra a carga.
CREATE OR REPLACE FUNCTION carregar_oportunidades(p_rows jsonb, p_fonte text DEFAULT 'agent')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows deve ser um array JSON nao vazio';
  END IF;
  DELETE FROM oportunidades;
  INSERT INTO oportunidades (ano, mes, status, uf, torre, linha_servico, vistoria, analista, motivo_no_go, motivo_lost,
                             conta_vinculada, orcamento, valor_ctc, valor_vencedor, sla, processo, orgao, descritivo, data_pregao, acao_ia)
  SELECT r."ano", r."mes", r."status", r."uf", r."torre", r."linhaServico", r."vistoria", r."analista", r."motivoNoGo", r."motivoLost",
         r."contaVinculada", r."orcamento", r."valorCtc", r."valorVencedor", r."sla", r."processo", r."orgao", r."descritivo", r."dataPregao", r."acaoIA"
  FROM jsonb_to_recordset(p_rows) AS r("ano" text, "mes" text, "status" text, "uf" text, "torre" text, "linhaServico" text, "vistoria" text,
       "analista" text, "motivoNoGo" text, "motivoLost" text, "contaVinculada" text, "orcamento" numeric, "valorCtc" numeric,
       "valorVencedor" numeric, "sla" numeric, "processo" text, "orgao" text, "descritivo" text, "dataPregao" text, "acaoIA" jsonb);
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE carga_status SET ultima_carga_em = now(), total_linhas = n, fonte = p_fonte, erro = NULL WHERE id = 1;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION carregar_oportunidades(jsonb, text) FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO radar_leitor, radar_escritor;
GRANT SELECT ON oportunidades, carga_status TO radar_leitor;
GRANT EXECUTE ON FUNCTION carregar_oportunidades(jsonb, text) TO radar_escritor;
