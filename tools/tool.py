"""Download coloring page images and update pages/index.json.

Usage:
  python tools/tool.py --topic "cats" --count 8
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import urlparse

import requests
from duckduckgo_search import DDGS


ALLOWED_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def slugify(text: str) -> str:
	slug = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
	return slug or "coloring-page"


def infer_extension(url: str, content_type: Optional[str]) -> Optional[str]:
	if content_type:
		ctype = content_type.split(";")[0].strip().lower()
		if ctype == "image/svg+xml":
			return ".svg"
		ext = mimetypes.guess_extension(ctype)
		if ext == ".jpe":
			ext = ".jpg"
		if ext in ALLOWED_EXTENSIONS:
			return ext

	path = urlparse(url).path
	ext = Path(path).suffix.lower()
	if ext in ALLOWED_EXTENSIONS:
		return ext
	return None


def load_manifest(path: Path) -> list[str]:
	if not path.exists():
		return []
	try:
		data = json.loads(path.read_text(encoding="utf-8"))
	except json.JSONDecodeError:
		return []
	if isinstance(data, dict):
		pages = data.get("pages", [])
	else:
		pages = data
	return [p for p in pages if isinstance(p, str)]


def save_manifest(path: Path, pages: Iterable[str]) -> None:
	payload = {"pages": list(pages)}
	path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def fetch_image_urls(query: str, max_results: int) -> Iterable[str]:
	with DDGS() as ddgs:
		for result in ddgs.images(query, max_results=max_results):
			url = result.get("image")
			if url:
				yield url


def fetch_content_type(url: str, timeout: int) -> Optional[str]:
	headers = {"User-Agent": "Mozilla/5.0"}
	try:
		response = requests.head(url, headers=headers, timeout=timeout, allow_redirects=True)
		return response.headers.get("Content-Type")
	except requests.RequestException:
		return None


def download_image(url: str, dest_path: Path, timeout: int) -> bool:
	headers = {"User-Agent": "Mozilla/5.0"}
	try:
		with requests.get(url, headers=headers, timeout=timeout, stream=True) as response:
			if response.status_code != 200:
				return False
			content_type = response.headers.get("Content-Type", "")
			if content_type and not content_type.lower().startswith("image/"):
				return False
			dest_path.parent.mkdir(parents=True, exist_ok=True)
			with dest_path.open("wb") as handle:
				for chunk in response.iter_content(chunk_size=8192):
					if chunk:
						handle.write(chunk)
		return True
	except requests.RequestException:
		return False


def resolve_filename(base_slug: str, index: int, ext: str, existing: set[str]) -> str:
	while True:
		name = f"{base_slug}-{index:02d}{ext}"
		if name not in existing:
			return name
		index += 1


def main() -> int:
	parser = argparse.ArgumentParser(description="Download coloring page images for a topic.")
	parser.add_argument("--topic", required=True, help="Topic to search for.")
	parser.add_argument("--count", type=int, default=8, help="Number of images to download.")
	parser.add_argument("--max-results", type=int, default=40, help="Max search results to scan.")
	parser.add_argument("--timeout", type=int, default=15, help="HTTP timeout in seconds.")
	parser.add_argument("--pages-dir", default="pages", help="Destination folder for images.")
	parser.add_argument("--manifest", default="pages/index.json", help="Manifest path.")
	parser.add_argument("--dry-run", action="store_true", help="List images without downloading.")
	args = parser.parse_args()

	pages_dir = Path(args.pages_dir)
	manifest_path = Path(args.manifest)

	existing_pages = load_manifest(manifest_path)
	existing_names = set(existing_pages)

	query = f"{args.topic} coloring pages"
	base_slug = slugify(args.topic)

	downloaded = []
	scanned = 0

	for url in fetch_image_urls(query, args.max_results):
		if len(downloaded) >= args.count:
			break
		scanned += 1

		content_type = fetch_content_type(url, args.timeout)
		ext = infer_extension(url, content_type)
		if not ext:
			continue

		filename = resolve_filename(base_slug, len(downloaded) + 1, ext, existing_names)
		if args.dry_run:
			print(f"[dry-run] {url} -> {filename}")
			downloaded.append(filename)
			existing_names.add(filename)
			continue

		dest_path = pages_dir / filename
		success = download_image(url, dest_path, args.timeout)
		if success:
			downloaded.append(filename)
			existing_names.add(filename)
			print(f"Downloaded {url} -> {dest_path}")

	if not downloaded:
		print("No images downloaded.")
		return 1

	updated_pages = existing_pages + downloaded
	save_manifest(manifest_path, updated_pages)
	print(f"Updated manifest with {len(downloaded)} new images.")
	print(f"Scanned {scanned} results for query: {query}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
