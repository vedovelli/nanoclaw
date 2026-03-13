---
name: competitor-monitor
description: Daily competitive intelligence monitor for Faros AI, Jellyfish, and Entelligence AI. Fetches updates from GitHub, blogs, and product pages; compares with yesterday's snapshot in Basic Memory; sends an HTML report by email when changes are found; maintains a persistent timeline; creates GitHub issues for features relevant to Dev Visibility.
---

# Competitor Monitor — Dev Visibility

## Notification Rules — Read Before Doing Anything

**You may only call `mcp__gmail__*` to send an email when there are actual changes since yesterday for at least one competitor (Faros AI, Jellyfish, or Entelligence AI).**

In every other situation (no changes, errors, API failures), produce no output and call no tools except `<internal>`.

Silent exit means your **entire output** is:
```
<internal>Nothing to do this run.</internal>
```
The `<` must be the very first character. No explanation. No summary. Nothing outside those tags.

## Factual Accuracy Rules — HARD REQUIREMENT

**Every finding in the report MUST be a directly observable fact.** Violations of these rules produce dangerous false intelligence that leads to wrong strategic decisions.

### No fabricated redirects

- You MUST NOT claim that domain A redirects to domain B unless you have **explicit HTTP redirect evidence** from a `curl -sI -L` check (see below).
- The `agent-browser` tool does NOT reliably report redirects. Browser rendering of a page is NOT proof of a redirect.
- If you suspect a redirect, you MUST verify it with:

```bash
curl -sI -L --max-redirs 5 "https://[domain]" 2>&1 | grep -iE "^(HTTP/|location:)"
```

- Only report a redirect if the `Location:` header explicitly shows the target domain.
- If `curl` shows a 200 OK with no `Location:` header, the domain is NOT redirecting — period.

### No inferred relationships between competitors

- You MUST NOT fabricate acquisition, merger, or partnership claims unless you find them in an **explicit press release, blog post, or official announcement** with a verifiable URL.
- Seeing similar content on two sites is NOT evidence of a relationship.
- Seeing that a domain is down or returning errors is NOT evidence of acquisition.

### Source requirement

- Every finding MUST include the exact source URL where it was observed.
- If a source URL cannot be provided, the finding MUST be discarded.
- "I observed this while browsing" is NOT a valid source — provide the specific page URL.

### When in doubt, discard

- If you are not 100% certain a finding is factual, **do not include it**.
- It is FAR better to report "no changes" than to report fabricated changes.
- A false positive wastes executive attention and erodes trust in the monitoring system.

### Browser failure protocol

- If `agent-browser` returns an error, empty content, or content you cannot parse → treat as "no data" for that source.
- Do NOT attempt to "reconstruct" or "infer" what the page might contain.
- Do NOT use your training data to fill in what a page "probably" shows.

---

## Overview

This skill does the following on every run:

1. Calculates today's and yesterday's dates
2. Reads yesterday's snapshots from Basic Memory
3. Researches Faros AI (GitHub API + browser)
4. Researches Jellyfish (browser)
5. Researches Entelligence AI (GitHub API + browser)
6. Compares findings with yesterday's snapshot
7. If no changes in any competitor → silent exit
8. If changes found → generates HTML report → sends as HTML email body → updates timeline in Basic Memory → saves daily snapshots → creates GitHub issues for Dev Visibility-relevant features

## Steps

### 1. Calculate dates

```bash
TODAY=$(date +%Y-%m-%d)
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)
echo "Today: $TODAY | Yesterday: $YESTERDAY"
```

### 2. Read yesterday's snapshots from Basic Memory

Use `mcp__basic-memory-cloud__read_note` with `project: "dev-visibility-product"` for:
- `Concorrência/Faros AI/$YESTERDAY`
- `Concorrência/Jellyfish/$YESTERDAY`
- `Concorrência/Entelligence AI/$YESTERDAY`

If any note is not found (e.g. first run), fall back to the base analysis docs:
- `Concorrência/Faros AI - Análise Competitiva`
- `Concorrência/Jellyfish - Análise Competitiva`
- `Concorrência/Entelligence AI - Análise Competitiva`

Also read `Concorrência/Monitoramento Diário - Perguntas de Análise` to understand which signals to look for.

Store the content of all snapshots in memory for comparison in step 6.

Also check whether `Concorrência/Run/$TODAY` already exists in Basic Memory (`project: "dev-visibility-product"`).
If it does, today's run already completed. Exit silently:
```
<internal>Already ran today.</internal>
```

