#!/usr/bin/env python3
"""Offline behavior checks for the PDF-to-knowledge preprocessing route."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

try:
    import fitz
except ImportError:
    raise SystemExit("PyMuPDF is required: python -m pip install PyMuPDF")

SCRIPT = Path(__file__).with_name("ingest-football-knowledge.py")
spec = importlib.util.spec_from_file_location("football_pdf_ingestion", SCRIPT)
ingestion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingestion)


def write_fixture(path):
    document = fitz.open()
    page = document.new_page(width=600, height=800)
    page.insert_text((40, 70), "Cover 3 spot-drop: confirm the curl/flat defender's assignment.")
    page.insert_text((40, 110), "Match rules may change after the receiver release.")
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 30), False)
    pixmap.clear_with(185)
    png = pixmap.tobytes("png")
    page.insert_image(fitz.Rect(40, 160, 240, 310), stream=png)
    page.insert_image(fitz.Rect(340, 160, 540, 310), stream=png)
    scanned = document.new_page(width=600, height=800)
    scanned.insert_image(fitz.Rect(20, 20, 580, 780), stream=png)
    document.save(path)
    document.close()


class PdfIngestionTests(unittest.TestCase):
    def test_cli_preserves_provenance_without_inventing_diagram_links_or_ocr(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source = folder / "coaching.pdf"
            write_fixture(source)
            first, second = folder / "first.json", folder / "second.json"
            command = [sys.executable, str(SCRIPT), "--input", str(source), "--title", "Verified coaching notes", "--render-pages"]
            result = subprocess.run(command + ["--output", str(first)], check=True, capture_output=True, text=True)
            subprocess.run(command + ["--output", str(second)], check=True, capture_output=True, text=True)
            self.assertEqual(first.read_bytes(), second.read_bytes(), "same input must produce stable source/card IDs and pack content")
            pack = json.loads(first.read_text())
            summary = json.loads(result.stdout)
            manifest = json.loads((folder / "first.manifest.json").read_text())
            self.assertEqual(pack["format"], "playbook-studio-knowledge")
            self.assertEqual(pack["version"], 1)
            self.assertEqual(len(pack["sources"]), 1)
            source_id = pack["sources"][0]["id"]
            self.assertEqual(len(pack["sources"][0]["revision"]), 64)
            self.assertEqual(summary["needsOcrPages"], [2])
            self.assertFalse(summary["modelSawImages"])
            self.assertFalse(summary["ocrPerformed"])
            self.assertFalse(manifest["semanticFigureLinkingPerformed"])
            self.assertTrue(pack["cards"])
            for card in pack["cards"]:
                self.assertEqual(card["sourceId"], source_id)
                self.assertEqual(card["page"], 1)
                self.assertEqual(card["figures"], [], "same-page image is not a semantic association")
                self.assertTrue(0 < len(card["content"]) <= 4000)
                self.assertTrue(all(0 <= value <= 1 for value in card["bbox"]))
            self.assertIn("curl/flat", " ".join(card["content"] for card in pack["cards"]))
            self.assertEqual(len(manifest["pages"][0]["figures"]), 2)
            self.assertEqual(manifest["pages"][1]["status"], "needs_ocr")
            self.assertEqual(manifest["pages"][1]["cardIds"], [])
            for page in manifest["pages"]:
                self.assertTrue((folder / page["imageRef"]).read_bytes().startswith(b"\x89PNG"))
                for figure in page["figures"]:
                    self.assertEqual(figure["linkedCardIds"], [])
                    self.assertFalse(figure["interpreted"])
                    self.assertTrue((folder / figure["imageRef"]).is_file())

    def test_card_budget_errors_without_pack_then_requires_explicit_truncation(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source, output = folder / "coaching.pdf", folder / "bounded.json"
            write_fixture(source)
            original = ingestion.MAX_CARDS
            ingestion.MAX_CARDS = 1
            try:
                with self.assertRaisesRegex(ValueError, "exceeds 400 cards"):
                    ingestion.ingest(source, output)
                self.assertFalse(output.exists())
                result = ingestion.ingest(source, output, truncate=True)
                self.assertTrue(result["truncated"])
                self.assertEqual(result["cards"], 1)
                self.assertGreater(result["excludedCards"], 0)
            finally:
                ingestion.MAX_CARDS = original

    def test_blank_pdf_has_no_knowledge_card(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source, output = folder / "blank.pdf", folder / "blank.json"
            document = fitz.open()
            document.new_page()
            document.save(source)
            document.close()
            result = ingestion.ingest(source, output)
            self.assertEqual(result["cards"], 0)
            self.assertEqual(result["needsOcrPages"], [1])
            self.assertEqual(json.loads(output.read_text())["cards"], [])

    def test_long_text_chunks_remain_bounded_and_preserve_words(self):
        text = " ".join(f"coaching-rule-{index}" for index in range(900))
        chunks = ingestion.split_text(text)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(" ".join(chunks), text)
        self.assertTrue(all(len(chunk) <= 4000 for chunk in chunks))


if __name__ == "__main__":
    unittest.main(verbosity=2)
