import { BookOpen, BrainCircuit, Database, ShieldAlert, Stethoscope, Workflow } from 'lucide-react'
import { CLASSES, CLASS_COLORS, CLASS_NAMES } from '../lib'
import { Card } from '../components/ui'

const DESC = {
  NORM: 'No diagnostic abnormality.',
  MI: 'Patterns of current or prior myocardial infarction — pathological Q waves, ST elevation, territorial T inversion.',
  STTC: 'ST-segment / T-wave changes: possible ischaemia, strain, electrolyte or drug effect.',
  CD: 'Conduction disturbances: bundle-branch blocks, fascicular blocks, AV blocks, WPW.',
  HYP: 'Chamber enlargement / ventricular hypertrophy voltage and morphology criteria.',
}

export default function About() {
  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>About CardioLens</h2>
          <p>Bringing intelligent cardiac triage to the last mile of healthcare.</p>
        </div>
      </div>
      <div className="disclaimer" style={{ marginBottom: 16, fontSize: 13 }}>
        <ShieldAlert size={18} />
        <div><strong>This project is a prototype and is not medical advice.</strong> It is trained on a public research dataset, has not been clinically validated, and must not be used for real patient decisions. A normal AI result never overrides symptoms or clinical judgement.</div>
      </div>
      <div className="grid g-2" style={{ marginBottom: 16 }}>
        <Card title="Who it is for" icon={<Stethoscope size={16} color="var(--accent)" />}>
          <p className="text-2" style={{ lineHeight: 1.7 }}>
            A cardiologist at an urban referral hospital who receives dozens of ECGs a day from clinics without on-site cardiology.
            Instead of scrolling through messages in arrival order, CardioLens analyses every ECG the moment it arrives and ranks the queue,
            so likely heart attacks and multi-abnormality ECGs are read first.
          </p>
        </Card>
        <Card title="How it works" icon={<Workflow size={16} color="var(--accent)" />}>
          <ol className="text-2" style={{ lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
            <li>Upload a digital 12-lead ECG (any sampling rate) → resampled to 100 Hz, 10 s, band-passed 0.5–40 Hz.</li>
            <li>Signal-quality checks flag flat leads, clipping, noise and baseline wander.</li>
            <li>An ensemble of 1D-ResNets outputs independent probabilities for 5 categories (multi-label).</li>
            <li>Gradient × input attribution highlights the waveform regions and leads behind each finding.</li>
            <li>A transparent rule combines findings, confidence, heart rate and symptoms into a review priority.</li>
          </ol>
        </Card>
      </div>
      <Card title="What the AI classifies" icon={<BrainCircuit size={16} color="var(--accent)" />} style={{ marginBottom: 16 }}>
        <div className="grid g-5" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {CLASSES.map((c) => (
            <div key={c} className="card" style={{ background: 'var(--surface-2)', borderTop: `3px solid ${CLASS_COLORS[c]}` }}>
              <strong>{CLASS_NAMES[c]}</strong>
              <p className="small text-2" style={{ lineHeight: 1.6 }}>{DESC[c]}</p>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid g-2">
        <Card title="Known limitations" icon={<ShieldAlert size={16} color="var(--warning)" />}>
          <ul className="text-2" style={{ lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
            <li>PTB-XL labels describe ECG findings, not clinical urgency or outcomes — the priority score is a heuristic, not a validated risk model.</li>
            <li>Training data comes from one German hospital system (1989–1996); performance on other devices and populations is unknown.</li>
            <li>Photos / scans of paper ECGs are not supported yet — only digital waveforms.</li>
            <li>Superclasses are coarse: e.g. "CD" merges benign and serious conduction disorders, and rhythm disorders such as AF are not a target class.</li>
            <li>Multiple models agreeing is not independent confirmation; they share training data and biases.</li>
          </ul>
        </Card>
        <Card title="Data & credits" icon={<Database size={16} color="var(--accent)" />}>
          <p className="text-2" style={{ lineHeight: 1.7, marginTop: 0 }}>
            Wagner, P., Strodthoff, N., Bousseljot, R., Samek, W., &amp; Schaeffter, T. (2022). <em>PTB-XL, a large publicly available electrocardiography dataset</em> (version 1.0.3). PhysioNet. https://doi.org/10.13026/kfzx-aw45 — licensed CC BY 4.0.
          </p>
          <p className="text-2" style={{ lineHeight: 1.7 }}>
            Wagner et al. (2020), <em>Scientific Data</em> 7:154. Goldberger et al. (2000), PhysioBank, PhysioToolkit, and PhysioNet, <em>Circulation</em> 101(23).
          </p>
          <p className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><BookOpen size={13} /> Built with PyTorch, scikit-learn, FastAPI, React and Recharts. AI coding assistants were used and are cited in the write-up.</p>
        </Card>
      </div>
    </div>
  )
}
