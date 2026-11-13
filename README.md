# Fuse Desktop

Fuse is a desktop workspace for turning mathematical ideas into Lean proofs with
Claude Code or Codex. Work with your LaTeX blueprint, Lean code, and AI agent in
one place, using files in your own repository.

## What you can do

- Read and edit your blueprint, with a graph of how its definitions and theorems depend on each other.
- Write Lean proofs with live goals, diagnostics, and build results.
- Ask an agent to help formalize statements and prove lemmas.
- Review the agent’s changes and commit them with Git.

## Get started

Install [Node.js 22.12+](https://nodejs.org) and Git, then run:

```bash
git clone https://github.com/project-numina/fuse-desktop.git
cd fuse-desktop
make app
```

This installs dependencies and opens Fuse. Run `make app` again to reopen it;
dependencies are reinstalled only when the dependency manifests change. Keep the
terminal open while using Fuse; press Ctrl+C to stop it.

For browser mode, run `make web PORT=9988` (9988 is the default). This builds
Fuse and prints an authenticated entry URL; open that URL in your browser. Keep
the terminal open and press Ctrl+C to stop either mode. Use `DATA=/path/to/data`
with either Make target to override storage. Without Make, use
`node scripts/launch.mjs app` or `node scripts/launch.mjs web --port 9988`.

Desktop and web share the same default data directory: `~/Library/Application Support/Fuse`
on macOS, `%APPDATA%/Fuse` on Windows, and `$XDG_CONFIG_HOME/Fuse` (or `~/.config/Fuse`)
on Linux. Only one instance per OS user may run, across modes and data directories.
Make reserves a launch guard before dependency installation or builds; direct
Electron and standalone starts reserve the runtime guard before initializing data.
Both guards are OS-owned loopback sockets and disappear on exit or crash; no stale
lock files need removal. The runtime guard remains authoritative if a direct start
wins while Make is building. Reserved lock ports are derived from the user identity;
an unrelated listener or a hash collision fails closed with a descriptive error.
This coordinates processes on the same host/network namespace; it does not provide
a distributed lock across hosts or containers. Older Fuse versions without this
guard must be stopped separately.

For direct headless use after building: `node out/main/standalone.js --port 9988`.
Optional arguments are `--data DIR`, `--renderer DIR` (or `none`), `--token TOKEN`,
and repeatable `--register DIR`. Direct headless starts default to an ephemeral
port (`--port 0`) for test harnesses. Occupied ports and invalid/missing arguments
fail before data initialization. A port can still become occupied after preflight;
the HTTP bind reports that failure.

To use an agent, install and sign in to [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
or [Codex](https://github.com/openai/codex). For Lean projects, install
[elan](https://github.com/leanprover/elan) to manage your Lean toolchains.

Once Fuse opens:

1. **Open a folder** containing your project, or open `fixtures/sample-blueprint` to try the included example.
2. Create a workspace and choose its blueprint source and Lean project.
3. Open the blueprint or a Lean file, and start a chat with your agent.

Use **Help → Guide** for a walkthrough and troubleshooting.

## Your files stay yours

Fuse edits your project files in place and saves its settings and chat data locally.
When you use an agent, prompts and relevant project content are sent to its model
provider. You use your own agent account and can choose permissions in Settings.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for code and testing conventions, and the
[developer reference](docs/development.md) for architecture, builds, and releases.
Report bugs through [GitHub Issues](https://github.com/project-numina/fuse-desktop/issues);
report security issues [privately](SECURITY.md).

## License

[AGPL-3.0-or-later](LICENSE). See [third-party notices](THIRD_PARTY.md).
