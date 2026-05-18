# Guia de Resolução: Claude-Mem Server (Modo Server-Beta)

Este documento descreve as etapas realizadas para corrigir a indisponibilidade do painel administrativo do Claude-Mem e como proceder caso o problema ocorra novamente.

## 1. Problemas Identificados
- **Conflito de Portas:** O `docker-compose.yml` estava configurado para a porta `37877`, enquanto o ambiente esperava a porta `37954`.
- **Erro de Certificado SSL (Build):** O ambiente de rede bloqueava o download de dependências (Bun, UV, NPM) devido a certificados auto-assinados.
- **Falha de Compilação Nativa:** Módulos que dependem de C++ (`node-gyp`) falhavam por falta de ferramentas de build no container.

## 2. Ajustes Realizados

### Docker Compose
Atualizamos o serviço `claude-mem-server` para refletir a porta correta:
- `CLAUDE_MEM_SERVER_PORT: "37954"`
- `CLAUDE_MEM_WORKER_PORT: "37954"`
- Mapeamento de portas: `"37954:37954"`
- Healthcheck atualizado para o novo endpoint.

### Dockerfile (Correção de Ambiente)
Adicionamos configurações para ignorar validações de SSL e permitir compilação nativa:
- **Ferramentas:** Instalação de `build-essential` e `python3`.
- **SSL Bypass:** 
    - `curl -k`
    - `npm config set strict-ssl false`
    - Variável `NODE_TLS_REJECT_UNAUTHORIZED=0`
    - Variável `npm_config_disturl=http://nodejs.org/dist` para forçar o `node-gyp` a baixar dependências via HTTP.
- **Registro NPM:** Uso temporário de `http://registry.npmjs.org/` para evitar travas de TLS.

## 3. Como Subir a Aplicação

Com os ajustes aplicados no `Dockerfile`, agora é possível subir a aplicação integralmente via Docker, não dependendo mais da biblioteca local (`bun plugin/...`).

### Subir Toda a Infraestrutura (Postgres, Valkey, Servidor e Worker)
```bash
docker compose up -d --build
```

*Acesso:* Após rodar os containers, o painel fica disponível em: http://localhost:37954/admin/#projects

### Alternativa: Subir Manualmente no Host (Caso o Docker Falhe)

Caso precise rodar a aplicação localmente:
1. Garanta que apenas o Postgres e o Valkey estão rodando:
   `docker compose up -d postgres valkey`
2. Execute o servidor em modo daemon:
   `bun plugin/scripts/server-beta-service.cjs --daemon`
3. Inicie o processador de observações (Worker):
   `bun plugin/scripts/server-beta-service.cjs worker start`

## 4. Verificação de Saúde
Sempre que tiver problemas de conexão, valide o endpoint de saúde:
- [http://localhost:37954/healthz](http://localhost:37954/healthz)

A resposta esperada é: `{"status":"ok","runtime":"server-beta"}`.
