"""Shared configuration for CardioLens (training + inference)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PTBXL_DIR = DATA_DIR / "ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.3"
CACHE_DIR = DATA_DIR / "cache"
ARTIFACTS_DIR = ROOT / "artifacts"          # trained models, metrics, demo samples
UPLOAD_EXAMPLES_DIR = ROOT / "sample_uploads"

SAMPLING_RATE = 100          # Hz (PTB-XL low-res version)
SECONDS = 10
N_SAMPLES = SAMPLING_RATE * SECONDS
LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]

# PTB-XL diagnostic superclasses: Normal + 4 abnormal categories
CLASSES = ["NORM", "MI", "STTC", "CD", "HYP"]
CLASS_INFO = {
    "NORM": {"name": "Normal ECG", "short": "Normal",
             "desc": "No diagnostic abnormality detected by the model."},
    "MI": {"name": "Myocardial Infarction", "short": "MI",
           "desc": "Patterns associated with current or prior myocardial infarction "
                   "(e.g. pathological Q waves, ST elevation, T-wave inversion in a territory)."},
    "STTC": {"name": "ST/T Change", "short": "ST/T change",
             "desc": "ST-segment or T-wave abnormalities (possible ischaemia, strain, "
                     "electrolyte or drug effect)."},
    "CD": {"name": "Conduction Disturbance", "short": "Conduction",
           "desc": "Abnormal electrical conduction such as bundle branch block, "
                   "fascicular block or AV block."},
    "HYP": {"name": "Hypertrophy", "short": "Hypertrophy",
            "desc": "Voltage/morphology patterns associated with chamber enlargement "
                    "or ventricular hypertrophy."},
}

# PTB-XL recommended patient-level split
TRAIN_FOLDS = list(range(1, 9))
VAL_FOLD = 9
TEST_FOLD = 10

# Band-pass applied identically at train and inference time
BANDPASS = (0.5, 40.0)