If it does NOT exist, write it now before proceeding:
- **Title:** `$TODAY`
- **Directory:** `Concorrência/Run`
- **Content:** `Run started at $TODAY.`

This sentinel is written before any research begins, so re-runs triggered by container crashes or scheduler retries will not produce duplicate emails.

Additionally, always read `Concorrência/Faros AI - Análise Competitiva`, `Concorrência/Jellyfish - Análise Competitiva`, and `Concorrência/Entelligence AI - Análise Competitiva` to retrieve the **Sinais de Alerta** sections for all competitors. Store these for use in step 8 when applying the `high-threat` CSS class.

Also read these two product documents from Basic Memory (`project: "dev-visibility-product"`) to understand what Dev Visibility is building. You will use this context in steps 3–5 to identify competitor features worth turning into GitHub issues:

- `design/PRD - PoC Single-User v1.0` (primary — what we're building now)
- `design/PRD - MVP Enterprise-Ready` (secondary — future direction)

Store the key capabilities and differentiators from both PRDs in memory.

### 3. Research Faros AI

**a) GitHub releases (faros-community-edition):**

```bash
gh api repos/faros-ai/faros-community-edition/releases \
  -f per_page=10 \
  --jq '[.[] | select(.published_at >= "'$YESTERDAY'") | {tag: .tag_name, published: .published_at, body: .body}]'
```

**b) GitHub releases (airbyte-connectors):**

```bash
gh api repos/faros-ai/airbyte-connectors/releases \
  -f per_page=10 \
  --jq '[.[] | select(.published_at >= "'$YESTERDAY'") | {tag: .tag_name, published: .published_at, body: .body}]'
```

**c) Recently merged PRs (last 24h only):**

```bash
gh api repos/faros-ai/faros-community-edition/pulls \
  --method GET \
  -f state=closed \
  -f per_page=20 \
  --jq '[.[] | select(.merged_at != null and .merged_at >= "'$YESTERDAY'") | {title: .title, merged: .merged_at, labels: [.labels[].name]}]'
```

**d) Blog — new posts:**

Use `agent-browser` to fetch `https://faros.ai/blog`. Extract post titles, dates, and URLs. **Only include posts with a publish date of $TODAY or $YESTERDAY.** Discard any post older than $YESTERDAY — do not treat old posts as new findings.

⚠️ **If the page loads a different domain or you suspect a redirect, STOP. Run `curl -sI -L "https://faros.ai/blog"` and check the `Location:` headers. Do NOT report a redirect unless `curl` confirms it. See "Factual Accuracy Rules" above.**

**e) Clara product page:**

Use `agent-browser` to fetch `https://faros.ai/clara`. Note any visible changes, new features, or new copy compared to what was in yesterday's snapshot.

⚠️ **Report only what the page actually shows. Do NOT infer domain ownership or acquisitions from page content. See "Factual Accuracy Rules" above.**

**f) Tag Dev Visibility candidates:**

For each item found in sub-steps a–e, check against the PRD capabilities read in step 2. Mark any item as `[DEV_VISIBILITY_CANDIDATE]` if it:
- Implements a feature that Dev Visibility is also planning to build
- Represents a capability that directly reduces our differentiation
- Uses a technology pattern (MCP, hooks, knowledge graph, session capture) that is core to our architecture

Store the list of candidates separately from the general change list.

If `agent-browser` fails or returns no usable content for any sub-step, treat that source as "no data" and continue. If ALL browser sources in this step fail, treat Faros AI as having no changes for today.

### 4. Research Jellyfish

Jellyfish is closed source — no GitHub to query. Use browser only.

**a) Blog — new posts:**

Use `agent-browser` to fetch `https://jellyfish.co/blog`. Extract post titles, dates, and URLs. **Only include posts with a publish date of $TODAY or $YESTERDAY.** Discard any post older than $YESTERDAY — do not treat old posts as new findings.

⚠️ **If the page loads a different domain or you suspect a redirect, STOP. Run `curl -sI -L "https://jellyfish.co/blog"` and check the `Location:` headers. Do NOT report a redirect unless `curl` confirms it. See "Factual Accuracy Rules" above.**

**b) AI Impact Dashboard page:**

Use `agent-browser` to fetch `https://jellyfish.co/platform/jellyfish-ai-impact/`. Note any changes in supported tools or feature descriptions compared to yesterday's snapshot.

