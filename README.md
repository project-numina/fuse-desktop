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

Installers aren't available yet. For now, run Fuse from source with Node.js 22.12+
and Git:

```bash
git clone https://github.com/project-numina/fuse-desktop.git
cd fuse-desktop
npm ci
npm run dev
```

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
