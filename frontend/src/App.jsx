import { useCallback, useEffect, useState } from 'react'
import { Activity, BarChart3, BrainCircuit, Info, LayoutDashboard, ListChecks, Upload } from 'lucide-react'
import { api } from './lib'
import Dashboard from './pages/Dashboard'
import Analyze from './pages/Analyze'
import Queue from './pages/Queue'
import CaseDetail from './pages/CaseDetail'
import ModelInsights from './pages/ModelInsights'
import About from './pages/About'

const NAV = [
  { hash: '#/', label: 'Dashboard', icon: LayoutDashboard },
  { hash: '#/analyze', label: 'New analysis', icon: Upload },
  { hash: '#/queue', label: 'Review queue', icon: ListChecks, badge: true },
  { hash: '#/model', label: 'Model insights', icon: BrainCircuit },
  { hash: '#/about', label: 'About & limits', icon: Info },
]

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const on = () => { setHash(window.location.hash || '#/'); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export default function App() {
  const hash = useHash()
  const [health, setHealth] = useState(null)
  const [cases, setCases] = useState([])
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [h, c] = await Promise.all([api.health(), api.cases()])
      setHealth(h); setCases(c); setError(null)
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { refresh() }, [refresh, hash])

  const urgentPending = cases.filter((c) => c.triage.level === 'urgent' && c.review.status !== 'reviewed').length
  const caseMatch = hash.match(/^#\/case\/(\w+)/)

  let page
  if (caseMatch) page = <CaseDetail id={caseMatch[1]} onChange={refresh} />
  else if (hash.startsWith('#/analyze')) page = <Analyze health={health} onDone={refresh} />
  else if (hash.startsWith('#/queue')) page = <Queue cases={cases} onChange={refresh} />
  else if (hash.startsWith('#/model')) page = <ModelInsights />
  else if (hash.startsWith('#/about')) page = <About />
  else page = <Dashboard cases={cases} health={health} onChange={refresh} />

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo"><Activity size={20} color="white" /></div>
          <div>
            <h1>CardioLens</h1>
            <small>AI ECG triage for clinicians</small>
          </div>
        </div>
        {NAV.map((n) => {
          const active = n.hash === '#/' ? (hash === '#/' || hash === '') : hash.startsWith(n.hash)
          const Icon = n.icon
          return (
            <button key={n.hash} className={`nav-item ${active ? 'active' : ''}`} onClick={() => { window.location.hash = n.hash }}>
              <Icon size={17} /> {n.label}
              {n.badge && urgentPending > 0 && <span className="nav-badge">{urgentPending}</span>}
            </button>
          )
        })}
        <div className="sidebar-foot">
          <div>
            <span className="status-dot" style={{ background: health?.model_ready ? 'var(--good)' : error ? 'var(--critical)' : 'var(--warning)' }} />
            {health?.model_ready ? `Model online · ${health.ensemble_size}-model ensemble` : error ? 'Backend offline' : 'Model not trained'}
          </div>
          <div style={{ marginTop: 8 }}>Prototype — not medical advice. Trained on PTB-XL (PhysioNet, CC BY 4.0).</div>
        </div>
      </aside>
      <main className="main">
        {error && <div className="disclaimer" style={{ marginBottom: 16 }}>Cannot reach the CardioLens API: {error}. Start it with <span className="mono">uvicorn backend.app:app --port 8000</span>.</div>}
        {page}
      </main>
    </div>
  )
}
