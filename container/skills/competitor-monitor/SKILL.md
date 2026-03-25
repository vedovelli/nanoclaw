---
name: competitor-monitor
description: Daily competitive intelligence monitor for Faros AI, Jellyfish, Entelligence AI, and Linear. Fetches updates from GitHub, blogs, and product pages; compares with yesterday's snapshot in Basic Memory; sends an HTML report by email when changes are found; maintains a persistent timeline; creates GitHub issues for features relevant to Dev Visibility.
---

# Competitor Monitor — Dev Visibility

## Notification Rules — Read Before Doing Anything

**You may only call `mcp__gmail__*` to send an email when there are actual changes since yesterday for at least one competitor (Faros AI, Jellyfish, Entelligence AI, or Linear).**

In every other situation (no changes, errors, API failures), produce no output and call no tools except `<internal>`.

Silent exit means your **entire output** is:
```
<internal>Nothing to do this run.</internal>
```
The `<` must be the very first character. No explanation. No summary. Nothing outside those tags.

## Crawlee Stealth Scraper — PRIMARY TOOL FOR BLOG/PAGE CONTENT

**Use `crawlee-fetch` as the primary tool for extracting content from competitor blogs and product pages.** It uses Playwright with anti-bot stealth plugins, which bypasses protections that block plain `agent-browser`.

```bash
# Fetch full page text
node /app/crawlee-fetch.js "https://example.com/blog"

# Fetch only specific elements (e.g. blog post titles and summaries)
node /app/crawlee-fetch.js "https://example.com/blog" --selector "article"

# Custom timeout (default 30s)
node /app/crawlee-fetch.js "https://example.com/blog" --timeout 45000
```

**Fallback chain:** `crawlee-fetch` → `agent-browser` → skip (no data).
If `crawlee-fetch` fails (exit code 1), try `agent-browser` as fallback. If both fail, treat as "no data".

---

## curl-first Protocol — MANDATORY FOR EVERY URL

**You MUST run `curl` BEFORE using `crawlee-fetch` or `agent-browser` on ANY URL. No exceptions.**

For every URL you plan to visit, first run:

```bash
curl -sI -L --max-redirs 5 "$URL" 2>&1 | grep -iE "^(HTTP/|location:)"
```

Then follow this decision tree:

| curl result | Action |
|-------------|--------|
| `HTTP/2 200` with NO `Location:` header | URL is live, no redirect. Proceed with `crawlee-fetch` to read content. |
| `Location:` header present | Redirect confirmed. Record the EXACT redirect chain from curl. Do NOT use browser. |
| curl fails / times out / 4xx / 5xx | Skip this URL entirely. Treat as "no data". |

**CRITICAL RULES:**

1. **curl is the ONLY authority on redirects.** If curl shows `200` with no `Location:` header, the URL is NOT redirecting — regardless of what browser renders.
2. **NEVER claim a redirect without pasting curl output as proof.** Any redirect claim without curl evidence = hallucination.
3. **NEVER claim acquisitions, mergers, or partnerships.** These require an official press release URL. Similar-looking websites, shared content, or failed pages are NOT evidence.
4. **NEVER invent content.** If browser returns errors or empty content, record "no data". Do NOT fill in from memory.
5. **When in doubt, discard.** A false positive is worse than a missed finding.

---

## Overview

This skill does the following on every run:

1. Calculates today's and yesterday's dates
2. Reads yesterday's snapshots from Basic Memory
3. Researches Faros AI (GitHub API + browser)
4. Researches Jellyfish (browser)
5. Researches Entelligence AI (GitHub API + browser)
6. Researches Linear (GitHub API + browser)
7. Compares findings with yesterday's snapshot
8. If no changes in any competitor → silent exit
9. If changes found → generates HTML report → sends as HTML email body → updates timeline in Basic Memory → saves daily snapshots → creates GitHub issues for Dev Visibility-relevant features

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
- `Concorrência/Linear/$YESTERDAY`

If any note is not found (e.g. first run), fall back to the base analysis docs:
- `Concorrência/Faros AI - Análise Competitiva`
- `Concorrência/Jellyfish - Análise Competitiva`
- `Concorrência/Entelligence AI - Análise Competitiva`
- `Concorrência/Linear - Análise Competitiva`

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

Additionally, always read `Concorrência/Faros AI - Análise Competitiva`, `Concorrência/Jellyfish - Análise Competitiva`, `Concorrência/Entelligence AI - Análise Competitiva`, and `Concorrência/Linear - Análise Competitiva` to retrieve the **Sinais de Alerta** sections for all competitors. Store these for use in step 8 when applying the `high-threat` CSS class.

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

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://faros.ai/blog" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows `Location:` redirect → record the redirect chain as a finding. Do NOT use browser.
- If curl fails → skip. No data for this URL.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://faros.ai/blog`. Extract post titles, dates, and URLs. **Only include posts with a publish date of $TODAY or $YESTERDAY.** Discard any post older than $YESTERDAY.

