# GitGrab

GitGrab is a Chromium browser extension that adds copy buttons to GitHub so you
can grab check step logs and Dependabot alerts without extra clicks.

## Features

| Feature | Description |
| --- | --- |
| Copy log button | Adds a "Copy log" button to expanded GitHub Actions check steps. The full raw log is fetched from GitHub's per-step log endpoint, so long steps are not truncated by DOM virtualization. |
| Clean log output | ANSI escape codes are stripped before copying. ISO timestamps are stripped by default and can be kept with the popup toggle. |
| Copy Dependabot alerts | Adds a "Copy Dependabot alerts" button on the repository Dependabot alerts page. All open alerts are collected across pagination and copied as a Markdown document. |
| Markdown alert format | Each alert is copied with its title, priority, detected dependency, and manifest file. |
| On/off toggle | The popup toggle enables or disables GitGrab on GitHub without reinstalling. |
| Timestamps toggle | The popup toggle controls whether timestamps are included in copied check step logs. |

## Installation

GitGrab is not published to the Chrome Web Store. Install it as an unpacked
extension:

1. Download or clone the repository and unpack it to a folder on your
   computer.
2. Open your Chromium browser (Chrome, Edge, Brave, Opera, or Vivaldi).
3. Go to the extensions page:
   - Chrome, Brave, Opera, Vivaldi: `chrome://extensions`
   - Edge: `edge://extensions`
4. Enable "Developer mode" (top-right corner).
5. Click "Load unpacked".
6. Select the folder containing `manifest.json` (the repository root).
7. GitGrab appears in the toolbar. Pin it if you want quick access to the
   popup.

The extension activates automatically when you visit `github.com` pages.
Check step log pages and the Dependabot alerts page
(`https://github.com/<owner>/<repo>/security/dependabot`) get the new buttons.

## Usage

- Open a workflow run on GitHub, expand a check step, and click "Copy log".
- Open the Dependabot alerts page of a repository and click
  "Copy Dependabot alerts". The alerts are copied as Markdown.
- Click the GitGrab toolbar icon to toggle the extension or to include
  timestamps in copied logs.

## Permissions

| Permission | Reason |
| --- | --- |
| `storage` | Saves the popup toggle settings via `chrome.storage.sync`. |
| `https://github.com/*` host access | Injects the copy buttons and fetches log and alert data from github.com. |

## License

[MIT](LICENSE)
