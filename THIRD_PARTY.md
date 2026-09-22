# Licensing and third-party components

Copyright (c) 2026 Numina. Fuse is offered under AGPL-3.0-or-later.
Previously MIT-licensed Numina code retains its original notice in
`licenses/MIT-original.txt`. Dependencies are not relicensed by Fuse's LICENSE.

The exact dependency versions and declared licenses are recorded in
`package-lock.json`. Important components include:

| Component | Declared license / terms |
| --- | --- |
| codemirror-lang-latex | AGPL-3.0-or-later |
| CodeMirror, React, Electron, KaTeX, electron-updater | MIT (with their own bundled notices) |
| elkjs | EPL-2.0 |
| @anthropic-ai/claude-agent-sdk | Anthropic terms; not MIT |
| PDF.js | Apache-2.0 |
| Inter and JetBrains Mono fonts | OFL-1.1 |

## Binary distribution review

Accepting AGPL for Fuse does not establish compatibility for every bundled
dependency. Before publishing installers, review in particular the combination
with EPL-2.0 `elkjs` and the Anthropic SDK's redistribution terms. The SDK is
currently imported for Claude history access. Do not assume the package's
availability from npm permits relicensing or unrestricted redistribution.

The `release` environment requires an explicit `DISTRIBUTION_REVIEWED=true`
variable as well as signing credentials. CI tests source on all platforms but
does not upload compiled app artifacts until distribution is reviewed.

For approved binary releases, include dependency license/copyright notices and
the complete corresponding source, including required dependency source and
scripts needed to build the release. A repository snapshot alone may not satisfy
every dependency's source-distribution obligations.

User-installed Claude Code, Codex, Lean and Git are separate tools with their own
terms. Fuse users authenticate through the providers' own tools; Fuse does not
grant rights to those services or their credentials.

References: [AGPL](https://www.gnu.org/licenses/agpl-3.0.html),
[ELK](https://github.com/kieler/elkjs),
[Anthropic terms](https://code.claude.com/docs/en/legal-and-compliance).
