import { AlertTriangle, CheckCircle2, Info, Ruler } from 'lucide-react'
import { Card } from './ui'

// Classic LVH voltage criteria measured on the ECG — a rule-based safety net next to the AI.
const CRITERIA = [
  { key: 'sokolow', name: 'Sokolow-Lyon', rule: (c) => `S in V1 + tallest R in V5/V6 ≥ ${c.cutoff} mV` },
  { key: 'cornell', name: 'Cornell voltage', rule: (c) => `R in aVL + S in V3 > ${c.cutoff} mV${c.sex_used ? ` (${c.sex_used === 'F' ? 'women' : 'men'})` : ''}` },
]
const PART_LABEL = { S_V1: 'S V1', R_V5: 'R V5', R_V6: 'R V6', R_aVL: 'R aVL', S_V3: 'S V3' }

function banner(v, aiHyp) {
  if (v.status === 'met' && !aiHyp) return { tone: 'warn', icon: AlertTriangle, text: 'Meets LVH voltage criteria, but the AI did not flag hypertrophy — check this ECG for hypertrophy.' }
  if (v.status === 'met') return { tone: 'ok', icon: CheckCircle2, text: "Voltage criteria agree with the AI's hypertrophy finding." }
  if (v.status === 'borderline') return { tone: 'warn', icon: Info, text: `Borderline voltage — within 10% of an LVH cut-off.${aiHyp ? '' : ' The AI did not flag hypertrophy; worth a look if the history fits (e.g. hypertension).'}` }
  if (aiHyp) return { tone: 'neutral', icon: Info, text: "Voltage criteria are not met. They miss many cases of hypertrophy, so this does not rule out the AI's finding." }
  return { tone: 'neutral', icon: CheckCircle2, text: 'Below LVH voltage criteria.' }
}

function hitRate(v) {
  const h = v.test_hit_rate
  if (!h || !h.total) return ''
  return ` In testing, ${h.hits} of ${h.total} ECGs like this (${Math.round((100 * h.hits) / h.total)}%) turned out to have hypertrophy.`
}

export default function VoltageCheck({ v, aiHyp }) {
  return (
    <Card title="Hypertrophy voltage check" icon={<Ruler size={16} color="var(--accent)" />}
      sub="Classic rules for left ventricular hypertrophy, measured on this ECG. A safety net next to the AI — not a diagnosis.">
      {!v || !v.available ? (
        <div className="muted small">{v?.reason || 'Not available for this ECG.'}</div>
      ) : (() => {
        const b = banner(v, aiHyp)
        const extra = !aiHyp && (v.status === 'met' || v.status === 'borderline') ? hitRate(v) : ''
        const Icon = b.icon
        return (
          <>
            <div className={`voltage-banner ${b.tone}`}><Icon size={15} aria-hidden="true" /><span>{b.text}{extra}</span></div>
            <div className="voltage-grid">
              {CRITERIA.map(({ key, name, rule }) => {
                const c = v[key]
                const max = c.cutoff * 1.5
                const state = c.met ? 'met' : c.borderline ? 'borderline' : 'not'
                return (
                  <div key={key} className="voltage-item">
                    <div className="row between">
                      <strong className="small">{name}</strong>
                      <span className={`voltage-pill ${state}`}>{c.met ? 'Met' : c.borderline ? 'Borderline' : 'Not met'}</span>
                    </div>
                    <div className="voltage-value">{c.value.toFixed(2)} <span>mV</span></div>
                    <div className="voltage-meter" role="img" aria-label={`${c.value.toFixed(2)} mV against a cut-off of ${c.cutoff} mV`}>
                      <div className={`voltage-fill ${state}`} style={{ width: `${Math.min(100, (c.value / max) * 100)}%` }} />
                      <div className="voltage-cut" style={{ left: `${(c.cutoff / max) * 100}%` }} title={`Cut-off ${c.cutoff} mV`} />
                    </div>
                    <div className="muted small">{rule(c)}</div>
                    <div className="small text-2 mono">{Object.entries(c.parts).map(([k, x]) => `${PART_LABEL[k] || k} ${x.toFixed(2)}`).join(' + ')} mV</div>
                  </div>
                )
              })}
            </div>
            <div className="muted small" style={{ marginTop: 10 }}>
              Wave heights are the median over {v.beats} beats. {v.notes?.join(' ')}
            </div>
          </>
        )
      })()}
    </Card>
  )
}
