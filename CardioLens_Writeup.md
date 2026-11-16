<img src="frontend/public/logo.svg" alt="CardioLens logo" width="120">

# CardioLens

*Helping doctors spot heart emergencies in remote places, faster*

**Track:** AI + Health   **Project:** Our own idea (4.1.4)   **Team:** MCN Networks

> **This project is a prototype and is not medical advice.**

## The problem

A family friend of ours is a heart doctor (cardiologist) at a non-profit hospital in India. Small clinics in rural areas send him their patients' ECGs, the heart tracings doctors use to spot heart problems, via WhatsApp. He can't tell which ones are emergencies until he opens each one. By the time they are reviewed, it's too late for the patient to get to a city hospital. Based on his experience, we built CardioLens: it reads every ECG first and moves the most urgent ones to the top of his list.

## What we built

**What goes in (input):** a digital 12-lead ECG file, plus the patient's age, sex and symptoms if known. **What comes out (output), in under a second:** whether the ECG looks normal, or shows signs of a heart attack (MI), ST/T changes, a conduction problem (the heart's electrical signal is blocked or delayed), or hypertrophy (a thickened heart wall). It also gives each case a priority (Urgent, Priority or Routine) and highlights the parts of the ECG that led to its answer. The doctor works through a shared list sorted by urgency and agrees with or corrects the AI with one click. **Our own ideas on top of the AI:** the urgency list, the ability for the doctor to make their own diagnosis, improvement to detecting hypertrophy, doctor sign-in, voice typing, a settings page, and intuitive analytics.

## How it works

**Data:** we used PTB-XL, a free public dataset of 21,388 ECGs from 18,869 patients, each labelled by cardiologists. We trained on most of it, used one part to fine-tune, and kept the final part (2,158 ECGs) completely hidden until the end for testing. No patient appears in both the training and the test data, so the test is fair. **Model:** a neural network (a 1D ResNet) that we trained from scratch to recognize patterns in the ECGs. We trained three copies and averaged their answers; when the three disagree, CardioLens tells the doctor the AI is unsure.

## Results

We compared our model with a simpler baseline (logistic regression). On the hidden test ECGs, our model scored **0.933 AUROC** (1.0 is perfect and 0.5 is guessing), compared with **0.854 for the baseline**. For the main question, "is something wrong with this ECG?", it caught **86.4%** of the abnormal ECGs, **missing 169** (false negatives), and correctly cleared **88.3%** of the normal ones, with **107 false alarms** (false positives).

| Category (test ECGs) | AUROC | Caught | Missed (FN) | False alarms (FP) | Flags that were right |
|---|---:|---:|---:|---:|---:|
| Normal ECG (963) | 0.952 | 91.6% | 81 | 191 | 82.2% |
| Heart attack (MI) (550) | 0.931 | 78.9% | 116 | 162 | 72.8% |
| ST/T change (521) | 0.943 | 80.8% | 100 | 128 | 76.7% |
| Conduction problem (496) | 0.929 | 75.6% | 121 | 94 | 80.0% |
| Hypertrophy (262) | 0.910 | 73.3% | 70 | 160 | 54.5% |
| **Anything abnormal** | **0.933** | **86.4%** | **169** | **107** | **—** |

**Is it fair?** It works almost equally well for men (0.943) and women (0.923), but it is less effective for patients under 40: it catches 57% of their heart attacks, because young patients with heart disease are rare in the data. **Where it fails:** hypertrophy is its weakest area: 55% of its hypertrophy warnings are right, and many of these ECGs are hard to call even for cardiologists. Our backup check raises how many are caught to 77%. It can also miss small or old heart attacks.

**What's next:** reading photos of paper ECGs and testing on ECGs from other hospitals, since all our data comes from one hospital in Germany. We also plan on continuing to improve the model’s capability to detect hypertrophy and minimize both cases of false positives and false negatives over all categories. Finally, we hope to expand the model’s range to other types of heart disorders and to better diagnose more specific cases.

## Sources

### Dataset

- Wagner, P., Strodthoff, N., Bousseljot, R., Samek, W., & Schaeffter, T. (2022). PTB-XL, a large publicly available electrocardiography dataset (version 1.0.3). PhysioNet. RRID:SCR_007345. https://doi.org/10.13026/kfzx-aw45
- Wagner, P., Strodthoff, N., Bousseljot, R.-D., Kreiseler, D., Lunze, F.I., Samek, W., Schaeffter, T. (2020), PTB-XL: A Large Publicly Available ECG Dataset. Scientific Data. https://doi.org/10.1038/s41597-020-0495-6 https://doi.org/10.1038/s41597-020-0495-6
- Pollard, T., Moody, B. E., Lehman, L., Gow, B., Fernandes, C., Xie, C., Johnson, A., Mark, R. G., & Heldt, T. (2026). PhysioNet as a global platform for biomedical research. Nature Health. https://doi.org/10.1038/s44360-026-00096-z. Available from: https://pmc.ncbi.nlm.nih.gov/articles/PMC13641116/

### Algorithms and methods

- He K, Zhang X, Ren S, Sun J. [Deep residual learning for image recognition (ResNet)](https://arxiv.org/abs/1512.03385). CVPR 2016.
- Strodthoff N, Wagner P, Schaeffter T, Samek W. [Deep learning for ECG analysis: benchmarks and insights from PTB-XL](https://doi.org/10.1109/JBHI.2020.3022989). IEEE J Biomed Health Inform 25(5) (2021).
- Loshchilov I, Hutter F. [Decoupled weight decay regularization (AdamW)](https://arxiv.org/abs/1711.05101). ICLR 2019.
- Smith LN, Topin N. [Super-convergence: very fast training using large learning rates (one-cycle schedule)](https://arxiv.org/abs/1708.07120). 2017.
- Shrikumar A, et al. [Not just a black box: learning important features through propagating activation differences (gradient × input)](https://arxiv.org/abs/1605.01713). 2016.
- Sokolow M, Lyon TP. [The ventricular complex in left ventricular hypertrophy (Sokolow-Lyon criterion)](https://doi.org/10.1016/0002-8703(49)90562-1). Am Heart J 37(2) (1949).
- Casale PN, et al. [Electrocardiographic detection of left ventricular hypertrophy (Cornell voltage criteria)](https://doi.org/10.1016/S0735-1097(85)80115-7). J Am Coll Cardiol 6(3) (1985).

### Pretrained models and tutorials

- None. All models were trained from scratch by our team on PTB-XL.

### Software

- [PyTorch](https://pytorch.org/) · [scikit-learn](https://scikit-learn.org/) (logistic-regression baseline) · [SciPy](https://scipy.org/) · [wfdb](https://github.com/MIT-LCP/wfdb-python) · [FastAPI](https://fastapi.tiangolo.com/) · [React](https://react.dev/) · [Recharts](https://recharts.org/) · [Playwright](https://playwright.dev/) and [FFmpeg](https://ffmpeg.org/) (demo video).

### AI tools

- [Claude Code](https://claude.com/product/claude-code) (Anthropic): coding assistant for the ML pipeline, backend, dashboard, testing, demo-video automation and drafting this write-up.
- [GitHub Copilot](https://github.com/features/copilot) in Visual Studio Code: code completion and editing.
- [ChatGPT](https://chatgpt.com/) (OpenAI): early brainstorming and project planning.
- [ElevenLabs](https://elevenlabs.io/): narration voice (text-to-speech) and background music for the demo video.

### Code

- [github.com/matthews153/Team-MCN-Networks-AI-Hackathon](https://github.com/matthews153/Team-MCN-Networks-AI-Hackathon)
