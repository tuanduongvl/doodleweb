# DoodleWeb Tools

## Coloring page image fetcher

A small Python helper that searches the web for "{topic} coloring pages", downloads images into `pages/`, and updates `pages/index.json`.

### Setup

Install dependencies from the repo root:

```pwsh
pip install -r requirements.txt
```

### Usage

```pwsh
python tools/tool.py --topic "cats" --count 8
```

Optional flags:

- `--max-results` — total search results to scan (default: 40)
- `--timeout` — request timeout in seconds (default: 15)
- `--dry-run` — list downloads without writing files
- `--pages-dir` — destination folder (default: `pages`)
- `--manifest` — manifest path (default: `pages/index.json`)

### Notes

- The downloader only saves image types supported by the app: SVG, PNG, JPG, JPEG, GIF, WEBP, BMP.
- Results depend on the search provider and network access.
