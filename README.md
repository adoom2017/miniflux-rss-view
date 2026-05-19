# Miniflux RSS View

Desktop Obsidian plugin for reading Miniflux RSS entries inside Obsidian.

## Features

* Configure a Miniflux server URL, API key, and page size.
* Open a dedicated RSS view from the ribbon or command palette.
* Browse unread entries by default, with all/unread/starred filters.
* Search entries, refresh the list, and load more pages.
* Open article URLs in Obsidian Web viewer.
* Automatically mark unread entries as read after opening them.

## Install Locally

1. Run `npm install`.
2. Run `npm run build`.
3. Create `<vault>/.obsidian/plugins/miniflux-rss-view`.
4. Copy the generated files from `dist/` into that folder.
5. Enable the plugin in Obsidian community plugin settings.
6. Enable Obsidian's core `Web viewer` plugin.
7. Open plugin settings and enter your Miniflux server URL and API key.

## Release

Use the release scripts to update plugin versions before tagging. The scripts keep `package.json`, `manifest.json`, and `versions.json` in sync, rebuild `dist/`, commit the tracked release files, and create a tag without a `v` prefix. The generated `dist/` files are ignored by Git.

```bash
npm run release -- 0.1.1
```

For automatic semantic version bumps:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Push the commit and tag after the release script finishes:

```bash
git push origin main
git push origin 0.1.1
```

Pushing the tag starts the release workflow. GitHub Actions builds the plugin, creates artifact attestations, writes release notes with the release commands and commit summary, and uploads the supported plugin files from `dist/`:

```text
dist/main.js
dist/manifest.json
dist/styles.css
```

## Disclosures

This plugin requires access to a Miniflux instance. You need to provide a Miniflux server URL and API key in the plugin settings.

The plugin sends network requests only to the Miniflux server URL that you configure. It uses those requests to load RSS entries, search entries, update read status, and open article URLs in Obsidian's core Web viewer.

The Miniflux API key is sent to your configured Miniflux server as the `X-Auth-Token` header. The API key is stored in Obsidian plugin data on your device.

This plugin does not include ads, client-side telemetry, server-side telemetry, or self-update mechanisms.
