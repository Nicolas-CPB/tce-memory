Este é um fork do projeto [claude-mem](https://github.com/thedotmack/claude-mem). 

O projeto original é uma biblioteca de compressão de memória persistente construído para [Claude Code](https://claude.com/claude-code). 

# Alterações feitas por nós:
1. Disponibilizamos para utilizar em qualquer IDE e AGENTE via MCP.
2. Criamos uma interface web para gerenciamento dos times, projetos e memórias.
3. Implementamos com um banco compartilhado, onde todos irão compartilhar as memórias dentro do seu projeto.

### Para utilizar com MCP, adicione no seus servers a configuração do MCP:

```json
{
  "mcpServers": {
    "tce-mem": {
      "command": "npx",
      "args": [
        "-y", 
        "git+https://SEU_USUARIO@bitbucket.org/tcesc-git/tce-mem.git"
      ]
    }
  }
}
```
# Observação: Essa config foi feita no formato do Google Antigravity. Para outres AGENTES ajuste conforme a necessidade.

### Adicione o arquivo ./docs/AGENT_RULES_EXAMPLE.md no seu agente para ele sempre interagir via MCP com o projeto.

Além disso, em cada projeto seu crie um arquivo "tce-memory.md" também com trigger always_on com a seguinte configuração:

```md
---
trigger: always_on
---

# Claude Mem Project Config

Project name: <NOME_DO_PROJETO>
Claude Mem projectId: <PROJECT_ID_DO_PROJETO>

Always pass this projectId when calling claude-mem MCP tools.
```

# Note: Este ID deve ser previamente criado via interface WEB do Claude Mem.

### Sugestões de melhoria, crítica ou bug entre em contato com o Nicolas Becker.