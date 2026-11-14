import { useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AlertTriangle, BrainCircuit, Database, Ruler, Scale, Target, TrendingUp } from 'lucide-react'
import { api, CLASSES, CLASS_COLORS, CLASS_NAMES, CLASS_SHORT, navigate, num, pct } from '../lib'
import { axisProps, Card, ChartTip, ClassTag, ErrorState, gridProps, Kpi, Legend } from '../components/ui'

const SEQ = ['#557f8b', '#84704d', '#527451', '#73628a']

export default function ModelInsights() {
  const [m, setM] = useState(null)
  const [err, setErr] = useState(null)
  const [curve, setCurve] = useState('roc')
  const [samples, setSamples] = useState([])
  useEffect(() => { api.model().then(setM).catch((e) => setErr(e.message)); api.samples().then(setSamples).catch(() => {}) }, [])

  const derived = useMemo(() => {
    if (!m) return null
    const E = m.ensemble.per_class
    const comp = [
      { name: 'Prevalence (always guess base rate)', short: 'Prevalence', s: m.baselines.prevalence },
      { name: 'Logistic regression on signal features', short: 'LogReg features', s: m.baselines.logreg_features },
      { name: 'Single 1D-ResNet', short: 'Single ResNet', s: m.single_model },
      { name: `Ensemble of ${m.ensemble_size} 1D-ResNets`, short: 'CardioLens ensemble', s: m.ensemble },
    ].map((x) => ({ ...x, auroc: x.s.macro.auroc, f1: x.s.macro.f1, sens: x.s.macro.sensitivity, spec: x.s.macro.specificity }))
    const errors = CLASSES.map((c) => ({ code: c, name: CLASS_SHORT[c], missed: -E[c].fn, false_alarms: E[c].fp }))
    const hist = (m.history[0] || []).map((h, i) => {
      const row = { epoch: h.epoch }
      m.history.forEach((hh, k) => { row[`m${k}`] = hh[i]?.val_macro_auroc })
      return row
    })
    const lossHist = (m.history[0] || []).map((h) => ({ epoch: h.epoch, train: h.train_loss, val: h.val_loss }))
    const total = CLASSES.map((c) => ({ code: c, name: CLASS_SHORT[c], n: m.dataset.split_counts.train[c] + m.dataset.split_counts.val[c] + m.dataset.split_counts.test[c] }))
    const age = m.dataset.age_hist.counts.map((n, i) => ({ bin: `${m.dataset.age_hist.bins[i]}–${m.dataset.age_hist.bins[i] + 9}`, n }))
    return { comp, errors, hist, lossHist, total, age }
  }, [m])

  if (err) return <ErrorState title="Model insights unavailable" message="Performance data could not be loaded from the CardioLens API." detail={err} />
  if (!m) return <div className="empty"><span className="spinner" /></div>
  const B = m.binary
  const sampleById = Object.fromEntries(samples.map((s) => [s.ecg_id, s]))

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Model insights</h2>
          <p>How well the AI performs on {m.n.test.toLocaleString('en-US')} ECGs from PTB-XL fold 10 — patients it never saw during training. Trained {m.created}.</p>
        </div>
      </div>

      <div className="grid g-6 metric-grid" style={{ marginBottom: 16 }}>
        <Kpi label="Macro AUROC" value={num(m.ensemble.macro.auroc, 3)} hint={`vs ${num(m.baselines.logreg_features.macro.auroc, 3)} baseline`} icon={<Target size={18} />} />
        <Kpi label="Abnormal sensitivity" value={pct(B.sensitivity, 1)} hint={`${B.confusion.fn} abnormal ECGs missed`} icon={<AlertTriangle size={16} />} />
        <Kpi label="Abnormal specificity" value={pct(B.specificity, 1)} hint={`${B.confusion.fp} false alarms`} icon={<Scale size={16} />} />
        <Kpi label="Normal-vs-abnormal accuracy" value={pct(B.accuracy, 1)} hint={`majority guess: ${pct(B.majority_baseline.accuracy, 1)}`} icon={<TrendingUp size={16} />} />
        <Kpi label="Macro F1" value={num(m.ensemble.macro.f1, 3)} hint="thresholds tuned on fold 9" icon={<BrainCircuit size={16} />} />
        <Kpi label="Training data" value={m.n.train.toLocaleString('en-US')} hint={`ECGs · ${m.ensemble_size} models × ${m.epochs} epochs`} icon={<Database size={18} />} />
      </div>

      <div className="section-heading"><h3>Overall performance</h3></div>
      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <Card title="Comparison with baselines" sub="Macro AUROC on the held-out test set (0.5 = chance)" className="span-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={derived.comp} layout="vertical" margin={{ left: 20, right: 40 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" domain={[0, 1]} {...axisProps} />
              <YAxis type="category" dataKey="short" {...axisProps} width={130} />
              <ReferenceLine x={0.5} stroke="var(--axis)" strokeDasharray="4 3" />
              <Tooltip cursor={{ fill: 'rgba(23,87,101,0.05)' }} content={<ChartTip fmt={(v) => num(v, 3)} />} />
              <Bar isAnimationActive={false} dataKey="auroc" name="Macro AUROC" radius={0} barSize={22} label={{ position: 'right', fill: 'var(--text-2)', fontSize: 11, formatter: (v) => num(v, 3) }}>
                {derived.comp.map((c, i) => <Cell key={i} fill={i === 3 ? 'var(--accent)' : '#607680'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <table className="table" style={{ marginTop: 8 }}>
            <thead><tr><th>Model</th><th className="num">AUROC</th><th className="num">F1</th><th className="num">Sensitivity</th><th className="num">Specificity</th></tr></thead>
            <tbody>{derived.comp.map((c) => (
              <tr key={c.short}><td>{c.name}</td><td className="num">{num(c.auroc, 3)}</td><td className="num">{num(c.f1, 3)}</td><td className="num">{pct(c.sens, 1)}</td><td className="num">{pct(c.spec, 1)}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title="Normal vs abnormal" sub="Abnormal = any of MI, ST/T, CD, HYP flagged">
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: 6, marginTop: 6 }}>
            <div />
            <div className="small muted" style={{ textAlign: 'center' }}>AI: abnormal</div>
            <div className="small muted" style={{ textAlign: 'center' }}>AI: normal</div>
            <div className="small muted" style={{ alignSelf: 'center' }}>Truly abnormal</div>
            <Cm v={B.confusion.tp} label="Caught" tone="good" />
            <Cm v={B.confusion.fn} label="Missed (FN)" tone="critical" />
            <div className="small muted" style={{ alignSelf: 'center' }}>Truly normal</div>
            <Cm v={B.confusion.fp} label="False alarm (FP)" tone="warning" />
            <Cm v={B.confusion.tn} label="Correctly clear" tone="good" />
          </div>
          <div className="divider" />
          <div className="small text-2" style={{ lineHeight: 1.6 }}>
            AUROC {num(B.auroc, 3)} · {pct(B.prevalence_abnormal)} of test ECGs are abnormal. A "model" that always predicts <em>{B.majority_baseline.predicts}</em> scores {pct(B.majority_baseline.accuracy, 1)} accuracy but is clinically useless; the logistic-regression baseline reaches {pct(m.binary_logreg.accuracy, 1)}.
          </div>
        </Card>
      </div>

      <Card title="Per-category performance" sub="Missed cases (false negatives) and false alarms (false positives) reported separately, as clinical triage requires" style={{ marginBottom: 16 }}>
        <table className="table">
          <thead><tr><th>Category</th><th className="num">Test positives</th><th className="num">AUROC</th><th className="num">AUPRC</th><th className="num">Sensitivity</th><th className="num">Specificity</th><th className="num">PPV</th><th className="num">F1</th><th className="num">Missed (FN)</th><th className="num">False alarms (FP)</th><th className="num">Threshold</th></tr></thead>
          <tbody>{CLASSES.map((c) => {
            const e = m.ensemble.per_class[c]
            return (
              <tr key={c}>
                <td><ClassTag code={c} label={CLASS_NAMES[c]} /></td>
                <td className="num">{e.n_pos}</td><td className="num">{num(e.auroc, 3)}</td><td className="num">{num(e.auprc, 3)}</td>
                <td className="num">{pct(e.sensitivity, 1)}</td><td className="num">{pct(e.specificity, 1)}</td><td className="num">{pct(e.ppv, 1)}</td><td className="num">{num(e.f1, 3)}</td>
                <td className="num" style={{ color: 'var(--critical)', fontWeight: 600 }}>{e.fn}</td><td className="num" style={{ color: 'var(--warning)', fontWeight: 600 }}>{e.fp}</td><td className="num muted">{num(e.threshold, 2)}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </Card>

      {m.lvh_voltage && (() => {
        const V = m.lvh_voltage
        const rows = [
          { name: 'AI alone', d: V.ai, note: `threshold ${num(V.threshold, 2)}` },
          { name: 'Voltage criteria alone (Sokolow-Lyon or Cornell)', d: V.voltage_met, note: 'classic clinical rule — a baseline' },
          { name: 'AI + voltage criteria met', d: V.ai_or_met, note: 'shown as a prompt on the case page' },
          { name: 'AI + voltage met or borderline', d: V.ai_or_borderline, note: 'borderline = within 10% of a cut-off (also shown on the case page)' },
        ]
        return (
          <Card title="Hypertrophy safety net: voltage criteria" icon={<Ruler size={16} color="var(--accent)" />} style={{ marginBottom: 16 }}
            sub={`Hypertrophy is the category the AI misses most. CardioLens also measures the classic LVH voltage rules on every ECG. Test set: ${V.n_hyp} hypertrophy ECGs out of ${V.n_test.toLocaleString('en-US')}.`}>
            <table className="table">
              <thead><tr><th>Approach</th><th className="num">Hypertrophy caught</th><th className="num">Flags that are right (PPV)</th><th className="num">Missed</th><th className="num">False alarms</th><th>Note</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.name}><td>{r.name}</td><td className="num">{pct(r.d.sensitivity, 1)}</td><td className="num">{pct(r.d.ppv, 1)}</td>
                  <td className="num" style={{ color: 'var(--critical)', fontWeight: 600 }}>{r.d.fn}</td><td className="num" style={{ color: 'var(--warning)', fontWeight: 600 }}>{r.d.fp}</td>
                  <td className="muted small">{r.note}</td></tr>
              ))}</tbody>
            </table>
            <p className="small text-2" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>
              Of the {V.ai_misses} hypertrophy ECGs the AI misses, {V.ai_misses_met} meet voltage criteria and {V.ai_misses_borderline} more are borderline.
              The price: {V.extra_alarms_met} ECGs without hypertrophy also meet the criteria ({V.extra_alarms_borderline} more are borderline) — so only about
              1 in {Math.round((V.ai_misses_met + V.extra_alarms_met) / Math.max(1, V.ai_misses_met))} voltage flags the AI didn't make is real hypertrophy.
              The AI alone beats the voltage rules on both catch rate and precision; the check is a prompt to double-check, not a diagnosis.
            </p>
          </Card>
        )
      })()}

      <div className="section-heading"><h3>Discrimination and error profile</h3></div>
      <div className="grid g-2" style={{ marginBottom: 16 }}>
        <Card title={curve === 'roc' ? 'ROC curves' : 'Precision–recall curves'} sub={curve === 'roc' ? 'True-positive rate vs false-positive rate per category' : 'Precision vs recall — more informative for rarer categories like HYP'}
          right={<div className="seg"><button className={curve === 'roc' ? 'on' : ''} onClick={() => setCurve('roc')}>ROC</button><button className={curve === 'pr' ? 'on' : ''} onClick={() => setCurve('pr')}>PR</button></div>}>
          <Legend shape="line" items={CLASSES.map((c) => ({ label: `${CLASS_SHORT[c]} (${num(curve === 'roc' ? m.ensemble.per_class[c].auroc : m.ensemble.per_class[c].auprc, 2)})`, color: CLASS_COLORS[c] }))} />
          <ResponsiveContainer width="100%" height={300}>
            <LineChart margin={{ right: 10 }}>
              <CartesianGrid stroke="var(--grid)" />
              <XAxis type="number" dataKey={curve === 'roc' ? 'fpr' : 'recall'} domain={[0, 1]} {...axisProps} label={{ value: curve === 'roc' ? 'False-positive rate' : 'Recall', fill: 'var(--muted)', fontSize: 11, position: 'insideBottom', offset: -2 }} />
              <YAxis type="number" domain={[0, 1]} {...axisProps} width={34} />
              {curve === 'roc' && <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--axis)" strokeDasharray="4 3" />}
              <Tooltip content={<ChartTip fmt={(v) => num(v, 3)} labelFmt={(l) => `${curve === 'roc' ? 'FPR' : 'Recall'} ${num(l, 2)}`} />} />
              {CLASSES.map((c) => (
                <Line key={c + curve} data={m.curves[c][curve]} dataKey={curve === 'roc' ? 'tpr' : 'precision'} name={CLASS_SHORT[c]} stroke={CLASS_COLORS[c]} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="False negatives and false positives" sub="Per-category test-set errors">
          <ResponsiveContainer width="100%" height={330}>
            <BarChart data={derived.errors} layout="vertical" stackOffset="sign" margin={{ left: 10, right: 30 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} tickFormatter={(v) => Math.abs(v)} />
              <YAxis type="category" dataKey="name" {...axisProps} width={84} />
              <ReferenceLine x={0} stroke="var(--axis)" />
              <Tooltip cursor={{ fill: 'rgba(23,87,101,0.05)' }} content={<ChartTip fmt={(v) => Math.abs(v)} />} />
              <Bar isAnimationActive={false} dataKey="missed" name="Missed (FN)" stackId="s" barSize={22} radius={0} label={{ position: 'insideLeft', fill: '#172a33', fontSize: 11, formatter: (v) => Math.abs(v) }}>
                {derived.errors.map((e) => <Cell key={e.code} fill={CLASS_COLORS[e.code]} />)}
              </Bar>
              <Bar isAnimationActive={false} dataKey="false_alarms" name="False alarms (FP)" stackId="s" barSize={22} radius={0} label={{ position: 'insideRight', fill: '#172a33', fontSize: 11 }}>
                {derived.errors.map((e) => <Cell key={e.code} fill={CLASS_COLORS[e.code]} fillOpacity={0.5} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="section-heading"><h3>Subgroup performance and calibration</h3></div>
      <div className="grid g-2" style={{ marginBottom: 16 }}>
        <Card title="Fairness across groups" sub="Macro AUROC and per-category sensitivity by sex and age band (test set)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={m.subgroups} margin={{ right: 10 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="group" {...axisProps} />
              <YAxis domain={[0.5, 1]} {...axisProps} width={34} />
              <Tooltip cursor={{ fill: 'rgba(23,87,101,0.05)' }} content={<ChartTip fmt={(v) => num(v, 3)} />} />
              <Bar isAnimationActive={false} dataKey="macro_auroc" name="Macro AUROC" fill="var(--accent)" radius={0} barSize={30} label={{ position: 'top', fill: 'var(--muted)', fontSize: 10, formatter: (v) => num(v, 2) }} />
            </BarChart>
          </ResponsiveContainer>
          <div className="small muted" style={{ margin: '6px 0 2px' }}>Sensitivity by category</div>
          <table className="table">
            <thead><tr><th>Group</th><th className="num">n</th>{CLASSES.map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
            <tbody>{m.subgroups.map((g) => (
              <tr key={g.group}><td>{g.group}</td><td className="num">{g.n}</td>{CLASSES.map((c) => <td key={c} className="num">{pct(g[`sens_${c}`])}</td>)}</tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title="Calibration" sub="When the model says X%, how often is it right? Points on the diagonal = well calibrated">
          <Legend shape="line" items={CLASSES.map((c) => ({ label: CLASS_SHORT[c], color: CLASS_COLORS[c] }))} />
          <ResponsiveContainer width="100%" height={330}>
            <LineChart margin={{ right: 10 }}>
              <CartesianGrid stroke="var(--grid)" />
              <XAxis type="number" dataKey="predicted" domain={[0, 1]} {...axisProps} label={{ value: 'Predicted probability', fill: 'var(--muted)', fontSize: 11, position: 'insideBottom', offset: -2 }} />
              <YAxis type="number" domain={[0, 1]} {...axisProps} width={34} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--axis)" strokeDasharray="4 3" />
              <Tooltip content={<ChartTip fmt={(v) => num(v, 2)} labelFmt={(l) => `Predicted ${num(l, 2)}`} />} />
              {CLASSES.map((c) => (
                <Line key={c} data={m.calibration[c]} dataKey="observed" name={CLASS_SHORT[c]} stroke={CLASS_COLORS[c]} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: CLASS_COLORS[c] }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="section-heading"><h3>Training and dataset</h3></div>
      <div className="grid g-3" style={{ marginBottom: 16 }}>
        <Card title="Training progress" sub="Validation macro AUROC per epoch, one line per ensemble member">
          <Legend shape="line" items={m.history.map((_, k) => ({ label: `Model ${k + 1}`, color: SEQ[k % SEQ.length] }))} />
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={derived.hist}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="epoch" {...axisProps} />
              <YAxis domain={['auto', 'auto']} {...axisProps} width={40} tickFormatter={(v) => v.toFixed(2)} />
              <Tooltip content={<ChartTip fmt={(v) => num(v, 4)} labelFmt={(l) => `Epoch ${l}`} />} />
              {m.history.map((_, k) => <Line key={k} dataKey={`m${k}`} name={`Model ${k + 1}`} stroke={SEQ[k % SEQ.length]} strokeWidth={2} dot={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Dataset composition" sub={`${m.n.total_labelled.toLocaleString('en-US')} labelled PTB-XL ECGs (labels can co-occur)`}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={derived.total} margin={{ right: 10 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis {...axisProps} width={40} />
              <Tooltip cursor={{ fill: 'rgba(23,87,101,0.05)' }} content={<ChartTip fmt={(v) => `${v.toLocaleString('en-US')} ECGs`} />} />
              <Bar isAnimationActive={false} dataKey="n" name="ECGs" radius={0}>{derived.total.map((t) => <Cell key={t.code} fill={CLASS_COLORS[t.code]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Label co-occurrence" sub="How often two categories appear on the same ECG">
          <div style={{ display: 'grid', gridTemplateColumns: '70px repeat(5, 1fr)', gap: 3, marginTop: 8 }}>
            <div />
            {CLASSES.map((c) => <div key={c} className="small muted" style={{ textAlign: 'center' }}>{CLASS_SHORT[c].slice(0, 6)}</div>)}
            {CLASSES.map((r, i) => {
              const row = m.dataset.cooccurrence[i]
              const mx = Math.max(...m.dataset.cooccurrence.flat())
              return [
                <div key={r} className="small row">{CLASS_SHORT[r].slice(0, 8)}</div>,
                ...row.map((v, j) => (
                  <div key={r + j} className="heat-cell" style={{ height: 34, background: `rgba(24,127,142,${0.06 + 0.75 * Math.sqrt(v / mx)})` }}
                    title={`${CLASS_NAMES[r]} & ${CLASS_NAMES[CLASSES[j]]}: ${v.toLocaleString('en-US')}`}>{v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}</div>
                )),
              ]
            })}
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>Sex: {m.dataset.sex_counts.M.toLocaleString('en-US')} male · {m.dataset.sex_counts.F.toLocaleString('en-US')} female</div>
        </Card>
      </div>

      <div className="section-heading"><h3>Largest test-set errors</h3></div>
      <Card title="Cases for inspection" sub="The test ECGs the AI got most wrong. Reports are shown in English, built from the cardiologist's coded statements; the original free text (often German or Swedish) is one click away.">
        <table className="table">
          <thead><tr><th>ECG</th><th>Patient</th><th>Cardiologist label</th><th>AI prediction</th><th>Cardiologist's report</th><th /></tr></thead>
          <tbody>{m.failures.slice(0, 12).map((f) => {
            const s = sampleById[f.ecg_id]
            return (
              <tr key={f.ecg_id}>
                <td className="mono small">#{f.ecg_id}</td>
                <td className="small">{Math.round(f.age)}y {f.sex}</td>
                <td>{f.true.map((c) => <ClassTag key={c} code={c} />)}</td>
                <td>{f.pred.length ? f.pred.map((c) => <ClassTag key={c} code={c} />) : <span className="muted small">none</span>}</td>
                <td className="small" style={{ maxWidth: 380 }}>
                  <div className="text-2">{f.report_en || f.report}</div>
                  {f.report_en && f.report_lang && f.report_lang !== 'English' && (
                    <details className="orig-report"><summary>Original wording ({f.report_lang})</summary><span lang={f.report_lang === 'German' ? 'de' : 'sv'}>{f.report}</span></details>
                  )}
                </td>
                <td>{s && <button className="btn sm" onClick={async () => { const c = await api.analyzeSample(s.idx); navigate(`#/case/${c.id}`) }}>Inspect</button>}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </Card>
    </div>
  )
}

function Cm({ v, label, tone }) {
  return (
    <div className={`confusion-cell ${tone}`}>
      <div style={{ fontSize: 22, fontWeight: 650 }}>{v.toLocaleString('en-US')}</div>
      <div className="small text-2">{label}</div>
    </div>
  )
}
