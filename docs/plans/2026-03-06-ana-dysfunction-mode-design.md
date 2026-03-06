# Ana Dysfunction Mode — Design

## Goal

Generate realistic "disengaged developer" signals in GitHub and Linear for DevVis testing. Ana (junior agent) enters a mode where she participates in discussions but fails to deliver — leaving issues open and PRs unreviewed across sprints.

## Behavior Contract

| Context | Normal Mode | Dysfunction Mode |
|---------|-------------|-----------------|
| Planning / Debate | Engaged, pushback, questions | Short, neutral, no initiative |
| Dev phase (coding) | Completes assigned issues | Skipped — issue stays open |
| Review phase | Reviews assigned PRs | Skipped — PR stays unreviewed |
| Sprint close | Clean | Open issues + unreviewed PRs |

## Components

### 1. Sprint State (`sprint-state.json`)

Add `dysfunctionMode` boolean:

```json
{
  "phase": "DEV",
  "dysfunctionMode": true
}
```

Persists across restarts. Orchestrator reads it on every tick.

### 2. Orchestrator — Turn Skip Logic

In `DEV` and `REVIEW` phases, when Ana is the designated agent and `dysfunctionMode = true`:

- Do **not** invoke Ana's container
- Log the skipped turn in state (`ana_skipped_turns: number`)
- Sprint advances naturally — artefacts remain pending in GitHub/Linear

In `PLANNING` and `DEBATE` phases: Ana is always invoked regardless of mode.

### 3. Ana's Persona Prompt — Dysfunction Variant

The orchestrator selects between two prompt variants:

**Normal:** Engaged, curious, constructive pushback, asks questions.

**Dysfunction:** Responds briefly and neutrally. Doesn't ask follow-up questions. Doesn't volunteer observations. Tone is polite but low-energy — someone going through something but not saying what.

Example normal: *"Good point Carlos, but I think we should also consider error states here — what happens if the fetch fails?"*

Example dysfunction: *"Makes sense."* / *"Ok."* / *"Agreed."*

### 4. Telegram Toggle

Extend existing `/devteam` command:

```
/devteam dysfunction on
/devteam dysfunction off
/devteam status          (already shows phase — add dysfunctionMode field)
```

Handler writes `dysfunctionMode` to the sprint state JSON. No restart required.

## Signal Profile for DevVis

After N dysfunction sprints, DevVis should observe:

- Issues assigned to Ana: consistently not closed
- PRs assigned to Ana for review: consistently not reviewed
- Sprint velocity: drop in Ana's contribution
- Comment pattern: Ana present in discussions but absent in delivery
- Sprint closed with open items: recurring pattern

## Out of Scope

- Carlos is unaffected
- No changes to GitHub/Linear API integration
- No new scheduled tasks
