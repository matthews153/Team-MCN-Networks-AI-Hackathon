// Shared API helpers, colours and formatting
export const CLASSES = ['NORM', 'MI', 'STTC', 'CD', 'HYP']
// Restrained category colors distinguish plotted series without encoding clinical severity.
export const CLASS_COLORS = {
  NORM: 'var(--c-norm)', MI: 'var(--c-mi)', STTC: 'var(--c-sttc)', CD: 'var(--c-cd)', HYP: 'var(--c-hyp)',
}
export const CLASS_NAMES = {
  NORM: 'Normal', MI: 'Myocardial infarction', STTC: 'ST/T change', CD: 'Conduction disturbance', HYP: 'Hypertrophy',
}
export const CLASS_SHORT = { NORM: 'Normal', MI: 'MI', STTC: 'ST/T', CD: 'Conduction', HYP: 'Hypertrophy' }
// Status colours are reserved for triage level only
export const TRIAGE = {
  urgent: { color: 'var(--critical)', label: 'Urgent', order: 0 },
  priority: { color: 'var(--warning)', label: 'Priority', order: 1 },
  routine: { color: 'var(--good)', label: 'Routine', order: 2 },
}
export const SYMPTOMS = ['chest pain', 'shortness of breath', 'palpitations', 'dizziness', 'syncope', 'fatigue']

async function req(path, opts = {}) {
  const r = await fetch(path, opts)
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return r.json()
}

export const api = {
  health: () => req('/api/health'),
  model: () => req('/api/model'),
  samples: () => req('/api/samples'),
  cases: () => req('/api/cases'),
  case: (id) => req(`/api/cases/${id}`),
  analyzeSample: (idx, patient) => {
    const fd = new FormData()
    if (patient) fd.append('patient', JSON.stringify(patient))
    return req(`/api/samples/${idx}/analyze`, { method: 'POST', body: fd })
  },
  analyzeFiles: (files, patient) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    fd.append('patient', JSON.stringify(patient || {}))
    return req('/api/analyze', { method: 'POST', body: fd })
  },
  review: (id, body) => req(`/api/cases/${id}/review`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  del: (id) => req(`/api/cases/${id}`, { method: 'DELETE' }),
  clear: () => req('/api/cases', { method: 'DELETE' }),
  seed: () => req('/api/demo/seed', { method: 'POST' }),
}

export const pct = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`)
export const num = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d))
export const timeAgo = (ts) => {
  const s = Date.now() / 1000 - ts
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
export const fmtDate = (ts) => new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
export const navigate = (hash) => { window.location.hash = hash }
