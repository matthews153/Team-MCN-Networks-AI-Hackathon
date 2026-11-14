// 12-lead ECG renderer on standard ECG paper (25 mm/s, 10 mm/mV), drawn in mm units.
import { useMemo } from 'react'

const LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
const CLINICAL = [['I', 'aVR', 'V1', 'V4'], ['II', 'aVL', 'V2', 'V5'], ['III', 'aVF', 'V3', 'V6']]
const MM_PER_S = 25
const MM_PER_MV = 10
const HEAT = '#fbbf24'

function tracePath(sig, i0, i1, x0, yMid, fs, clip) {
  const dx = MM_PER_S / fs
  let d = ''
  for (let i = i0; i < i1; i++) {
    let v = sig[i] * MM_PER_MV
    if (v > clip) v = clip
    if (v < -clip) v = -clip
    d += `${i === i0 ? 'M' : 'L'}${(x0 + (i - i0) * dx).toFixed(2)},${(yMid - v).toFixed(2)}`
  }
  return d
}

function heatRects(sal, i0, i1, x0, yTop, h, fs, bin = 5) {
  if (!sal) return null
  const out = []
  const dx = MM_PER_S / fs
  for (let i = i0; i < i1; i += bin) {
    let m = 0
    for (let k = i; k < Math.min(i + bin, i1); k++) m = Math.max(m, sal[k])
    if (m < 0.25) continue
    out.push(<rect key={i} x={x0 + (i - i0) * dx} y={yTop} width={bin * dx + 0.05} height={h}
      fill={HEAT} opacity={Math.min(0.5, (m - 0.2) * 0.65)} />)
  }
  return out
}

function Paper({ id, w, h }) {
  return (
    <>
      <defs>
        <pattern id={`${id}-s`} width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M1 0H0V1" fill="none" stroke="rgba(244,114,182,0.08)" strokeWidth="0.08" />
        </pattern>
        <pattern id={`${id}-l`} width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill={`url(#${id}-s)`} />
          <path d="M5 0H0V5" fill="none" stroke="rgba(244,114,182,0.2)" strokeWidth="0.15" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill="#12151c" />
      <rect width={w} height={h} fill={`url(#${id}-l)`} />
    </>
  )
}

function CalPulse({ x, yMid }) {
  // 1 mV, 200 ms calibration pulse
  return <path d={`M${x},${yMid} h1 v-10 h5 v10 h1`} fill="none" stroke="#9aa4b2" strokeWidth="0.3" />
}

