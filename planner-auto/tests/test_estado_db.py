import json
import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import estado_db as ed  # noqa: E402


class CifraEPreparo(unittest.TestCase):
    def test_cifra_e_decifra_com_a_mesma_chave(self):
        from cryptography.fernet import Fernet

        chave = Fernet.generate_key().decode()
        c = ed.cifrar('{"refresh_token": "segredo"}', chave)
        self.assertNotIn("segredo", c)  # o banco só vê texto cifrado
        self.assertEqual(ed.decifrar(c, chave), '{"refresh_token": "segredo"}')

    def test_chave_errada_nao_decifra(self):
        from cryptography.fernet import Fernet

        c = ed.cifrar("x", Fernet.generate_key().decode())
        with self.assertRaises(SystemExit):
            ed.decifrar(c, Fernet.generate_key().decode())

    def test_preparar_cria_config_a_partir_do_ambiente(self):
        with tempfile.TemporaryDirectory() as d, unittest.mock.patch.object(ed, "BASE", Path(d) / "planner-auto"):
            (Path(d) / "planner-auto").mkdir()
            env = {"PLANNER_CLIENT_ID": "cid", "PLANNER_TENANT_ID": "tid"}
            with unittest.mock.patch.dict(os.environ, env):
                ed.preparar()
            cfg = json.loads((Path(d) / "planner-auto" / "config.json").read_text(encoding="utf-8"))
            self.assertEqual((cfg["client_id"], cfg["tenant_id"]), ("cid", "tid"))
            self.assertEqual(set(cfg["planos"]), {"its", "digital_health"})

    def test_restaurar_e_guardar_ida_e_volta(self):
        from cryptography.fernet import Fernet

        chave = Fernet.generate_key().decode()
        banco: dict[str, str] = {}

        def falso_sql(consulta, params=None):
            if consulta.startswith("insert"):
                banco[params[0]] = params[1]
                return []
            return [{"nome": k, "conteudo": v} for k, v in banco.items() if k in params[0]]

        with tempfile.TemporaryDirectory() as d, unittest.mock.patch.object(ed, "HOME_DIR", Path(d)), \
                unittest.mock.patch.object(ed, "sql", falso_sql), unittest.mock.patch.dict(os.environ, {"PLANNER_ESTADO_CHAVE": chave}):
            (Path(d) / "token_cache.json").write_text("TOKEN", encoding="utf-8")
            (Path(d) / "estado_radar.json").write_text('{"2026-0001": {"versaoOrigem": 3}}', encoding="utf-8")
            ed.guardar()
            self.assertNotIn("TOKEN", "".join(banco.values()))
            (Path(d) / "token_cache.json").unlink()
            (Path(d) / "estado_radar.json").unlink()
            ed.restaurar()
            self.assertEqual((Path(d) / "token_cache.json").read_text(encoding="utf-8"), "TOKEN")
            self.assertEqual(json.loads((Path(d) / "estado_radar.json").read_text(encoding="utf-8"))["2026-0001"]["versaoOrigem"], 3)

    def test_sem_token_no_banco_falha_com_instrucao(self):
        from cryptography.fernet import Fernet

        with tempfile.TemporaryDirectory() as d, unittest.mock.patch.object(ed, "HOME_DIR", Path(d)), \
                unittest.mock.patch.object(ed, "sql", lambda *_a, **_k: []), \
                unittest.mock.patch.dict(os.environ, {"PLANNER_ESTADO_CHAVE": Fernet.generate_key().decode()}):
            with self.assertRaises(SystemExit) as e:
                ed.restaurar()
            self.assertIn("guardar", str(e.exception))


if __name__ == "__main__":
    unittest.main()
