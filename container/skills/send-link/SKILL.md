---
name: send-link
description: Send a link to Fabio's desktop email. Use when the user shares a URL they want to access later on their computer.
---

# Send Link to Desktop

Send the provided URL to fabio@vedovelli.com.br so it's ready to open on the desktop.

## Steps

1. Extract the URL from the user's message (the args or the first URL found in the message)
2. Use `mcp__gmail__send_email` to send it:
   - **to**: fabio@vedovelli.com.br
   - **subject**: 🔗 Link saved
   - **body**: The URL on its own line, nothing else

## Example

User: `/send-link https://example.com/article`

Send email:
- to: fabio@vedovelli.com.br
- subject: 🔗 Link saved
- body: `https://example.com/article`

Confirm to the user with a short message like "Sent to your email ✓"