**e) Clara product page:**

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://faros.ai/clara" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows `Location:` redirect → record the redirect chain. Do NOT use browser.
- If curl fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://faros.ai/clara`. Note any visible changes, new features, or new copy compared to what was in yesterday's snapshot.

**f) Tag Dev Visibility candidates:**

For each item found in sub-steps a–e, check against the PRD capabilities read in step 2. Mark any item as `[DEV_VISIBILITY_CANDIDATE]` if it:
- Implements a feature that Dev Visibility is also planning to build
- Represents a capability that directly reduces our differentiation
- Uses a technology pattern (MCP, hooks, knowledge graph, session capture) that is core to our architecture

Store the list of candidates separately from the general change list.

If both `crawlee-fetch` and `agent-browser` fail or return no usable content for any sub-step, treat that source as "no data" and continue. If ALL browser sources in this step fail, treat Faros AI as having no changes for today.

### 4. Research Jellyfish

Jellyfish is closed source — no GitHub to query. Use browser only.

**a) Blog — new posts:**

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://jellyfish.co/blog" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows `Location:` redirect → record the redirect chain as a finding. Do NOT use browser.
- If curl fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://jellyfish.co/blog`. Extract post titles, dates, and URLs. **Only include posts with a publish date of $TODAY or $YESTERDAY.** Discard any post older than $YESTERDAY.

**b) AI Impact Dashboard page:**

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://jellyfish.co/platform/jellyfish-ai-impact/" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows redirect or fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://jellyfish.co/platform/jellyfish-ai-impact/`. Note any changes in supported tools or feature descriptions compared to yesterday's snapshot.

**c) Homepage/announcements:**

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://jellyfish.co" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows redirect or fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to check `https://jellyfish.co` for any banners or featured announcements.

**d) Tag Dev Visibility candidates:**

Apply the same tagging logic as step 3f: mark any item as `[DEV_VISIBILITY_CANDIDATE]` if it aligns with PRD capabilities or reduces Dev Visibility's differentiation.

If both `crawlee-fetch` and `agent-browser` fail or return no usable content for any sub-step, treat that source as "no data" and continue. If ALL browser sources in this step fail, treat Jellyfish as having no changes for today.

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

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://docs.entelligence.ai/" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows `Location:` redirect → record the redirect chain. Do NOT use browser.
- If curl fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://docs.entelligence.ai/`. Compare the page structure, feature descriptions, and integration list against yesterday's snapshot. Pay particular attention to:
- New integration pages (IDE, MCP, or third-party tools)
- Changes to Team Insights / Performance Review features
- New product capabilities

**c) Blog / announcements:**

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://www.entelligence.ai/blog" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows redirect or fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://www.entelligence.ai/blog`. Extract post titles, dates, and URLs. **Only include posts with a publish date of $TODAY or $YESTERDAY.** Discard any post older than $YESTERDAY.

**d) Product page:**

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://www.entelligence.ai/" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows redirect or fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://www.entelligence.ai/`. Note any changes in positioning, feature highlights, new customer logos, or announcements compared to yesterday's snapshot.

**e) Tag Dev Visibility candidates:**

Apply the same tagging logic as step 3f: mark any item as `[DEV_VISIBILITY_CANDIDATE]` if it aligns with PRD capabilities or reduces Dev Visibility's differentiation. Entelligence AI overlaps heavily with Dev Visibility in these areas:
- Code review automation (PR reviews)
- Team performance metrics and sprint assessment
- AI-powered documentation generation
- MCP integration
- IDE integration

If both `crawlee-fetch` and `agent-browser` fail or return no usable content for any sub-step, treat that source as "no data" and continue. If ALL sources in this step fail, treat Entelligence AI as having no changes for today.

### 6. Research Linear

Linear is a project management and issue tracking platform for software teams (modern Jira alternative). They recently launched **Linear Agent** — an AI agent that understands a workspace's roadmap, issues, and code, and can autonomously triage, plan, and dispatch work to coding agents. They also offer deep integrations with AI coding tools (Claude Code, Cursor, GitHub Copilot) via deeplinks and MCP support. Linear competes with Dev Visibility on the AI-powered engineering intelligence and orchestration layer.

**a) GitHub repos (linear org, non-fork only):**

```bash
gh api orgs/linear/repos -f per_page=30 --jq '[.[] | select(.fork == false) | {name: .full_name, pushed: .pushed_at, description: .description}]'
```

Check for any repos pushed since $YESTERDAY. For repos with recent activity, check releases:

```bash
gh api repos/linear/linear/releases \
  -f per_page=5 \
  --jq '[.[] | select(.published_at >= "'$YESTERDAY'") | {tag: .tag_name, published: .published_at, body: .body}]'
```

Also check if any new non-fork repos appeared since yesterday's snapshot.

