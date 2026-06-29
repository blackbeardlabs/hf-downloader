# HF Downloader — Application Report

**Generated:** 2026-06-29
**Version:** 1.2.0
**Author:** blackbeardlabs
**License:** MIT

---

## Overview

HF Downloader is a **local-only download manager** for Hugging Face repositories and arbitrary URLs. It runs entirely on the user's machine with no accounts, no cloud sync, and no telemetry. The app can be run as a Node.js web server or packaged as a cross-platform Electron desktop application.

---

## Architecture

```
hf-downloader-app/
├── server.js            # Express server, API routes, app bootstrapping
├── db.js                # SQLite layer (better-sqlite3), all persistence
├── queue.js             # DownloadQueue — single-concurrency job/file executor
├── aria2.js             # aria2c child process wrapper, progress parsing, failure classification
├── hf.js                # Hugging Face API client, glob filtering, URL construction
├── modelIndexer.js      # Local model scanner (GGUF, SafeTensors, Diffusers)
├── policy.js            # DownloadPolicyMonitor — auto-restart rules engine
├── settings.js          # Settings persistence: HF token, download policy, model roots
├── system.js            # aria2c detection, version check, auto-install per platform
├── paths.js             # Path sanitization, output splitting, URL-to-filename
├── main.js              # Legacy Electron entry (uses ../server)
├── electron/main.js     # Electron main process, auto-port, BrowserWindow
├── public/
│   ├── index.html       # Single-page dashboard HTML
│   ├── style.css        # All styles
│   └── app.js           # Vanilla JS frontend, no framework
├── package.json
├── .env.example
└── data/                # SQLite database (app.db)
```

### Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Runtime     | Node.js 18+                         |
| Backend     | Express (REST API)                  |
| Database    | SQLite via better-sqlite3 (native)  |
| Frontend    | Vanilla HTML/CSS/JS (no framework)  |
| Downloads   | aria2c CLI (spawned as child proc)  |
| Desktop     | Electron 33, electron-builder 25    |
| Icons       | FontAwesome 7                       |

### Design Principles

- **No bundler, no TypeScript, no frontend framework** — everything is plain JS.
- **No CORS** — frontend and API are served from the same Express instance.
- **Local-only** — no accounts, no cloud, no telemetry.
- **Single-job concurrency** — one job downloads at a time, files within a job are sequential.
- **Path safety** — all paths go through sanitization; no directory traversal.

---

## Data Model (SQLite)

### `jobs` table
| Column        | Type   | Notes                          |
|---------------|--------|--------------------------------|
| id            | INT    | PK, autoincrement              |
| type          | TEXT   | `hf_repo` or `url_list`        |
| name          | TEXT   |                                |
| status        | TEXT   | queued, running, paused, completed, failed, cancelled |
| target_dir    | TEXT   | absolute path on disk          |
| created_at    | TEXT   | ISO timestamp                  |
| updated_at    | TEXT   | ISO timestamp                  |
| error         | TEXT   | nullable                       |

### `files` table
| Column        | Type   | Notes                          |
|---------------|--------|--------------------------------|
| id            | INT    | PK, autoincrement              |
| job_id        | INT    | FK → jobs.id (CASCADE delete)  |
| url           | TEXT   |                                |
| relative_path | TEXT   | sanitized relative path        |
| output_dir    | TEXT   | absolute directory for output  |
| output_name   | TEXT   | filename on disk               |
| size          | INT    | nullable (bytes)               |
| downloaded    | INT    | default 0 (bytes)              |
| status        | TEXT   | queued, downloading, paused, completed, failed, skipped |
| attempts      | INT    | default 0                      |
| last_error    | TEXT   | nullable                       |
| created_at    | TEXT   | ISO timestamp                  |
| updated_at    | TEXT   | ISO timestamp                  |

### `settings` table
| Column     | Type   | Notes                             |
|------------|--------|-----------------------------------|
| key        | TEXT   | PK (e.g., `downloadPolicy`, `hfToken`, `modelRoots`) |
| value_json | TEXT   | JSON-serialized value             |
| updated_at | TEXT   | ISO timestamp                     |

### `model_index` table
| Column          | Type   | Notes                        |
|-----------------|--------|------------------------------|
| id              | INT    | PK, autoincrement            |
| root_dir        | TEXT   | model root directory         |
| path            | TEXT   | UNIQUE, file/dir path        |
| name            | TEXT   | display name                 |
| format          | TEXT   | gguf, safetensors, diffusers |
| domain          | TEXT   | llm, image, video, lora, etc.|
| architecture    | TEXT   | nullable                     |
| creator         | TEXT   | nullable                     |
| base_model      | TEXT   | nullable                     |
| finetune        | TEXT   | nullable                     |
| quant           | TEXT   | nullable                     |
| params          | TEXT   | nullable                     |
| precision       | TEXT   | nullable                     |
| context_length  | INT    | nullable                     |
| size_bytes      | INT    | default 0                    |
| modified_at     | TEXT   | nullable                     |
| metadata_json   | TEXT   | raw metadata                 |
| scanned_at      | TEXT   | ISO timestamp                |

---

## Core Flows

