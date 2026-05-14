---
trigger: always_on
---

# Claude-Mem Manager Skill

Use o MCP `claude-mem` para recuperar e salvar conhecimento relevante entre sessões.

## Runtime

O ambiente usa `claude-mem` em `server-beta`.

Use preferencialmente estas tools:

- `observation_search`: buscar observações no projeto atual.
- `memory_context`: recuperar contexto relevante do projeto atual.
- `observation_add`: salvar fatos pontuais.
- `memory_add`: salvar conhecimento consolidado.
- `__IMPORTANT`: consultar instruções críticas do claude-mem quando necessário.

Evite usar como fluxo principal:

- `search`
- `timeline`
- `get_observations`

Essas tools pertencem ao fluxo legado/worker e podem não refletir corretamente o storage `server-beta`.

## Project ID Obrigatório

Toda chamada de escrita ou busca deve passar `projectId` explicitamente.

Antes de usar `claude-mem`, identifique o projeto atual procurando uma configuração local. A configuração local do projeto deve estar em uma rule chamada `tce-memory.md`, com este formato:

```md
# Claude Mem Project Config

Project name: ...
Claude Mem projectId: ...
```

Se o projeto atual não tiver `projectId` configurado, não salve memória automaticamente. Informe ao usuário que falta configurar o projeto.

## Quando Buscar Memória

Use `memory_context` ou `observation_search` no início de tarefas relevantes quando:

- *** SEMPRE ***

Sempre use o `projectId` do projeto atual.

## Quando Salvar Memória

Salve memória quando houver:

- *** SEMPRE ***

Não salve ruído, passos triviais, tentativas falhas sem valor futuro, logs longos ou informação sensível.

## Formato Recomendado

Para `observation_add`, use fatos curtos e objetivos.

Para `memory_add`, use conhecimento consolidado neste formato:

```md
Título: [CATEGORIA] Breve descrição

Conteúdo:

Contexto: onde e por que isso foi observado.
Decisão/Fato: o que foi decidido ou descoberto.
Implicações: o que isso muda para o futuro.
Tags: palavras-chave.
```

Sempre incluir `metadata` quando possível:

```json
{
  "title": "[CATEGORIA] Breve descrição",
  "tags": ["spring-boot", "auth", "java"],
  "project": "nome-do-projeto",
  "source": "antigravity"
}
```

## Exemplos

Salvar fato pontual:

```js
observation_add({
  "projectId": "<project-id-do-repo-atual>",
  "kind": "manual",
  "content": "O projeto usa Spring Boot 2.7 e a biblioteca X na versão Y causa conflito; usar versão Z.",
  "metadata": {
    "title": "[BUGFIX] Conflito de biblioteca X",
    "tags": ["spring-boot", "dependency"],
    "project": "ms-esfinge-web"
  }
})
```

Salvar memória consolidada:

```js
memory_add({
  "projectId": "<project-id-do-repo-atual>",
  "kind": "manual",
  "content": "Contexto: ...\nDecisão/Fato: ...\nImplicações: ...\nTags: ...",
  "metadata": {
    "title": "[DECISION] Estratégia de autenticação",
    "tags": ["auth", "architecture"],
    "project": "ms-esfinge-web"
  }
})
```

## Feedback Ao Usuário

Quando salvar algo, informe de forma curta:

```text
Memória salva: [TÍTULO] - resumo breve.
```

Quando não salvar algo, informe ao usuário o motivo.
```text
Não salvando memória: [motivo]
```