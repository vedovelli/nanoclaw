---
name: competitor-monitor
description: Daily competitive intelligence monitor for Faros AI and Jellyfish. Fetches updates from GitHub, blogs, and product pages; compares with yesterday's snapshot in Basic Memory; generates a PDF report and sends by email when changes are found.
---

# Competitor Monitor — Dev Visibility

## Notification Rules — Read Before Doing Anything

**You may only call `mcp__gmail__*` to send an email when there are actual changes since yesterday for at least one competitor.**

In every other situation (no changes, errors, API failures), produce no output and call no tools except `<internal>`.

Silent exit means your **entire output** is:
```
<internal>Nothing to do this run.</internal>
```
The `<` must be the very first character. No explanation. No summary. Nothing outside those tags.

## Overview

This skill does the following on every run:

1. Calculates today's and yesterday's dates
2. Reads yesterday's snapshots from Basic Memory
3. Researches Faros AI (GitHub API + browser) and Jellyfish (browser)
4. Compares findings with yesterday's snapshot
5. If no changes in either competitor → silent exit
6. If changes found → generates HTML report → converts to PDF via Chromium → sends by email → saves today's snapshots to Basic Memory

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

If either note is not found (e.g. first run), fall back to the base analysis docs:
- `Concorrência/Faros AI - Análise Competitiva`
- `Concorrência/Jellyfish - Análise Competitiva`

Also read `Concorrência/Monitoramento Diário - Perguntas de Análise` to understand which signals to look for.

Store the content of both snapshots in memory for comparison in step 5.

Also check whether `Concorrência/Faros AI/$TODAY` already exists in Basic Memory.
If it does, today's run already completed successfully. Exit silently:
```
<internal>Already ran today.</internal>
```

Additionally, always read `Concorrência/Faros AI - Análise Competitiva` and `Concorrência/Jellyfish - Análise Competitiva` to retrieve the **Sinais de Alerta** sections for both competitors. Store these for use in step 7 when applying the `high-threat` CSS class.

### 3. Research Faros AI

**a) GitHub releases (faros-community-edition):**

```bash
gh api repos/faros-ai/faros-community-edition/releases \
  -f per_page=5 \
  --jq '[.[] | {tag: .tag_name, published: .published_at, body: .body}]'
```

**b) GitHub releases (airbyte-connectors):**

```bash
gh api repos/faros-ai/airbyte-connectors/releases \
  -f per_page=5 \
  --jq '[.[] | {tag: .tag_name, published: .published_at, body: .body}]'
```

**c) Recently merged PRs (last 48h — cast wider net to avoid missing daily gaps):**

```bash
gh api repos/faros-ai/faros-community-edition/pulls \
  --method GET \
  -f state=closed \
  -f per_page=20 \
  --jq '[.[] | select(.merged_at != null) | {title: .title, merged: .merged_at, labels: [.labels[].name]}]'
```

**d) Blog — new posts:**

Use `agent-browser` to fetch `https://faros.ai/blog`. Extract post titles, dates, and URLs. Identify any post published on or after $YESTERDAY.

**e) Clara product page:**

Use `agent-browser` to fetch `https://faros.ai/clara`. Note any visible changes, new features, or new copy compared to what was in yesterday's snapshot.

If `agent-browser` fails or returns no usable content for any sub-step, treat that source as "no data" and continue. If ALL browser sources in this step fail, treat Faros AI as having no changes for today.

### 4. Research Jellyfish

Jellyfish is closed source — no GitHub to query. Use browser only.

**a) Blog — new posts:**

Use `agent-browser` to fetch `https://jellyfish.co/blog`. Extract post titles, dates, and URLs. Identify any post published on or after $YESTERDAY.

**b) AI Impact Dashboard page:**

Use `agent-browser` to fetch `https://jellyfish.co/platform/jellyfish-ai-impact/`. Note any changes in supported tools or feature descriptions compared to yesterday's snapshot.

**c) Homepage/announcements:**

Use `agent-browser` to check `https://jellyfish.co` for any banners or featured announcements.

If `agent-browser` fails or returns no usable content for any sub-step, treat that source as "no data" and continue. If ALL browser sources in this step fail, treat Jellyfish as having no changes for today.

### 5. Compare with yesterday

For each competitor, answer these questions using the monitoring questions from Basic Memory and what you found:

- Is there a new blog post? What's the topic?
- Is there a new release or PR that touches AI coding tool integrations?
- Any new integration announced (Claude Code hooks, Cursor, Cline, Windsurf)?
- Any strategic signal (pricing change, new client, funding, chat interface launch)?

Produce a structured findings list for each competitor:
```
FAROS_CHANGES = [list of new items not in yesterday's snapshot]
JELLYFISH_CHANGES = [list of new items not in yesterday's snapshot]
```

### 6. Decide: send or silent exit

If both `FAROS_CHANGES` and `JELLYFISH_CHANGES` are empty → exit:
```
<internal>Nothing to do this run.</internal>
```

**Critical:** The `<` must be the very first character of your entire output. Do NOT write any summary, reasoning, or explanation before the `<internal>` tag.

### 7. Generate HTML report

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

  <h2>Relevância para Dev Visibility</h2>
  <p>[Analysis: do any of these changes reduce our differentiation? Did threat level change?]</p>

  <h2>Ação Necessária</h2>
  <p>[nenhuma | atualizar nota de análise | alertar founder]</p>

  <footer>Gerado automaticamente pelo NanoClaw competitor-monitor às 05:00 BRT</footer>
</body>
</html>
```

Use `high-threat` CSS class on items that match the "Sinais de Alerta" sections from the base analysis documents.

### 8. Convert HTML to PDF via Chromium headless

```bash
/usr/bin/chromium --headless --no-sandbox \
  --print-to-pdf=/tmp/competitor-report-$TODAY.pdf \
  --print-to-pdf-no-header \
  file:///tmp/competitor-report-$TODAY.html
```

Verify the PDF was created:
```bash
ls -lh /tmp/competitor-report-$TODAY.pdf
```

If the file is 0 bytes or doesn't exist, log internally and skip sending — do not notify.

### 9. Send by email via Gmail

Use `mcp__gmail__*` to send:

- **To:** fabio@vedovelli.com.br
- **Subject:** `[Dev Visibility] Competitive Intelligence — $TODAY`
- **Body:** Plain text summary of the key changes (2–4 lines)
- **Attachment:** `/tmp/competitor-report-$TODAY.pdf`

If the Gmail send fails for any reason, do not retry and do not notify. Exit silently — skip step 10:
```
<internal>Gmail send failed.</internal>
```

### 10. Save today's snapshots to Basic Memory

Use `mcp__basic-memory-cloud__write_note` with `project: "dev-visibility-product"` for each competitor:

**Title:** `Concorrência/Faros AI/$TODAY`
**Content:** Markdown with everything found today (raw findings, not just changes). This becomes tomorrow's baseline.

**Title:** `Concorrência/Jellyfish/$TODAY`
**Content:** Same structure for Jellyfish.

