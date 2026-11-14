import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Ban, ChevronRight, EyeOff, Info, Mic, MicOff, FileUp, FlaskConical, Play, ShieldAlert, Trash2, Upload, X } from 'lucide-react'
import { api, CLASSES, SYMPTOMS, fmtDate, navigate } from '../lib'
import { applyDictation, readDemographics, useDictation } from '../patientInput'
import { Card, ClassTag, ErrorState, Findings, TriageBadge } from '../components/ui'

const ACCEPT = '.hea,.dat,.csv,.txt,.json,.npy,.zip'
const LAST_UPLOAD_KEY = 'cardiolens.lastUpload'

const FORMATS = [
  { name: 'WFDB record', ext: ['.hea', '.dat'], how: 'Select both files of a record together, with the same name (e.g. 07005_hr.hea + 07005_hr.dat). The PhysioNet / PTB-XL format.' },
  { name: 'CSV or text', ext: ['.csv', '.txt'], how: 'One column per lead, one row per sample, with a header row of lead names. Put the sampling rate in the file name (e.g. ecg_fs500.csv); otherwise a 10-second recording is assumed.' },
  { name: 'JSON or NumPy', ext: ['.json', '.npy'], how: 'JSON as {"fs": 500, "signal": [[12 values], …]}, or a NumPy array of samples × 12 leads.' },
  { name: 'ZIP', ext: ['.zip'], how: 'Any of the above bundled into one archive, for batches.' },
]

const extOf = (name) => (name.match(/\.[^.]+$/)?.[0] || '').toLowerCase()
const stemOf = (name) => name.replace(/\.[^.]+$/, '')

// Group the chosen files into ECG records: a .hea/.dat pair is one record
function toRecords(files) {
  const records = []
  const wfdb = new Map()
  files.forEach((f, i) => {
    const ext = extOf(f.name)
    if (ext === '.hea' || ext === '.dat') {
      const stem = stemOf(f.name)
      if (!wfdb.has(stem)) { wfdb.set(stem, { key: `w:${stem}`, label: stem, kind: 'WFDB record', idx: [], exts: new Set(), size: 0 }); records.push(wfdb.get(stem)) }
      const r = wfdb.get(stem); r.idx.push(i); r.exts.add(ext); r.size += f.size
    } else {
      const ok = ACCEPT.split(',').includes(ext)
      records.push({ key: `f:${i}`, label: f.name, idx: [i], size: f.size,
        kind: ok ? FORMATS.find((x) => x.ext.includes(ext)).name : 'Not supported',
        problem: ok ? null : (['.pdf', '.png', '.jpg', '.jpeg', '.heic', '.webp'].includes(ext)
          ? 'Images and PDFs of ECGs are not supported — upload the digital export instead.'
          : `"${ext || 'no extension'}" files are not supported.`) })
    }
  })
  for (const r of wfdb.values()) {
    if (!r.exts.has('.hea')) r.problem = `Missing ${r.label}.hea — select it together with the .dat file.`
    else if (!r.exts.has('.dat')) r.problem = `Missing ${r.label}.dat — select it together with the .hea file.`
  }
  return records
}

function loadLastUpload() {
  try { return JSON.parse(sessionStorage.getItem(LAST_UPLOAD_KEY)) } catch { return null }
}