**c) Homepage/announcements:**

Use `agent-browser` to check `https://jellyfish.co` for any banners or featured announcements.

⚠️ **Report only what is directly visible on the page. Do NOT infer corporate events (acquisitions, mergers) from page design or content similarities with other competitors. See "Factual Accuracy Rules" above.**

**d) Tag Dev Visibility candidates:**

Apply the same tagging logic as step 3f: mark any item as `[DEV_VISIBILITY_CANDIDATE]` if it aligns with PRD capabilities or reduces Dev Visibility's differentiation.

If `agent-browser` fails or returns no usable content for any sub-step, treat that source as "no data" and continue. If ALL browser sources in this step fail, treat Jellyfish as having no changes for today.

### 5. Research Entelligence AI

Entelligence AI is an AI-powered engineering intelligence platform competing directly with Dev Visibility on code review automation, team performance insights, AI documentation, and MCP integration.

**a) GitHub repos (original, non-fork only):**

```bash
gh api orgs/Entelligence-AI/repos --jq '[.[] | select(.fork == false) | {name: .full_name, pushed: .pushed_at, description: .description}]'
```

Check for any repos pushed since $YESTERDAY. For repos with recent activity, check releases:

```bash
gh api repos/Entelligence-AI/chat-popup/releases \
  -f per_page=5 \
  --jq '[.[] | select(.published_at >= "'$YESTERDAY'") | {tag: .tag_name, published: .published_at, body: .body}]'
```

```bash
gh api repos/Entelligence-AI/code_review_evals/releases \
  -f per_page=5 \
  --jq '[.[] | select(.published_at >= "'$YESTERDAY'") | {tag: .tag_name, published: .published_at, body: .body}]'
```

Also check if any new non-fork repos appeared since yesterday's snapshot.

**b) Documentation changes:**

Use `agent-browser` to fetch `https://docs.entelligence.ai/`. Compare the page structure, feature descriptions, and integration list against yesterday's snapshot. Pay particular attention to:
- New integration pages (IDE, MCP, or third-party tools)
- Changes to Team Insights / Performance Review features
- New product capabilities

⚠️ **If the docs site loads a different domain or you suspect a redirect, STOP. Run `curl -sI -L "https://docs.entelligence.ai/"` and check the `Location:` headers. Do NOT claim the domain redirects unless `curl` confirms it. See "Factual Accuracy Rules" above.**

**c) Blog / announcements:**

Use `agent-browser` to fetch `https://www.entelligence.ai/blog` (or homepage if no dedicated blog path). Extract post titles, dates, and URLs. **Only include posts with a publish date of $TODAY or $YESTERDAY.** Discard any post older than $YESTERDAY.

**d) Product page:**

Use `agent-browser` to fetch `https://www.entelligence.ai/`. Note any changes in positioning, feature highlights, new customer logos, or announcements compared to yesterday's snapshot.

⚠️ **Report only what the page actually shows. Do NOT claim domain ownership changes or redirects without `curl -sI -L` verification. See "Factual Accuracy Rules" above.**

**e) Tag Dev Visibility candidates:**

Apply the same tagging logic as step 3f: mark any item as `[DEV_VISIBILITY_CANDIDATE]` if it aligns with PRD capabilities or reduces Dev Visibility's differentiation. Entelligence AI overlaps heavily with Dev Visibility in these areas:
- Code review automation (PR reviews)
- Team performance metrics and sprint assessment
- AI-powered documentation generation
- MCP integration
- IDE integration

If `agent-browser` fails or returns no usable content for any sub-step, treat that source as "no data" and continue. If ALL sources in this step fail, treat Entelligence AI as having no changes for today.

### 6. Compare with yesterday

