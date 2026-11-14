#!/usr/bin/env python3
"""Extract selectable PDF text into a bounded, traceable local knowledge pack.

No OCR, semantic diagram recognition, model call, or network access is performed.
Rendered assets are for a person's offline provenance review, not model inputs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

FORMAT = "playbook-studio-knowledge"
VERSION = 1
MAX_INPUT_BYTES = 100 * 1024 * 1024
MAX_PAGES = 1000
MAX_CARDS = 400
MAX_PACK_BYTES = 1_000_000
MAX_TEXT_CHARS = 4000
MAX_FIGURES_PER_PAGE = 40
PREVIEW_EDGE = 1200


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def normalized_bbox(rect: object, width: float, height: float) -> list[float] | None:
    box = fitz.Rect(rect)
    values = [box.x0 / width, box.y0 / height, box.x1 / width, box.y1 / height]
    normalized = [round(max(0.0, min(1.0, value)), 6) for value in values]
    if normalized[0] >= normalized[2] or normalized[1] >= normalized[3]:
        return None
    return normalized


def split_text(text: str) -> list[str]:
    """Keep raw words intact where possible; never append generated explanations."""
    text = text.replace("\x00", "").strip()
    chunks = []
    while text:
        if len(text) <= MAX_TEXT_CHARS:
            chunks.append(text)
            break
        split = max(text.rfind("\n", 0, MAX_TEXT_CHARS + 1), text.rfind(" ", 0, MAX_TEXT_CHARS + 1))
        if split < MAX_TEXT_CHARS // 2:
            split = MAX_TEXT_CHARS
        chunks.append(text[:split].strip())
        text = text[split:].strip()
    return [part for part in chunks if part]


def render_asset(page: object, destination: Path, clip: object | None = None) -> None:
    bounds = fitz.Rect(clip) if clip is not None else page.rect
    if bounds.is_empty or bounds.is_infinite:
        raise ValueError("Cannot render an empty or infinite PDF region.")
    scale = min(1.5, PREVIEW_EDGE / max(bounds.width, bounds.height))
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=bounds, alpha=False)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pixmap.save(str(destination))


def ingest(input_path: Path, output_path: Path, title: str | None = None, render_pages: bool = False, truncate: bool = False) -> dict:
    if fitz is None:
        raise ValueError("PyMuPDF is required. Install it with: python -m pip install PyMuPDF")
    input_path = input_path.expanduser().resolve(strict=True)
    output_path = output_path.expanduser().resolve()
    if not input_path.is_file():
        raise ValueError("--input must name a PDF file.")
    if input_path == output_path:
        raise ValueError("--output must not overwrite the input PDF.")
    if input_path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("PDF exceeds the 100 MiB input limit; split it into smaller documents.")
    digest = hashlib.sha256()
    with input_path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    revision = digest.hexdigest()
    source_id = f"team:pdf:{revision[:24]}"
    source_title = (title or input_path.stem).strip()
    if not source_title or len(source_title) > 180:
        raise ValueError("The document title must contain 1 to 180 characters.")
    document_name = input_path.name
    if len(document_name) > 180:
        raise ValueError("The PDF filename must be at most 180 characters; rename it locally.")
    pack = {
        "format": FORMAT,
        "version": VERSION,
        "sources": [{"id": source_id, "title": source_title, "kind": "team", "revision": revision, "documentName": document_name}],
        "cards": [],
    }
    manifest = {
        "format": "playbook-studio-pdf-provenance",
        "version": VERSION,
        "sourceId": source_id,
        "revision": revision,
        "documentName": document_name,
        "coordinateSpace": "normalized-unrotated-page-top-left",
        "modelSawImages": False,
        "ocrPerformed": False,
        "semanticFigureLinkingPerformed": False,
        "limitations": [
            "Only selectable PDF text is extracted. Scans and diagrams require OCR or human annotation.",
            "A shared page number is coarse provenance, not evidence that a particular image explains a text chunk.",
            "Detected image placements are not classified as tactical figures. Vector drawings are not interpreted.",
            "Rendered PNG files are offline review assets and are not included in model requests.",
        ],
        "truncated": False,
        "pages": [],
    }
    # Use a fixed safe asset name, independent of user-controlled PDF titles.
    assets_name = f"pdf-{revision[:16]}-assets"
    assets_dir = output_path.parent / assets_name
    excluded_cards = 0
    with fitz.open(input_path) as document:
        if not document.is_pdf:
            raise ValueError("The input is not a PDF document.")
        if document.needs_pass:
            raise ValueError("The PDF is password protected; decrypt a local copy before extraction.")
        if len(document) > MAX_PAGES:
            raise ValueError("PDF exceeds 1,000 pages; split it into smaller documents.")
        if not len(document):
            raise ValueError("The PDF has no pages.")
        for page_index, page in enumerate(document):
            original_rotation = page.rotation
            # Extraction and rendered review assets use exactly the same coordinate frame.
            page.set_rotation(0)
            width, height = page.rect.width, page.rect.height
            if width <= 0 or height <= 0:
                raise ValueError(f"Page {page_index + 1} has invalid dimensions.")
            page_number = page_index + 1
            page_record = {
                "page": page_number,
                "pageId": f"{source_id}:page:{page_number}",
                "widthPoints": width,
                "heightPoints": height,
                "originalRotation": original_rotation,
                "status": "needs_ocr",
                "cardIds": [],
                "figures": [],
            }
            blocks = page.get_text("blocks", sort=True)
            text_blocks = [block for block in blocks if len(block) >= 7 and block[6] == 0 and str(block[4]).strip()]
            if text_blocks:
                page_record["status"] = "text_extracted"
            else:
                page_record["reason"] = "No selectable text; this may be a scan, a diagram, or an intentionally blank page. Review before adding knowledge."
            for block_index, block in enumerate(text_blocks):
                text_bbox = normalized_bbox(block[:4], width, height)
                if text_bbox is None:
                    page_record.setdefault("skippedTextRegions", []).append({"block": block_index + 1, "reason": "Text region has no positive area inside the normalized page; review the original page."})
                    continue
                for part_index, part in enumerate(split_text(str(block[4]))):
                    region_id = f"text-{block_index + 1}-{part_index + 1}"
                    card_id = f"pdf-{revision[:20]}-p{page_number}-{region_id}"
                    card = {
                        "id": card_id,
                        "sourceId": source_id,
                        "title": f"{source_title[:140]} · p.{page_number} · {block_index + 1}.{part_index + 1}",
                        "content": part,
                        "tags": [],
                        "coverages": [],
                        "appliesWhen": [],
                        "exceptions": [],
                        "page": page_number,
                        "regionId": region_id,
                        "bbox": text_bbox,
                        # Explicitly empty: same-page images are not automatically linked to text.
                        "figures": [],
                    }
                    if len(pack["cards"]) >= MAX_CARDS:
                        if not truncate:
                            raise ValueError("Extraction exceeds 400 cards; split the PDF or rerun with --truncate to explicitly keep a bounded subset.")
                        excluded_cards += 1
                        manifest["truncated"] = True
                        continue
                    pack["cards"].append(card)
                    if len(canonical_bytes(pack)) > MAX_PACK_BYTES:
                        pack["cards"].pop()
                        if not truncate:
                            raise ValueError("Knowledge pack exceeds 1 MB (1,000,000 bytes); split the PDF or rerun with --truncate to explicitly keep a bounded subset.")
                        excluded_cards += 1
                        manifest["truncated"] = True
                        continue
                    page_record["cardIds"].append(card_id)
            if text_blocks and not page_record["cardIds"] and page_record.get("skippedTextRegions"):
                page_record["status"] = "needs_review"
                page_record["reason"] = "Selectable text was found, but no valid text region could be exported."
            if render_pages:
                page_asset = f"page-{page_number:04d}.png"
                render_asset(page, assets_dir / page_asset)
                page_record["imageRef"] = f"{assets_name}/{page_asset}"
            image_infos = page.get_image_info(xrefs=True)
            for figure_index, image in enumerate(image_infos):
                if figure_index >= MAX_FIGURES_PER_PAGE:
                    page_record["omittedImagePlacements"] = len(image_infos) - MAX_FIGURES_PER_PAGE
                    break
                box = fitz.Rect(image["bbox"]) & page.rect
                if box.is_empty or box.is_infinite:
                    continue
                figure_bbox = normalized_bbox(box, width, height)
                if figure_bbox is None:
                    page_record["skippedImagePlacements"] = page_record.get("skippedImagePlacements", 0) + 1
                    continue
                figure = {
                    "id": f"{source_id}:page:{page_number}:image:{figure_index + 1}",
                    "regionId": f"image-{figure_index + 1}",
                    "bbox": figure_bbox,
                    "kind": "embedded_image_placement",
                    "linkedCardIds": [],
                    "interpreted": False,
                }
                if render_pages:
                    image_asset = f"page-{page_number:04d}-image-{figure_index + 1:03d}.png"
                    render_asset(page, assets_dir / image_asset, box)
                    figure["imageRef"] = f"{assets_name}/{image_asset}"
                page_record["figures"].append(figure)
            manifest["pages"].append(page_record)
    manifest["excludedCardCount"] = excluded_cards
    manifest_path = output_path.with_name(output_path.stem + ".manifest.json")
    if output_path == manifest_path or input_path == manifest_path:
        raise ValueError("Output names conflict; use a .json filename distinct from the input PDF.")
    atomic_write(manifest_path, canonical_bytes(manifest))
    atomic_write(output_path, canonical_bytes(pack))
    return {
        "output": str(output_path),
        "manifest": str(manifest_path),
        "sourceId": source_id,
        "pages": len(manifest["pages"]),
        "cards": len(pack["cards"]),
        "needsOcrPages": [page["page"] for page in manifest["pages"] if page["status"] == "needs_ocr"],
        "truncated": manifest["truncated"],
        "excludedCards": excluded_cards,
        "packBytes": len(canonical_bytes(pack)),
        "modelSawImages": False,
        "ocrPerformed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Local input PDF. No network access is used.")
    parser.add_argument("--output", required=True, type=Path, help="Destination knowledge-pack JSON.")
    parser.add_argument("--title", help="Human-readable source title; defaults to the PDF filename.")
    parser.add_argument("--render-pages", action="store_true", help="Render page and embedded-image-placement PNGs for offline review.")
    parser.add_argument("--truncate", action="store_true", help="Explicitly retain at most 400 cards and 1 MB (1,000,000 bytes); record omitted cards in the manifest.")
    args = parser.parse_args()
    try:
        result = ingest(args.input, args.output, args.title, args.render_pages, args.truncate)
    except (ValueError, OSError, RuntimeError) as error:
        print(f"PDF ingestion failed: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