### Hugging Face Repo Import
1. User provides `repoId` (e.g., `owner/repo-name`), `repoType`, `revision`, optional `include`/`exclude` patterns.
2. `hf.js` calls `https://huggingface.co/api/{type}/{repoId}/tree/{revision}?recursive=true`.
3. Files are filtered via glob-to-regex matching.
4. User can preview files in a modal, select subsets, then import.
5. Target directory is computed from the first Models root + repo ID: `{root}/{owner}/{repo-name}`.
6. A job is created with one `files` row per matched file.

### General URL Download
1. User provides a job name, target directory, and list of URLs.
2. Each URL gets a `files` row; filenames are extracted from URL paths.
3. Job is created and ready to start.

### Download Execution (`queue.js` → `aria2.js`)
1. `DownloadQueue.startJob(jobId)` sets the job as preferred, pauses any currently running job.
2. `pump()` finds the next queued/failed file in the job.
3. `runAria2()` spawns `aria2c` with `-c` (continue), retry, timeout, and speed-limit flags.
4. Progress is parsed from `aria2c` stdout in real-time (speed, percent, downloaded/total).
5. `DownloadPolicyMonitor` evaluates speed samples against auto-restart rules.
6. On completion, disk file size is used to finalize the `downloaded` and `size` fields.
7. On failure, `classifyDownloadFailure()` determines if the error is retryable or not (e.g., 401/403 from HF are non-retryable).
8. Files are processed sequentially; on completion/failure, `pump()` moves to the next file.
9. When all files are done, the job is marked `completed` or `failed`.

### Model Indexer
1. User configures model root directories in Settings.
2. `scanModelRoots()` recursively walks each root.
3. Detects three model types:
   - **GGUF files** — binary header parsed for architecture, quant, params, context length, etc.
   - **SafeTensors files** — 8-byte header length prefix parsed, JSON header for tensor names, dtypes, metadata.
   - **Diffusers folders** — detected via `model_index.json`, directory size computed recursively.
4. Multi-part shards (e.g., `-00001-of-00009`) are grouped into a single model row with combined size.
5. Domain is inferred from architecture, tensor names, and filename heuristics (llm, image, video, lora, vae, embedding, controlnet).
6. Results are upserted into `model_index`; stale entries from prior scans are deleted.

---

## API Endpoints

### System
| Method | Path                          | Description                |
|--------|-------------------------------|----------------------------|
| GET    | `/api/health`                 | Server health, aria2 status, token status |
| GET    | `/api/system/aria2`           | aria2c detection details   |
| POST   | `/api/system/aria2/install`   | Auto-install aria2c        |

### Settings
| Method | Path                              | Description            |
|--------|-----------------------------------|------------------------|
| GET    | `/api/settings/hf-token`          | Token existence status |
| PUT    | `/api/settings/hf-token`          | Save/remove HF token   |
| DELETE | `/api/settings/hf-token`          | Clear HF token         |
| GET    | `/api/settings/download-policy`   | Auto-restart policy    |
| PUT    | `/api/settings/download-policy`   | Update policy          |
| GET    | `/api/settings/model-roots`       | Model root directories |
| PUT    | `/api/settings/model-roots`       | Update model roots     |

### Jobs
| Method | Path                      | Description              |
|--------|---------------------------|--------------------------|
| GET    | `/api/jobs`               | List all jobs with stats |
| GET    | `/api/jobs/:id`           | Single job with stats    |
| POST   | `/api/jobs`               | Create URL-list job      |
| PUT    | `/api/jobs/:id/start`     | Start job                |
| PUT    | `/api/jobs/:id/resume`    | Resume paused job        |
| PUT    | `/api/jobs/:id/pause`     | Pause running job        |
| PUT    | `/api/jobs/:id/cancel`    | Cancel job (keeps DB row)|
| DELETE | `/api/jobs/:id`           | Delete job (DB only)     |
| GET    | `/api/jobs/:id/files`     | Files in a job           |

### Hugging Face
| Method | Path               | Description                     |
|--------|--------------------|---------------------------------|
| POST   | `/api/hf/files`    | Preview repo file list          |
| POST   | `/api/hf/import`   | Import repo as job              |

### Models
| Method | Path                         | Description                |
|--------|------------------------------|----------------------------|
| GET    | `/api/models`                | List indexed models        |
| GET    | `/api/models/:id`            | Single model detail        |
| POST   | `/api/models/scan`           | Start model scan           |
| GET    | `/api/models/scan/status`    | Scan progress/status       |
| POST   | `/api/models/export-file`    | Export model list (Electron)|

---

## Auto-Restart Policy

Disabled by default. When enabled, monitors download speed in real-time:

| Rule         | Trigger                                          | Default     |
|--------------|--------------------------------------------------|-------------|
| Low speed    | Speed below threshold for duration               | 5K for 120s |
| Average drop | Recent average drops N% below long-window average | 50% drop    |

Rules are combined with `any` or `all` logic. Limits include max restarts per file (5), per job (30), and cooldown (60s).

---

## Security Considerations

