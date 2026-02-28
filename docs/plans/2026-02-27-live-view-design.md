# Live View de Logs — Design

**Data:** 2026-02-27
**Status:** Aprovado
**Escopo:** Acesso local apenas (localhost)

## Resumo

Interface web acessível pelo browser que exibe em tempo real os logs do NanoClaw. Equivalente a um `tail -f` com cores ANSI preservadas, sem build step, sem dependências novas no servidor.

## Decisões de Design

| Questão | Decisão |
|---------|---------|
| Acesso | Local apenas (localhost) |
| Conteúdo | Log tail simples com backfill das últimas ~200 linhas |
| Arquivos | `nanoclaw.log` (main) + `nanoclaw.error.log` (error) |
| Onde roda | Embutido no processo NanoClaw existente |
| Frontend | HTML + JS vanilla (sem React, sem build step) |
| Streaming | Server-Sent Events (SSE) |
| Cores | `ansi_up` via CDN converte ANSI → HTML spans |

## Arquitetura

### Novo módulo: `src/log-viewer.ts`

Iniciado em `src/index.ts` na startup se `LOG_VIEWER_ENABLED=true`.

Servidor HTTP nativo (`node:http`) com três rotas:

| Rota | Função |
|------|--------|
| `GET /` | Serve o HTML único (inline no TS como template string) |
| `GET /stream/main` | SSE — tail de `logs/nanoclaw.log` |
| `GET /stream/error` | SSE — tail de `logs/nanoclaw.error.log` |

### Ciclo de vida de um SSE stream

1. Cliente conecta → servidor lê as últimas ~200 linhas do arquivo (backfill imediato)
2. Envia cada linha como evento SSE
3. Abre `fs.watch()` no arquivo → a cada mudança, lê do offset anterior até EOF e envia novas linhas
4. Cliente desconecta → fecha o watcher

### Configuração

Duas variáveis novas em `.env` e `src/config.ts`:

| Variável | Default | Descrição |
|----------|---------|-----------|
| `LOG_VIEWER_ENABLED` | `false` | Liga o servidor web |
| `LOG_VIEWER_PORT` | `4242` | Porta HTTP |

### Integração

```typescript
// src/index.ts — na startup
import { startLogViewer } from './log-viewer.js';
startLogViewer();
```

## Frontend

Layout com dois painéis lado a lado:

```
┌─────────────────────────────────────────────┐
│  NanoClaw Live Logs                    [⏸]  │
├──────────────────┬──────────────────────────┤
│  nanoclaw.log    │  nanoclaw.error.log       │
│  (main)          │  (error)                  │
├──────────────────┼──────────────────────────┤
│ [20:02:30] INFO  │ [20:07:06] ERROR          │
│   Found due...   │   Container exited...     │
│ [20:02:34] INFO  │                           │
└──────────────────┴──────────────────────────┘
```

- Auto-scroll para o fim, pausável com `⏸` ou ao scrollar manualmente para cima
- Fundo escuro, fonte monospace
- `EventSource` com reconexão automática nativa

O HTML inteiro fica como template string em `src/log-viewer.ts` — sem arquivo separado.

## Edge Cases

| Situação | Comportamento |
|----------|---------------|
| Arquivo não existe | Stream aguarda; envia evento `"waiting"` |
| Arquivo rotacionado | `fs.watch` detecta rename/delete — reabre o stream |
| Cliente lento | Sem buffer acumulado; conexão fecha se não consumir |
| NanoClaw reinicia | `EventSource` reconecta automaticamente |
| Sem autenticação | Ok — escopo é local apenas |

## Fora do Escopo

- Filtros por nível ou grupo
- Dashboard de estado (containers ativos, filas, sprint)
- Acesso remoto / autenticação
- Testes unitários (I/O puro, sem valor proporcional)
