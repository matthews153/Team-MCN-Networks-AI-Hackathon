import { useEffect, useRef, useState } from 'react'
import { AlertCircle, FileUp, FlaskConical, Play, ShieldAlert, Trash2, Upload, X } from 'lucide-react'
import { api, CLASSES, SYMPTOMS, navigate } from '../lib'
import { Card, ClassTag, Findings, TriageBadge } from '../components/ui'

export default function Analyze({ health, onDone }) {
  const [patient, setPatient] = useState({ patient_id: '', age: '', sex: '', symptoms: [], facility: '', notes: '' })
  const [files, setFiles] = useState([])
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState(null)
  const [err, setErr] = useState(null)
  const [samples, setSamples] = useState([])
  const [filter, setFilter] = useState('ALL')
  const [busySample, setBusySample] = useState(null)
  const inputRef = useRef()

  useEffect(() => { api.samples().then(setSamples).catch(() => {}) }, [])

  const set = (k, v) => setPatient((p) => ({ ...p, [k]: v }))
  const toggleSym = (s) => set('symptoms', patient.symptoms.includes(s) ? patient.symptoms.filter((x) => x !== s) : [...patient.symptoms, s])
  const addFiles = (list) => setFiles((f) => [...f, ...Array.from(list)])
  const cleanPatient = () => ({ ...patient, age: patient.age === '' ? null : Number(patient.age) })

  const run = async () => {
    setBusy(true); setErr(null); setResults(null)
    try {
      const r = await api.analyzeFiles(files, cleanPatient())
      setResults(r); setFiles([]); onDone?.()
      const ok = r.filter((x) => x.case_id)
      if (ok.length === 1 && r.length === 1) navigate(`#/case/${ok[0].case_id}`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const runSample = async (s) => {
    setBusySample(s.idx)
    try {
      const p = cleanPatient()
      const body = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)))
      const c = await api.analyzeSample(s.idx, body)
      onDone?.(); navigate(`#/case/${c.id}`)
    } catch (e) { setErr(e.message) } finally { setBusySample(null) }
  }

  const shown = samples.filter((s) => filter === 'ALL' || (filter === 'FAIL' ? s.is_failure_case : s.true_labels.includes(filter)))

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>New ECG analysis</h2>
          <p>Upload one or more 12-lead ECG recordings. Each file becomes a case in your review queue.</p>
        </div>
      </div>

      {!health?.model_ready && <div className="disclaimer" style={{ marginBottom: 16 }}><AlertCircle size={16} />The model is not trained yet. Run <span className="mono">python -m ml.train</span> first.</div>}

      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <Card title="Patient context" sub="Optional — symptoms raise review priority. Use anonymised IDs only.">
          <div className="grid" style={{ gap: 12 }}>
            <label className="field">Patient ID<input className="input" placeholder="e.g. PT-2041" value={patient.patient_id} onChange={(e) => set('patient_id', e.target.value)} /></label>
            <div className="grid g-2" style={{ gap: 10 }}>
              <label className="field">Age<input className="input" type="number" min="0" max="120" value={patient.age} onChange={(e) => set('age', e.target.value)} /></label>
              <label className="field">Sex
                <select className="input" value={patient.sex} onChange={(e) => set('sex', e.target.value)}>
                  <option value="">—</option><option value="M">Male</option><option value="F">Female</option>
                </select>
              </label>
            </div>
            <div className="field">Presenting symptoms
              <div className="row wrap" style={{ gap: 6 }}>
                {SYMPTOMS.map((s) => <span key={s} className={`chip ${patient.symptoms.includes(s) ? 'on' : ''}`} onClick={() => toggleSym(s)}>{s}</span>)}
              </div>
            </div>
            <label className="field">Referring facility<input className="input" placeholder="e.g. District Clinic A" value={patient.facility} onChange={(e) => set('facility', e.target.value)} /></label>
            <label className="field">Clinical notes<textarea className="input" rows={2} value={patient.notes} onChange={(e) => set('notes', e.target.value)} /></label>
          </div>
        </Card>

        <Card title="Upload ECG files" sub="WFDB (.hea + .dat), CSV (12 lead columns), JSON, NPY, or a ZIP of these. Any sampling rate — resampled to 100 Hz, 10 s." className="span-2">
          <div className={`dropzone ${drag ? 'drag' : ''}`}
            onClick={() => inputRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}>
            <FileUp size={34} color="var(--accent)" />
            <div style={{ fontWeight: 600, marginTop: 10 }}>Drop ECG files here or click to browse</div>
            <div className="muted small" style={{ marginTop: 4 }}>Batch upload supported — try the files in <span className="mono">sample_uploads/</span></div>
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          </div>
          {files.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {files.map((f, i) => (
                <div key={i} className="row between" style={{ padding: '7px 10px', background: 'var(--surface-2)', borderRadius: 8, marginBottom: 6 }}>
                  <span className="row small"><FileUp size={14} className="muted" /> {f.name} <span className="muted">· {(f.size / 1024).toFixed(0)} KB</span></span>
                  <button className="btn sm ghost" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="row between" style={{ marginTop: 14 }}>
            <div className="small muted row"><ShieldAlert size={14} /> Prototype — not medical advice. Do not upload identifiable patient data.</div>
            <div className="row">
              {files.length > 0 && <button className="btn ghost" onClick={() => setFiles([])}><Trash2 size={14} /> Clear</button>}
              <button className="btn primary" disabled={!files.length || busy || !health?.model_ready} onClick={run}>
                {busy ? <span className="spinner" /> : <Upload size={15} />} Analyse {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''}
              </button>
            </div>
          </div>
          {err && <div className="disclaimer" style={{ marginTop: 12 }}><AlertCircle size={16} />{err}</div>}
          {results && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13 }}>Results</h3>
              <table className="table">
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className={r.case_id ? 'click' : ''} onClick={() => r.case_id && navigate(`#/case/${r.case_id}`)}>
                      <td className="small">{r.name}</td>
                      {r.error ? <td colSpan={2} style={{ color: '#ff8b8b' }} className="small">{r.error}</td> : (
                        <>
                          <td><Findings flagged={r.summary.flagged} category={r.summary.category} /></td>
                          <td><TriageBadge level={r.summary.triage.level} score={r.summary.triage.score} /></td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Demo library — unseen PTB-XL test ECGs" icon={<FlaskConical size={16} color="var(--accent)" />}
        sub="Records from fold 10, which the model never saw during training. Ground-truth cardiologist labels are shown so you can compare with the AI."
        right={
          <div className="row wrap" style={{ gap: 6 }}>
            {['ALL', ...CLASSES, 'FAIL'].map((c) => (
              <span key={c} className={`chip ${filter === c ? 'on' : ''}`} onClick={() => setFilter(c)}>{c === 'ALL' ? 'All' : c === 'FAIL' ? 'Known failures' : c}</span>
            ))}
          </div>
        }>
        <div className="grid g-4">
          {shown.map((s) => (
            <div key={s.idx} className="card" style={{ background: 'var(--surface-2)', padding: 14 }}>
              <div className="row between">
                <strong className="mono small">ECG #{s.ecg_id}</strong>
                {s.is_failure_case && <span className="badge neutral" title="Among the model's largest test errors">hard case</span>}
              </div>
              <div className="muted small" style={{ margin: '4px 0 8px' }}>{s.age ? `${Math.round(s.age)}y` : '—'} · {s.sex === 'F' ? 'Female' : 'Male'}</div>
              <div className="small muted">Cardiologist label</div>
              <div style={{ minHeight: 22, marginTop: 2 }}>{s.true_labels.map((c) => <ClassTag key={c} code={c} />)}</div>
              <button className="btn sm" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }} disabled={busySample != null || !health?.model_ready} onClick={() => runSample(s)}>
                {busySample === s.idx ? <span className="spinner" /> : <Play size={13} />} Analyse
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
