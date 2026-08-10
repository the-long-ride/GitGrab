# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-11

### Added

- Copy log button on expanded GitHub Actions check steps.
  - Fetches the full raw log from GitHub's per-step log endpoint instead of
    only the rows currently rendered in the DOM.
  - Strips ANSI escape codes and optional ISO timestamps from the copied text.
  - Falls back to visible rendered rows if the raw log fetch fails.
- Copy Dependabot alerts button on the repository Dependabot alerts page.
  - Collects all open alerts across pagination using the active GitHub session.
  - Reads structured React embedded data and JSON payloads first, with a
    legacy HTML row parser as fallback.
  - Copies alerts as a Markdown document with title, priority, detected
    dependency, and manifest file per alert.
- Popup with toggles to enable GitGrab on GitHub and to include timestamps
  in copied logs.
- Clipboard support with graceful fallback from the modern Clipboard API to
  `execCommand("copy")`.
