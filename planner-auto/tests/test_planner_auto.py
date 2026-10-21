import sys
import unittest
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
        self.assertIsNone(pa.chave_do_titulo("Nova oportunidade"))

    def test_valida_evento(self):
        pa.valida_evento(evento(), PLANOS)
        novo = evento(titulo="[2026-0512] SEDES | Link")
        novo["chave"] = "2026-0512"
        pa.valida_evento(novo, PLANOS)
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

    def test_erros_vao_para_erros(self):
        with self.assertRaises(pa.EventoInvalido):
            pa.planeja(evento(bucket="Bucket Fantasma"), ctx())
        with self.assertRaises(pa.EventoInvalido):
            pa.planeja(evento(rotulos=["Rótulo Fantasma"]), ctx())
        with self.assertRaises(pa.EventoInvalido):
            pa.planeja(evento(), ctx(usuario=None))
        with self.assertRaises(pa.EventoInvalido):  # chave duplicada no plano: nunca adivinhar
            pa.planeja(evento(), ctx(tarefas={"RAD-7": [{"id": "a"}, {"id": "b"}]}))


if __name__ == "__main__":
    unittest.main()
