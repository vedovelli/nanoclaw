# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM node:22-slim

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# ved custom
# Suppress npm update notifier — avoids noise in agent stdout before the output sentinel
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# ved custom end

# ved custom
# Install GitHub CLI (gh)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*
# ved custom end

# ved custom
# Install uv (Python package manager) for stdio MCP servers (e.g. mcp-obsidian)
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
# ved custom end

# Install agent-browser, claude-code, and MCP servers globally
# Pre-installing MCP servers avoids ~20-30s npx download on every cold start
# ved custom: gmail, calendar, mcp-remote added below
RUN npm install -g agent-browser @anthropic-ai/claude-code \
    @gongrzhe/server-gmail-autoauth-mcp \
    @cocal/google-calendar-mcp \
    mcp-remote
# ved custom end

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# ved custom
# Configure git to trust host-mounted volumes (avoids "dubious ownership" errors
# when the host directory is owned by a different UID than the container user)
# Must run after USER node so it writes to /home/node/.gitconfig, not /root/.gitconfig
RUN git config --global --add safe.directory '*'
# Pre-install mcp-obsidian as node user to avoid cold-start download latency
# Patch: mcp-obsidian hardcodes host=127.0.0.1 — inject OBSIDIAN_HOST/PORT env var support
# so the container can reach the host Obsidian API via host.docker.internal
RUN uv tool install mcp-obsidian \
    && TOOLS_PY=$(find /home/node/.local -path '*/mcp_obsidian/tools.py' -print -quit) \
    && sed -i 's/obsidian.Obsidian(api_key=api_key)/obsidian.Obsidian(api_key=api_key, host=os.getenv("OBSIDIAN_HOST", "127.0.0.1"), port=int(os.getenv("OBSIDIAN_PORT", "27124")))/g' "$TOOLS_PY"
# ved custom end

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
