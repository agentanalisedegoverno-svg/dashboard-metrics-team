# Política de segurança

O Radar Pré-Vendas é uma ferramenta **interna** da CTC. O repositório é público, então **nenhum segredo, dado real de oportunidade, planilha, dump ou backup pode ser versionado** (há testes automáticos que barram isso).

## Versão suportada
Só a `main` (a versão em produção, `https://radar-prevendas.pages.dev`). Correções entram por Pull Request e o deploy é automático depois do merge.

## Como reportar uma vulnerabilidade
- **Não abra uma issue pública.** Use *Security → Report a vulnerability* neste repositório (aviso privado do GitHub) ou fale diretamente com o responsável pelo projeto, pelo canal interno da CTC.
- Informe o que foi encontrado, como reproduzir e o impacto. Não inclua dados reais nem credenciais no relato.
- O responsável confirma o recebimento e informa o andamento. Correções críticas (vazamento de dados, acesso indevido) têm prioridade sobre qualquer outra entrega.

## Como o sistema se protege
- **Acesso:** login pelo Cloudflare Access (código no e-mail corporativo). A API valida o JWT do Access em todas as rotas; sem identidade válida nada passa (testado rota a rota em `functions/api/seguranca.test.ts`).
- **Perfis:** administrador, pré-vendas e somente leitura; a regra mora no banco (funções `SECURITY DEFINER`), não só na tela.
- **Escritas:** exigem o cabeçalho anti-CSRF e origem do próprio site.
- **Banco (Azure Database for PostgreSQL):** papéis de **mínimo privilégio** (`radar_app`, `radar_leitor`, `radar_escritor`, `radar_planner`, `radar_email`, `radar_monitor`, `radar_backup`), TLS obrigatório, senhas longas e aleatórias, RLS ligado nas tabelas. Funções de escrita **não** são executáveis por `PUBLIC`. Conferir sempre depois de aplicar migrações (ver `docs/MIGRACAO-AZURE.md`).
- **Segredos:** só em segredos do GitHub Actions e do Cloudflare Pages; nunca no código, em logs, em issues ou em chats. Os logs do GitHub são públicos: os workflows imprimem apenas contagens.
- **Cadeia de suprimentos:** actions de terceiros presas a commit (SHA), Dependabot, revisão de dependências no PR, `npm audit` e verificação de assinaturas no CI, CodeQL.
- **Backups:** dump criptografado (AES-256) no Drive, espelho no Supabase e backup nativo do Azure; teste de restauração semanal. Ver `docs/BACKUP.md`.

## Riscos conhecidos e decisões
- O firewall do servidor Postgres está **aberto para qualquer origem** (necessário porque o Cloudflare e o GitHub Actions têm IPs variáveis); a proteção é TLS + senha forte por papel. Mitigação planejada: Hyperdrive (`docs/PLANO-DE-ACAO-BANCO.md`, R8).
- A `BACKUP_PASSPHRASE` precisa de custódia no cofre da empresa, com 2 pessoas (R1). Sem ela o backup do Drive não abre.
- A `main` ainda **não tem proteção de branch**. Recomendado: exigir PR e os checks do Pipeline e do CodeQL antes do merge (passo a passo em [`docs/OPERACAO.md`](docs/OPERACAO.md), seção 4.6).

## Se um segredo vazar
1. Troque o segredo imediatamente (senha do papel no Postgres, token, chave) e atualize o Cloudflare/GitHub.
2. Revogue o que foi exposto (chaves da API externa em Administração, tokens de serviço).
3. Registre o ocorrido em `docs/` (modelo: `INCIDENTE-2026-11-17-NEON.md`).
