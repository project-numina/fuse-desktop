.DEFAULT_GOAL := app
PORT ?= 9988
export PORT
export DATA

.PHONY: app web check-node

# The launcher takes its per-user guard before dependency installation/builds.
app: check-node
	@node scripts/launch.mjs app $${DATA:+--data "$$DATA"}

web: check-node
	@node scripts/launch.mjs web --port "$$PORT" $${DATA:+--data "$$DATA"}

check-node:
	@command -v node >/dev/null 2>&1 || { echo "Install Node.js 22.12+ from https://nodejs.org first."; exit 1; }
	@node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Fuse requires Node.js 22.12 or newer."); process.exit(1); }'
	@command -v npm >/dev/null 2>&1 || { echo "npm is required; install it with Node.js."; exit 1; }
