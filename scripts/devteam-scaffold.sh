#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/devteam-scaffold.sh <repo-name>
# Creates a new GitHub repo with React + TanStack + MSW + Tailwind scaffold

REPO_NAME="${1:?Usage: $0 <repo-name>}"
REPO_DIR="/tmp/devteam-scaffold-${REPO_NAME}"

echo "Creating scaffold in ${REPO_DIR}..."

# Create project with Vite
npm create vite@latest "${REPO_DIR}" -- --template react-ts
cd "${REPO_DIR}"

# Install TanStack suite
npm install @tanstack/react-router @tanstack/react-query @tanstack/react-table @tanstack/react-form @tanstack/react-virtual

# Install MSW for API mocking
npm install msw --save-dev

# Install Tailwind CSS
npm install -D tailwindcss @tailwindcss/vite

# Install dev tools
npm install -D prettier eslint @eslint/js typescript-eslint

# Initialize git
git init -b main
git add -A
git commit -m "chore: scaffold React + TanStack + MSW + Tailwind project"

# Create GitHub repo
gh repo create "${REPO_NAME}" --public --source=. --push

echo ""
echo "Repo created: https://github.com/$(gh api user -q .login)/${REPO_NAME}"
echo ""
echo "Next steps:"
echo "  1. Create GitHub accounts for Carlos and Ana"
echo "  2. Fork the repo from each account"
echo "  3. Add PATs to .env"
