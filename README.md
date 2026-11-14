# CardioLens
**Bringing intelligent cardiac triage to the last mile of healthcare.**

Team MCN Networks · Veritas AI International High School Hackathon 2026 · Track: **AI + Health**

> **This project is a prototype and is not medical advice.**

CardioLens is a doctor-facing web app. A cardiologist uploads 12-lead ECGs, and an AI ensemble trained on PTB-XL
interprets each one as **Normal** or one of **4 abnormal categories**:

| Code | Category | Example patterns |
|---|---|---|
| NORM | Normal ECG | no diagnostic abnormality |
| MI | Myocardial infarction | pathological Q waves, ST elevation, territorial T inversion |
| STTC | ST/T change | ischaemia, strain, electrolyte or drug effects |
| CD | Conduction disturbance | bundle-branch / fascicular / AV block |
| HYP | Hypertrophy | ventricular hypertrophy, chamber enlargement |

The app then ranks the doctor's review queue so the most urgent ECGs are read first.

---

## Quick start

```bash
# 1. Python env (Python 3.9+), once
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 2. Run: one server for the API + dashboard on http://127.0.0.1:8000
.venv/bin/python Main.py
```

`Main.py` builds the dashboard on first run, or whenever the frontend source has changed (this needs Node.js 18+ and installs `frontend/node_modules` automatically). It then serves everything from a single uvicorn process and opens your browser. Trained weights are committed in `artifacts/`, so the app runs without retraining.

| Command | What it does |
|---|---|
| `python Main.py` | one server, API + dashboard on port 8000 |
| `python Main.py --dev` | UI development: Vite hot reload on :5173, API auto-reload on :8000 |
| `python Main.py --rebuild` | force a fresh dashboard build |
| `python Main.py --port 9000 --no-browser` | different port, don't open a browser |

**Demo data:** *Load demo cases* on the empty dashboard creates 24 synthetic patients from unseen PTB-XL test ECGs; they are tagged **Demo**. The **Demo data** switch in the sidebar hides or shows them, so only real uploads are left on the dashboard and in the queue. **Remove demo cases** in the review queue deletes only the demo cases and keeps real patients.

**Snapshots (save and bring back case lists):** cases live in `data/cases.json`. Named copies are kept in `data/snapshots/`, which is local only and not committed.

```bash
python3 cases.py list                          # saved snapshots and what's on the dashboard now
python3 cases.py save before_demo              # save the current cases
python3 cases.py restore before_demo           # bring them back (merges; existing cases are kept)
python3 cases.py restore before_demo --demo-only   # only the demo cases
python3 cases.py restore before_demo --replace     # replace the current cases entirely
```

These commands work whether or not CardioLens is running. If it is, the dashboard updates straight away.

### Retraining from scratch

```bash
# download PTB-XL 1.0.3 (~1.7 GB) into data/
mkdir -p data && cd data
curl -L -o ptbxl.zip https://physionet.org/static/published-projects/ptb-xl/ptb-xl-a-large-publicly-accessible-electrocardiography-dataset-1.0.3.zip
unzip ptbxl.zip && rm ptbxl.zip && cd ..

.venv/bin/python -m ml.train --models 3 --epochs 20   # ~1 h on an Apple M2 (MPS)
.venv/bin/python -m ml.make_sample_uploads            # optional: regenerate sample_uploads/
```

---

## How it works

```
 Upload (WFDB .hea/.dat, CSV, JSON, NPY, ZIP — any sampling rate)
   │  backend/parsers.py
   ▼
 Resample → 100 Hz × 10 s  ·  band-pass 0.5–40 Hz  ·  per-lead standardise      ml/preprocess.py
   │
   ├─► Signal-quality checks (flat leads, clipping, noise, baseline wander)
   ├─► Rhythm: R-peak detection → heart rate, RR variability, irregularity
   ▼
 Ensemble of 3 × 1D-ResNet (multi-label, sigmoid)                                ml/model.py
   │  thresholds tuned per class on validation fold 9
   ▼
 Explainability: gradient × input → per-lead importance + "AI attention" overlay
   ▼
 Review priority (Urgent / Priority / Routine) from findings, confidence,         backend/inference.py
 model agreement, heart rate, signal quality and reported red-flag symptoms
   ▼
 FastAPI (backend/app.py)  ──►  React dashboard (frontend/)
```