**b) Blog — new posts:**

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://linear.app/blog" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows `Location:` redirect → record the redirect chain as a finding. Do NOT use browser.
- If curl fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://linear.app/blog`. Extract post titles, dates, and URLs. **Only include posts with a publish date of $TODAY or $YESTERDAY.** Discard any post older than $YESTERDAY.

**c) Changelog — recent updates:**

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://linear.app/changelog" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows redirect or fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://linear.app/changelog`. Note any new entries compared to yesterday's snapshot. Pay particular attention to:
- Linear Agent updates (new capabilities, expanded access)
- MCP integration changes
- New coding agent integrations (Claude Code, Cursor, Copilot, Codex)
- Triage automation features
- API or SDK changes

**d) Product / Agent page:**

**Step 1 — curl pre-flight (mandatory):**
```bash
curl -sI -L --max-redirs 5 "https://linear.app/features" 2>&1 | grep -iE "^(HTTP/|location:)"
```
- If curl shows `200` with no `Location:` → proceed to step 2.
- If curl shows redirect or fails → skip. No data.

**Step 2 — content extraction (only if curl shows 200, no redirect):**
Use `crawlee-fetch` (with `agent-browser` as fallback) to fetch `https://linear.app/features`. Note any changes in positioning, feature highlights, new AI capabilities, or announcements compared to yesterday's snapshot.

**e) Tag Dev Visibility candidates:**

Apply the same tagging logic as step 3f: mark any item as `[DEV_VISIBILITY_CANDIDATE]` if it aligns with PRD capabilities or reduces Dev Visibility's differentiation. Linear overlaps heavily with Dev Visibility in these areas:
- AI agent orchestration and autonomous task management
- MCP integration for AI coding tools
- Deeplink integration with Claude Code, Cursor, GitHub Copilot
- Triage automation and intelligent issue routing
- Engineering workflow intelligence and project analytics
- Context-aware AI that understands codebase + project state

If both `crawlee-fetch` and `agent-browser` fail or return no usable content for any sub-step, treat that source as "no data" and continue. If ALL sources in this step fail, treat Linear as having no changes for today.

### 7. Compare with yesterday

**MANDATORY VERIFICATION GATE — you MUST complete this before listing ANY changes:**

**A) Write your curl evidence log.** For every URL you checked, paste the actual curl output:
```
URL: https://faros.ai/blog
curl: HTTP/2 200 (no Location header → no redirect)

URL: https://faros.ai/clara
curl: HTTP/2 200 (no Location header → no redirect)

URL: https://jellyfish.co/blog
curl: [paste actual output]

... (repeat for all URLs checked)
```

**B) Apply these discard rules to every finding:**
1. Finding claims a redirect? → Check your curl log above. If curl showed `200` with no `Location:` header, **DELETE the finding — it is a hallucination.**
2. Finding claims acquisition/merger/partnership? → Where is the press release URL? No URL → **DELETE the finding.**
3. Finding has no source URL? → **DELETE.**
4. Finding could come from your training data rather than today's browser visit? → **DELETE.**

**C) If all findings are deleted after step B, proceed to step 7 (silent exit).**

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
LINEAR_CHANGES = [list of new items not in yesterday's snapshot]
```

### 8. Decide: send or silent exit

If `FAROS_CHANGES`, `JELLYFISH_CHANGES`, `ENTELLIGENCE_CHANGES`, and `LINEAR_CHANGES` are all empty → exit:
```
<internal>Nothing to do this run.</internal>
```

**Critical:** The `<` must be the very first character of your entire output. Do NOT write any summary, reasoning, or explanation before the `<internal>` tag.

### 9. Generate HTML report

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

  <h2>Linear</h2>
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

### 10. Send HTML report by email

Read the content of `/tmp/competitor-report-$TODAY.html` and send it as the email body:

- **To:** fabio@vedovelli.com.br
- **Subject:** `[Dev Visibility] Competitive Intelligence — $TODAY`
- **Body:** Full HTML content of the report (the file generated in step 9)
- **mimeType:** `text/html`
- **No attachments**

### 11. Update Timeline in Basic Memory

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

> **If the Gmail send in step 10 failed:** continue to steps 11–13 anyway — the timeline and snapshots should still be saved. Only the email notification is skipped.

### 12. Save today's snapshots to Basic Memory

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

**Title:** `$TODAY`
**Directory:** `Concorrência/Linear`
**Content:** Use this exact Markdown schema (omit sections with no data):

```markdown
## GitHub Repos
- [repo] — [last pushed] — [description or notable changes]

## Releases
- [repo] [tag] — [published_at] — [key changes summary]

## Blog Posts
- [title] — [date] — [url]

## Changelog
[New entries from linear.app/changelog — feature updates, agent capabilities, MCP changes]

## Product Page
[Notable copy, positioning changes, new AI capabilities, or feature highlights]

## Announcements
[Any banners, press releases, or notable homepage content]
```

### 13. Create GitHub issues for Dev Visibility-relevant features

For each item marked `[DEV_VISIBILITY_CANDIDATE]` in steps 3, 4, 5, and 6:

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