- **Path traversal protection:** All paths are sanitized via `safeRelativePath()` and `splitOutput()`. Output paths are verified to stay within `targetDir`.
- **HF token:** Stored in SQLite, never returned to the frontend. Only boolean `hasToken` status is exposed. Token is masked in aria2c output logs.
- **No CORS:** Frontend and API share the same origin.
- **No input sanitization framework:** Relies on manual validation and path safety functions.
- **JSON body limit:** 1MB cap on request bodies.

---

## Build & Distribution

| Target  | Artifacts                    | Command           |
|---------|------------------------------|-------------------|
| macOS   | `.dmg`                       | `npm run dist:mac`|
| Windows | `.exe` installer + portable  | `npm run dist:win`|
| Linux   | `.deb` + `.AppImage` (x64)   | `npm run dist:linux`|
| Linux   | `.deb` + `.AppImage` (arm64) | `npm run dist:linux:arm64`|

**Packaging notes:**
- `better-sqlite3` is native — rebuilt per runtime via electron-rebuild.
- `aria2c` is a system dependency — not bundled. App provides auto-install helpers.
- Cross-OS builds are possible for Win/Linux from any host (prebuilt binaries downloaded).
- macOS signing/notarization not yet configured.

---

## Environment Variables

| Variable                | Default                              | Description                    |
|-------------------------|--------------------------------------|--------------------------------|
| `PORT`                  | `3021`                               | HTTP listen port               |
| `DOWNLOAD_ROOT`         | —                                    | Default download directory     |
| `HF_TOKEN`              | —                                    | Fallback HF token (dev only)   |
| `HF_DOWNLOADER_DATA_DIR`| `./data`                             | SQLite database directory      |
| `LOWEST_SPEED_LIMIT`    | `50K`                                | aria2c lowest-speed-limit      |
| `ARIA2_TIMEOUT`         | `60`                                 | aria2c timeout (seconds)       |
| `ARIA2_RETRY_WAIT`      | `10`                                 | aria2c retry-wait (seconds)    |

---

## Version History Highlights

| Version | Date       | Key Change                                              |
|---------|------------|---------------------------------------------------------|
| 1.2.0   | 2026-06-29 | Shared Models root setting, computed HF target paths    |
| 1.1.3   | 2026-06-28 | Fixed gated/restricted repo retry loops                 |
| 1.1.2   | 2026-06-25 | Model export (TXT/CSV/TSV), Electron save dialog        |
| 1.1.1   | 2026-06-25 | Diffusers model detection fix                           |
| 1.1.0   | 2026-06-25 | Local Model Index with GGUF/SafeTensors/Diffusers scan  |
| 1.0.8   | 2026-06-24 | Fixed aria2 progress parsing, disk size fallback        |
| 1.0.6   | 2026-06-24 | Job priority switching                                  |
| 1.0.5   | 2026-06-24 | Toast notifications                                     |
| 1.0.4   | 2026-06-24 | FontAwesome icons, resizable table columns              |
| 1.0.3   | 2026-06-24 | Progress bars, ETA, speed display                       |
| 1.0.2   | 2026-06-23 | Electron packaging, HF token UI, aria2 auto-detect      |
| 1.0.1   | 2026-06-23 | File preview modal, include/exclude, auto-restart policy|
| 1.0.0   | 2026-06-23 | Initial MVP                                             |

---

## File Count & Size Summary

| File                  | Lines  | Purpose                        |
|-----------------------|--------|--------------------------------|
| `modelIndexer.js`     | 662    | Local model scanning/indexing  |
| `server.js`           | 482    | Express server, all API routes |
| `queue.js`            | 259    | Download job execution         |
| `db.js`               | 343    | SQLite persistence layer       |
| `settings.js`         | 180    | Settings/token/policy mgmt     |
| `aria2.js`            | 166    | aria2c process wrapper         |
| `system.js`           | 151    | System detection, aria2 install|
| `policy.js`           | 128    | Auto-restart rules engine      |
| `hf.js`               | 135    | Hugging Face API client        |
| `electron/main.js`    | 97     | Electron desktop entry point   |
| `paths.js`            | 64     | Path sanitization utilities    |
| **Total backend**     | ~2667  |                                |

---

## Strengths

- Clean separation of concerns: each module has a single responsibility.
- No framework overhead — everything is plain Node.js and vanilla JS.
- Robust path safety and input validation.
- Smart model indexer with binary format parsing (GGUF, SafeTensors).
- Graceful error handling for gated repos, auth failures, and network issues.
- Comprehensive changelog with disciplined versioning.

## Potential Improvements

- **Tests:** No test suite exists. Unit tests for `aria2.js` (progress parsing), `hf.js` (glob matching), `paths.js` (path safety), and `modelIndexer.js` (metadata extraction) would add confidence.
- **Concurrency:** Single-job concurrency limits throughput. Multi-job parallel downloads could be a future feature.
- **aria2c bundling:** Currently requires system install. Bundling platform-specific binaries would improve UX.
- **TypeScript migration:** Would add type safety for the growing codebase.
- **Rate limiting:** The HF API has rate limits; no explicit rate limiting is implemented for file listing.
- **macOS notarization:** Required for polished macOS distribution.
