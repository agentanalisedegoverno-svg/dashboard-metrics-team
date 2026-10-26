import sys
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import planner_auto as pa  # noqa: E402

BUCKETS = {"GO": "b-go", "Em andamento ( Proposta Entregue)": "b-and", "NO GO": "b-nogo"}
CATS = {"Licitação": "category1", "Público": "category2", "DIGITAL": "category3"}
PLANOS = {"PLANO1"}


def evento(**cartao):
    c = {"titulo": "[RAD-7] SEDES | Link | PE: 1/2026 | DATA: 05/11/2026", "status": "Go", "bucket": "GO", "progresso": 50,
         "prazo": "2026-11-05T12:00:00Z", "responsavel": "julio.silva@ctctech.com.br", "rotulos": ["Licitação", "Público"],
         "nota": "Radar #7 (v1)", "checklist": ["a", "b"]}
    c.update(cartao)
    return {"versao": "2", "tipo": "oportunidade_nova", "chave": "RAD-7", "versaoOrigem": 1, "origem": "Radar",
            "geradoEm": "2026-10-21T14:00:00Z", "plano": "PLANO1", "cartao": c}


def ctx(tarefas=None, ultima=None, usuario="user-1"):
    return {"buckets": BUCKETS, "categorias": CATS, "tarefas_por_chave": tarefas or {}, "ultima_versao": ultima or {},
            "resolve_usuario": lambda email: usuario}


class Funcoes(unittest.TestCase):
    def test_normaliza_e_resolve(self):
        self.assertEqual(pa.resolve_nome("GO", BUCKETS), "b-go")
        self.assertEqual(pa.resolve_nome("em andamento (proposta entregue)", BUCKETS), "b-and")  # caixa/espaços
        self.assertIsNone(pa.resolve_nome("Inexistente", BUCKETS))

    def test_chave_do_titulo(self):
        self.assertEqual(pa.chave_do_titulo("[RAD-12] X | Y"), "RAD-12")
        self.assertEqual(pa.chave_do_titulo("[2026-0512] Órgão | Objeto"), "2026-0512")
        self.assertEqual(pa.chave_do_titulo("[RADAR 2026-3156] IBGE | Objeto"), "2026-3156")  # novo padrão do título
        self.assertEqual(pa.chave_do_titulo("[RADAR RAD-12] X | Y"), "RAD-12")
        self.assertIsNone(pa.chave_do_titulo("Nova oportunidade"))

    def test_valida_evento(self):
        pa.valida_evento(evento(), PLANOS)
        novo = evento(titulo="[2026-0512] SEDES | Link")
        novo["chave"] = "2026-0512"
        pa.valida_evento(novo, PLANOS)
        radar = evento(titulo="[RADAR 2026-0512] SEDES | Link")  # novo padrão do título
        radar["chave"] = "2026-0512"
        pa.valida_evento(radar, PLANOS)
        for mut, msg in [
            (lambda e: e.update(versao="1"), "versão"),
            (lambda e: e.update(chave="X-1"), "chave"),
            (lambda e: e.update(chave="26-1"), "chave curta"),
            (lambda e: e.update(plano="OUTRO"), "plano"),
            (lambda e: e["cartao"].update(progresso=30), "progresso"),
            (lambda e: e["cartao"].update(titulo="sem chave"), "título"),
            (lambda e: e.pop("versaoOrigem"), "versaoOrigem"),
        ]:
            e = evento(); mut(e)
            with self.assertRaises(pa.EventoInvalido, msg=msg):
                pa.valida_evento(e, PLANOS)


