# Features

HF Downloader is a local download manager for Hugging Face repositories and any other files. It runs entirely on your machine — no account, no cloud, no telemetry.

## Download from Hugging Face

- Download models, datasets, and spaces by repo ID.
- Choose a revision (branch or commit).
- Pick a destination folder on your computer.
- Filter files with `include` and `exclude` patterns (for example `*.safetensors, *.json`).
- Preview the file list before downloading and select exactly the files you want.
- Use the preview to select all, select only the visible (filtered) files, or uncheck items.

## Download any file by URL

- Paste a list of URLs and download them all into one folder.
- Give the job a name to keep things organized.

## Download control

- Start, pause, resume, cancel, and delete jobs.
- Resume continues from partial files — no re-downloading what you already have.
- If the app closes mid-download, your job stays paused and ready to resume.

## Live progress

- See downloaded bytes, total size, percentage, and current speed for the active file.
- The jobs table shows the speed of the active download.
- A job detail view lists every file with its status, size, and downloaded amount.

## Smart auto-restart

- Automatically restart downloads that stall or slow down.
- Two rules: low-speed and average-drop, with `any` or `all` matching.
- Set limits on restarts per file and per job, plus a cooldown.
- Disabled by default — turn it on in Settings.

## Private by design

- Your Hugging Face token is stored only on your machine.
- The token is never sent back to the browser or shown again after saving.
- No accounts, no sync, no cloud services, no tracking.

## Remembers your input

- The app saves what you typed in the forms, so a refresh keeps your repo, folder, and filters.
- A `Reset defaults` button restores the auto-restart settings.

## Desktop app

- Available for Windows, macOS, and Linux.
- Linux builds come in `.deb` and `.AppImage` for both 64-bit (x64) and ARM (arm64) computers.
- Windows builds come as an installer or a portable executable.
- macOS builds come as a `.dmg`.
- If `aria2c` (the download engine) is missing, the app shows a one-click installer button when supported on your platform, or shows the command to run manually.

## Easy to run

- Just install and open — no configuration required for normal use.
- Advanced options (port, download root, aria2 timeouts) are available for those who want them.
