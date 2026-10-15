# CLAUDE.md — Döndü

> Bu dosya Claude Code'un her oturumda okuduğu talimat dosyasıdır. İnsan okurlar için asıl dokümantasyon `docs/` altındadır (Türkçe).

## What Döndü is

Döndü ("it returned / it turned back" in Turkish) is a desktop app (macOS + Windows) that tidies a messy computer: it scans **user-selected folders only**, understands every file (metadata, text excerpt, image thumbnail, optional AI), proposes a **plan** (which file goes where, what gets renamed, which duplicates get quarantined), shows that plan as an editable **report**, and only after an explicit **approval** executes it — writing every step to a **journal** so the whole run (or any single item) can be **undone**.

Primary user: a non-technical person (the developer's spouse) on a MacBook. Second user: the developer on Windows. UI language: Turkish first, English second.

## Golden rules (never violate)

1. **Plan → Review → Approve → Apply.** No file system mutation ever happens outside `apply`, and `apply` only runs on a plan whose status is `approved`. Scan and plan are strictly read-only.
2. **Never delete.** "Delete" means: move to `Döndü Karantina/<run-id>/` inside the root, or OS trash via `shell.trashItem()` if the user enabled that setting. Never `fs.rm`/`unlink` a user file. The only things Döndü may remove are empty directories *it created itself* during the same run.
3. **Never overwrite.** Target exists → suffix ` (2)`, ` (3)` …, never replace. Cross-volume move = copy → verify hash → then remove source; never remove source before verification.
4. **Stay inside the selected roots.** Every source and target path must resolve (after `realpath`) inside one of the roots the user picked. Path traversal, symlink/junction following, `.app`/`.photoslibrary`/other bundles' internals: forbidden. Bundles are leaves.
5. **Journal first.** Write the journal row *before* performing an operation (write-ahead), then mark it done/failed. Undo replays the journal backwards and refuses to touch a file whose size+mtime changed since.
6. **Sensitive stays local.** Files flagged sensitive (see `docs/03-YAPAY-ZEKA.md` §Hassas) are never sent to a cloud AI — only to LM Studio or rules. Thumbnails/excerpts of flagged files are not persisted outside the app data dir.
7. **No secrets in the repo or logs.** API keys live in Electron `safeStorage`. `.env*` is gitignored. Never log file contents, excerpts or keys. Paths in logs are fine.
8. **Cost guard.** Every AI run shows an estimate first and respects the per-run token/dollar cap setting. Cache AI results by content hash + prompt version.
9. **Anthropic API specifics:** model id `claude-haiku-5-5`; **omit `temperature`, `top_p`, `top_k`** (they return 400 on this model); use `effort: "low"` for classification; use tool-use with a JSON schema for structured output; mark the system prompt with `cache_control`.
10. **Cross-platform file names.** Sanitize for both OSes (see `docs/04-PLATFORM.md`), normalize to NFC, cap at 200 chars, handle case-insensitive renames in two steps.

## Tech stack (decided — do not change without asking)

- **Electron** (latest stable) + **electron-vite** + **React 18** + **TypeScript (strict)** + **Tailwind CSS** + **Zustand** + **react-i18next**
- **better-sqlite3** for index/cache/journal (`@electron/rebuild` via `electron-builder install-app-deps`). If native build fails on the dev machine, fall back to `sql.js` behind the same repository interface — the DB layer must be swappable.
- Hashing: `hash-wasm` (xxh3 for fast hash, blake3 for full hash) — no native deps.
- Thumbnails: Electron `nativeImage.createThumbnailFromPath()` (main process; uses QuickLook on macOS, shell thumbnails on Windows → handles HEIC, PDF, Pages, videos). Fallback `nativeImage.createFromPath().resize()`. **No `sharp`.**
- Text extraction: `pdf-parse` (or `pdfjs-dist`), `mammoth` (docx), `xlsx` (SheetJS, read-only), `music-metadata`, `exifr`, `file-type`.
- AI: `@anthropic-ai/sdk`; LM Studio via its OpenAI-compatible endpoint using plain `fetch` (no openai sdk needed).
- Settings: JSON file in `app.getPath('userData')` with a Zod schema; secrets via `safeStorage`.
- Packaging: `electron-builder` (dmg + nsis), builds run on GitHub Actions (`.github/workflows/build.yml`). macOS is built unsigned/ad-hoc (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `mac.identity: null`).
- Tests: `vitest`. Fixture generator at `scripts/make-fixtures.ts` creates a messy temp folder; **all FS tests run only inside temp dirs**.
- Lint/format: ESLint + Prettier. Commit messages: Conventional Commits, English.

## Repository layout

```
src/
  main/                 # Electron main process (Node)
    index.ts            # app lifecycle, window, IPC registration
    ipc/                # typed IPC handlers (one file per domain)
    core/
      scanner/          # walker, exclusions, bundle detection, metadata
      extract/          # text/exif/thumbnail extractors (one per type)
      hash/             # fast + full hashing, perceptual hash
      rules/            # deterministic classifier, sensitive detector, screenshot detector
      dupes/            # duplicate / near-duplicate finder
      ai/               # Provider interface + anthropic + lmstudio + none; batching; cache; cost estimator
      planner/          # builds Plan from analysis + settings + taxonomy
      apply/            # executor, pre-flight, cross-volume move, journal
      undo/             # journal replay
      naming/           # sanitizer, templates, collision handling
      platform/         # macOS/Windows specifics (permissions checks, cloud placeholders, trash)
    db/                 # schema, migrations, repositories (swappable backend)
    settings/           # schema (zod), load/save, secrets
  preload/              # contextBridge: exposes window.dondu.* (typed)
  renderer/             # React app
    app/                # routes, layout, theme
    features/           # onboarding, folders, scan, report, apply, history, settings
    components/         # shared UI
    i18n/               # tr.json, en.json
  shared/               # types shared by main/renderer (Plan, PlanItem, FileRecord, Settings, IPC contracts)
docs/                   # design docs (Turkish) — read them, they are the spec
docs/prompts/           # AI prompt templates (versioned: bump PROMPT_VERSION when changed)
scripts/                # make-fixtures.ts, setup-git.ps1
tests/                  # vitest unit + integration tests
```

## Commands (package.json scripts — keep these names)

- `npm run dev` — electron-vite dev with HMR
- `npm run build` — compile main/preload/renderer
- `npm run package` — electron-builder for the current OS (`dist/`)
- `npm test` / `npm run test:watch` — vitest
- `npm run lint` / `npm run typecheck` / `npm run format`
- `npm run fixtures` — generate a messy fixture folder in the OS temp dir and print its path

## How to work in this repo

- **Start of every session:** read `CLAUDE.md`, then `STATUS.md`, then the docs for the current phase (`docs/07-YOL-HARITASI.md` says which). Do not re-plan what the docs already decide; if a doc is wrong or missing something, say so and propose a change — do not silently diverge.
- **End of every work chunk:** run `npm run typecheck && npm run lint && npm test`, update `STATUS.md` (what is done, what is next, known issues), commit with a conventional message. Ask before `git push` unless the user has said "push" in this session.
- Work in small vertical slices that can be run and verified (`npm run dev`). Prefer finishing one feature end-to-end (main → IPC → renderer) over scaffolding many half-features.
- Verify your own work: for FS logic, generate fixtures and run the real code against them; for UI, launch `npm run dev` and describe what you see, or add a test.
- The developer machine is **Windows**; the production target is **macOS first**. Every path operation must be written with both in mind (`path.posix` vs `path.win32`, case-insensitivity, NFC/NFD). Put platform differences in `src/main/core/platform/` behind one interface, never scatter `process.platform` checks across features.
- All user-facing strings go through i18n (`tr.json` is the source of truth; `en.json` mirrors it). No hardcoded Turkish/English in components.
- UI: calm, minimal, no gradients, no emoji in the product UI, system font stack, 8px grid, light + dark themes, keyboard accessible. See `docs/08-TASARIM.md`.
- Don't add dependencies casually. Native modules need a very good reason (see stack list). Check license (MIT/Apache/BSD/ISC only).
- Never write to the user's real folders from tests or dev tooling. Fixtures only.

## Definition of done for a feature

1. Types in `src/shared` updated; IPC contract typed end-to-end.
2. Unit tests for pure logic (planner, naming, dupes, sensitive, undo).
3. Works on fixtures via `npm run dev`.
4. Strings in `tr.json` + `en.json`.
5. `STATUS.md` updated; docs updated if behavior differs from the spec.
