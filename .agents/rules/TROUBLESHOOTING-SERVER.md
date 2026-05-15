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
- **Registro NPM:** Uso temporário de `http://registry.npmjs.org/` para evitar travas de TLS.

## 3. Como Subir a Aplicação

Caso os containers não subam via Docker devido a restrições de compilação, a solução mais estável é manter o **Banco e Redis no Docker** e rodar a **Aplicação no Host**.

### Passo 1: Garantir Infraestrutura (Docker)
Certifique-se de que o Postgres e o Valkey estão rodando:
```bash
docker compose up -d postgres valkey
```

### Passo 2: Subir o Servidor (Host)
Execute o servidor em modo daemon:
```bash
bun plugin/scripts/server-beta-service.cjs --daemon
```
*Acesse em: http://localhost:37954/admin/#projects*

### Passo 3: Subir o Worker (Host)
Inicie o processador de observações:
```bash
bun plugin/scripts/server-beta-service.cjs worker start
```

## 4. Verificação de Saúde
Sempre que tiver problemas de conexão, valide o endpoint de saúde:
- [http://localhost:37954/healthz](http://localhost:37954/healthz)

A resposta esperada é: `{"status":"ok","runtime":"server-beta"}`.
