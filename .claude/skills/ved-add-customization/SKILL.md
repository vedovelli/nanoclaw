---
name: ved-add-customization
description: Use before implementing any customization in an upstream NanoClaw file. Enforces ved custom marker protocol, tracker check, and build verification. Triggers on any task that modifies src/, container/, or scripts/ files that came from qwibitai/nanoclaw.
---

# Customization Protocol (ved-add-customization)

Run this protocol before and after every change to an upstream file. Upstream files are anything in `src/`, `container/`, `scripts/` that originated from qwibitai/nanoclaw. New files you create from scratch are local-only and skip this protocol.

> **HARD RULE — Pull Requests required:** Every customization MUST be developed on a feature branch and merged via Pull Request. **Never commit customizations directly to `main`.** If no feature branch exists yet, create one before writing any code:
> ```bash
> git checkout -b feat/<short-description>
> ```

## Step 0: Establish baseline

Before touching any code, capture the current state so regressions are detectable at the end:

```bash
npm run build && npm run test
```

Record the results:
- **Build:** passed / failed (note any pre-existing errors)
- **Tests:** N passed, N failed (note any pre-existing failures by name)

If the baseline itself is broken, surface that to the user before proceeding — don't let pre-existing failures get attributed to your changes later.

## Step 1: Identify file ownership

Is the target file upstream (came from qwibitai/nanoclaw) or a new local file?

```bash
git log --oneline --follow <file> | tail -1
```

If the earliest commit is an upstream sync (message contains "Sync upstream" or "Initial commit"), it's an upstream file — markers required. If it's a file you're creating fresh, skip to implementation directly.

## Step 2: Check the customizations tracker

Before touching anything, read the existing customizations tracker:

- Project: `nanoclaw`
- Permalink: `nanoclaw/nano-claw-custom-modifications-tracker`
- Tool: `mcp__basic-memory-cloud__read_note` (identifier: `nanoclaw/nano-claw-custom-modifications-tracker`, project: `nanoclaw`)

Understand what's already customized in the target files. Do not duplicate or conflict with existing marked blocks.

## Step 3: Implement with markers

Wrap every change inside an upstream file:

**TypeScript / JavaScript:**
```typescript
/* ved custom */
// your changes here
/* ved custom end */
```

**Dockerfile / shell scripts:**
```dockerfile
# ved custom
# your changes here
# ved custom end
```

Rules:
- Keep each marker block minimal — only the changed lines, not surrounding context
- One block per logical customization (don't group unrelated changes under one marker)
- Inline single-line changes: `/* ved custom */ yourCode; /* ved custom end */`

## Step 4: Verify markers

After implementing, confirm every customization has both opening and closing markers:

```bash
grep -n "ved custom" <changed-file>
```

The output should show balanced pairs: each opening marker has a corresponding closing marker.

## Step 5: Update the tracker

O tracker tem **dois níveis**: a nota principal é uma tabela de alto nível; os detalhes ficam em notas individuais.

### 5a — Adicionar linha ao tracker principal

Editar a tabela em `nanoclaw/nano-claw-custom-modifications-tracker` (project: `nanoclaw`) com `mcp__basic-memory-cloud__edit_note` (operation: `find_replace`).

Adicionar uma linha na tabela "Active Customizations" com:

```
| N | [Nome](nanoclaw/customizations/NN-nome-slug) | PR #X / commit `abc1234` | `arquivo1.ts`, `arquivo2.ts` | Low |
```

Campos obrigatórios: número sequencial, nome linkado à nota individual, PR ou commit, arquivos upstream modificados (só os modificados — novos arquivos não entram), dificuldade de re-apply (Very Low / Low / Medium / High).

### 5b — Criar nota individual de detalhes

Criar uma nova nota em `nanoclaw/customizations/` com `mcp__basic-memory-cloud__write_note`:
- **title:** `NN — Nome da Customização`
- **directory:** `nanoclaw/customizations`
- **project:** `nanoclaw`

Conteúdo mínimo da nota:

```markdown
# Nome — Subtítulo

**PR/Branch:** feat/xxx (status)
**Re-apply difficulty:** Low

## O que faz
Uma ou duas frases descrevendo o comportamento adicionado ou corrigido.

## Arquivos
- `src/foo.ts` — **NOVO** ou **MODIFICADO** — descrição da mudança
- `src/bar.ts` — **MODIFICADO** — descrição da mudança

## Env vars (se houver)
- `VAR_NAME=valor` — descrição

## Notas de re-apply (se relevante)
Qualquer detalhe que ajude a restaurar após conflito de merge.
```

## Step 6: Build and test check

```bash
npm run build && npm run test
```

Compare results against the Step 0 baseline:
- Build must pass (no new errors)
- Test failures must not exceed the baseline (no new failures introduced)

Fix any regressions before proceeding. Never leave the session with a broken build.

## Step 7: Should this be a skill?

If the customization is substantial — adding a new MCP server, a new container mount, a new integration — ask:

> "This change is significant enough to become its own `ved-` skill. Want me to create `.claude/skills/ved-<name>/SKILL.md` so it's documented, repeatable, and shows up in `/help`?"

If yes, create the skill file before committing.

## Step 8: Update ved-sync-upstream regression check if needed

Read Step 12 of `.claude/skills/ved-sync-upstream/SKILL.md` and check whether the new customization introduces anything the regression check wouldn't catch in a future sync:

- **New custom skill in `container/skills/`** — add it to the `ls container/skills/` check (e.g. `myskill/` must be present)
- **New ordering constraint in the Dockerfile** — add a `grep -n` check for the relevant lines
- **New file that must always exist** — add an existence check

If the regression check already covers the new customization via the `grep -rn "ved custom"` marker count, no update is needed. Only update when the new customization can't be caught by marker presence alone.
