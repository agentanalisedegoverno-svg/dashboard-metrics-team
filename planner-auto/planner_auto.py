#!/usr/bin/env python3
"""planner-auto — integração Radar -> Planner (Pré-vendas CTC).

Comandos desta entrega:
  login                      login por código de dispositivo (cache em %USERPROFILE%\\.planner_auto\\)
  inspecionar [--plano ID]   lista planos, buckets e rótulos (SOMENTE LEITURA) e confere com o mapa do Radar
  processar-eventos          aplica os eventos de eventos\\entrada (contrato v2 do Radar)
      --dry-run              mostra o que seria feito em cada cartão, sem gravar nada
      --sim                  grava sem pedir confirmação (só para rotinas já aprovadas)
      --arquivo NOME         processa só esse arquivo de entrada\\

Regras (docs/INTEGRACAO-PLANNER.md do Radar): idempotência pela chave [AAAA-NNNN] (código da oportunidade) no título; ignora
eventos com versaoOrigem menor/igual à última aplicada; responsavel null não altera a atribuição;
bucket/rótulo por nome exato e depois sem caixa/espaços, senão o evento vai para erros\\; nunca apaga nada.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

GRAPH = "https://graph.microsoft.com/v1.0"
ESCOPOS = ["Tasks.ReadWrite", "Group.Read.All", "User.ReadBasic.All"]
BASE = Path(__file__).resolve().parent
HOME_DIR = Path.home() / ".planner_auto"
CHAVE_PADRAO = r"(?:\d{4}-\d{4,}|RAD-\d+)"  # código AAAA-NNNN do Radar; RAD-<id> é o formato antigo
CHAVE_RE = re.compile(r"\[(?:RADAR\s+)?(" + CHAVE_PADRAO + r")\]")  # aceita "[2026-0512]" (antigo) e "[RADAR 2026-0512]"
ASSIGN = {"@odata.type": "#microsoft.graph.plannerAssignment", "orderHint": " !"}


# ----------------------------------------------------------------- utilitários puros (testados)
def normaliza(s: str) -> str:
    """Compara nomes sem caixa nem espaços (ex.: 'Em andamento ( Proposta Entregue)')."""
    return re.sub(r"\s+", "", s or "").casefold()


def resolve_nome(nome: str, candidatos: dict[str, str]) -> str | None:
    """candidatos: {nome: id}. Nome exato primeiro, depois comparação normalizada; None se não achar."""
    if nome in candidatos:
        return candidatos[nome]
    alvo = normaliza(nome)
    achados = [v for k, v in candidatos.items() if normaliza(k) == alvo]
    return achados[0] if len(achados) == 1 else None


def chave_do_titulo(titulo: str) -> str | None:
    m = CHAVE_RE.search(titulo or "")
    return m.group(1) if m else None


class EventoInvalido(Exception):
    pass


def valida_evento(ev: dict, planos_conhecidos: set[str]) -> None:
    if ev.get("versao") != "2":
        raise EventoInvalido(f"versão de contrato não suportada: {ev.get('versao')!r}")
    if ev.get("tipo") not in ("oportunidade_nova", "oportunidade_atualizada"):
        raise EventoInvalido(f"tipo desconhecido: {ev.get('tipo')!r}")
    if not re.fullmatch(CHAVE_PADRAO, str(ev.get("chave", ""))):
        raise EventoInvalido(f"chave inválida: {ev.get('chave')!r}")
    if not isinstance(ev.get("versaoOrigem"), int):
        raise EventoInvalido("versaoOrigem ausente")
    if ev.get("plano") not in planos_conhecidos:
        raise EventoInvalido(f"plano fora da configuração: {ev.get('plano')!r}")
    c = ev.get("cartao") or {}
    if not c.get("titulo") or not c.get("bucket"):
        raise EventoInvalido("cartao.titulo e cartao.bucket são obrigatórios")
    if c.get("progresso") not in (0, 50, 100):
        raise EventoInvalido(f"progresso deve ser 0, 50 ou 100 (veio {c.get('progresso')!r})")
    titulo = ev["cartao"]["titulo"]
    if not (titulo.startswith(f"[{ev['chave']}]") or titulo.startswith(f"[RADAR {ev['chave']}]")):
        raise EventoInvalido("o título deve começar com [chave] ou [RADAR chave]")


def planeja(ev: dict, contexto: dict) -> dict:
    """Decide o que fazer com UM evento, sem tocar na rede.

    contexto: {buckets:{nome:id}, categorias:{nome:'categoryN'}, tarefas_por_chave:{chave:[tarefa,...]},
               ultima_versao:{chave:int}, resolve_usuario: callable(email)->id|None}
    Devolve {acao: criar|atualizar|ignorar, ...} ou levanta EventoInvalido (vai para erros\\).
    """
    chave = ev["chave"]
    c = ev["cartao"]
    ultima = contexto["ultima_versao"].get(chave)
    if ultima is not None and ev["versaoOrigem"] <= ultima:
        return {"acao": "ignorar", "motivo": f"versaoOrigem {ev['versaoOrigem']} <= última aplicada ({ultima})"}

    bucket_id = resolve_nome(c["bucket"], contexto["buckets"])
    if not bucket_id:
        raise EventoInvalido(f"bucket não encontrado no plano: {c['bucket']!r}")
    categorias = {}
    for rotulo in c.get("rotulos", []):
        cat = resolve_nome(rotulo, contexto["categorias"])
        if not cat:
            raise EventoInvalido(f"rótulo não encontrado no plano: {rotulo!r}")
        categorias[cat] = True

    # `responsaveis` (lista) ou `responsavel` (um e-mail). Vazio/nulo = não altera a atribuição.
    emails = list(c.get("responsaveis") or ([c["responsavel"]] if c.get("responsavel") else []))
    # `responsaveis_extras` (config.json do planner-auto): pessoas acrescentadas a TODO cartão, além do pré-vendas do Radar.
    for extra in contexto.get("responsaveis_extras", []):
        if extra not in emails:
            emails.append(extra)
    responsaveis_ids = []
    for email in emails:
        uid = contexto["resolve_usuario"](email)
        if not uid:
            raise EventoInvalido(f"responsável não encontrado no Entra: {email!r}")
        responsaveis_ids.append(uid)

    existentes = contexto["tarefas_por_chave"].get(chave, [])
    if len(existentes) > 1:
        raise EventoInvalido(f"mais de um cartão com a chave {chave}: {[t['id'] for t in existentes]}")

    base = {
        "chave": chave, "versaoOrigem": ev["versaoOrigem"], "bucket_id": bucket_id, "bucket_nome": c["bucket"],
        "categorias": categorias, "responsaveis_ids": responsaveis_ids, "responsaveis_emails": emails,
        "titulo": c["titulo"], "prazo": c.get("prazo"), "progresso": c["progresso"],
        "nota": c.get("nota", ""), "checklist": c.get("checklist", []),
    }
    if existentes:
        return {"acao": "atualizar", "tarefa_id": existentes[0]["id"], **base}
    return {"acao": "criar", **base}


def descricao_acao(p: dict) -> str:
    if p["acao"] == "ignorar":
        return f"IGNORAR — {p['motivo']}"
    resp = ", ".join(p["responsaveis_emails"]) or "(sem responsável: não altera)"
    cats = ", ".join(p["categorias"]) or "—"
    linhas = [
        f"{p['acao'].upper()} {p['chave']} (v{p['versaoOrigem']})",
        f"   título : {p['titulo']}",
        f"   bucket : {p['bucket_nome']}   progresso: {p['progresso']}%   prazo: {p['prazo'] or '—'}",
        f"   rótulos: {cats}   responsável: {resp}",
    ]
    if p["acao"] == "criar" and p["checklist"]:
        linhas.append(f"   checklist: {len(p['checklist'])} itens")
    linhas.append("   nota: acrescentada em Anotações" if p["nota"] else "   nota: —")
    return "\n".join(linhas)


# ----------------------------------------------------------------- Graph
class Graph:
    def __init__(self, token_fn):
        import requests

        self.s = requests.Session()
        self.token_fn = token_fn

    def _req(self, metodo, caminho, **kw):
        url = caminho if caminho.startswith("http") else GRAPH + caminho
        for tentativa in range(4):
            headers = {"Authorization": f"Bearer {self.token_fn()}", **kw.pop("headers", {})}
            r = self.s.request(metodo, url, headers=headers, timeout=60, **kw)
            if r.status_code in (429, 503) and tentativa < 3:
                time.sleep(min(int(r.headers.get("Retry-After", "5")), 60))
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"{metodo} {caminho} -> HTTP {r.status_code}: {r.text[:300]}")
            return r
        raise RuntimeError("tentativas esgotadas")

    def get(self, caminho, **kw):
        return self._req("GET", caminho, **kw).json()

    def paginado(self, caminho):
        url, itens = caminho, []
        while url:
            j = self.get(url)
            itens += j.get("value", [])
            url = j.get("@odata.nextLink")
        return itens

    def post(self, caminho, corpo):
        return self._req("POST", caminho, json=corpo, headers={"Prefer": "return=representation"}).json()

    def patch(self, caminho, corpo, etag):
        r = self._req("PATCH", caminho, json=corpo, headers={"If-Match": etag, "Prefer": "return=representation"})
        return r.json() if r.content else {}


def cliente_autenticado():
    import msal

    cfg = carregar_config()
    HOME_DIR.mkdir(exist_ok=True)
    cache_arq = HOME_DIR / "token_cache.json"
    cache = msal.SerializableTokenCache()
    if cache_arq.exists():
        cache.deserialize(cache_arq.read_text(encoding="utf-8"))
    app = msal.PublicClientApplication(cfg["client_id"], authority=f"https://login.microsoftonline.com/{cfg['tenant_id']}", token_cache=cache)

    def salvar():
        if cache.has_state_changed:
            cache_arq.write_text(cache.serialize(), encoding="utf-8")

    def token():
        contas = app.get_accounts()
        r = app.acquire_token_silent(ESCOPOS, account=contas[0]) if contas else None
        if not r or "access_token" not in r:
            sys.exit("Sem login válido. Rode: python planner_auto.py login")
        salvar()
        return r["access_token"]

    return app, cache, salvar, token


def carregar_config() -> dict:
    return json.loads((BASE / "config.json").read_text(encoding="utf-8"))


# ----------------------------------------------------------------- comandos
def cmd_login(_args):
    app, cache, salvar, _ = cliente_autenticado()
    fluxo = app.initiate_device_flow(scopes=ESCOPOS)
    if "user_code" not in fluxo:
        sys.exit(f"Falha ao iniciar o login: {fluxo}")
    print(fluxo["message"], flush=True)
    r = app.acquire_token_by_device_flow(fluxo)
    if "access_token" not in r:
        sys.exit(f"Login não concluído: {r.get('error_description', r)}")
    salvar()
    print(f"✓ Login OK como {r.get('id_token_claims', {}).get('preferred_username', '?')}")


def carregar_mapa_radar(cfg) -> dict | None:
    p = Path(cfg.get("radar_mapa", ""))
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None


def cmd_inspecionar(args):
    _, _, _, token = cliente_autenticado()
    g = Graph(token)
    cfg = carregar_config()
    mapa = carregar_mapa_radar(cfg)
    planos = {k: v for k, v in cfg["planos"].items() if not args.plano or v == args.plano}
    problemas = 0
    for chave, plan_id in planos.items():
        plano = g.get(f"/planner/plans/{plan_id}")
        buckets = {b["name"]: b["id"] for b in g.paginado(f"/planner/plans/{plan_id}/buckets")}
        det = g.get(f"/planner/plans/{plan_id}/details")
        categorias = {nome: cat for cat, nome in (det.get("categoryDescriptions") or {}).items() if nome}
        tarefas = g.paginado(f"/planner/plans/{plan_id}/tasks")
        print(f"\n=== {plano['title']}  ({chave})  planId={plan_id}")
        print(f"Tarefas: {len(tarefas)}")
        print("Buckets:", " | ".join(repr(n) for n in buckets))
        print("Rótulos:", " | ".join(f"{cat}={nome!r}" for nome, cat in categorias.items()))
        if mapa and chave in mapa["planos"]:
            m = mapa["planos"][chave]
            if m["planId"] != plan_id:
                print(f"  ✗ planId do mapa ({m['planId']}) difere do config"); problemas += 1
            for status, nome in m["buckets"].items():
                exato = nome in buckets
                ok = exato or resolve_nome(nome, buckets)
                print(f"  {'✓' if exato else ('~' if ok else '✗')} bucket {status!r} -> {nome!r}" + ("" if exato else (" (só casa sem caixa/espaços)" if ok else " NÃO ENCONTRADO")))
                problemas += 0 if ok else 1
            rotulos = set(m["rotulos"]) | {r for v in (m.get("rotulosPorTorre") or {}).values() for r in v}
            for r in sorted(rotulos):
                ok = r in categorias or resolve_nome(r, categorias)
                print(f"  {'✓' if r in categorias else ('~' if ok else '✗')} rótulo {r!r}" + ("" if ok else " NÃO ENCONTRADO"))
                problemas += 0 if ok else 1
    print("\n" + ("✓ Tudo o que o Radar envia existe nos planos." if not problemas else f"✗ {problemas} divergência(s): ajuste o mapa do Radar ou o Planner antes de ativar."))


def carregar_estado() -> dict:
    p = HOME_DIR / "estado_radar.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def salvar_estado(est: dict):
    HOME_DIR.mkdir(exist_ok=True)
    (HOME_DIR / "estado_radar.json").write_text(json.dumps(est, indent=2), encoding="utf-8")


def log_acao(registro: dict):
    HOME_DIR.mkdir(exist_ok=True)
    registro = {"em": datetime.now(timezone.utc).isoformat(), **registro}
    with (HOME_DIR / "acoes.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(registro, ensure_ascii=False) + "\n")


def aplica(g: Graph, p: dict, plano_id: str, ev: dict):
    """Executa a escrita no Planner. Só chamado fora do --dry-run."""
    nota = p["nota"]
    if p["acao"] == "criar":
        corpo = {"planId": plano_id, "bucketId": p["bucket_id"], "title": p["titulo"], "percentComplete": p["progresso"]}
        if p["prazo"]:
            corpo["dueDateTime"] = p["prazo"]
        if p["categorias"]:
            corpo["appliedCategories"] = p["categorias"]
        if p["responsaveis_ids"]:
            corpo["assignments"] = {uid: ASSIGN for uid in p["responsaveis_ids"]}
        tarefa = g.post("/planner/tasks", corpo)
        tarefa_id = tarefa["id"]
        det = g.get(f"/planner/tasks/{tarefa_id}/details")
        corpo_det = {"description": nota[:30000]}
        if p["checklist"]:
            corpo_det["checklist"] = {
                str(uuid.uuid4()): {"@odata.type": "microsoft.graph.plannerChecklistItem", "title": item[:100], "isChecked": False}
                for item in p["checklist"][:20]
            }
        g.patch(f"/planner/tasks/{tarefa_id}/details", corpo_det, det["@odata.etag"])
        log_acao({"acao": "criar", "chave": p["chave"], "tarefa": tarefa_id, "bucket": p["bucket_nome"], "versaoOrigem": p["versaoOrigem"]})
        return tarefa_id
    tarefa_id = p["tarefa_id"]
    t = g.get(f"/planner/tasks/{tarefa_id}")
    corpo = {"title": p["titulo"], "bucketId": p["bucket_id"], "percentComplete": p["progresso"]}
    if p["prazo"]:
        corpo["dueDateTime"] = p["prazo"]
    if p["categorias"]:
        corpo["appliedCategories"] = {**(t.get("appliedCategories") or {}), **p["categorias"]}
    novos = [u for u in p["responsaveis_ids"] if u not in (t.get("assignments") or {})]
    if novos:  # só acrescenta; nunca remove quem já estava atribuído
        corpo["assignments"] = {uid: ASSIGN for uid in novos}
    antes = {k: t.get(k) for k in ("title", "bucketId", "percentComplete", "dueDateTime")}
    g.patch(f"/planner/tasks/{tarefa_id}", corpo, t["@odata.etag"])
    if nota:
        det = g.get(f"/planner/tasks/{tarefa_id}/details")
        antiga = det.get("description") or ""
        stamp = datetime.now().strftime("%d/%m/%Y %H:%M")
        g.patch(f"/planner/tasks/{tarefa_id}/details", {"description": (antiga + f"\n\n--- Radar {stamp} ---\n" + nota)[:30000]}, det["@odata.etag"])
    log_acao({"acao": "atualizar", "chave": p["chave"], "tarefa": tarefa_id, "antes": antes, "depois": {k: corpo.get(k) for k in antes}, "versaoOrigem": p["versaoOrigem"]})
    return tarefa_id


def cmd_processar(args):
    cfg = carregar_config()
    pasta = Path(cfg["eventos_dir"])
    entrada, processados, erros = pasta / "entrada", pasta / "processados", pasta / "erros"
    for d in (entrada, processados, erros):
        d.mkdir(parents=True, exist_ok=True)
    arquivos = sorted(entrada.glob("*.json"))
    if args.arquivo:
        arquivos = [a for a in arquivos if a.name == args.arquivo]
    if not arquivos:
        print("Nenhum evento em entrada\\.")
        return
    _, _, _, token = cliente_autenticado()
    g = Graph(token)
    planos_conhecidos = set(cfg["planos"].values())
    estado = carregar_estado()
    cache_plano: dict[str, dict] = {}
    cache_users: dict[str, str | None] = {}

    def resolve_usuario(email):
        if email not in cache_users:
            try:
                cache_users[email] = g.get(f"/users/{email}?$select=id")["id"]
            except RuntimeError:
                cache_users[email] = None
        return cache_users[email]

    def contexto(plan_id):
        if plan_id not in cache_plano:
            det = g.get(f"/planner/plans/{plan_id}/details")
            tarefas: dict[str, list] = {}
            for t in g.paginado(f"/planner/plans/{plan_id}/tasks"):
                k = chave_do_titulo(t.get("title", ""))
                if k:
                    tarefas.setdefault(k, []).append(t)
            cache_plano[plan_id] = {
                "buckets": {b["name"]: b["id"] for b in g.paginado(f"/planner/plans/{plan_id}/buckets")},
                "categorias": {nome: cat for cat, nome in (det.get("categoryDescriptions") or {}).items() if nome},
                "tarefas_por_chave": tarefas,
            }
        return {**cache_plano[plan_id], "ultima_versao": {k: v["versaoOrigem"] for k, v in estado.items()}, "resolve_usuario": resolve_usuario,
                "responsaveis_extras": cfg.get("responsaveis_extras", [])}

    planos = []
    for arq in arquivos:
        try:
            ev = json.loads(arq.read_text(encoding="utf-8"))
            valida_evento(ev, planos_conhecidos)
            p = planeja(ev, contexto(ev["plano"]))
            planos.append((arq, ev, p, None))
        except (EventoInvalido, RuntimeError, json.JSONDecodeError) as e:
            planos.append((arq, None, None, str(e)))

    print(f"{len(arquivos)} evento(s) em entrada\\ {'[DRY-RUN: nada será gravado]' if args.dry_run else ''}\n")
    for arq, ev, p, erro in planos:
        print(f"• {arq.name}")
        print("   ✗ ERRO: " + erro if erro else descricao_acao(p))
        print()
    if args.dry_run:
        return
    pendentes = [x for x in planos if x[3] is None and x[2]["acao"] != "ignorar"]
    if pendentes and not args.sim:
        if input(f"Gravar {len(pendentes)} alteração(ões) no Planner? [s/N] ").strip().lower() not in ("s", "sim", "y"):
            print("Cancelado; nada foi gravado.")
            return
    for arq, ev, p, erro in planos:
        if erro:
            (erros / (arq.name + ".erro.txt")).write_text(erro, encoding="utf-8")
            shutil.move(str(arq), str(erros / arq.name))
            continue
        if p["acao"] != "ignorar":
            try:
                tarefa_id = aplica(g, p, ev["plano"], ev)
                estado[ev["chave"]] = {"versaoOrigem": ev["versaoOrigem"], "tarefa": tarefa_id}
                salvar_estado(estado)
            except RuntimeError as e:
                (erros / (arq.name + ".erro.txt")).write_text(str(e), encoding="utf-8")
                shutil.move(str(arq), str(erros / arq.name))
                print(f"   ✗ {arq.name}: {e}")
                continue
        shutil.move(str(arq), str(processados / arq.name))
    print("✓ Concluído.")


def main():
    ap = argparse.ArgumentParser(prog="planner_auto")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login")
    i = sub.add_parser("inspecionar"); i.add_argument("--plano")
    p = sub.add_parser("processar-eventos")
    p.add_argument("--dry-run", action="store_true"); p.add_argument("--sim", action="store_true"); p.add_argument("--arquivo")
    a = ap.parse_args()
    {"login": cmd_login, "inspecionar": cmd_inspecionar, "processar-eventos": cmd_processar}[a.cmd](a)


if __name__ == "__main__":
    main()
