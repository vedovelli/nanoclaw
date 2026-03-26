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
>
> **Exceptions — commit directly to `main` is authorized when ANY of the following applies:**
> - **Hotfix urgente:** the change unblocks a production issue and waiting for a PR review would cause continued damage
> - **Trivial change:** single-line or very small changes with negligible risk (e.g. one ENV var, one config flag)
> - **Own file:** the file is not upstream (not from qwibitai/nanoclaw) — e.g. `src/dev-team-orchestrator.ts`, `src/log-viewer.ts`
> - **Explicit user authorization:** the user explicitly says to commit directly to `main` in the current session
>
> Even when committing directly to `main`, all other steps still apply: markers (if upstream file), tracker update, build check.

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

- Vault path: `nanoclaw/nano-claw-custom-modifications-tracker.md`
- Tool: `mcp__mcp-obsidian__obsidian_get_file_contents` (filepath: `nanoclaw/nano-claw-custom-modifications-tracker.md`)

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

Editar a tabela em `nanoclaw/nano-claw-custom-modifications-tracker.md` no vault Obsidian com `mcp__mcp-obsidian__obsidian_patch_content`.

Adicionar uma linha na tabela "Active Customizations" com:

```
| N | [Nome](nanoclaw/customizations/NN-nome-slug) | PR #X / commit `abc1234` | `arquivo1.ts`, `arquivo2.ts` | Low |
```

Campos obrigatórios: número sequencial, nome linkado à nota individual, PR ou commit, arquivos upstream modificados (só os modificados — novos arquivos não entram), dificuldade de re-apply (Very Low / Low / Medium / High).

### 5b — Criar nota individual de detalhes

Criar uma nova nota no vault Obsidian com `mcp__mcp-obsidian__obsidian_patch_content`:
- **filepath:** `nanoclaw/customizations/NN — Nome da Customização.md`

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

## Step 9: Push and create Pull Request

> **Conditional:** This step only applies when the work was developed on a feature branch (i.e., the HARD RULE at the top of this skill was followed). If for any reason the change was committed directly to `main` — or if the user explicitly says to skip the PR — stop here.

After all steps above are complete, push the feature branch and open a PR automatically:

```bash
git push -u origin <branch-name>
```

Then create the PR with `gh pr create`:

```bash
gh pr create \
  --title "<type>: <short description of the customization>" \
  --body "$(cat <<'EOF'
## Summary

- <bullet per logical change made>

## Test Plan

- [x] `npm run build` passes
- [x] `npm run test` — N/N tests passing
- [ ] <manual verification step if applicable>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Rules:
- Title format: `feat:`, `fix:`, or `chore:` prefix + concise description
- Summary bullets: one per logical change (not per file)
- Test plan: check off what was verified automatically; leave manual steps unchecked for the reviewer
- Do not merge — leave the PR open for human review

After the PR is created, post a comment to trigger an automatic code review:

```bash
gh pr comment <pr-number> --body "@claude please review this pull request"
```

The PR number is returned by `gh pr create`. Capture it:

```bash
PR_URL=$(gh pr create --title "..." --body "...")
PR_NUMBER=$(echo "$PR_URL" | grep -o '[0-9]*$')
gh pr comment "$PR_NUMBER" --body "@claude please review this pull request"
```

## Step 10: Review and fix loop

> **Conditional:** Only execute if Step 9 was executed (a PR was opened).

After triggering the review, monitor the PR for @claude's response and address all feedback until the PR is approved:

```bash
# Poll every 60 seconds until new comment appears
while true; do
  sleep 60
  LATEST=$(gh pr view "$PR_NUMBER" --repo <owner>/<repo> --json comments \
    --jq '[.comments | sort_by(.createdAt) | reverse | .[0] | {author: .author.login, body: .body}]')
  echo "$LATEST"
done
```

Loop protocol:
1. Wait 60 seconds between each poll — no exponential backoff needed
2. Read the full review body when @claude responds
3. Evaluate each item: verify against codebase reality before implementing (see `superpowers:receiving-code-review`)
4. Implement all valid fixes, run `npm run build && npm run test` to confirm no regressions
5. Commit with `git add .` and push
6. Reply on the PR describing each fix and push back on any incorrect suggestions with technical reasoning
7. End the reply with `@claude please re-review`
8. Repeat from step 1 until @claude responds with **"LGTM"** or **"ready to merge"**

Once approved, merge with:

```bash
gh pr merge "$PR_NUMBER" --repo <owner>/<repo> --squash --delete-branch
git checkout main && git pull
```
