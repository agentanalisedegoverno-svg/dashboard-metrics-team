-- 004: código de negócio da oportunidade (AAAA-NNNN), numerado por ano da data do pregão.
-- É o identificador que aparece no Radar e no título do cartão do Planner. Imutável depois de atribuído.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS codigo_sequencia (
  ano int PRIMARY KEY,
  ultimo int NOT NULL DEFAULT 0
);;

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS codigo text;;
CREATE UNIQUE INDEX IF NOT EXISTS oportunidades_codigo_uq ON oportunidades (codigo);;

-- Próximo número do ano (atômico: o UPSERT trava a linha do ano até o fim da transação).
CREATE OR REPLACE FUNCTION proximo_codigo(p_ano int) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO codigo_sequencia (ano, ultimo) VALUES (p_ano, 1)
  ON CONFLICT (ano) DO UPDATE SET ultimo = codigo_sequencia.ultimo + 1
  RETURNING ultimo INTO n;
  RETURN p_ano::text || '-' || lpad(n::text, 4, '0');
END $$;;

-- Atribui o código quando a oportunidade passa a valer (insert vigente, ou volta a valer) e impede alteração depois.
CREATE OR REPLACE FUNCTION oportunidades_codigo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ano_ref int;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.codigo IS NOT NULL THEN
    NEW.codigo := OLD.codigo;  -- imutável
    RETURN NEW;
  END IF;
  IF NEW.codigo IS NULL AND NEW.arquivado_em IS NULL AND NOT coalesce(NEW.ausente_na_planilha, false) THEN
    ano_ref := coalesce(extract(year FROM NEW.data_pregao_dt), extract(year FROM NEW.data_distribuicao), extract(year FROM now()))::int;
    NEW.codigo := proximo_codigo(ano_ref);
  END IF;
  RETURN NEW;
END $$;;
DROP TRIGGER IF EXISTS oportunidades_codigo_tg ON oportunidades;;
CREATE TRIGGER oportunidades_codigo_tg BEFORE INSERT OR UPDATE ON oportunidades FOR EACH ROW EXECUTE FUNCTION oportunidades_codigo();;

-- A mudança de `codigo` não é "edição" do usuário: fora do histórico.
CREATE OR REPLACE FUNCTION oportunidades_auditar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ruido text[] := ARRAY['carregado_em','atualizado_em','versao','ano','mes','sla','data_pregao','editado_na_web','ausente_na_planilha','codigo'];
  antes jsonb; depois jsonb; diff jsonb; quem text; acao text;
BEGIN
  quem := coalesce(nullif(current_setting('app.usuario', true), ''), NEW.atualizado_por, NEW.criado_por, 'sistema');
  IF TG_OP = 'INSERT' THEN
    INSERT INTO oportunidades_historico (oportunidade_id, versao, acao, por, alteracoes)
    VALUES (NEW.id, NEW.versao, CASE NEW.fonte WHEN 'web' THEN 'criou' ELSE 'importou' END, quem, '{}');
    RETURN NEW;
  END IF;
  antes := to_jsonb(OLD) - ruido;
  depois := to_jsonb(NEW) - ruido;
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_array(antes -> k, depois -> k)), '{}')
    INTO diff FROM jsonb_object_keys(depois) AS k WHERE (antes -> k) IS DISTINCT FROM (depois -> k);
  IF diff = '{}'::jsonb THEN RETURN NEW; END IF;
  IF OLD.arquivado_em IS NULL AND NEW.arquivado_em IS NOT NULL THEN acao := 'arquivou';
  ELSIF OLD.arquivado_em IS NOT NULL AND NEW.arquivado_em IS NULL THEN acao := 'restaurou';
  ELSIF coalesce(current_setting('app.origem', true), '') = 'sync' THEN acao := 'sincronizou';
  ELSE acao := 'editou'; END IF;
  INSERT INTO oportunidades_historico (oportunidade_id, versao, acao, por, alteracoes) VALUES (NEW.id, NEW.versao, acao, quem, diff);
  RETURN NEW;
END $$;;

REVOKE ALL ON FUNCTION proximo_codigo(int) FROM PUBLIC;;

-- Numeração inicial das oportunidades vigentes: por ano, da data do pregão mais antiga para a mais nova
-- (sem data de pregão: usa o ano da distribuição, senão o ano corrente, e entra no fim do ano).
-- Só preenche quem ainda não tem código (idempotente).
WITH base AS (
  SELECT id, data_pregao_dt,
         coalesce(extract(year FROM data_pregao_dt), extract(year FROM data_distribuicao), extract(year FROM now()))::int AS ano_ref
  FROM oportunidades
  WHERE codigo IS NULL AND arquivado_em IS NULL AND NOT ausente_na_planilha
), ord AS (
  SELECT id, ano_ref, row_number() OVER (PARTITION BY ano_ref ORDER BY (data_pregao_dt IS NULL), data_pregao_dt, id) AS rn
  FROM base
)
UPDATE oportunidades o SET codigo = ord.ano_ref::text || '-' || lpad(ord.rn::text, 4, '0')
FROM ord WHERE o.id = ord.id;;

-- O contador de cada ano passa a valer o maior número já usado.
INSERT INTO codigo_sequencia (ano, ultimo)
SELECT split_part(codigo, '-', 1)::int, max(split_part(codigo, '-', 2)::int)
FROM oportunidades WHERE codigo IS NOT NULL GROUP BY 1
ON CONFLICT (ano) DO UPDATE SET ultimo = GREATEST(codigo_sequencia.ultimo, EXCLUDED.ultimo);;
