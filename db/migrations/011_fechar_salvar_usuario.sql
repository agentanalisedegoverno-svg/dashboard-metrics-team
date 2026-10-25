-- 011: correção de segurança. A migração 006 recriou salvar_usuario com outra assinatura (7 parâmetros) e não repetiu o
-- REVOKE ... FROM PUBLIC: por padrão o Postgres dá EXECUTE a PUBLIC a toda função nova. Como a função confia na identidade
-- passada em p_por (quem chama pela API já foi autenticado pelo Cloudflare Access), qualquer papel de banco, mesmo só de
-- leitura, poderia chamá-la com o e-mail de um administrador e se promover. Pela API isso nunca foi explorável.
-- Agora só a aplicação (radar_app) executa, como as demais funções que recebem a identidade.
-- O teste db/testes/seguranca.test.ts garante que nenhuma função nova volte a nascer aberta.

REVOKE ALL ON FUNCTION salvar_usuario(text, text, boolean, boolean, boolean, text, boolean) FROM PUBLIC;;
GRANT EXECUTE ON FUNCTION salvar_usuario(text, text, boolean, boolean, boolean, text, boolean) TO radar_app;;
