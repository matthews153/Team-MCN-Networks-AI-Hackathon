import { useMemo, useState } from 'react'
import { Download, Search, Trash2 } from 'lucide-react'
import { api, CLASSES, CLASS_COLORS, CLASS_SHORT, TRIAGE, fmtDate, navigate } from '../lib'
import { Card, Findings, TriageBadge } from '../components/ui'

export default function Queue({ cases, onChange }) {
  const [level, setLevel] = useState('all')
  const [status, setStatus] = useState('pending')
  const [finding, setFinding] = useState('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('priority')

  const rows = useMemo(() => {
    let r = cases.filter((c) =>
      (level === 'all' || c.triage.level === level) &&
      (status === 'all' || (status === 'pending' ? c.review.status !== 'reviewed' : c.review.status === 'reviewed')) &&
      (finding === 'all' || (finding === 'NORM' ? c.category === 'normal' : c.flagged.includes(finding))) &&
      (!q || JSON.stringify([c.patient, c.source]).toLowerCase().includes(q.toLowerCase())))
    r = [...r].sort((a, b) => sort === 'priority'
      ? TRIAGE[a.triage.level].order - TRIAGE[b.triage.level].order || b.triage.score - a.triage.score
      : sort === 'newest' ? b.created_at - a.created_at : a.quality.score - b.quality.score)
    return r
  }, [cases, level, status, finding, q, sort])

  const exportCsv = () => {
    const head = ['case_id', 'patient_id', 'age', 'sex', 'priority', 'score', 'findings', ...CLASSES.map((c) => `p_${c}`), 'quality', 'hr', 'review_status', 'doctor_labels', 'agrees', 'received']
    const lines = rows.map((c) => [c.id, c.patient?.patient_id || '', c.patient?.age ?? '', c.patient?.sex || '', c.triage.level, c.triage.score, c.flagged.join('|'),
      ...CLASSES.map((k) => c.probs[k].toFixed(3)), c.quality.score, c.heart_rate ?? '', c.review.status, (c.review.doctor_labels || []).join('|'), c.review.agrees ?? '', new Date(c.created_at * 1000).toISOString()].join(','))
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cardiolens_queue.csv'; a.click()
  }
  const clearAll = async () => { if (confirm('Delete ALL cases?')) { await api.clear(); onChange?.() } }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Review queue</h2>
          <p>Cases ranked by AI review priority. Urgent cases float to the top so nothing time-critical gets buried.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={exportCsv}><Download size={15} /> Export CSV</button>
          <button className="btn danger ghost" onClick={clearAll}><Trash2 size={15} /> Clear all</button>
        </div>
      </div>

      <div className="queue-filters">
        <div className="filter-group">
          <span className="filter-label">Review status</span>
          <div className="seg">
            {['pending', 'reviewed', 'all'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Review priority</span>
          <div className="seg">
            {['all', 'urgent', 'priority', 'routine'].map((l) => <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l === 'all' ? 'All levels' : TRIAGE[l].label}</button>)}
          </div>
        </div>
        <label className="filter-select">
          <span className="filter-label">Finding</span>
          <select className="input" value={finding} onChange={(e) => setFinding(e.target.value)}>
            <option value="all">All findings</option>
            {CLASSES.map((c) => <option key={c} value={c}>{CLASS_SHORT[c]}</option>)}
          </select>
        </label>
        <label className="filter-select sort-select">
          <span className="filter-label">Sort by</span>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="priority">Review priority</option><option value="newest">Newest first</option><option value="quality">Lowest signal quality</option>
          </select>
        </label>
        <div className="queue-search">
          <Search size={14} aria-hidden="true" />
          <input className="input" aria-label="Search patient, facility, or source" placeholder="Search patient, facility, source…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Card>
        {rows.length === 0 ? <div className="empty">No cases match these filters.</div> : (
          <table className="table">
            <thead>
              <tr><th>Priority</th><th>Patient</th><th>AI interpretation</th><th>Probabilities</th><th>Symptoms</th><th className="num">HR</th><th className="num">Quality</th><th>Status</th><th>Received</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="click" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`#/case/${c.id}`) } }}
                  onClick={() => navigate(`#/case/${c.id}`)}>
                  <td><TriageBadge level={c.triage.level} score={c.triage.score} /></td>
                  <td><strong>{c.patient?.patient_id || c.id}</strong><div className="muted small">{c.patient?.age ? `${Math.round(c.patient.age)}y` : ''} {c.patient?.sex || ''} {c.patient?.facility ? `· ${c.patient.facility}` : ''}</div></td>
                  <td><Findings flagged={c.flagged} category={c.category} />{c.uncertain.length > 0 && c.flagged.length > 0 && <div className="muted" style={{ fontSize: 11 }}>uncertain: {c.uncertain.join(', ')}</div>}</td>
                  <td><Spark probs={c.probs} /></td>
                  <td className="small text-2" style={{ maxWidth: 170 }}>{c.patient?.symptoms?.length ? c.patient.symptoms.join(', ') : '—'}</td>
                  <td className="num">{c.heart_rate ? Math.round(c.heart_rate) : '—'}</td>
                  <td className="num" style={{ color: c.quality.grade === 'poor' ? 'var(--critical)' : undefined }}>{Math.round(c.quality.score)}</td>
                  <td>{c.review.status === 'reviewed'
                    ? <span className={`badge ${c.review.agrees ? 'routine' : 'priority'}`}>{c.review.agrees ? 'Agreed' : 'Overridden'}</span>
                    : <span className="badge neutral">Pending</span>}</td>
                  <td className="muted small">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function Spark({ probs }) {
  return (
    <div className="row" style={{ gap: 3, alignItems: 'flex-end', height: 26 }} title={CLASSES.map((c) => `${c} ${(probs[c] * 100).toFixed(0)}%`).join(' · ')}>
      {CLASSES.map((c) => (
        <div key={c} style={{ width: 9, height: Math.max(2, probs[c] * 26), background: CLASS_COLORS[c], borderRadius: '3px 3px 0 0' }} />
      ))}
    </div>
  )
}
