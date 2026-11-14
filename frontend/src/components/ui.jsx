import { AlertCircle, AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { CLASS_COLORS, CLASS_SHORT, TRIAGE } from '../lib'

export function ErrorState({ title, message, detail }) {
  return (
    <div className="inline-error" role="alert">
      <AlertCircle size={17} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
        {detail && <details><summary>Technical details</summary><span>{detail}</span></details>}
      </div>
    </div>
  )
}

export function Card({ title, sub, icon, right, children, className = '', style }) {
  return (
    <div className={`card ${className}`} style={style}>
      {(title || right) && (
        <div className="card-header row between">
          <div className="card-heading">
            {title && <h3>{icon && <span className="card-icon">{icon}</span>}{title}</h3>}
            {sub && <p className="sub">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

export function Kpi({ label, value, hint, icon }) {
  return (
    <div className="kpi">
      <div className="label">{icon && <span className="kpi-icon">{icon}</span>}{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

const TRIAGE_ICON = { urgent: AlertOctagon, priority: AlertTriangle, routine: CheckCircle2 }

export function TriageBadge({ level, score, large }) {
  const Icon = TRIAGE_ICON[level] || CheckCircle2
  return (
    <span className={`badge ${level}`} style={large ? { fontSize: 13, padding: '5px 12px' } : undefined}>
      <Icon size={large ? 15 : 13} />
      {TRIAGE[level]?.label || level}
      {score != null && <span style={{ opacity: 0.8, fontWeight: 500 }}>· {Math.round(score)}</span>}
    </span>
  )
}

export function ClassTag({ code, label }) {
  return (
    <span className="cls-tag">
      <span className="cls-dot" style={{ background: CLASS_COLORS[code] }} />
      {label || CLASS_SHORT[code]}
    </span>
  )
}

export function Findings({ flagged, category }) {
  if (!flagged?.length) {
    return category === 'normal' ? <ClassTag code="NORM" /> : <span className="muted small">Indeterminate</span>
  }
  return <span>{flagged.map((c) => <ClassTag key={c} code={c} />)}</span>
}

/* Recharts tooltip: value leads, label follows, line keys */
export function ChartTip({ active, payload, label, fmt = (v) => v, labelFmt = (l) => l }) {
  if (!active || !payload?.length) return null
  return (
    <div className="tooltip-box">
      <div className="muted">{labelFmt(label)}</div>
      {payload.map((p) => (
        <div className="t-row" key={p.dataKey + p.name}>
          <span className="t-key" style={{ background: p.color || p.payload?.fill || p.fill }} />
          <strong>{fmt(p.value, p)}</strong>
          <span className="muted">{p.name}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items, shape = 'rect' }) {
  return (
    <div className="row wrap" style={{ gap: 14, marginBottom: 10 }}>
      {items.map((it) => (
        <span key={it.label} className="row small text-2" style={{ gap: 6 }}>
          <span style={{
            width: shape === 'line' ? 14 : 10, height: shape === 'line' ? 2 : 10,
            borderRadius: shape === 'line' ? 1 : 3, background: it.color, display: 'inline-block',
            borderTop: it.dashed ? `2px dashed ${it.color}` : undefined, ...(it.dashed ? { background: 'none' } : {}),
          }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

export const axisProps = {
  stroke: 'var(--axis)', tick: { fill: 'var(--muted)', fontSize: 11 }, tickLine: false,
}
export const gridProps = { stroke: 'var(--grid)', strokeDasharray: '0', vertical: false }
