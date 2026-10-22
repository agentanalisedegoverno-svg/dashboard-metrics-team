# Backup do banco (Neon → Google Drive)

O Neon free guarda só 6 horas de histórico, então o backup é a nossa proteção real contra erro humano, carga errada ou perda do projeto.

> **Estado (22/10/2026): funcional e comprovado.** Backups diários automáticos desde 21/10; restauração testada em Postgres temporário **e** em um branch real do Neon; cópia semanal e vigia de alerta ativos.

## O que roda

| Workflow | Quando | O que faz |
|---|---|---|
| [`backup-banco.yml`](../.github/workflows/backup-banco.yml) — *Backup do banco* | diário (agendado para 03:00 Brasília) e sob demanda | dump criptografado → Drive |
| [`restore-test.yml`](../.github/workflows/restore-test.yml) — *Teste de restauração do backup* | dia 1 de cada mês e sob demanda | baixa o último backup e restaura em 2 destinos |
| [`verificar-backup.yml`](../.github/workflows/verificar-backup.yml) — *Vigia do backup* | diário às 12:00 Brasília | **falha (e o GitHub envia e-mail)** se o backup ou o teste de restauração estiverem velhos |

> **Horário real:** o GitHub atrasa execuções agendadas quando há fila. O backup agendado para 03:00 tem rodado por volta das **08:30 (Brasília)**. Isso é normal; o vigia tolera até 30 horas.

### Backup diário
1. `pg_dump` completo (tabelas, dados, funções, gatilhos) com um papel **somente leitura** (`radar_backup`).
2. Verifica o dump (tamanho mínimo e presença das tabelas principais).
3. Criptografa com AES-256 (PBKDF2, 600 mil iterações) e gera o `.sha256`.
4. Envia para a pasta do Drive em `diario/`; **aos domingos** (ou com a opção *semanal* ao rodar manualmente) copia também para `semanal/`.
5. Retenção: diários por 14 dias, semanais por 12 semanas. A limpeza só atua dentro de `diario/` e `semanal/`.

Pasta do Drive: `1DJrTNn_LcKxwHzf7gd22DvAD1KdD8Eq6` (variável no workflow; o acesso vem do token).

### Teste de restauração (2 destinos)
Baixa o backup mais recente, confere o hash, descriptografa e restaura em:
- **`temporario`:** Postgres 17 descartável no próprio runner;
- **`neon`:** branch real **`teste-restauracao`** do Neon (banco `restore_drill`, papel `radar_restore`, **isolado da produção**: a credencial só entra nesse branch).

Em cada destino o teste confere: número de oportunidades (igual à produção), quantas têm código `AAAA-NNNN`, soma do orçamento, histórico, as 6 funções, os 3 gatilhos e executa um **cadastro de verdade (desfeito)** para provar que função, validação, numeração e auditoria funcionam no banco restaurado. O resumo aparece na página da execução. Pode rodar só um destino pelo campo *alvo*.

### Vigia
Todo dia confere (a) se há backup bem-sucedido nas últimas 30 horas e (b) se o último teste de restauração tem menos de 40 dias. Se não, o workflow falha e o GitHub envia e-mail. Para testar o alerta: *Actions → Vigia do backup → Run workflow* com `max_horas_backup = 0` (deve falhar de propósito).

## Segredos necessários (GitHub → Settings → Secrets and variables → Actions)

| Segredo | O que é |
|---|---|
| `DATABASE_URL_BACKUP` | Connection string do papel `radar_backup` (somente leitura) |
| `BACKUP_PASSPHRASE` | Senha de criptografia dos dumps. **Guarde também no cofre de senhas da empresa: sem ela o backup não abre.** |
| `RCLONE_DRIVE_TOKEN` | Token OAuth do Drive (JSON), gerado uma vez com `rclone authorize "drive"` |
| `DATABASE_URL_RESTORE` | Connection string do papel `radar_restore` **do branch `teste-restauracao`** (banco administrativo `neondb`; o teste usa o banco `restore_drill`). Não dá acesso à produção |

## Restaurar de verdade (desastre)

```bash
# 1) baixar radar-AAAA-MM-DDTHHMMZ.dump.enc da pasta do Drive e conferir o .sha256
sha256sum -c radar-*.dump.enc.sha256

# 2) descriptografar (pede a BACKUP_PASSPHRASE)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in radar-*.dump.enc -out radar.dump

# 3) restaurar num banco VAZIO (um branch/projeto novo do Neon)
pg_restore --no-owner --no-privileges --dbname "<url do banco de destino>" radar.dump
```

Depois de restaurar, **recrie os papéis e permissões** (`radar_leitor`, `radar_app`, `radar_escritor`, `radar_planner`, `radar_backup`), porque o dump não leva privilégios: rode as migrações de `db/migrations/` em ordem (são idempotentes) e redefina as senhas (ver [OPERACAO.md](OPERACAO.md) §4.1). Por fim aponte os secrets (`DATABASE_URL*`) para o banco novo e faça o redeploy.

## Manutenção do branch de teste

O branch `teste-restauracao` e o banco `restore_drill` existem só para o drill e são sobrescritos a cada teste. O branch nasceu como cópia da produção (contém dados reais até o primeiro teste mensal, que os substitui pelo conteúdo do backup). Se for apagado ou recriado: criar o branch, criar o papel `radar_restore` **no branch** (`neonctl roles create --name radar_restore --branch teste-restauracao`), o banco `restore_drill` com esse dono e atualizar o secret `DATABASE_URL_RESTORE`. Confira sempre que o *host* da URL é o do branch, não o da produção.
