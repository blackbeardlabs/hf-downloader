# Changelog

All notable changes to HF Downloader will be tracked here.

## Unreleased



## 1.0.8 - 2026-06-24

### Fixed

- Fixed aria2 progress parsing so log timestamps like `06/24` are no longer treated as `6 B / 24 B` download progress.
- Fixed completed file display when old corrupted byte values were already stored in SQLite.
- Completed files now prefer the actual disk file size when finalizing progress.
- Prevented suspicious tiny parsed sizes from overwriting known Hugging Face file sizes.

## 1.0.6 - 2026-06-24

### Changed

- Starting or resuming a job now pauses the currently running job and switches priority to the selected job.
- Queue still runs with single-job concurrency, but the user's selected job now takes precedence.

## 1.0.5 - 2026-06-24

### Added

- Added toast notifications in the top-right corner for app errors, saved settings, token changes, job actions, and job completion/failure.
- Removed duplicate inline success/error messages so notifications are shown in one place.

## 1.0.4 - 2026-06-24

### Added

- Added FontAwesome icons for job action buttons.
- Added adjustable table columns for jobs and file detail tables.
- Added persisted column width preferences in browser local storage.
- Added screenshots to the README.

### Changed

- Kept job action buttons in a single row.
- Improved table layout stability so changing speed/ETA text does not resize nearby columns.

## 1.0.3 - 2026-06-24

### Added

- Added job-level and file-level progress bars.
- Added job-level and file-level ETA display based on current speed and known file sizes.
- Added total downloaded/total size display for jobs and files.

### Changed

- Reorganized job action buttons into primary lifecycle actions plus cancel/delete actions.

## 1.0.2 - 2026-06-23

### Added

- Added Electron packaging support for desktop builds.
- Added local Hugging Face token management from the UI.
- Added automatic aria2 detection and install helper flow.

### Changed

- Release users no longer need to edit `.env` for the Hugging Face token.

## 1.0.1 - 2026-06-23

### Added

- Added Hugging Face repo file preview modal with manual file selection.
- Added include/exclude filtering support before import.
- Added configurable auto-restart policies for low speed and average speed drop.
- Added separate cancel and delete actions.

## 1.0.0 - 2026-06-23

### Added

- Initial local downloader MVP.
- Node.js/Express backend with SQLite persistence.
- Vanilla HTML/CSS/JavaScript dashboard.
- Hugging Face repo import.
- General URL list downloads.
- Sequential aria2c download queue with pause/resume support.
- Local-only data model with no accounts, cloud sync, or telemetry.