### Model
* **Data:** PTB-XL v1.0.3 — 21,799 ten-second 12-lead ECGs from 18,869 patients; 21,388 have a diagnostic superclass label.
* **Split:** the dataset's recommended patient-level folds — train 1–8, validate 9, **test 10** (never seen in training or threshold tuning).
* **Architecture:** 1D-ResNet (4 stages, 8 residual blocks, kernel 9, ~4.2 M params), global avg + max pooling, 5 sigmoid outputs (an ECG can have several findings).
* **Training:** AdamW + one-cycle LR, BCE loss, augmentations (amplitude scaling, noise, baseline wander, time shift); best epoch picked by validation macro-AUROC; 3 seeds averaged into an ensemble. Spread between the models is shown as an uncertainty signal.
* **Baselines:** (1) prevalence guess, (2) logistic regression on 120 hand-crafted signal features, (3) a single ResNet.

### Dashboard pages
* **Dashboard:** KPIs (volume, urgent unreviewed, pending, AI–clinician agreement, time to review, signal quality), daily volume by priority, triage mix, urgent worklist, findings by category and age group, priority-score distribution.
* **New analysis:** patient context (age, sex, symptoms), drag-and-drop batch upload, and a demo library of unseen test-fold ECGs with their cardiologist labels.
* **Case view:** 12-lead ECG on standard paper (3×4 + rhythm strip, or 12×10 s) with an AI-attention overlay, single-lead inspector with detected beats, probability bars with thresholds and per-model dots, radar profile, lead-importance heatmap, per-lead quality, an AI narrative report, and a clinician review panel (agree or override). The page can be printed.
* **Review queue:** filter, sort, search, CSV export, and removal of demo cases only.
* **Model insights:** baseline comparison, normal/abnormal confusion matrix, per-class metrics with **missed cases and false alarms reported separately**, ROC/PR curves, failure butterfly chart, fairness by sex and age, calibration, training curves, dataset composition and label co-occurrence, and the hardest test cases.

---

## Write-up notes (hackathon's four questions)

1. **Who is it for?** A cardiologist at a referral hospital who receives ECGs from rural clinics (today often via WhatsApp) between ward rounds. They open CardioLens to see which ECGs to read first.
2. **What goes in / what comes out?** A digital 12-lead ECG goes in. Out come: Normal or MI / ST-T / conduction / hypertrophy probabilities, highlighted leads and regions, signal quality, heart rate, and a review priority.
3. **Does it beat a baseline?** See *Model insights* or `artifacts/metrics.json`. Results are on test fold 10 (2,158 ECGs from patients never seen in training):

   | Model | Macro AUROC | Macro F1 | Normal-vs-abnormal accuracy |
   |---|---|---|---|
   | Prevalence guess | 0.500 | 0.00 | 57.7% (always "abnormal") |
   | Logistic regression on hand-crafted features | 0.854 | 0.65 | 79.1% |
   | Single 1D-ResNet | 0.928 | 0.75 | — |
   | **CardioLens ensemble (3 × ResNet)** | **0.931** | **0.76** | **87.0%** |

   Normal vs abnormal, reported separately: **85.2% sensitivity** (185 abnormal ECGs missed, i.e. false negatives) and **89.6% specificity** (95 normal ECGs falsely flagged, i.e. false positives).
   Per class, sensitivity / PPV: MI 81% / 71%, STTC 79% / 79%, CD 72% / 82%, HYP 60% / 62%.
   Fairness: macro AUROC is 0.941 for men and 0.921 for women. The weakest group is under-40s: only 46% of their abnormal ECGs are kept out of the "Normal" class, and MI sensitivity falls to 57%. Young patients with disease are the most likely to be missed.
4. **Where does it fail?** See the *Hardest test cases* table and the failure chart. Typical failures: subtle or old MI read as normal; multi-label ECGs where only one finding is caught; hypertrophy (rarest class, lowest PPV); the youngest age group, which has few abnormal training examples.

**Make it our own:** a specific clinical user and workflow (remote ECG triage queue), uncertainty from ensemble disagreement, signal-quality gating, explainability overlays, and a subgroup fairness audit.

### Limitations
* PTB-XL labels describe ECG findings, not urgency or outcomes, so the priority rule is a transparent heuristic, not a validated risk model.
* Data comes from a single German source (1989–1996), so generalisation to other devices and populations is untested.
* Photos and scans of paper ECGs are not supported yet; only digital waveforms are.

## Credits
* Wagner, P., Strodthoff, N., Bousseljot, R., Samek, W., & Schaeffter, T. (2022). *PTB-XL, a large publicly available electrocardiography dataset* (v1.0.3). PhysioNet. https://doi.org/10.13026/kfzx-aw45 — CC BY 4.0
* Wagner et al. (2020). PTB-XL, a large publicly available electrocardiography dataset. *Scientific Data* 7, 154.
* Goldberger et al. (2000). PhysioBank, PhysioToolkit, and PhysioNet. *Circulation* 101(23).
* Libraries: PyTorch, scikit-learn, SciPy, wfdb, FastAPI, React, Recharts, lucide-react. AI coding assistants (Claude, ChatGPT) were used during development.
