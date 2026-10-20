# Backup do banco (Neon → Google Drive)

O Neon free guarda só 6 horas de histórico, então o backup é a nossa proteção real contra erro humano, carga errada ou perda do projeto.

## O que roda

Workflow [`backup-banco.yml`](../.github/workflows/backup-banco.yml), todo dia às 03:00 (Brasília) e sob demanda (Actions → "Backup do banco" → Run workflow).

1. `pg_dump` completo (tabelas, dados, funções, gatilhos) com um papel **somente leitura** (`radar_backup`).
2. Verifica o dump (tamanho mínimo e presença das tabelas principais).
3. Criptografa com AES-256 (PBKDF2, 600 mil iterações).
4. Envia para a pasta do Drive em `diario/`; aos domingos copia também para `semanal/`.
5. Retenção: diários por 14 dias, semanais por 12 semanas.

Se qualquer passo falhar, o GitHub envia e-mail de falha do workflow. Confira também a aba Actions de vez em quando.

## Segredos necessários (GitHub → Settings → Secrets and variables → Actions)

| Segredo | O que é |
|---|---|
| `DATABASE_URL_BACKUP` | Connection string do papel `radar_backup` (somente leitura) |
| `BACKUP_PASSPHRASE` | Senha de criptografia dos dumps. **Guarde também no cofre de senhas da empresa: sem ela o backup não abre.** |
| `RCLONE_DRIVE_TOKEN` | Token OAuth do Drive (JSON), gerado uma vez com `rclone authorize "drive"` |

## Restaurar

```bash
# 1) baixar radar-AAAA-MM-DDTHHMMZ.dump.enc da pasta do Drive e conferir o .sha256
sha256sum -c radar-*.dump.enc.sha256

# 2) descriptografar (pede a BACKUP_PASSPHRASE)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in radar-*.dump.enc -out radar.dump

# 3) restaurar num banco VAZIO (de preferência um branch novo do Neon)
pg_restore --no-owner --no-privileges --dbname "<url do banco de destino>" radar.dump
```

Depois de restaurar, recrie os papéis e permissões (`radar_leitor`, `radar_escritor`, `radar_app`) conforme `db/migrations/001_cadastro_oportunidades.sql`, que é idempotente.

## Teste de restauração

Uma vez por mês: criar um branch do Neon, restaurar o último dump e conferir `select count(*) from oportunidades`. Backup que nunca foi restaurado não é garantia.