export default function Analyze({ health, demo, onDone }) {
  const [patient, setPatient] = useState({ patient_id: '', age: '', sex: '', symptoms: [], facility: '', notes: '' })
  const [files, setFiles] = useState([])
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  // Results of the last upload survive leaving the page (until cleared or the tab is closed)
  const [last, setLast] = useState(loadLastUpload)
  const [err, setErr] = useState(null)
  const [samples, setSamples] = useState([])
  const [filter, setFilter] = useState('ALL')
  const [busySample, setBusySample] = useState(null)
  const inputRef = useRef()

  const [facilities, setFacilities] = useState([])
  const [autofill, setAutofill] = useState(null)   // short note on what was filled in automatically

  useEffect(() => { api.samples().then(setSamples).catch(() => {}) }, [])
  useEffect(() => { api.facilities().then(setFacilities).catch(() => {}) }, [last])

  // Voice: dictated text goes into the notes; age, sex and symptoms are picked out of it
  // (useDictation always calls the latest version of this callback, so `patient` is current)
  const dictation = useDictation((text) => {
    const { patient: next, filled } = applyDictation(text, patient)
    setPatient(next)
    setAutofill(filled.length ? `From dictation: ${filled.join(', ')} — full text added to notes` : 'Dictation added to clinical notes')
  })

  // Returning patient: fill empty fields from their most recent case
  const lookupPatient = async () => {
    const pid = patient.patient_id.trim()
    if (!pid) return
    try {
      const info = await api.patient(pid)
      const fill = {}
      if (patient.age === '' && info.age != null) fill.age = String(Math.round(info.age))
      if (!patient.sex && info.sex) fill.sex = info.sex
      if (!patient.facility && info.facility) fill.facility = info.facility
      const filled = Object.keys(fill)
      if (filled.length) setPatient((p) => ({ ...p, ...fill }))
      setAutofill(`${info.case_count} earlier case${info.case_count > 1 ? 's' : ''} for ${info.patient_id} (last ${fmtDate(info.last_seen)})` +
        (filled.length ? ` — filled ${filled.join(', ')}` : ''))
    } catch { /* new patient: nothing to fill */ }
  }

  const set = (k, v) => setPatient((p) => ({ ...p, [k]: v }))
  const toggleSym = (s) => set('symptoms', patient.symptoms.includes(s) ? patient.symptoms.filter((x) => x !== s) : [...patient.symptoms, s])
  // Copy the FileList right away: the picker's list is live and is emptied when the input is reset
  const addFiles = (list) => {
    const picked = Array.from(list || [])
    if (!picked.length) return
    setFiles((f) => [...f, ...picked])
    fillFromFiles(picked)
  }
  // Some ECG files carry the patient's age/sex (WFDB header comments, JSON fields)
  const fillFromFiles = async (picked) => {
    const found = []
    for (const f of picked) {
      const d = await readDemographics(f)
      if (d.age != null || d.sex) found.push({ name: f.name, ...d })
    }
    if (!found.length) return
    const stems = new Set(picked.map((f) => f.name.replace(/\.[^.]+$/, '')))
    if (stems.size > 1) {
      setAutofill("Some of these files include age/sex — each case will use its own file's values where the form is left empty.")
      return
    }
    const d = found[0]
    const fill = {}
    if (patient.age === '' && d.age != null) fill.age = String(d.age)
    if (!patient.sex && d.sex) fill.sex = d.sex
    const filledAny = Object.keys(fill).length > 0
    if (filledAny) setPatient((p) => ({ ...p, ...fill }))
    const what = [d.age != null && `age ${d.age}`, d.sex && (d.sex === 'F' ? 'female' : 'male')].filter(Boolean).join(', ')
    setAutofill(`Read from ${d.name}: ${what}` + (filledAny ? '' : ' (form already filled — kept your values)'))
  }
  const cleanPatient = () => ({ ...patient, age: patient.age === '' ? null : Number(patient.age) })

  const records = toRecords(files)
  const valid = records.filter((r) => !r.problem)
  const removeRecord = (rec) => setFiles(files.filter((_, j) => !rec.idx.includes(j)))
  const clearLast = () => { sessionStorage.removeItem(LAST_UPLOAD_KEY); setLast(null) }

  const run = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await api.analyzeFiles(files, cleanPatient())
      const entry = { at: Date.now(), results: r }
      sessionStorage.setItem(LAST_UPLOAD_KEY, JSON.stringify(entry))
      setLast(entry); setFiles([]); onDone?.()
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
    <div>
      <div className="page-head">
        <div>
          <h2>New ECG analysis</h2>
          <p>Upload one or more 12-lead ECG recordings. Each file becomes a case in your review queue.</p>
        </div>
      </div>

      {health && !health.model_ready && <div className="disclaimer" style={{ marginBottom: 16 }}><AlertCircle size={16} />The model is not trained yet. Run <span className="mono">python -m ml.train</span> first.</div>}

      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <Card title="Patient context" sub="Optional — symptoms raise review priority. Use anonymised IDs only.">
          <div className="grid" style={{ gap: 12 }}>
            {autofill && (
              <div className="autofill-note" role="status">
                <Info size={14} aria-hidden="true" /><span>{autofill}</span>
                <button type="button" className="btn sm ghost" aria-label="Dismiss" onClick={() => setAutofill(null)}><X size={12} /></button>
              </div>
            )}
            <label className="field">Patient ID<input className="input" placeholder="e.g. PT-2041" value={patient.patient_id}
              onChange={(e) => set('patient_id', e.target.value)} onBlur={lookupPatient}
              title="Returning patient? Their last known age, sex and facility are filled in" /></label>
            <div className="grid g-2" style={{ gap: 10 }}>
              <label className="field">Age<input className="input" type="number" min="0" max="120" value={patient.age} onChange={(e) => set('age', e.target.value)} /></label>
              <label className="field">Sex
                <select className="input" value={patient.sex} onChange={(e) => set('sex', e.target.value)}>
                  <option value="">—</option><option value="M">Male</option><option value="F">Female</option>
                </select>
              </label>
            </div>
            <fieldset className="field symptom-field">
              <legend>Presenting symptoms</legend>
              <div className="row wrap" style={{ gap: 6 }}>
                {SYMPTOMS.map((s) => <button type="button" key={s} className={`chip ${patient.symptoms.includes(s) ? 'on' : ''}`}
                  aria-pressed={patient.symptoms.includes(s)} onClick={() => toggleSym(s)}>{s}</button>)}
              </div>
            </fieldset>
            <label className="field">Referring facility
              <input className="input" list="facility-options" placeholder={facilities.length ? 'Choose a past facility or type a new one' : 'e.g. District Clinic A'}
                value={patient.facility} onChange={(e) => set('facility', e.target.value)} autoComplete="off" />
              <datalist id="facility-options">{facilities.map((f) => <option key={f} value={f} />)}</datalist>
            </label>
            <div className="field">
              <div className="notes-head">
                <label htmlFor="clinical-notes">Clinical notes</label>
                {dictation.supported && (
                  <button type="button" className={`btn sm ${dictation.listening ? 'recording' : ''}`} onClick={dictation.toggle}
                    title="Speak your notes. Age, sex and symptoms you mention (e.g. “62-year-old man with chest pain”) are also filled in above. In Chrome, speech is transcribed by Google — don't say identifiable details.">
                    {dictation.listening ? <><MicOff size={14} /> Stop</> : <><Mic size={14} /> Dictate</>}
                  </button>
                )}
              </div>
              <textarea id="clinical-notes" className="input" rows={3} value={patient.notes} onChange={(e) => set('notes', e.target.value)}
                placeholder={dictation.supported ? 'Type, or press Dictate and speak' : undefined} />
              {dictation.listening && (
                <div className="dictation-live" role="status">
                  <span className="rec-dot" aria-hidden="true" /> Listening… {dictation.interim
                    ? <em>“{dictation.interim}”</em>
                    : <span className="muted">age, sex and symptoms you mention are filled in above</span>}
                </div>
              )}
              {dictation.error && <div className="autofill-note warn" role="status"><AlertTriangle size={14} /><span>{dictation.error}</span></div>}
            </div>
          </div>
        </Card>

        <Card title="Upload ECG files" sub="Digital 12-lead ECG recordings. Each ECG becomes a case in your review queue." className="span-2">
          <div className="format-guide">
            <div className="format-guide-head">
              <strong>Accepted files</strong>
              <span>All 12 standard leads (I, II, III, aVR, aVL, aVF, V1–V6), ideally 10 seconds, any sampling rate</span>
            </div>
            <ul className="format-list">
              {FORMATS.map((f) => (
                <li key={f.name}>
                  <span className="format-ext">{f.ext.map((e) => <code key={e}>{e}</code>)}</span>
                  <span><strong>{f.name}</strong> — {f.how}</span>
                </li>
              ))}
            </ul>
            <div className="format-no"><Ban size={13} aria-hidden="true" /> Not supported: photos, scans or PDFs of paper ECGs, and single-lead smartwatch exports.</div>
          </div>

          <div className={`dropzone ${drag ? 'drag' : ''}`} role="button" tabIndex={0}
            aria-label="Choose ECG files to upload"
            onClick={(e) => { if (e.target !== inputRef.current) inputRef.current.click() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current.click() }
            }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}>
            <FileUp size={34} color="var(--accent)" />
            <div style={{ fontWeight: 600, marginTop: 10 }}>Drop ECG files here or click to browse</div>
            <div className="muted small" style={{ marginTop: 4 }}>Several ECGs at once are fine — try the examples in <span className="mono">sample_uploads/</span></div>
            <input ref={inputRef} type="file" multiple hidden aria-label="ECG files" accept={ACCEPT}
              onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          </div>
          {records.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {records.map((r) => (
                <div key={r.key} className={`file-row ${r.problem ? 'bad' : ''}`}>
                  <div className="file-row-main">
                    <span className="row small">{r.problem ? <AlertTriangle size={14} className="file-warn" /> : <FileUp size={14} className="muted" />}
                      <span className="file-name">{r.label}</span>
                      <span className="muted">· {r.kind}{r.exts ? ` (${[...r.exts].sort().reverse().join(' + ')})` : ''} · {Math.max(1, Math.round(r.size / 1024))} KB</span>
                    </span>
                    {r.problem && <div className="file-problem">{r.problem}</div>}
                  </div>
                  <button type="button" className="btn sm ghost" aria-label={`Remove ${r.label}`}
                    onClick={() => removeRecord(r)}><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="row between" style={{ marginTop: 14 }}>
            <div className="small muted row"><ShieldAlert size={14} /> Prototype — not medical advice. Do not upload identifiable patient data.</div>
            <div className="row">
              {files.length > 0 && <button className="btn ghost" onClick={() => setFiles([])}><Trash2 size={14} /> Clear</button>}
              <button className="btn primary" disabled={!valid.length || busy || !health?.model_ready} onClick={run}
                title={records.length && !valid.length ? 'Fix or remove the files marked above' : undefined}>
                {busy ? <span className="spinner" /> : <Upload size={15} />} Analyse {valid.length > 0 ? `${valid.length} ECG${valid.length > 1 ? 's' : ''}` : ''}
              </button>
            </div>
          </div>
          {err && <ErrorState title="Analysis could not be completed" message="Check the selected ECG files and try again." detail={err} />}
          {last?.results?.length > 0 && (
            <div className="last-upload">
              <div className="row between">
                <div>
                  <h3 style={{ fontSize: 13, margin: 0 }}>Last upload · {new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</h3>
                  <div className="muted small">Click a result to open it. These cases are also in the review queue.</div>
                </div>
                <button className="btn sm ghost" onClick={clearLast} title="Removes this list only — the cases stay in the review queue">
                  <X size={13} /> Clear list
                </button>
              </div>
              <table className="table" style={{ marginTop: 8 }}>
                <tbody>
                  {last.results.map((r, i) => (
                    <tr key={i} className={r.case_id ? 'click' : ''} tabIndex={r.case_id ? 0 : undefined}
                      onKeyDown={(e) => { if (r.case_id && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(`#/case/${r.case_id}`) } }}
                      onClick={() => r.case_id && navigate(`#/case/${r.case_id}`)}>
                      <td className="small">{r.name}</td>
                      {r.error ? <td colSpan={3} style={{ color: 'var(--critical)' }} className="small">{r.error}</td> : (
                        <>
                          <td><Findings flagged={r.summary.flagged} category={r.summary.category} /></td>
                          <td><TriageBadge level={r.summary.triage.level} score={r.summary.triage.score} /></td>
                          <td className="num"><ChevronRight size={15} className="muted" aria-hidden="true" /></td>
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

      {demo && !demo.show ? (
        <div className="demo-hidden-note">
          <FlaskConical size={15} aria-hidden="true" />
          <span>The demo library of PTB-XL test ECGs is hidden while <strong>Demo data</strong> is off.</span>
          <button className="btn sm" onClick={() => demo.setShow(true)} title="Same as switching Demo data on in the sidebar — also shows demo cases on the dashboard and in the queue">Show demo library</button>
        </div>
      ) : (
      <Card title="Demo library — unseen PTB-XL test ECGs" icon={<FlaskConical size={16} color="var(--accent)" />}
        sub="Records from fold 10, which the model never saw during training. Ground-truth cardiologist labels are shown so you can compare with the AI."
        right={
          <div className="row wrap" style={{ gap: 6 }}>
            {['ALL', ...CLASSES, 'FAIL'].map((c) => (
              <button type="button" key={c} className={`chip ${filter === c ? 'on' : ''}`} aria-pressed={filter === c}
                onClick={() => setFilter(c)}>{c === 'ALL' ? 'All' : c === 'FAIL' ? 'Known failures' : c}</button>
            ))}
            {demo && (
              <button type="button" className="btn sm hide-library" onClick={() => demo.setShow(false)}
                title="Same as switching Demo data off in the sidebar — also hides demo cases on the dashboard and in the queue">
                <EyeOff size={13} /> Hide demo library
              </button>
            )}
          </div>
        }>
        {shown.length === 0 ? <div className="empty">No records match this filter.</div> : (
          <div className="table-scroll">
            <table className="table demo-table">
              <thead><tr><th scope="col">ECG record</th><th scope="col">Age / sex</th><th scope="col">Cardiologist label</th><th scope="col">Evaluation</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
              <tbody>{shown.map((s) => (
                <tr key={s.idx}>
                  <td className="mono">#{s.ecg_id}</td>
                  <td>{s.age ? `${Math.round(s.age)}y` : '—'} · {s.sex === 'F' ? 'Female' : 'Male'}</td>
                  <td>{s.true_labels.map((c) => <ClassTag key={c} code={c} />)}</td>
                  <td>{s.is_failure_case ? <span className="badge neutral" title="Among the model's largest test errors">Hard case</span> : <span className="muted">—</span>}</td>
                  <td className="action-cell">
                    <button className="btn sm" aria-label={`Analyse ECG ${s.ecg_id}`} disabled={busySample != null || !health?.model_ready} onClick={() => runSample(s)}>
                      {busySample === s.idx ? <span className="spinner" /> : <Play size={13} />} Analyse
                    </button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      )}
    </div>
  )
}
