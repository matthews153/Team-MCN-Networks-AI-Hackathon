"""Add English versions of the PTB-XL cardiologist reports to existing artifacts (no retraining).

    python -m ml.english_reports

Adds `report_en` (built from the coded SCP statements, which have English descriptions) and
`report_lang` (language of the original free text) to artifacts/samples.json and to the
hardest-cases list in artifacts/metrics.json. ml.train writes these fields itself.
"""
import json

from .config import ARTIFACTS_DIR
from .data import english_report, load_metadata, report_language


def main():
    meta = load_metadata()

    def add(item):
        row = meta.loc[item["ecg_id"]]
        item["report_en"] = english_report(row["scp_codes"])
        item["report_lang"] = report_language(str(row["report"]))

    samples_path = ARTIFACTS_DIR / "samples.json"
    samples = json.loads(samples_path.read_text())
    for s in samples:
        add(s)
    samples_path.write_text(json.dumps(samples))

    metrics_path = ARTIFACTS_DIR / "metrics.json"
    metrics = json.loads(metrics_path.read_text())
    for f in metrics.get("failures", []):
        add(f)
    metrics_path.write_text(json.dumps(metrics))
    langs = [x["report_lang"] for x in samples + metrics.get("failures", [])]
    print(f"Added English reports to {len(samples)} samples and {len(metrics.get('failures', []))} hardest cases "
          f"(originals: {', '.join(f'{langs.count(l)} {l}' for l in sorted(set(langs)))}).")


if __name__ == "__main__":
    main()
