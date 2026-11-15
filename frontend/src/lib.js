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

// The server API version this dashboard needs (backend/app.py API_VERSION). An older server
// process still running after a `git pull` is detected and reported instead of failing oddly.
export const REQUIRED_API = 5
export const serverOutdated = (health) => !!health && (health.api_version ?? 0) < REQUIRED_API

// Name-only sign-in: the chosen doctor is remembered per browser and sent with every request
const DOCTOR_KEY = 'cardiolens.doctor'
export const getDoctor = () => localStorage.getItem(DOCTOR_KEY) || ''
export const setDoctor = (name) => (name ? localStorage.setItem(DOCTOR_KEY, name) : localStorage.removeItem(DOCTOR_KEY))

async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (getDoctor()) headers['X-Doctor'] = encodeURIComponent(getDoctor())
  const r = await fetch(path, { ...opts, headers })
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
  clearDemo: () => req('/api/cases?demo_only=true', { method: 'DELETE' }),
  seed: () => req('/api/demo/seed', { method: 'POST' }),
  resetDemo: () => req('/api/demo/reset', { method: 'POST' }),
  doctors: () => req('/api/doctors'),
  addDoctor: (name) => req('/api/doctors', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  renameDoctor: (name, newName) => req('/api/doctors', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, new_name: newName }),
  }),
  deleteDoctor: (name) => req(`/api/doctors?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),
  facilities: () => req('/api/facilities'),
  patient: (pid) => req(`/api/patients/${encodeURIComponent(pid)}`),
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
export const fmtDate = (ts) => new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
export const navigate = (hash) => { window.location.hash = hash }