export default function ECGViewer({
  signal, saliency, fs = 100, layout = 'clinical', showSaliency = true, highlight = [],
  selected, onSelect, rPeaks = [],
}) {
  const id = useMemo(() => `p${Math.random().toString(36).slice(2, 8)}`, [])
  if (!signal) return null
  const n = signal[0].length
  const sal = showSaliency ? saliency : null
  const LEFT = 9

  const leadLabel = (name, x, y) => {
    const hl = highlight.includes(name)
    return (
      <text x={x} y={y} fontSize="3.2" fontWeight="600" fill={hl ? HEAT : '#cfd6e2'}>{name}{hl ? ' ★' : ''}</text>
    )
  }

  if (layout === 'stack') {
    const rowH = 18
    const W = LEFT + (n / fs) * MM_PER_S + 2
    const H = rowH * 12 + 4
    return (
      <svg viewBox={`0 0 ${W} ${H}`}>
        <Paper id={id} w={W} h={H} />
        {LEADS.map((name, li) => {
          const yTop = 2 + li * rowH
          const yMid = yTop + rowH / 2
          return (
            <g key={name} className="lead-hit" onClick={() => onSelect?.(name)}>
              <rect className="hover-bg" x={0} y={yTop} width={W} height={rowH}
                fill={selected === name ? 'rgba(56,189,248,.08)' : 'transparent'} />
              {heatRects(sal?.[li], 0, n, LEFT, yTop, rowH, fs)}
              <CalPulse x={1} yMid={yMid + 4} />
              {leadLabel(name, 1, yTop + 3.6)}
              <path d={tracePath(signal[li], 0, n, LEFT, yMid, fs, rowH * 0.62)} fill="none"
                stroke="#e8edf5" strokeWidth="0.32" strokeLinejoin="round" />
            </g>
          )
        })}
      </svg>
    )
  }

  // clinical 3x4 + rhythm strip (lead II)
  const rowH = 26
  const colW = (n / fs / 4) * MM_PER_S
  const seg = Math.floor(n / 4)
  const W = LEFT + colW * 4 + 2
  const H = rowH * 4 + 4
  const IDX = Object.fromEntries(LEADS.map((l, i) => [l, i]))
  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      <Paper id={id} w={W} h={H} />
      {CLINICAL.map((row, r) => row.map((name, c) => {
        const li = IDX[name]
        const yTop = 2 + r * rowH
        const yMid = yTop + rowH / 2 + 1
        const x0 = LEFT + c * colW
        const i0 = c * seg
        return (
          <g key={name} className="lead-hit" onClick={() => onSelect?.(name)}>
            <rect className="hover-bg" x={x0} y={yTop} width={colW} height={rowH}
              fill={selected === name ? 'rgba(56,189,248,.08)' : 'transparent'} />
            {heatRects(sal?.[li], i0, i0 + seg, x0, yTop, rowH, fs)}
            {c === 0 && <CalPulse x={1} yMid={yMid + 4} />}
            {c > 0 && <line x1={x0} x2={x0} y1={yMid - 3} y2={yMid + 3} stroke="#9aa4b2" strokeWidth="0.3" />}
            {leadLabel(name, x0 + 1, yTop + 4)}
            <path d={tracePath(signal[li], i0, i0 + seg, x0, yMid, fs, rowH * 0.6)} fill="none"
              stroke="#e8edf5" strokeWidth="0.32" strokeLinejoin="round" />
          </g>
        )
      }))}
      {(() => {
        const li = IDX.II
        const yTop = 2 + 3 * rowH
        const yMid = yTop + rowH / 2 + 1
        return (
          <g className="lead-hit" onClick={() => onSelect?.('II')}>
            {heatRects(sal?.[li], 0, n, LEFT, yTop, rowH, fs)}
            <CalPulse x={1} yMid={yMid + 4} />
            {leadLabel('II (rhythm)', LEFT + 1, yTop + 4)}
            {rPeaks.map((p) => (
              <path key={p} d={`M${LEFT + (p * MM_PER_S) / fs},${yTop + 1.5} l-1,-1.5 h2 z`} fill="#38bdf8" />
            ))}
            <path d={tracePath(signal[li], 0, n, LEFT, yMid, fs, rowH * 0.6)} fill="none"
              stroke="#e8edf5" strokeWidth="0.32" strokeLinejoin="round" />
          </g>
        )
      })()}
    </svg>
  )
}

export function LeadDetail({ signal, saliency, lead, fs = 100, rPeaks = [] }) {
  const id = useMemo(() => `d${Math.random().toString(36).slice(2, 8)}`, [])
  if (!signal || !lead) return null
  const li = LEADS.indexOf(lead)
  const n = signal[li].length
  const W = (n / fs) * MM_PER_S + 4
  const H = 44
  const yMid = H / 2 + 2
  const s = signal[li]
  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      <Paper id={id} w={W} h={H} />
      {heatRects(saliency?.[li], 0, n, 2, 0, H - 5, fs, 3)}
      {rPeaks.map((p) => (
        <line key={p} x1={2 + (p * MM_PER_S) / fs} x2={2 + (p * MM_PER_S) / fs} y1={2} y2={H - 6}
          stroke="#38bdf8" strokeWidth="0.15" strokeDasharray="0.8 0.8" />
      ))}
      <path d={tracePath(s, 0, n, 2, yMid, fs, H * 0.45)} fill="none" stroke="#f1f5f9" strokeWidth="0.35" />
      {Array.from({ length: 11 }, (_, k) => (
        <text key={k} x={2 + k * MM_PER_S} y={H - 1.2} fontSize="2.4" fill="#8a909c" textAnchor="middle">{k}s</text>
      ))}
    </svg>
  )
}
