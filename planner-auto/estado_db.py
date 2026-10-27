"""Estado do planner-auto no banco (Neon), para rodar em servidor sem disco fixo (ex.: Render cron job).

Guarda no banco, CIFRADOS com a chave PLANNER_ESTADO_CHAVE (Fernet), os dois arquivos que ficam em ~/.planner_auto:
  token_cache.json   token do login Microsoft (contém o refresh token)
  estado_radar.json  última versão aplicada por oportunidade (impede reaplicar evento antigo)

Comandos:
  restaurar   baixa os arquivos do banco para ~/.planner_auto (início do job)
  guardar     envia os arquivos de ~/.planner_auto para o banco (fim do job; também serve para migrar o estado do Windows)
  preparar    cria config.json a partir das variáveis de ambiente (o job não tem o arquivo)

Variáveis: DATABASE_URL_PLANNER, PLANNER_ESTADO_CHAVE, e (preparar) PLANNER_CLIENT_ID e PLANNER_TENANT_ID.
O acesso ao banco usa a API SQL sobre HTTPS do Neon (só `requests`, sem driver de Postgres).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests

BASE = Path(__file__).resolve().parent
HOME_DIR = Path.home() / ".planner_auto"
ARQUIVOS = ("token_cache.json", "estado_radar.json")

PLANOS = {"its": "ZiZ73_n76Uu8gXXYbmIQ0mUAD-k0", "digital_health": "4lfDD-9yK0KEimdO-fLPMmUACMhU"}


def _env(nome: str) -> str:
    v = os.environ.get(nome, "").strip()
    if not v:
        sys.exit(f"Variável de ambiente ausente: {nome}")
    return v


def cifrar(texto: str, chave: str) -> str:
    from cryptography.fernet import Fernet

    return Fernet(chave.encode()).encrypt(texto.encode("utf-8")).decode()


def decifrar(token: str, chave: str) -> str:
    from cryptography.fernet import Fernet, InvalidToken

    try:
        return Fernet(chave.encode()).decrypt(token.encode()).decode("utf-8")
    except InvalidToken:
        sys.exit("Não foi possível decifrar o estado: PLANNER_ESTADO_CHAVE não é a chave usada ao guardar.")


def sql(consulta: str, params: list | None = None) -> list[dict]:
    """Executa uma consulta pela API SQL HTTP do Neon e devolve as linhas."""
    url = _env("DATABASE_URL_PLANNER")
    host = urlparse(url).hostname
    r = requests.post(
        f"https://{host}/sql",
        headers={"Neon-Connection-String": url, "Content-Type": "application/json"},
        data=json.dumps({"query": consulta, "params": params or []}),
        timeout=30,
    )
    if r.status_code != 200:
        sys.exit(f"Banco recusou a consulta ({r.status_code}): {r.text[:200]}")
    return r.json().get("rows", [])


def restaurar() -> None:
    chave = _env("PLANNER_ESTADO_CHAVE")
    HOME_DIR.mkdir(parents=True, exist_ok=True)
    achou = {r["nome"]: r["conteudo"] for r in sql("select nome, conteudo from planner_auto_estado where nome = any($1)", [list(ARQUIVOS)])}
    for nome in ARQUIVOS:
        if nome in achou:
            (HOME_DIR / nome).write_text(decifrar(achou[nome], chave), encoding="utf-8")
            print(f"restaurado: {nome}")
        else:
            print(f"sem {nome} no banco (primeira execução?)")
    if "token_cache.json" not in achou:
        sys.exit("Sem token de login no banco. Rode 'guardar' na máquina que já fez o login (python estado_db.py guardar).")


def guardar() -> None:
    chave = _env("PLANNER_ESTADO_CHAVE")
    for nome in ARQUIVOS:
        arq = HOME_DIR / nome
        if not arq.is_file():
            print(f"sem {nome} em {HOME_DIR}; nada a guardar")
            continue
        sql(
            "insert into planner_auto_estado (nome, conteudo) values ($1, $2) "
            "on conflict (nome) do update set conteudo = excluded.conteudo, atualizado_em = now()",
            [nome, cifrar(arq.read_text(encoding="utf-8"), chave)],
        )
        print(f"guardado: {nome}")


def preparar() -> None:
    cfg = {
        "client_id": _env("PLANNER_CLIENT_ID"),
        "tenant_id": _env("PLANNER_TENANT_ID"),
        "planos": PLANOS,
        "eventos_dir": os.environ.get("PLANNER_EVENTOS_DIR", "/tmp/eventos"),
        "radar_mapa": str(BASE.parent / "config" / "planner-mapa.json"),
    }
    (BASE / "config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    print("config.json criado")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"restaurar": restaurar, "guardar": guardar, "preparar": preparar}.get(cmd, lambda: sys.exit(__doc__))()


if __name__ == "__main__":
    main()