class Planejamento(unittest.TestCase):
    def test_cria_quando_nao_existe(self):
        p = pa.planeja(evento(), ctx())
        self.assertEqual((p["acao"], p["bucket_id"], p["responsaveis_ids"]), ("criar", "b-go", ["user-1"]))
        self.assertEqual(p["categorias"], {"category1": True, "category2": True})
        self.assertIn("CRIAR RAD-7", pa.descricao_acao(p))

    def test_atualiza_quando_existe(self):
        p = pa.planeja(evento(), ctx(tarefas={"RAD-7": [{"id": "t1"}]}))
        self.assertEqual((p["acao"], p["tarefa_id"]), ("atualizar", "t1"))

    def test_ignora_versao_antiga_ou_repetida(self):
        self.assertEqual(pa.planeja(evento(), ctx(ultima={"RAD-7": 1}))["acao"], "ignorar")
        self.assertEqual(pa.planeja(evento(), ctx(ultima={"RAD-7": 5}))["acao"], "ignorar")
        e = evento(); e["versaoOrigem"] = 2
        self.assertEqual(pa.planeja(e, ctx(ultima={"RAD-7": 1}))["acao"], "criar")

    def test_responsavel_nulo_nao_altera(self):
        p = pa.planeja(evento(responsavel=None), ctx(tarefas={"RAD-7": [{"id": "t1"}]}))
        self.assertEqual(p["responsaveis_ids"], [])
        self.assertIn("não altera", pa.descricao_acao(p))

    def test_varios_responsaveis(self):
        p = pa.planeja(evento(responsaveis=["a@x.com", "b@x.com"]), ctx())
        self.assertEqual(len(p["responsaveis_ids"]), 2)
        self.assertIn("a@x.com, b@x.com", pa.descricao_acao(p))

    def test_responsaveis_extras_da_config(self):
        c = ctx(); c["responsaveis_extras"] = ["x@x.com", "julio.silva@ctctech.com.br"]
        p = pa.planeja(evento(), c)  # evento já traz julio.silva; o extra duplicado não repete
        self.assertEqual(p["responsaveis_emails"], ["julio.silva@ctctech.com.br", "x@x.com"])

    def test_erros_vao_para_erros(self):
        with self.assertRaises(pa.EventoInvalido):
            pa.planeja(evento(bucket="Bucket Fantasma"), ctx())
        with self.assertRaises(pa.EventoInvalido):
            pa.planeja(evento(rotulos=["Rótulo Fantasma"]), ctx())
        with self.assertRaises(pa.EventoInvalido):
            pa.planeja(evento(), ctx(usuario=None))
        with self.assertRaises(pa.EventoInvalido):  # chave duplicada no plano: nunca adivinhar
            pa.planeja(evento(), ctx(tarefas={"RAD-7": [{"id": "a"}, {"id": "b"}]}))


class GraphFalso:
    """Registra o que o integrador GRAVARIA no Planner (nada de rede). Espelha as chamadas de Graph: get, post, patch."""

    def __init__(self, tarefa=None, descricao=""):
        self.tarefa = {"id": "t1", "title": "[RAD-7] título antigo", "bucketId": "b-nogo", "percentComplete": 100,
                       "dueDateTime": "2026-01-01T12:00:00Z", "appliedCategories": {"category9": True},
                       "assignments": {"u-antigo": {}}, **(tarefa or {})}
        self.descricao = descricao
        self.gravacoes = []

    def get(self, caminho, **kw):
        if caminho.endswith("/details"):
            return {"@odata.etag": "d1", "description": self.descricao, "checklist": {}}
        return {"@odata.etag": "e1", **self.tarefa}

    def post(self, caminho, corpo):
        self.gravacoes.append(("POST", caminho, corpo))
        return {"id": "t-novo"}

    def patch(self, caminho, corpo, etag):
        self.gravacoes.append(("PATCH", caminho, corpo))
        return {}

    def corpo(self, metodo, sufixo):
        achados = [c for m, p, c in self.gravacoes if m == metodo and p.endswith(sufixo)]
        return achados[-1] if achados else None


def planeja_e_aplica(graph, evento_, tarefas, **ctx_extra):
    contexto = ctx(tarefas=tarefas)
    contexto.update(ctx_extra)
    contexto["resolve_usuario"] = lambda email: "u-" + email.split("@")[0]
    plano = pa.planeja(evento_, contexto)
    with unittest.mock.patch.object(pa, "log_acao"):
        pa.aplica(graph, plano, "PLANO1", evento_)
    return plano


