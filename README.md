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

## How to run CardioLens (step by step)

You don't need to train anything or download the dataset: the trained models are already in `artifacts/`, and sample ECGs are in `sample_uploads/`. Setup takes about 5 minutes, most of it downloading PyTorch.

### 1. What you need first

| Tool | Version | Check with | Get it from |
|---|---|---|---|
| Git | any | `git --version` | https://git-scm.com/downloads |
| Python | **3.9 or newer** | `python3 --version` (Windows: `py --version`) | https://www.python.org/downloads/ |
| Node.js | **18 or newer** | `node --version` | https://nodejs.org/ (the "LTS" version) |

Node.js is used only once, to build the dashboard on the first run. You also need about 2 GB of free disk space and an internet connection for the first install.

### 2. Download the code

```bash
git clone https://github.com/matthews153/Team-MCN-Networks-AI-Hackathon.git
cd Team-MCN-Networks-AI-Hackathon
```

### 3. Install the Python packages (once)

**macOS / Linux:**

```bash
python3 -m venv .venv
.venv/bin/python3 -m pip install --upgrade pip
.venv/bin/python3 -m pip install -r requirements.txt
```

**Windows (Command Prompt or PowerShell):**

```bat
py -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt
```

This creates a private Python environment (a "virtual environment") in the `.venv` folder, so nothing is installed system-wide. You don't need to "activate" it: every command in this README calls the Python inside `.venv` directly. Run all commands from inside the project folder.

### 4. Start the app

**macOS / Linux:**

```bash
.venv/bin/python3 Main.py
```

**Windows:**

```bat
.venv\Scripts\python Main.py
```

The first start installs the dashboard's packages and builds it (about 1–2 minutes; you'll see `npm` and `vite` output). Then the app opens in your browser at **http://127.0.0.1:8000**. If the browser doesn't open, paste that address in yourself. Later starts take a few seconds.

Leave this terminal window open while you use the app. To stop it, press **Ctrl+C** in that window.

### 5. Try it

1. **Sign in:** type any name (for example `Dr. Judge`) and press **Continue**. There are no passwords; the name only records who uploaded or reviewed each ECG.
2. **See a full example queue:** on the empty dashboard, click **Load demo cases**. This adds 24 example patients built from PTB-XL ECGs the model never saw in training. They're tagged **Demo**, and the **Demo data** switch in the sidebar hides or shows them.
3. **Analyse an ECG yourself:** click **New analysis**, then drag ECG files onto the upload box (or click it to choose files). See **Sample ECGs to try** below for where to get them. Optionally fill in the patient's age, sex and symptoms first. Click **Analyse**.
4. **Open the result:** you'll see the AI's reading, its review priority (Urgent / Priority / Routine), the 12-lead ECG with the parts that drove the decision shaded, and a **Clinician review** panel. There you can agree with the AI, pick your own interpretation, or drag the priority score up or down.
5. **Review queue** lists every ECG, most urgent first. **Model insights** shows the test results: baseline comparison, missed cases and false alarms, fairness by age and sex, and where the model fails.

---

## Sample ECGs to try

Nothing is looked up or pre-stored: CardioLens runs the trained model on whatever signal you upload, and it is sometimes wrong. The fairest test is an ECG **you** pick, so that comes first.

### Option A (recommended): pick any test-set ECG yourself

PTB-XL is free and public, and no account is needed. The dataset page is **https://physionet.org/content/ptb-xl/1.0.3/**.

