import { ShieldAlert } from 'lucide-react'
import { CLASSES, CLASS_NAMES } from '../lib'

const DESC = {
  NORM: 'No diagnostic abnormality.',
  MI: 'Patterns of current or prior myocardial infarction — pathological Q waves, ST elevation, territorial T inversion.',
  STTC: 'ST-segment / T-wave changes: possible ischaemia, strain, electrolyte or drug effect.',
  CD: 'Conduction disturbances: bundle-branch blocks, fascicular blocks, AV blocks, WPW.',
  HYP: 'Chamber enlargement / ventricular hypertrophy voltage and morphology criteria.',
}

const PIPELINE = [
  { title: 'ECG input and normalization', text: 'Upload a digital 12-lead ECG (any sampling rate) → resampled to 100 Hz, 10 s, band-passed 0.5–40 Hz.' },
  { title: 'Signal-quality screening', text: 'Checks flag flat leads, clipping, noise and baseline wander.' },
  { title: 'Five-category ensemble', text: 'An ensemble of 1D-ResNets outputs independent probabilities for 5 categories (multi-label).' },
  { title: 'Waveform attribution', text: 'Gradient × input highlights the waveform regions and leads behind each finding.' },
  { title: 'Review-priority rule', text: 'A transparent rule combines findings, confidence, heart rate and symptoms into a review priority.' },
]

export default function About() {
  return (
    <div className="about-page">
      <header className="page-head">
        <div>
          <h2>About CardioLens</h2>
          <p>Bringing intelligent cardiac triage to the last mile of healthcare.</p>
        </div>
      </header>

      <div className="disclaimer clinical-disclaimer" role="note">
        <ShieldAlert size={19} aria-hidden="true" />
        <div><strong>This project is a research prototype and is not medical advice.</strong> It is trained on a public research dataset, has not been clinically validated, and must not be used for real patient decisions. A normal AI result never overrides symptoms or clinical judgement.</div>
      </div>

      <section className="about-intro" aria-labelledby="who-heading">
        <h3 id="who-heading">Who it is for</h3>
        <p>
          A cardiologist at an urban referral hospital who receives dozens of ECGs a day from clinics without on-site cardiology.
          Instead of scrolling through messages in arrival order, CardioLens analyses every ECG the moment it arrives and ranks the queue,
          so likely heart attacks and multi-abnormality ECGs are read first.
        </p>
      </section>

      <section className="about-section" aria-labelledby="how-heading">
        <div className="section-title">
          <h3 id="how-heading">How it works</h3>
          <span className="section-meta">Five stages · ECG to review priority</span>
        </div>
        <ol className="process-list">
          {PIPELINE.map((step, index) => (
            <li key={step.title}>
              <span className="process-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h4>{step.title}</h4>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="about-section" aria-labelledby="classes-heading">
        <div className="section-title">
          <h3 id="classes-heading">What the AI classifies</h3>
          <span className="section-meta">PTB-XL diagnostic superclasses</span>
        </div>
        <div className="reference-table-wrap">
          <table className="table reference-table">
            <thead><tr><th scope="col">Category</th><th scope="col">Description</th></tr></thead>
            <tbody>{CLASSES.map((code) => (
              <tr key={code}>
                <th scope="row"><span className="reference-code">{code}</span><span>{CLASS_NAMES[code]}</span></th>
                <td>{DESC[code]}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <div className="about-bottom">
        <section className="info-section" aria-labelledby="limits-heading">
          <h3 id="limits-heading">Known limitations</h3>
          <ul>
            <li>PTB-XL labels describe ECG findings, not clinical urgency or outcomes — the priority score is a heuristic, not a validated risk model.</li>
            <li>Training data comes from one German hospital system (1989–1996); performance on other devices and populations is unknown.</li>
            <li>Photos / scans of paper ECGs are not supported yet — only digital waveforms.</li>
            <li>Superclasses are coarse: e.g. "CD" merges benign and serious conduction disorders, and rhythm disorders such as AF are not a target class.</li>
            <li>Multiple models agreeing is not independent confirmation; they share training data and biases.</li>
          </ul>
        </section>
        <section className="info-section credits-section" aria-labelledby="credits-heading">
          <h3 id="credits-heading">Data &amp; credits</h3>
          <p>
            Wagner, P., Strodthoff, N., Bousseljot, R., Samek, W., &amp; Schaeffter, T. (2022). <em>PTB-XL, a large publicly available electrocardiography dataset</em> (version 1.0.3). PhysioNet. https://doi.org/10.13026/kfzx-aw45 — licensed CC BY 4.0.
          </p>
          <p>
            Wagner et al. (2020), <em>Scientific Data</em> 7:154. Goldberger et al. (2000), PhysioBank, PhysioToolkit, and PhysioNet, <em>Circulation</em> 101(23).
          </p>
          <p className="credits-note">Built with PyTorch, scikit-learn, FastAPI, React and Recharts. AI coding assistants were used and are cited in the write-up.</p>
        </section>
      </div>
    </div>
  )
}