**⚠️ FACTUAL VERIFICATION CHECKPOINT — before proceeding, review every finding from steps 3–5:**
1. Does every finding have a specific, verifiable source URL?
2. Did any finding claim a redirect? If so, was it verified with `curl -sI -L`? Remove any unverified redirect claim.
3. Did any finding claim an acquisition, merger, or partnership? If so, is there a specific press release or announcement URL? Remove any claim without an explicit source.
4. Could any finding be a hallucination (something your training data "knows" but that wasn't actually observed on the page today)? If in doubt, remove it.

**If after this checkpoint all findings are removed, proceed to step 7 (silent exit).**

For each competitor, answer these questions using the monitoring questions from Basic Memory and what you found:

- Is there a new blog post? What's the topic?
- Is there a new release or PR that touches AI coding tool integrations?
- Any new integration announced (Claude Code hooks, Cursor, Cline, Windsurf)?
- Any strategic signal (pricing change, new client, funding, chat interface launch)?

Produce a structured findings list for each competitor:
```
FAROS_CHANGES = [list of new items not in yesterday's snapshot]
JELLYFISH_CHANGES = [list of new items not in yesterday's snapshot]
ENTELLIGENCE_CHANGES = [list of new items not in yesterday's snapshot]
```

### 7. Decide: send or silent exit

If `FAROS_CHANGES`, `JELLYFISH_CHANGES`, and `ENTELLIGENCE_CHANGES` are all empty → exit:
```
<internal>Nothing to do this run.</internal>
```

**Critical:** The `<` must be the very first character of your entire output. Do NOT write any summary, reasoning, or explanation before the `<internal>` tag.

### 8. Generate HTML report

**Ação Necessária decision rule:**
- If any change item matches a "Sinais de Alerta" entry (i.e. has `high-threat` class) → write **alertar founder**
- If changes exist but none are high-threat → write **atualizar nota de análise**

Write to `/tmp/competitor-report-$TODAY.html`. Use clean, readable HTML with inline CSS. Structure:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; color: #222; line-height: 1.6; }
    h1 { font-size: 1.6em; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { font-size: 1.2em; color: #444; margin-top: 32px; }
    h3 { font-size: 1em; color: #666; }
    .no-changes { color: #888; font-style: italic; }
    .change-item { margin: 8px 0; padding: 8px 12px; background: #f5f5f5; border-left: 3px solid #999; }
    .high-threat { border-left-color: #c0392b; background: #fdf2f2; }
    footer { margin-top: 48px; font-size: 0.8em; color: #999; }
  </style>
</head>
<body>
  <h1>📊 Competitive Intelligence Report</h1>
  <p><strong>Data:</strong> $TODAY</p>

  <h2>Faros AI</h2>
  <!-- For each item in FAROS_CHANGES: -->
  <div class="change-item [high-threat if relevant]">
    <strong>[category]</strong> — [description]
    <br><small>[source URL if available]</small>
  </div>

  <h2>Jellyfish</h2>
  <!-- Same structure -->

  <h2>Entelligence AI</h2>
  <!-- Same structure -->

  <h2>Relevância para Dev Visibility</h2>
  <p>[Analysis: do any of these changes reduce our differentiation? Did threat level change?]</p>

  <h2>Ação Necessária</h2>
  <p>
    <!-- Decision logic:
         - If ANY change-item has the high-threat class → "alertar founder"
         - If changes exist but none are high-threat → "atualizar nota de análise"
         - If this section is somehow reached with no changes → "nenhuma"
    -->
    [alertar founder | atualizar nota de análise | nenhuma]
  </p>

  <footer>Gerado automaticamente pelo NanoClaw competitor-monitor às 05:00 BRT</footer>
</body>
</html>
```

Use `high-threat` CSS class on items that match the "Sinais de Alerta" sections from the base analysis documents.

### 9. Send HTML report by email

Read the content of `/tmp/competitor-report-$TODAY.html` and send it as the email body:

- **To:** fabio@vedovelli.com.br
- **Subject:** `[Dev Visibility] Competitive Intelligence — $TODAY`
- **Body:** Full HTML content of the report (the file generated in step 7)
- **mimeType:** `text/html`
- **No attachments**

### 10. Update Timeline in Basic Memory

Regardless of whether the email succeeded, update the persistent timeline document in `dev-visibility-product`.

**a)** Check if `Concorrência/Timeline de Melhorias` exists using `mcp__basic-memory-cloud__read_note`.

**b)** Prepare today's timeline entry using this structure:

```markdown
## $TODAY

### [Competitor name — repeat section for each competitor with changes]

**[🔴 ALTO | 🟡 MÉDIO | ⚪ BAIXO] [Title of change]**
- Tipo: [blog post | release | PR | product update | announcement | partnership]
- Impacto: [one sentence on why this matters for Dev Visibility]
- Fonte: [URL if available]
```

Classification rules:
- **🔴 ALTO** — matches a "Sinais de Alerta" entry or is tagged `[DEV_VISIBILITY_CANDIDATE]`
- **🟡 MÉDIO** — relevant but not critical (strategic messaging, notable blog post)
- **⚪ BAIXO** — informational (generic content, minor release)

**c)** If the timeline document exists: use `mcp__basic-memory-cloud__edit_note` with `operation: "prepend"` to add today's entry at the top.

**d)** If it does NOT exist: create it with `mcp__basic-memory-cloud__write_note`:
- **Title:** `Timeline de Melhorias`
- **Directory:** `Concorrência`
- **project:** `dev-visibility-product`
- **Content:** Header + today's entry:

```markdown
# Timeline de Melhorias Detectadas nos Concorrentes

Histórico cronológico de features, parcerias e movimentos estratégicos detectados pelo competitor-monitor.

---

[today's entry here]
```

If the timeline update fails for any reason, continue silently — do not abort.

> **If the Gmail send in step 9 failed:** continue to steps 10–12 anyway — the timeline and snapshots should still be saved. Only the email notification is skipped.

### 11. Save today's snapshots to Basic Memory

Use `mcp__basic-memory-cloud__write_note` with `project: "dev-visibility-product"` for each competitor:

**Title:** `$TODAY`
**Directory:** `Concorrência/Faros AI`
**Content:** Use this exact Markdown schema (omit sections with no data):

```markdown
## Blog Posts
- [title] — [date] — [url]

## Releases
- [repo] [tag] — [published_at] — [key changes summary]

## Merged PRs (significant)
- [title] — [merged_at]

## Product Page (Clara)
[Notable copy or feature changes observed]

## Announcements
[Any banners, press releases, or notable homepage content]
```

**Title:** `$TODAY`
**Directory:** `Concorrência/Jellyfish`
**Content:** Use this exact Markdown schema (omit sections with no data):

```markdown
## Blog Posts
- [title] — [date] — [url]

## Product Page (AI Impact Dashboard)
[Notable copy, feature additions, or new supported tools observed]

## Announcements
[Any banners, press releases, or notable homepage content]
```

**Title:** `$TODAY`
**Directory:** `Concorrência/Entelligence AI`
**Content:** Use this exact Markdown schema (omit sections with no data):

```markdown
## GitHub Repos
- [repo] — [last pushed] — [description or notable changes]

## Releases
- [repo] [tag] — [published_at] — [key changes summary]

## Documentation Changes
[Changes in docs.entelligence.ai — new pages, updated features, new integrations]

## Blog Posts
- [title] — [date] — [url]

## Product Page
[Notable copy, positioning changes, new customer logos, or feature highlights]

## Announcements
[Any banners, press releases, or notable homepage content]
```

### 12. Create GitHub issues for Dev Visibility-relevant features

For each item marked `[DEV_VISIBILITY_CANDIDATE]` in steps 3, 4, and 5:

**a)** Check for duplicate issues to avoid noise:

```bash
gh issue list \
  --repo vedovelli/dev-visibility-application \
  --search "[Competitor name] [feature keywords]" \
  --state all \
  --json number,title \
  --limit 5
```

If a similar issue already exists (same competitor + same feature topic), skip creation for this item.

**b)** Create the issue:

> **Prerequisite:** The `competitive-intel` label must exist in `vedovelli/dev-visibility-application` before the first run. Create it once with: `gh label create "competitive-intel" --repo vedovelli/dev-visibility-application --color "0075ca"`

```bash
gh issue create \
  --repo vedovelli/dev-visibility-application \
  --title "Feature from [Competitor]: [Feature Name]" \
  --label "competitive-intel" \
  --body "$(cat <<'ISSUE'
## Feature Detectada em [Competitor]

[Descrição da funcionalidade]

## Por que é Relevante para Dev Visibility

[Análise de relevância baseada nos PRDs — qual capability do nosso produto esta feature toca ou ameaça]

## Implementação no Concorrente

- **Fonte:** [PR URL | blog post URL | product page URL]
- **Data:** [date detected]

## Próximos Passos

- [ ] Analisar implementação em detalhe
- [ ] Avaliar se se encaixa no roadmap
- [ ] Estimar esforço de implementação

---
Detectado automaticamente por competitor-monitor em $TODAY
ISSUE
)"
```

**c)** Notify via `mcp__nanoclaw__send_message`:
> "📋 Nova issue criada no Dev Visibility: [Feature Name] detectada em [Competitor]\nIssue: [GitHub URL]"

**d)** If no candidates were found, skip silently — do not notify.

**e)** If `gh issue create` fails, skip silently — do not abort the run.
