# Agent Workflow

This project keeps a strict changelog and versioning workflow.

## Changelog Discipline

- Always update `CHANGELOG.md` for user-visible changes.
- Keep `## Unreleased` only for local work that has not yet been assigned to a version.
- If the latest version commit has already been pushed to GitHub, do not add later changes under that same version heading. Open a new version heading instead.
- If changes are still local and unpushed, it is acceptable to keep them under `Unreleased` or move them into the version currently being prepared.
- When creating a version heading, use this format:

```md
## 1.1.3 - 2026-06-28
```

- Group entries under `### Added`, `### Changed`, `### Fixed`, or `### Removed` as appropriate.

## Versioning

Use standard semantic versioning:

- `MAJOR.MINOR.PATCH`
- Bug fixes, retry behavior, UI polish, small reliability fixes: increment `PATCH`.
  - Example: `1.1.2` -> `1.1.3`
- New user-facing features: increment `MINOR` and reset patch to `0`.
  - Example: `1.1.3` -> `1.2.0`
- Large architecture changes, breaking behavior, storage migrations that require special handling, or major packaging/runtime changes: increment `MAJOR` and reset lower numbers.
  - Example: `1.2.4` -> `2.0.0`

When bumping a version:

- Update `package.json`.
- Update `package-lock.json` if the package version changes there.
- Move relevant `Unreleased` entries into the new version heading.
- Do not rewrite old pushed changelog sections except for typo-only corrections explicitly requested by the user.

## GitHub Push Rule

Before deciding whether to add to an existing version or create a new one, check:

```bash
git status -sb
git log --oneline -5
```

If the previous version commit is already on `origin/main`, changes made after that point must be documented under a newer version. This prevents silently changing release history after users may already have pulled or downloaded a release.

## Packaging Notes

- This app uses native `better-sqlite3`; do not assume cross-built Electron artifacts work across OSes.
- Build macOS artifacts on macOS, Windows artifacts on Windows, and Linux artifacts on Linux whenever release quality matters.
- If build scripts are changed, document the behavior in both `README.md` and `CHANGELOG.md`.
