# Servidor MCP do Radar Pré-Vendas (somente leitura)

Permite que um **agente de IA** (Claude Desktop, Claude Code, ou qualquer cliente MCP) **consulte as oportunidades** do Radar. É só visualização: o servidor **não tem nenhuma ferramenta de escrita** e não acessa o banco; ele apenas repassa consultas à [API de leitura](../docs/API-LEITURA.md) usando uma **chave de leitura**.

```
Agente  --MCP (stdio)-->  este servidor (Node)  --HTTPS GET + chave de leitura-->  API de leitura  -->  banco (papel só-leitura)
```

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `listar_oportunidades` | Lista com filtros (texto, status, torre, UF, linha de serviço, segmento, pré-vendas, órgão, datas do pregão, faixa de valor, atualizado desde, arquivadas) e paginação. Devolve todos os campos. Até 100 por chamada (padrão 25); use `proximo_offset` para a próxima página |
| `ver_oportunidade` | Uma oportunidade completa, pelo código `AAAA-NNNN` ou id |
| `listar_campos` | Campos e listas de valores válidos (status, torre, UF...), para o agente filtrar com os nomes certos |

Todas são marcadas como *somente leitura* (`readOnlyHint`), então os clientes MCP não pedem confirmação de escrita.

## Instalar (uma vez)

Precisa de **Node 20+**. Na pasta do projeto:

```bash
cd mcp
npm ci
```

## Chave de leitura

Um **administrador do Radar** abre *Administração → API*, informa o nome do agente (ex.: `agente-consulta`), escolhe o tipo **Leitura** e clica em **Criar chave**. A chave (`rdr_...`) aparece **uma única vez**: guarde em cofre de senhas. **Ela dá acesso a todos os dados das oportunidades, inclusive valores internos da CTC**: trate como senha e não a coloque em repositórios, chats ou prints. Para desligar um agente, revogue a chave na mesma tela.

## Configurar no agente

Variáveis de ambiente: `RADAR_API_KEY` (**obrigatória**, a chave de leitura) e `RADAR_API_URL` (opcional; padrão `https://radar-prevendas.pages.dev/api/externo`).

**Claude Code**

```bash
claude mcp add radar-prevendas --env RADAR_API_KEY=rdr_SUA_CHAVE -- node /caminho/para/radar-prevendas-react/mcp/server.mjs
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "radar-prevendas": {
      "command": "node",
      "args": ["C:\\caminho\\para\\radar-prevendas-react\\mcp\\server.mjs"],
      "env": { "RADAR_API_KEY": "rdr_SUA_CHAVE" }
    }
  }
}
```

Depois reinicie o cliente e pergunte, por exemplo: *"Liste as oportunidades Go de valor acima de R$ 1 milhão com pregão em dezembro"* ou *"Mostre a oportunidade 2026-0001"*.

## Segurança

- **Somente leitura em todas as camadas:** o servidor só faz `GET`; a API só aceita chave de leitura nas consultas; a consulta usa o papel `radar_leitor` do banco (apenas `SELECT`).
- A chave nunca aparece em mensagens de erro nem em log; exige **HTTPS** (HTTP só em `localhost`, para testes) e não segue redirecionamentos (a tela de login do Access nunca recebe a chave).
- Os filtros são validados no servidor MCP e de novo na API; parâmetro desconhecido é recusado.
- Quem tem acesso ao computador onde o agente roda tem acesso à chave. Use uma chave por agente/pessoa e revogue ao desligar.

## Problemas comuns

| Mensagem | Causa |
|---|---|
| `Defina RADAR_API_KEY...` / `não tem o formato...` | variável ausente ou chave copiada incompleta |
| `Chave do Radar ausente, inválida ou revogada` | chave errada ou revogada: peça uma nova ao administrador |
| `A chave configurada é de escrita` | foi criada com o tipo Escrita: crie outra do tipo **Leitura** |
| `Não foi possível falar com o Radar` | sem internet/endereço errado, ou a API respondeu com um redirecionamento: o Cloudflare Access precisa ter a regra **Bypass** em `/api/externo/*` (ver [OPERACAO.md](../docs/OPERACAO.md)) |
| `Muitas consultas` | limite de 60 por minuto por chave: aguarde alguns segundos |

## Desenvolvimento

- `lib.mjs`: cliente HTTP e ferramentas, sem dependências. `server.mjs`: ligação com o SDK do MCP.
- Testes: `npm test` na raiz do projeto roda `mcp/lib.test.mjs` e `mcp/servidor.e2e.test.mjs` (este sobe o servidor de verdade contra uma API falsa local; precisa de `npm ci` dentro de `mcp/`, que o CI já faz).
- Servidor remoto (HTTP, compartilhado entre vários agentes) não foi construído: só faria sentido se agentes na nuvem precisarem se conectar.