class RegraDeAtualizacao(unittest.TestCase):
    """O que acontece no cartão quando o Radar manda uma atualização (documentado em docs/INTEGRACAO-PLANNER.md)."""

    def atualiza(self, graph=None, **cartao):
        graph = graph or GraphFalso()
        ev = evento(**cartao)
        ev["tipo"] = "oportunidade_atualizada"
        ev["versaoOrigem"] = 2
        ev["cartao"]["checklist"] = []  # o exportador só manda checklist na criação
        planeja_e_aplica(graph, ev, {"RAD-7": [{"id": "t1"}]})
        return graph

    def test_atualizacao_sobrescreve_titulo_bucket_progresso_e_prazo(self):
        g = self.atualiza(titulo="[RAD-7] SEDES | Link | DATA: 05/11/2026", bucket="GO", progresso=50, prazo="2026-11-05T12:00:00Z")
        c = g.corpo("PATCH", "/planner/tasks/t1")
        self.assertEqual(c["title"], "[RAD-7] SEDES | Link | DATA: 05/11/2026")
        self.assertEqual((c["bucketId"], c["percentComplete"], c["dueDateTime"]), ("b-go", 50, "2026-11-05T12:00:00Z"))

    def test_mudar_o_status_move_o_cartao_de_bucket_e_ajusta_o_progresso(self):
        g = self.atualiza(bucket="NO GO", progresso=100)
        c = g.corpo("PATCH", "/planner/tasks/t1")
        self.assertEqual((c["bucketId"], c["percentComplete"]), ("b-nogo", 100))

    def test_o_que_o_time_mexeu_a_mao_em_bucket_e_progresso_e_refeito_na_proxima_atualizacao(self):
        # alguém arrastou o cartão para outro bucket e marcou 100%: a atualização do Radar devolve ao que o status manda
        g = GraphFalso(tarefa={"bucketId": "b-and", "percentComplete": 100})
        self.atualiza(graph=g, bucket="GO", progresso=50)
        c = g.corpo("PATCH", "/planner/tasks/t1")
        self.assertEqual((c["bucketId"], c["percentComplete"]), ("b-go", 50))

    def test_rotulos_sao_acrescentados_sem_remover_os_do_time(self):
        g = self.atualiza(rotulos=["Licitação"])
        self.assertEqual(g.corpo("PATCH", "/planner/tasks/t1")["appliedCategories"], {"category9": True, "category1": True})

    def test_responsaveis_so_sao_acrescentados_e_o_antigo_continua(self):
        g = self.atualiza(responsavel="julio.silva@ctctech.com.br")
        self.assertEqual(list(g.corpo("PATCH", "/planner/tasks/t1")["assignments"]), ["u-julio.silva"])  # só o novo; nada remove u-antigo

    def test_quem_ja_esta_atribuido_nao_e_regravado_e_sem_responsavel_nao_mexe_na_atribuicao(self):
        g = GraphFalso(tarefa={"assignments": {"u-julio.silva": {}}})
        self.atualiza(graph=g, responsavel="julio.silva@ctctech.com.br")
        self.assertNotIn("assignments", g.corpo("PATCH", "/planner/tasks/t1"))
        g2 = self.atualiza(responsavel=None)
        self.assertNotIn("assignments", g2.corpo("PATCH", "/planner/tasks/t1"))

    def test_prazo_vazio_no_radar_nao_limpa_o_prazo_do_cartao(self):
        g = self.atualiza(prazo=None)
        self.assertNotIn("dueDateTime", g.corpo("PATCH", "/planner/tasks/t1"))

    def test_a_nota_e_acrescentada_com_carimbo_e_nao_apaga_o_que_o_time_escreveu(self):
        g = GraphFalso(descricao="Anotação escrita pelo time.")
        self.atualiza(graph=g, nota="Radar RAD-7 (v2) — status: Go.")
        d = g.corpo("PATCH", "/details")["description"]
        self.assertTrue(d.startswith("Anotação escrita pelo time.\n\n--- Radar "))
        self.assertTrue(d.endswith("Radar RAD-7 (v2) — status: Go."))

    def test_o_checklist_nao_e_tocado_na_atualizacao(self):
        g = self.atualiza()
        self.assertNotIn("checklist", g.corpo("PATCH", "/details") or {})

    def test_a_criacao_grava_o_checklist_padrao_e_a_nota_nas_anotacoes(self):
        g = GraphFalso()
        planeja_e_aplica(g, evento(checklist=["Análise de edital", "Vistoria"], nota="Radar RAD-7 (v1)"), {})
        self.assertEqual(g.corpo("POST", "/planner/tasks")["bucketId"], "b-go")
        det = g.corpo("PATCH", "/details")
        self.assertEqual(sorted(i["title"] for i in det["checklist"].values()), ["Análise de edital", "Vistoria"])
        self.assertEqual(det["description"], "Radar RAD-7 (v1)")

    def test_anotacoes_passam_do_limite_de_30000_caracteres_e_o_fim_e_cortado(self):
        g = GraphFalso(descricao="x" * 29990)
        self.atualiza(graph=g, nota="y" * 200)
        d = g.corpo("PATCH", "/details")["description"]
        self.assertEqual(len(d), 30000)
        self.assertTrue(d.startswith("x" * 29990))
        self.assertEqual(d.count("y"), 0)  # o corte é no FIM: a nota nova se perde quando as anotações já estão cheias

    def test_cartao_apagado_no_planner_e_recriado_na_proxima_atualizacao_sem_checklist(self):
        ev = evento()
        ev["tipo"] = "oportunidade_atualizada"
        ev["versaoOrigem"] = 3
        ev["cartao"]["checklist"] = []
        p = pa.planeja(ev, ctx(tarefas={}, ultima={"RAD-7": 2}))  # nenhum cartão com a chave: o integrador não sabe que foi apagado
        self.assertEqual((p["acao"], p["checklist"]), ("criar", []))

    def test_tirar_o_codigo_do_titulo_faz_o_integrador_nao_achar_o_cartao_e_criar_outro(self):
        # o cartão renomeado sem [RAD-7] deixa de ser encontrado (a busca é pelo código no título)
        titulos = {pa.chave_do_titulo(t) for t in ["Cartão renomeado pelo time"]}
        self.assertEqual(titulos, {None})
        p = pa.planeja(evento(), ctx(tarefas={}))
        self.assertEqual(p["acao"], "criar")

    def test_mudar_a_torre_cria_cartao_no_outro_plano_e_o_antigo_fica(self):
        # a busca é só no plano do evento: o cartão do plano de origem não é visto (nem movido, nem apagado)
        ev = evento()
        ev["plano"] = "PLANO1"
        p_origem = pa.planeja(ev, ctx(tarefas={"RAD-7": [{"id": "t-its"}]}))
        self.assertEqual((p_origem["acao"], p_origem["tarefa_id"]), ("atualizar", "t-its"))
        p_destino = pa.planeja(ev, ctx(tarefas={}))  # no plano novo ainda não há cartão com essa chave
        self.assertEqual(p_destino["acao"], "criar")

    def test_responsaveis_extras_entram_em_todo_cartao_alem_do_pre_vendas(self):
        g = GraphFalso(tarefa={"assignments": {}})
        ev = evento(responsavel="julio.silva@ctctech.com.br")
        ev["tipo"] = "oportunidade_atualizada"
        ev["versaoOrigem"] = 2
        planeja_e_aplica(g, ev, {"RAD-7": [{"id": "t1"}]}, responsaveis_extras=["flavio.santanna@ctctech.com.br"])
        self.assertEqual(sorted(g.corpo("PATCH", "/planner/tasks/t1")["assignments"]), ["u-flavio.santanna", "u-julio.silva"])


if __name__ == "__main__":
    unittest.main()
