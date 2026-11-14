import { useEffect, useState } from 'react'
import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip,
} from 'recharts'
import {
  ArrowLeft, BrainCircuit, CheckCircle2, ClipboardCheck, Eye, EyeOff, FileText, Gauge, HeartPulse,
  Printer, ShieldAlert, Stethoscope, Trash2, XCircle,
} from 'lucide-react'
import ECGViewer, { LeadDetail } from '../components/ECGViewer'
import { api, CLASSES, CLASS_COLORS, CLASS_NAMES, CLASS_SHORT, fmtDate, navigate, pct } from '../lib'
import { Card, ChartTip, ClassTag, ErrorState, TriageBadge } from '../components/ui'

const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']

export default function CaseDetail({ id, onChange }) {
  const [c, setC] = useState(null)
  const [err, setErr] = useState(null)
  const [layout, setLayout] = useState('clinical')
  const [showSal, setShowSal] = useState(true)
  const [lead, setLead] = useState('II')
  const [review, setReview] = useState({ labels: [], notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setC(null)
    api.case(id).then((d) => {
      setC(d)
      const r = d.result
      setReview({ labels: d.review.doctor_labels || (r.flagged.length ? r.flagged : r.category === 'normal' ? ['NORM'] : []), notes: d.review.notes || '' })
      const top = r.findings.find((f) => f.code === r.focus_class)?.top_leads?.[0]
      if (top) setLead(top)
    }).catch((e) => setErr(e.message))
  }, [id])

  if (err) return <ErrorState title="Case could not be loaded" message="The case details are currently unavailable." detail={err} />
  if (!c) return <div className="empty"><span className="spinner" /></div>
  const r = c.result
  const ai = r.flagged.length ? r.flagged : r.category === 'normal' ? ['NORM'] : []
  const focus = r.findings.find((f) => f.code === r.focus_class)
  const radar = r.findings.map((f) => ({ name: CLASS_SHORT[f.code], probability: Math.round(f.probability * 100), threshold: Math.round(f.threshold * 100) }))
  const gt = c.ground_truth

  const save = async (agrees) => {
    setSaving(true)
    try {
      const labels = agrees ? ai : review.labels
      const d = await api.review(c.id, { status: 'reviewed', doctor_labels: labels, agrees: agrees ?? (JSON.stringify([...labels].sort()) === JSON.stringify([...ai].sort())), notes: review.notes })
      setC(d); onChange?.()
    } finally { setSaving(false) }
  }
  const del = async () => { if (confirm('Delete this case?')) { await api.del(c.id); onChange?.(); navigate('#/queue') } }

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn sm ghost no-print" onClick={() => history.back()} style={{ marginBottom: 8 }}><ArrowLeft size={14} /> Back</button>
          <h2 className="row">Case {c.patient?.patient_id || c.id} <TriageBadge level={r.triage.level} score={r.triage.score} large /></h2>
          <p>
            {c.patient?.age ? `${Math.round(c.patient.age)} y` : 'Age —'} · {c.patient?.sex === 'F' ? 'Female' : c.patient?.sex === 'M' ? 'Male' : 'Sex —'}
            {c.patient?.facility ? ` · ${c.patient.facility}` : ''} · {c.source} · received {fmtDate(c.created_at)}
          </p>
        </div>
        <div className="row no-print">
          <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print report</button>
          <button className="btn danger ghost" aria-label="Delete case" onClick={del}><Trash2 size={15} /></button>
        </div>
      </div>

      {/* --- headline row --- */}
      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <div className={`triage-hero ${r.triage.level} span-2`}>
          <div className="small text-2" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>AI interpretation</div>
          <div style={{ fontSize: 22, fontWeight: 650, margin: '6px 0 10px' }}>{r.headline}</div>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            {r.findings.filter((f) => f.positive || (f.code === 'NORM' && r.category === 'normal')).map((f) => (
              <span key={f.code} className="badge neutral"><span className="cls-dot" style={{ background: CLASS_COLORS[f.code] }} />{f.name} · {pct(f.probability)}</span>
            ))}
          </div>
          <div className="text-2" style={{ lineHeight: 1.6 }}><strong style={{ color: 'var(--text)' }}>Suggested action: </strong>{r.triage.suggested_action}</div>
          <div className="row wrap small" style={{ marginTop: 10, gap: 6 }}>
            {r.triage.reasons.map((x, i) => <span key={i} className="chip" style={{ cursor: 'default' }}>{x}</span>)}
          </div>
        </div>
        <div className="case-metrics">
          <Mini icon={<HeartPulse size={16} />} label="Heart rate" value={r.rhythm.heart_rate ? `${Math.round(r.rhythm.heart_rate)} bpm` : '—'} hint={r.rhythm.rhythm_note} />
          <Mini icon={<Gauge size={16} />} label="Signal quality" value={`${Math.round(r.quality.score)}/100`} hint={r.quality.grade} warn={r.quality.grade === 'poor'} />
          <Mini icon={<BrainCircuit size={16} />} label="Model agreement" value={focus ? `${Math.round(focus.model_votes * 100)}%` : '—'} hint={`${r.ensemble_size} models · ${focus ? CLASS_SHORT[focus.code] : ''}`} />
          <Mini icon={<Stethoscope size={16} />} label="RR variability" value={r.rhythm.rr_sdnn_ms != null ? `${Math.round(r.rhythm.rr_sdnn_ms)} ms` : '—'} hint={r.rhythm.irregular ? 'Irregular' : 'Regular'} warn={r.rhythm.irregular} />
        </div>
      </div>

      {/* --- ECG --- */}
      <Card title="12-lead ECG" sub="25 mm/s · 10 mm/mV · band-pass 0.5–40 Hz shown raw. Amber shading = regions that most influenced the AI's leading finding. Click a lead to inspect it."
        style={{ marginBottom: 16 }}
        right={
          <div className="row no-print">
            <div className="seg">
              <button className={layout === 'clinical' ? 'on' : ''} onClick={() => setLayout('clinical')}>3×4 + rhythm</button>
              <button className={layout === 'stack' ? 'on' : ''} onClick={() => setLayout('stack')}>12 × 10 s</button>
            </div>
            <button className={`btn sm ${showSal ? '' : 'ghost'}`} onClick={() => setShowSal(!showSal)}>
              {showSal ? <Eye size={14} /> : <EyeOff size={14} />} AI attention
            </button>
          </div>
        }>
        <div className="ecg-wrap">
          <ECGViewer signal={r.signal} saliency={r.saliency} fs={r.fs} layout={layout} showSaliency={showSal}
            highlight={focus?.top_leads || []} selected={lead} onSelect={setLead} rPeaks={r.rhythm.r_peaks} />
        </div>
        <div className="row between" style={{ marginTop: 14 }}>
          <div className="row"><strong>Lead {lead}</strong><span className="muted small">— full 10 s, teal markers = detected beats</span></div>
          <div className="row wrap no-print" style={{ gap: 4 }}>
            {LEADS.map((l) => <button type="button" key={l} className={`chip ${lead === l ? 'on' : ''}`}
              aria-pressed={lead === l} style={{ padding: '3px 8px' }} onClick={() => setLead(l)}>{l}</button>)}
          </div>
        </div>
        <div className="ecg-wrap" style={{ marginTop: 8 }}>
          <LeadDetail signal={r.signal} saliency={showSal ? r.saliency : null} lead={lead} fs={r.fs} rPeaks={r.rhythm.r_peaks} />
        </div>
      </Card>

      {/* --- probabilities + radar + lead importance --- */}
      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <Card title="Diagnostic probabilities" className="span-2"
          sub="Bar = ensemble probability · white tick = decision threshold (tuned on validation set) · dots = individual models">
          {r.findings.map((f) => (
            <div key={f.code} className="prob-row">
              <div>
                <div className="row" style={{ gap: 6 }}><span className="cls-dot" style={{ background: CLASS_COLORS[f.code] }} /><strong className="small">{f.name}</strong></div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{f.positive ? 'Flagged' : 'Not flagged'} · {f.confidence} confidence</div>
              </div>
              <div className="prob-track" title={f.description}>
                <div className="prob-fill" style={{ width: `${f.probability * 100}%`, background: CLASS_COLORS[f.code], opacity: f.positive ? 1 : 0.45 }} />
                <div className="prob-th" style={{ left: `${f.threshold * 100}%` }} title={`threshold ${pct(f.threshold)}`} />
                {f.per_model.map((p, i) => <div key={i} className="prob-dot" style={{ left: `${p * 100}%` }} title={`model ${i + 1}: ${pct(p, 1)}`} />)}
              </div>
              <div style={{ textAlign: 'right', fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{pct(f.probability)}</div>
            </div>
          ))}
          <div className="muted small" style={{ marginTop: 10 }}>
            On held-out test data, when the model flags a category it is right {focus && focus.code !== 'NORM' ? pct(focus.test_ppv) : '—'} of the time for {focus ? CLASS_SHORT[focus.code] : ''}, and it catches {focus ? pct(focus.test_sensitivity) : '—'} of true cases.
          </div>
        </Card>
        <Card title="Probability profile" sub="Ensemble output vs. thresholds (%)">
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radar} outerRadius="72%">
              <PolarGrid stroke="#2a2f3a" />
              <PolarAngleAxis dataKey="name" tick={{ fill: '#b6bcc8', fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar isAnimationActive={false} name="Threshold" dataKey="threshold" stroke="#8a909c" strokeDasharray="4 3" fill="none" strokeWidth={1.5} />
              <Radar isAnimationActive={false} name="Probability" dataKey="probability" stroke="#45b8c8" fill="#45b8c8" fillOpacity={0.25} strokeWidth={2} />
              <Tooltip content={<ChartTip fmt={(v) => `${v}%`} />} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <Card title="Lead importance" sub="Share of model attribution per lead, for each category. Darker = more influential." className="span-2">
          <div style={{ display: 'grid', gridTemplateColumns: `90px repeat(12, 1fr)`, gap: 3 }}>
            <div />
            {LEADS.map((l) => <div key={l} className="small muted" style={{ textAlign: 'center' }}>{l}</div>)}
            {CLASSES.map((cl) => {
              const row = r.lead_importance[cl]
              const mx = Math.max(...row)
              return [
                <div key={cl} className="small row" style={{ gap: 6 }}><span className="cls-dot" style={{ background: CLASS_COLORS[cl] }} />{CLASS_SHORT[cl]}</div>,
                ...row.map((v, i) => (
                  <div key={cl + i} className="heat-cell" title={`${CLASS_NAMES[cl]} · ${LEADS[i]}: ${(v * 100).toFixed(1)}%`}
                    style={{ background: `rgba(69,184,200,${0.08 + 0.75 * (v / mx)})` }}>{(v * 100).toFixed(0)}</div>
                )),
              ]
            })}
          </div>
        </Card>
        <Card title="Signal quality by lead" sub={r.quality.issues.length ? `${r.quality.issues.length} issue(s) detected` : 'No quality issues detected'}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {r.quality.per_lead.map((q) => (
              <div key={q.lead} className={`quality-cell ${q.score >= 85 ? 'good' : q.score >= 65 ? 'limited' : 'poor'}`}
                title={q.issues.join(', ') || 'OK'}>
                <div className="small muted">{q.lead}</div>
                <div style={{ fontWeight: 650 }}>{Math.round(q.score)}</div>
              </div>
            ))}
          </div>
          {r.quality.issues.length > 0 && <ul className="small text-2" style={{ paddingLeft: 18, marginBottom: 0 }}>{r.quality.issues.slice(0, 6).map((i) => <li key={i}>{i}</li>)}</ul>}
          <div className="small muted" style={{ marginTop: 10 }}>Input: {r.original_samples} samples @ {r.original_fs} Hz → resampled to {r.fs} Hz.</div>
        </Card>
      </div>

      {/* --- narrative + review --- */}
      <div className="grid g-2">
        <Card title="AI report" icon={<FileText size={16} color="var(--accent)" />}>
          <p style={{ lineHeight: 1.7, color: 'var(--text-2)', marginTop: 4 }}>{r.narrative}</p>
          {r.uncertain.length > 0 && <div className="model-note"><ShieldAlert size={16} aria-hidden="true" />Borderline outputs: {r.uncertain.map((u) => CLASS_SHORT[u]).join(', ')}. The models disagree or the probability is close to the threshold.</div>}
          {gt && (
            <div className="row" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
              <span className="small muted">PTB-XL cardiologist label:</span>
              {gt.map((g) => <ClassTag key={g} code={g} />)}
              {(() => {
                const match = JSON.stringify([...gt].sort()) === JSON.stringify([...ai].sort())
                return <span className={`badge ${match ? 'routine' : 'priority'}`} style={{ marginLeft: 'auto' }}>{match ? 'AI matches' : 'AI differs'}</span>
              })()}
            </div>
          )}
          <div className="disclaimer" style={{ marginTop: 12 }}><ShieldAlert size={16} />This project is a prototype and is not medical advice. The AI assists prioritisation; a qualified clinician must make the final interpretation.</div>
        </Card>

        <Card title="Clinician review" icon={<ClipboardCheck size={16} color="var(--accent)" />}
          right={c.review.status === 'reviewed' ? <span className="badge routine"><CheckCircle2 size={13} /> Reviewed {fmtDate(c.review.reviewed_at)}</span> : <span className="badge neutral">Pending</span>}>
          <div className="small muted" style={{ marginBottom: 6 }}>Your interpretation (select all that apply)</div>
          <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
            {CLASSES.map((cl) => {
              const on = review.labels.includes(cl)
              return (
                <button type="button" key={cl} className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
                  onClick={() => setReview((rv) => ({ ...rv, labels: on ? rv.labels.filter((x) => x !== cl) : [...rv.labels, cl] }))}>
                  <span className="cls-dot" style={{ background: CLASS_COLORS[cl] }} />{CLASS_NAMES[cl]}
                </button>
              )
            })}
          </div>
          <textarea className="input" rows={4} placeholder="Notes, management plan, referral decision…" value={review.notes} onChange={(e) => setReview({ ...review, notes: e.target.value })} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={saving} onClick={() => save(true)}><CheckCircle2 size={15} /> Agree with AI</button>
            <button className="btn" disabled={saving} onClick={() => save(null)}><XCircle size={15} /> Save my interpretation</button>
          </div>
          {c.review.status === 'reviewed' && (
            <div className="small text-2" style={{ marginTop: 12 }}>
              Recorded: {c.review.agrees ? 'agrees with AI' : 'differs from AI'} · {(c.review.doctor_labels || []).map((x) => CLASS_SHORT[x]).join(', ') || 'no labels'}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Mini({ icon, label, value, hint, warn }) {
  return (
    <div className={`case-metric ${warn ? 'warn' : ''}`}>
      <div className="case-metric-label"><span>{icon}</span>{label}</div>
      <div className="case-metric-value">{value}</div>
      <div className="case-metric-hint">{hint}</div>
    </div>
  )
}