1. Download **`ptbxl_database.csv`** (https://physionet.org/files/ptb-xl/1.0.3/ptbxl_database.csv) and open it in Excel or Google Sheets.
2. Pick any row where **`strat_fold` is 10**. That's the test set: patients the model never saw. Folds 1–9 were used for training and tuning, so the model would look better on them than it really is.
3. Note the `ecg_id` and the cardiologists' labels in `scp_codes`. Common codes: `NORM` normal, `IMI`/`ASMI`/`AMI` heart attack (MI), `NDT`/`ISC_` ST/T change, `CLBBB`/`CRBBB`/`LAFB` conduction, `LVH` hypertrophy. The full list is in `scp_statements.csv` on the same page.
4. Download that ECG's two files and upload **both** to **New analysis**. For example, ECG 526:

```
https://physionet.org/files/ptb-xl/1.0.3/records100/00000/00526_lr.hea
https://physionet.org/files/ptb-xl/1.0.3/records100/00000/00526_lr.dat
```

Open each link in your browser to download it, or use the terminal. Keep the `-L`: PhysioNet redirects downloads, and without it you get empty files.

```bash
curl -L -O https://physionet.org/files/ptb-xl/1.0.3/records100/00000/00526_lr.hea
curl -L -O https://physionet.org/files/ptb-xl/1.0.3/records100/00000/00526_lr.dat
```

For another ECG, change the number in **both** links. Each folder holds 1,000 ECGs: `00000` has ECGs 1–999, `01000` has 1000–1999, `02000` has 2000–2999, and so on. For example, ECG 1785 is `records100/01000/01785_lr.hea`.

Expect it to be right most of the time, but not always. On the 2,158 test ECGs it caught 86% of abnormal ECGs (169 missed) and raised 107 false alarms on normal ones. The **Model insights** page shows exactly where it fails.

### Option B: known mistakes, on purpose

These are test-set ECGs that CardioLens gets **wrong**, so you can see failures for yourself. Download both files of each, the same way as above.

| ECG | Cardiologists' label | CardioLens's reading | Type of mistake | Files |
|---|---|---|---|---|
| 378 | Conduction disturbance (left posterior fascicular block) | Normal · Routine | **Missed** case (false negative) | `records100/00000/00378_lr.hea` + `.dat` |
| 1785 | Hypertrophy (right atrial enlargement) | Normal · Routine | **Missed** case (false negative) | `records100/01000/01785_lr.hea` + `.dat` |
| 38 | Normal | Conduction disturbance · Priority | **False alarm** (false positive) | `records100/00000/00038_lr.hea` + `.dat` |

Put `https://physionet.org/files/ptb-xl/1.0.3/` in front of each path, e.g. `https://physionet.org/files/ptb-xl/1.0.3/records100/00000/00378_lr.hea`.

Mistakes like these are why CardioLens only **ranks** the queue and a doctor makes the final call. For hypertrophy, its weakest category, it also runs a separate rule-based voltage check (shown on the case page) as a safety net.

### Option C: quick examples included in this repository (`sample_uploads/`)

For a fast first try without downloading anything. To be clear about how these were chosen: they are real test-set ECGs (patients the model never trained on) that we **picked as clear examples of each category that the model reads correctly**, so they show what each result looks like. They are not a measure of accuracy; options A and B are.

| Cardiologists' label | Upload these files **together** (WFDB format) | …or this single file (CSV) | CardioLens's reading |
|---|---|---|---|
| Normal | `norm_ecg2427.hea` + `norm_ecg2427.dat` | `norm_ecg2427_fs500.csv` | Normal · Routine |
| Heart attack (MI) | `mi_ecg240.hea` + `mi_ecg240.dat` | `mi_ecg240_fs500.csv` | Myocardial infarction · Urgent |
| ST/T change | `sttc_ecg20753.hea` + `sttc_ecg20753.dat` | `sttc_ecg20753_fs500.csv` | ST/T change · Urgent |
| Conduction disturbance | `cd_ecg19858.hea` + `cd_ecg19858.dat` | `cd_ecg19858_fs500.csv` | Conduction disturbance · Priority |
| Hypertrophy | `hyp_ecg8524.hea` + `hyp_ecg8524.dat` | `hyp_ecg8524_fs500.csv` | Hypertrophy · Priority |
| — | — | `example_ecg.json` | Only shows the JSON file format; not a real patient |

Tips:
* A WFDB recording is **two files with the same name**, `.hea` (header) and `.dat` (signal). Select or drag **both at once**.
* You can upload several ECGs in one go, or a **ZIP** of them.
* The CSV versions are the same ECGs at 500 Hz, so you can check that both formats give the same answer.

### Your own ECG files

| Format | What it should look like |
|---|---|
| WFDB (`.hea` + `.dat`) | Standard PhysioNet format, any sampling rate. |
| CSV | 12 columns in the order `I, II, III, aVR, aVL, aVF, V1–V6` (a header row with these names is optional), one row per sample, values in millivolts. Put the sampling rate in the file name, e.g. `patient_fs500.csv` for 500 Hz; otherwise it's guessed from the length (1,000 rows = 100 Hz, 5,000 rows = 500 Hz, for a 10-second ECG). |
| JSON | `{"fs": 500, "signal": [[12 values], [12 values], …]}` or `{"fs": 500, "leads": {"I": [...], "II": [...], …}}` |
| NumPy (`.npy`) | Array of shape (samples, 12). |
| ZIP | Any mix of the above. |

ECGs of any length and sampling rate are resampled to the 10 s × 100 Hz the model expects. Photos or scans of paper ECGs are **not** supported yet.

---

## Extras

| Command | What it does |
|---|---|
| `.venv/bin/python3 Main.py` | one server, API + dashboard on port 8000 |
| `.venv/bin/python3 Main.py --port 9000` | use a different port |
| `.venv/bin/python3 Main.py --no-browser` | don't open a browser |
| `.venv/bin/python3 Main.py --rebuild` | force a fresh dashboard build |
| `.venv/bin/python3 Main.py --dev` | UI development: Vite hot reload on :5173, API auto-reload on :8000 |

On Windows, use `.venv\Scripts\python` in place of `.venv/bin/python3` (a Windows virtual environment only has `python`, not `python3`).

**Demo data:** **Remove demo cases** in the review queue deletes only the demo cases. **Reset demo cases** brings back the original 24. **Clear all** deletes only the real (uploaded) cases; demo cases are always kept.

**Snapshots (save and bring back case lists):** cases live in `data/cases.json`. Named copies are kept in `data/snapshots/`, which is local only and not committed.

```bash
.venv/bin/python3 cases.py list                          # saved snapshots and what's on the dashboard now
.venv/bin/python3 cases.py save before_demo              # save the current cases
.venv/bin/python3 cases.py restore before_demo           # bring them back (merges; existing cases are kept)
.venv/bin/python3 cases.py restore before_demo --demo-only   # only the demo cases
.venv/bin/python3 cases.py restore before_demo --replace     # replace the current cases entirely
```

These commands work whether or not CardioLens is running. If it is, the dashboard updates straight away.

### Troubleshooting
* **`python3: command not found` (macOS/Linux) or `py` not recognised (Windows):** install Python from https://www.python.org/downloads/. On Windows, tick **"Add Python to PATH"** during installation, then open a new terminal.
* **`npm was not found. Install Node.js 18+`:** install Node.js (LTS) from https://nodejs.org/, open a **new** terminal, and run the start command again.
* **`No module named ...` when starting:** the packages aren't installed in `.venv`. Run step 3 again, from inside the project folder.
* **"Port 8000 is used by another program":** start on another port, e.g. `.venv/bin/python3 Main.py --port 8001`, and open http://127.0.0.1:8001.
* **"The CardioLens server is out of date" or "Method Not Allowed" after a `git pull`:** an old server process is still running. Stop it with Ctrl+C in its terminal (or close that terminal, or on macOS/Linux run `lsof -ti tcp:8000 | xargs kill`), then start it again.
* **An upload says the file couldn't be read:** for WFDB, make sure you selected both the `.hea` and the `.dat` file. For CSV, check that there are 12 columns. The error message says what's wrong.
* For developers: when you add or change API endpoints, bump `API_VERSION` in `backend/app.py` and `REQUIRED_API` in `frontend/src/lib.js`.

### Retraining from scratch (optional — not needed to run the app)

```bash
# download PTB-XL 1.0.3 (~1.7 GB) into data/
mkdir -p data && cd data
curl -L -o ptbxl.zip https://physionet.org/static/published-projects/ptb-xl/ptb-xl-a-large-publicly-accessible-electrocardiography-dataset-1.0.3.zip
unzip ptbxl.zip && rm ptbxl.zip && cd ..

.venv/bin/python3 -m ml.train --models 3 --epochs 20   # ~1 h on an Apple M2 (MPS)
.venv/bin/python3 -m ml.make_sample_uploads            # optional: regenerate sample_uploads/
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
* **Sign-in:** pick your name or type a new one (no passwords). The review queue is shared; uploads and reviews are signed with the doctor's name, and the queue can be filtered to *Mine*.
* **New analysis:** patient context (age, sex, symptoms) with **voice dictation** (age, sex and symptoms are picked out of what you say, and the full text goes into the notes), **autofill** (age/sex read from WFDB header comments or JSON files; a returning patient ID fills in their last known details), and facility suggestions from past cases. Also drag-and-drop batch upload with a format guide and file checks, and a demo library of unseen test-fold ECGs with their cardiologist labels.
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
   | Logistic regression on hand-crafted features | 0.854 | 0.65 | 79.3% |
   | Single 1D-ResNet | 0.930 | 0.75 | — |
   | **CardioLens ensemble (3 × ResNet)** | **0.933** | **0.76** | **87.2%** |

   Normal vs abnormal, reported separately: **86.4% sensitivity** (169 abnormal ECGs missed, i.e. false negatives) and **88.3% specificity** (107 normal ECGs falsely flagged, i.e. false positives).
   Per class, sensitivity / PPV: MI 79% / 73%, STTC 81% / 77%, CD 76% / 80%, HYP 73% / 55%. Hypertrophy uses a lowered threshold (0.20) on purpose: it catches more cases at the cost of more false alarms.
   Fairness: macro AUROC is 0.943 for men and 0.923 for women. The weakest group is under-40s: only 50% of their abnormal ECGs are kept out of the "Normal" class, and MI sensitivity falls to 57%. Young patients with disease are the most likely to be missed.

   Hypertrophy safety net: every ECG is also checked against the classic LVH voltage criteria (Sokolow-Lyon, sex-specific Cornell; `ml/voltage.py`). On the test set the voltage rules alone catch 51% of hypertrophy with 42% PPV, which is worse than the AI's 73% / 55%. Used as a safety net next to the AI, they raise hypertrophy detection to 77%, at the cost of 113 extra flags: only about 1 in 13 voltage flags the AI didn't make is real hypertrophy. The case page shows the measured values and this hit rate. Reproduce with `.venv/bin/python3 -m ml.eval_voltage`.

   After changing a decision threshold in `artifacts/metrics.json`, run `.venv/bin/python3 -m ml.recompute_metrics` (or `.venv/bin/python3 -m ml.recompute_metrics --set HYP=0.2`) to refresh every threshold-dependent number without retraining.
4. **Where does it fail?** See the *Hardest test cases* table and the failure chart. Typical failures: subtle or old MI read as normal; multi-label ECGs where only one finding is caught; hypertrophy (rarest class, lowest PPV); the youngest age group, which has few abnormal training examples.

**Make it our own:** a specific clinical user and workflow (remote ECG triage queue), uncertainty from ensemble disagreement, signal-quality gating, explainability overlays, and a subgroup fairness audit.

### Limitations
* PTB-XL labels describe ECG findings, not urgency or outcomes, so the priority rule is a transparent heuristic, not a validated risk model.
* Voltage criteria are a rule of thumb: they miss many cases of hypertrophy, and healthy young, thin or athletic people can meet them.
* PTB-XL's free-text reports are mostly German (some Swedish). CardioLens shows them in English, built from the cardiologists' coded SCP-ECG statements (`ml/data.py: english_report`), not machine-translated; the original wording is available on click. To add this to existing artifacts, run `.venv/bin/python3 -m ml.english_reports`.
* Data comes from a single German source (1989–1996), so generalisation to other devices and populations is untested.
* Photos and scans of paper ECGs are not supported yet; only digital waveforms are.

## Credits
* Wagner, P., Strodthoff, N., Bousseljot, R., Samek, W., & Schaeffter, T. (2022). *PTB-XL, a large publicly available electrocardiography dataset* (v1.0.3). PhysioNet. https://doi.org/10.13026/kfzx-aw45 — CC BY 4.0
* Wagner et al. (2020). PTB-XL, a large publicly available electrocardiography dataset. *Scientific Data* 7, 154.
* Goldberger et al. (2000). PhysioBank, PhysioToolkit, and PhysioNet. *Circulation* 101(23).
* Libraries: PyTorch, scikit-learn, SciPy, wfdb, FastAPI, React, Recharts, lucide-react.
* AI tools: Claude Code and GitHub Copilot (coding), ChatGPT (early brainstorming), ElevenLabs (demo-video voice and music).


https://github.com/matthews153/Team-MCN-Networks-AI-Hackathon.git