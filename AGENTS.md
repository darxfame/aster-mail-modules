# Aster Mail Module Guidelines

This is an independent repository for Aster Mail modules. In the intended local
layout, its root is `owamail/aster-mail-modules/` and the Aster Mail checkout is
the parent directory.

## Required context

Read `docs/DEVELOPMENT.md`, `CONTRIBUTING.md` and `docs/SECURITY-REVIEW.md` before
adding or publishing a module. Follow the root `SECURITY.md` when present.
User-facing installation instructions target released Aster Mail builds with
module support; do not ask end users to switch development branches or apply SDK patches.

Before implementing or changing a module, read the current `../AGENTS.md` and
the relevant Aster Mail implementation and tests in `../desktop/`, `../src/`
and `../test/`. Follow its applicable protocol, security, coding and testing
contracts. Do not duplicate those rules here: the parent file is authoritative
for Aster Mail behavior. If that checkout is unavailable, obtain its path before
making integration assumptions.

Inspect callers, success paths, failures and recovery before changing behavior.
Preserve credential boundaries, account-session isolation, TLS validation and
the prohibition on replaying uncertain writes. Never test sends or invitations
against a real mailbox.

## Repository boundaries

Keep new module sources and their tests in this repository. The parent checkout
provides context; change it only when the task explicitly requires an Aster Mail
integration change. Commit and push each repository separately. Never include
the parent application's source tree, credentials, account data or build output
in this repository.

Run Git commands from this repository's root, or use `git -C` with its path.
Do not register this checkout as a submodule unless requested.

Use two-space indentation, semicolons and descriptive camelCase names. Use
CommonJS `.cjs` for Electron and Node.js utilities/tests. Module package logic is
browser ES modules (`.js`), as required by the SDK; never use Node.js in a package.
Keep code and comments in English. Match the host application's shared
Russian/English dictionary when integrating visible strings.

## Verification and releases

Add focused regression checks for behavior changes and verify affected existing
paths. Validate platform-dependent behavior in the actual runtime. Report checks
that could not be performed. For ktalk run `npm run check`, `npm test`,
`npm run check:catalog` and the documented
native Electron fixture against the compatible host.

This repository has its own release history. Aster Mail package versions,
fallback versions and application release builds belong to the parent repository.
Tag main-branch pushes with a new annotated version tag and keep this repository's
release notes in Russian. Do not reuse or move existing tags. The initial
documentation-only version is `v0.1.0`.

## Catalog publication

The client reads the catalog from the repository root `catalog.json`.
For each release pin an immutable full commit SHA, the package SHA-256 fingerprint
and its exact permissions. Follow `docs/CATALOG.md` for the publication contract.
Before installation the client must independently reload the package at that
commit, validate the manifest and resources, recompute the fingerprint and compare
permissions. Fail closed on any mismatch, unsupported contract or invalid source.
Never replace a pin with a mutable branch/tag during installation. Do not publish
credentials, account data or private repositories in the public catalog.
