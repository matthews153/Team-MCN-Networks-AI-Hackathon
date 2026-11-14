import { useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Activity, AlertOctagon, Clock, FlaskConical, Gauge, Stethoscope, Upload, Users } from 'lucide-react'
import { api, CLASSES, CLASS_COLORS, CLASS_NAMES, CLASS_SHORT, TRIAGE, navigate, timeAgo } from '../lib'
import { axisProps, Card, ChartTip, Findings, gridProps, Kpi, Legend, TriageBadge } from '../components/ui'

const DAY = 86400

export default function Dashboard({ cases, demo, health, onChange }) {
  const [seeding, setSeeding] = useState(false)
  const [range, setRange] = useState(7)

  const scoped = useMemo(() => cases.filter((c) => c.created_at >= Date.now() / 1000 - range * DAY), [cases, range])

  const stats = useMemo(() => {
    const pending = scoped.filter((c) => c.review.status !== 'reviewed')
    const urgentPending = pending.filter((c) => c.triage.level === 'urgent')
    const reviewed = scoped.filter((c) => c.review.status === 'reviewed' && c.review.agrees != null)
    const agree = reviewed.length ? reviewed.filter((c) => c.review.agrees).length / reviewed.length : null
    const tats = scoped.filter((c) => c.review.reviewed_at).map((c) => (c.review.reviewed_at - c.created_at) / 60).sort((a, b) => a - b)
    const medTat = tats.length ? tats[Math.floor(tats.length / 2)] : null
    const q = scoped.length ? scoped.reduce((s, c) => s + c.quality.score, 0) / scoped.length : null
    const abnormal = scoped.filter((c) => c.flagged.length).length

    // volume per day, stacked by triage level
    const days = []
    const today = new Date(); today.setHours(0, 0, 0, 0)
    for (let i = range - 1; i >= 0; i--) {
      const d0 = today.getTime() / 1000 - i * DAY
      const inDay = scoped.filter((c) => c.created_at >= d0 && c.created_at < d0 + DAY)
      days.push({
        day: new Date(d0 * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric' }),
        urgent: inDay.filter((c) => c.triage.level === 'urgent').length,
        priority: inDay.filter((c) => c.triage.level === 'priority').length,
        routine: inDay.filter((c) => c.triage.level === 'routine').length,
      })
    }
    const triage = ['urgent', 'priority', 'routine'].map((l) => ({
      level: l, name: TRIAGE[l].label, value: scoped.filter((c) => c.triage.level === l).length, fill: TRIAGE[l].color,
    }))
    const findings = CLASSES.map((c) => ({
      code: c, name: CLASS_SHORT[c],
      value: c === 'NORM' ? scoped.filter((x) => x.category === 'normal').length : scoped.filter((x) => x.flagged.includes(c)).length,
    }))
    const ageBins = ['<40', '40–59', '60–74', '75+']
    const binOf = (a) => (a == null ? null : a < 40 ? 0 : a < 60 ? 1 : a < 75 ? 2 : 3)
    const byAge = ageBins.map((b, i) => {
      const row = { bin: b }
      const inBin = scoped.filter((c) => binOf(Number(c.patient?.age)) === i)
      for (const k of CLASSES.slice(1)) row[k] = inBin.filter((c) => c.flagged.includes(k)).length
      row.total = inBin.length
      return row
    })
    const scoreHist = Array.from({ length: 10 }, (_, i) => ({
      bin: `${i * 10}–${i * 10 + 10}`, n: scoped.filter((c) => Math.min(9, Math.floor(c.triage.score / 10)) === i).length,
    }))
    const worklist = [...pending].sort((a, b) => TRIAGE[a.triage.level].order - TRIAGE[b.triage.level].order || b.triage.score - a.triage.score).slice(0, 7)
    return { pending, urgentPending, agree, reviewed, medTat, q, abnormal, days, triage, findings, byAge, scoreHist, worklist }
  }, [scoped, range])

  const seed = async () => {
    setSeeding(true)
    try { await api.seed(); demo?.setShow(true); await onChange() } finally { setSeeding(false) }
  }

  if (!cases.length) {
    return (
      <div>
        <Head />
        <div className="empty-workspace">
          <div>
            <h3>{demo && !demo.show && demo.count ? 'No real patient ECGs yet' : 'No ECGs analysed yet'}</h3>
            <p>{demo && !demo.show && demo.count
              ? `${demo.count} demo case${demo.count === 1 ? ' is' : 's are'} hidden. Upload a 12-lead ECG to start your real review queue, or switch "Demo data" on in the sidebar.`
              : 'Upload a 12-lead ECG to start a review queue, or load cases built from unseen PTB-XL test records.'}</p>
          </div>
          <div className="row empty-actions">
            <button className="btn primary" onClick={() => navigate('#/analyze')}><Upload size={15} /> Analyse an ECG</button>
            <button className="btn" onClick={demo && !demo.show && demo.count ? () => demo.setShow(true) : seed} disabled={seeding || !health?.model_ready}>
              {seeding ? <span className="spinner" /> : <FlaskConical size={15} />} {demo && !demo.show && demo.count ? 'Show demo cases' : 'Load demo cases'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const total = scoped.length
  return (
    <div>
      <Head right={
        <div className="row">
          <div className="seg">
            {[1, 7, 30].map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r === 1 ? 'Today' : `Last ${r} days`}</button>)}
          </div>
          <button className="btn primary" onClick={() => navigate('#/analyze')}><Upload size={15} /> New analysis</button>
        </div>
      } />

      {stats.urgentPending.length > 0 && (
        <a href="#/queue" className="triage-hero urgent row between" style={{ marginBottom: 16, color: 'inherit' }}>
          <div className="row">
            <AlertOctagon color="var(--critical)" />
            <div>
              <strong>{stats.urgentPending.length} urgent ECG{stats.urgentPending.length > 1 ? 's' : ''} awaiting your review</strong>
              <div className="small text-2">Flagged for possible MI or multiple co-existing abnormalities. Open the review queue →</div>
            </div>
          </div>
        </a>
      )}

      <div className="section-heading"><h3>Current workload</h3></div>
      <div className="grid g-6 metric-grid" style={{ marginBottom: 16 }}>
        <Kpi label="ECGs analysed" value={total} hint={`${stats.abnormal} abnormal (${total ? Math.round((stats.abnormal / total) * 100) : 0}%)`} icon={<Activity size={18} />} />
        <Kpi label="Urgent, unreviewed" value={stats.urgentPending.length} hint="Needs immediate attention" icon={<AlertOctagon size={16} />} />
        <Kpi label="Awaiting review" value={stats.pending.length} hint={`${total - stats.pending.length} reviewed`} icon={<Users size={16} />} />
        <Kpi label="AI–clinician agreement" value={stats.agree == null ? '—' : `${Math.round(stats.agree * 100)}%`} hint={`${stats.reviewed.length} reviewed cases`} icon={<Stethoscope size={16} />} />
        <Kpi label="Median time to review" value={stats.medTat == null ? '—' : stats.medTat < 60 ? `${Math.round(stats.medTat)}m` : `${(stats.medTat / 60).toFixed(1)}h`} hint="Upload → clinician sign-off" icon={<Clock size={16} />} />
        <Kpi label="Avg signal quality" value={stats.q == null ? '—' : Math.round(stats.q)} hint="0–100 heuristic score" icon={<Gauge size={18} />} />
      </div>

      <div className="section-heading"><h3>Volume and priority</h3></div>
      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <Card title="ECG volume by review priority" sub="Cases received per day, stacked by AI triage level" className="span-2">
          <Legend items={['urgent', 'priority', 'routine'].map((l) => ({ label: TRIAGE[l].label, color: TRIAGE[l].color }))} />
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={stats.days} barCategoryGap="28%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="day" {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} width={28} />
              <Tooltip cursor={{ fill: 'rgba(23,87,101,0.05)' }} content={<ChartTip />} />
              <Bar isAnimationActive={false} dataKey="routine" name="Routine" stackId="a" fill={TRIAGE.routine.color} stroke="var(--surface)" strokeWidth={2} />
              <Bar isAnimationActive={false} dataKey="priority" name="Priority" stackId="a" fill={TRIAGE.priority.color} stroke="var(--surface)" strokeWidth={2} />
              <Bar isAnimationActive={false} dataKey="urgent" name="Urgent" stackId="a" fill={TRIAGE.urgent.color} stroke="var(--surface)" strokeWidth={2} radius={0} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Cases by review priority" sub="Current selection · all review statuses">
          <div className="priority-breakdown">
            {stats.triage.map((t) => {
              const share = total ? Math.round((t.value / total) * 100) : 0
              return (
                <div className="priority-row" key={t.level}>
                  <TriageBadge level={t.level} />
                  <div className="priority-track" role="meter" aria-label={`${t.name} share of cases`}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
                    <span style={{ width: `${share}%`, background: t.fill }} />
                  </div>
                  <strong className="priority-count">{t.value}</strong>
                  <span className="priority-percent">{share}%</span>
                </div>
              )
            })}
          </div>
          <div className="priority-total">{total.toLocaleString()} ECGs in this period</div>
        </Card>
      </div>

      <div className="section-heading"><h3>Review queue</h3></div>
      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <Card title="Urgent worklist" sub="Unreviewed cases, highest AI priority first" className="span-2"
          right={<button className="btn sm ghost" onClick={() => navigate('#/queue')}>Open queue →</button>}>
          {stats.worklist.length === 0 ? <div className="empty">All caught up — no pending cases.</div> : (
            <table className="table">
              <thead><tr><th>Priority</th><th>Patient</th><th>AI findings</th><th>Symptoms</th><th className="num">HR</th><th>Received</th></tr></thead>
              <tbody>
                {stats.worklist.map((c) => (
                  <tr key={c.id} className="click" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`#/case/${c.id}`) } }}
                    onClick={() => navigate(`#/case/${c.id}`)}>
                    <td><TriageBadge level={c.triage.level} score={c.triage.score} /></td>
                    <td><strong>{c.patient?.patient_id || '—'}</strong><div className="muted small">{c.patient?.age ? `${Math.round(c.patient.age)}y` : ''} {c.patient?.sex || ''}</div></td>
                    <td><Findings flagged={c.flagged} category={c.category} /></td>
                    <td className="small text-2">{c.patient?.symptoms?.length ? c.patient.symptoms.join(', ') : '—'}</td>
                    <td className="num">{c.heart_rate ? Math.round(c.heart_rate) : '—'}</td>
                    <td className="muted small">{timeAgo(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Finding frequency" sub="Cases flagged per diagnostic category">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.findings} layout="vertical" margin={{ left: 10, right: 24 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" allowDecimals={false} {...axisProps} />
              <YAxis type="category" dataKey="name" {...axisProps} width={80} />
              <Tooltip cursor={{ fill: 'rgba(23,87,101,0.05)' }} content={<ChartTip fmt={(v) => `${v} cases`} />} />
              <Bar isAnimationActive={false} dataKey="value" name="Cases" radius={0} barSize={18} label={{ position: 'right', fill: 'var(--text-2)', fontSize: 11 }}>
                {stats.findings.map((f) => <Cell key={f.code} fill={CLASS_COLORS[f.code]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="section-heading"><h3>Case distribution</h3></div>
      <div className="grid g-2">
        <Card title="Flagged findings by age group" sub="Cases with one or more findings, grouped by age band">
          <Legend items={CLASSES.slice(1).map((c) => ({ label: CLASS_NAMES[c], color: CLASS_COLORS[c] }))} />
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={stats.byAge} barCategoryGap="30%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="bin" {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} width={28} />
              <Tooltip cursor={{ fill: 'rgba(23,87,101,0.05)' }} content={<ChartTip labelFmt={(l) => `Age ${l}`} />} />
              {CLASSES.slice(1).map((c) => (
                <Bar isAnimationActive={false} key={c} dataKey={c} name={CLASS_SHORT[c]} fill={CLASS_COLORS[c]} radius={0} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Priority score distribution" sub="AI review-priority score (0–100) across all cases">
          <ResponsiveContainer width="100%" height={258}>
            <BarChart data={stats.scoreHist} barCategoryGap="12%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="bin" {...axisProps} interval={1} />
              <YAxis allowDecimals={false} {...axisProps} width={28} />
              <Tooltip cursor={{ fill: 'rgba(23,87,101,0.05)' }} content={<ChartTip fmt={(v) => `${v} cases`} labelFmt={(l) => `Score ${l}`} />} />
              <Bar isAnimationActive={false} dataKey="n" name="Cases" fill="var(--accent)" radius={0} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  )
}

function Head({ right }) {
  return (
    <div className="page-head">
      <div>
        <h2>ECG triage overview</h2>
        <p>Review cases by AI-suggested priority. Every ECG still requires clinical interpretation.</p>
      </div>
      {right}
    </div>
  )
}
