# BD-MarkdownRender

A BetterDiscord plugin that renders `.txt`, `.md`, and `.markdown` attachments as readable Markdown inside Discord.

## Install

1. [Download MarkdownRender.plugin.js](https://github.com/sutto4/BD-MarkdownRender/raw/refs/heads/main/MarkdownRender.plugin.js).
2. In Discord, open **Settings → BetterDiscord → Plugins → Open Plugins Folder**.
3. Place the downloaded file there and enable **MarkdownRender**.

Upgrading from **MarkdownAttachments**? Disable and remove that old plugin first so both versions do not process the same messages.

## Features

- Readable dark attachment cards with a raw-text toggle.
- Headings, tables, nested lists, task checkboxes, reference links, quotes, and fenced code blocks.
- Renders Discord's loaded preview immediately, without a redundant download.
- **Load full file** fetches the entire attachment when a preview is truncated.
- Download-only attachment cards load automatically.
- Loading status, retry, a 1 MiB limit, bounded download concurrency, and cancellation when a card disappears.
- Parser and sanitizer bundled into one plugin file; no separate library plugin needed.

A **Discord preview** label means completeness has not been verified. **Full file** confirms that the plugin downloaded the entire attachment. Raw mode shows the complete text after a successful download. Only your local display changes.

## Limits and privacy

Full-file downloads use Chromium fetch and only allow signed Discord CDN attachment URLs. No Discord token or cookies are sent. Failed requests keep any available preview readable. Browser restrictions or expired links may prevent downloading; reopen the channel and retry.

Files must be UTF-8 text and at most 1 MiB. Raw HTML stays literal, images become text labels, links allow HTTP/HTTPS only, and task checkboxes are read-only. Code blocks have no syntax highlighting. Discord DOM changes may require updates to attachment discovery.

## Development

Use Node.js 22.17 or newer:

```sh
npm ci
npm run build
npm test
```

Edit `src/main.js`, then rebuild `MarkdownRender.plugin.js`. The build includes Marked and DOMPurify and their license notices. Tests use simulated attachment cards and network responses; they do not establish compatibility with every Discord build.

## License

MIT for this plugin. Bundled dependencies retain their own license notices in the distributed plugin file.
