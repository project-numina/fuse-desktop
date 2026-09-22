.DEFAULT_GOAL := app

.PHONY: app check-node

# Install on first launch and whenever the dependency manifests change.
app: node_modules/.fuse-dependencies
	npm run dev

check-node:
	@command -v node >/dev/null 2>&1 || { echo "Install Node.js 22.12+ from https://nodejs.org first."; exit 1; }
	@node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Fuse requires Node.js 22.12 or newer."); process.exit(1); }'
	@command -v npm >/dev/null 2>&1 || { echo "npm is required; install it with Node.js."; exit 1; }

node_modules/.fuse-dependencies: package.json package-lock.json | check-node
	npm ci
	@touch $@
