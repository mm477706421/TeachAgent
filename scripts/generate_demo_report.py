"""Regenerate the synthetic Pages download after changing the demo or report template."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.reports import word_report  # noqa: E402

lesson = json.loads((ROOT / "frontend/src/demo.json").read_text(encoding="utf-8"))
target = ROOT / "frontend/public/example-report.docx"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(word_report(lesson, lesson["analysis"]))
print(f"Generated {target.name}: {target.stat().st_size} bytes")
