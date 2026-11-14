import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, BrainCircuit, FlaskConical, Info, LogOut, ShieldAlert, UserRound, LayoutDashboard, ListChecks, Menu, Upload, X } from 'lucide-react'
import { api, getDoctor, serverOutdated, setDoctor } from './lib'
import SignIn from './pages/SignIn'
import OutdatedServer from './components/OutdatedServer'
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
  const [navOpen, setNavOpen] = useState(false)
  const [doctor, setDoctorState] = useState(getDoctor)
  const signIn = (name) => { setDoctor(name); setDoctorState(name) }
  const signOut = () => { setDoctor(''); setDoctorState('') }
  // Demo / synthetic cases can be hidden so only real patients are shown (remembered per browser)
  const [showDemo, setShowDemoState] = useState(() => localStorage.getItem('cardiolens.showDemo') !== 'false')
  const setShowDemo = useCallback((v) => { localStorage.setItem('cardiolens.showDemo', String(v)); setShowDemoState(v) }, [])

  useEffect(() => {
    if (!navOpen) return
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [navOpen])

  const refresh = useCallback(async () => {
    try {
      const [h, c, docs] = await Promise.all([api.health(), api.cases(), api.doctors().catch(() => null)])
      setHealth(h); setCases(c); setError(null)
      // signed-in name was renamed or removed (e.g. from another browser): back to sign-in
      const me = getDoctor().toLowerCase()
      if (docs && me && !docs.some((d) => d.name.toLowerCase() === me)) { setDoctor(''); setDoctorState('') }
    } catch (e) { setHealth(null); setError(e.message) }
  }, [])
  useEffect(() => { refresh() }, [refresh, hash])

  const demoCount = cases.filter((c) => c.demo).length
  const visibleCases = showDemo ? cases : cases.filter((c) => !c.demo)
  const demo = { show: showDemo, setShow: setShowDemo, count: demoCount, realCount: cases.length - demoCount }
  const urgentPending = visibleCases.filter((c) => c.triage.level === 'urgent' && c.review.status !== 'reviewed').length
  const caseMatch = hash.match(/^#\/case\/(\w+)/)
  const activeNav = NAV.find((n) => n.hash === '#/' ? hash === '#/' || hash === '' : hash.startsWith(n.hash))
  const mobileTitle = caseMatch ? 'Case review' : activeNav?.label || 'Dashboard'

  if (!doctor) return <SignIn onSignIn={signIn} outdated={serverOutdated(health)} />

  let page
  if (caseMatch) page = <CaseDetail id={caseMatch[1]} onChange={refresh} />
  else if (hash.startsWith('#/analyze')) page = <Analyze health={health} demo={demo} onDone={refresh} />
  else if (hash.startsWith('#/queue')) page = <Queue cases={visibleCases} demo={demo} doctor={doctor} onChange={refresh} />
  else if (hash.startsWith('#/model')) page = <ModelInsights />
  else if (hash.startsWith('#/about')) page = <About />
  else page = <Dashboard cases={visibleCases} demo={demo} health={health} onChange={refresh} />

  return (
    <div className="app">
      <aside className={`sidebar ${navOpen ? 'nav-open' : ''}`}>
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" />
              <path d="M3.5 12h4l2-4 3.2 8 2.1-4H20.5" />
            </svg>
          </div>
          <div>
            <h1>CardioLens</h1>
            <small>ECG triage workstation</small>
          </div>
        </div>
        <nav id="primary-navigation" className={`nav-list ${navOpen ? 'open' : ''}`} aria-label="Primary navigation">
          {NAV.map((n) => {
            const active = n.hash === '#/' ? (hash === '#/' || hash === '') : hash.startsWith(n.hash)
            const Icon = n.icon
            return (
              <button key={n.hash} className={`nav-item ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => { window.location.hash = n.hash; setNavOpen(false) }}>
                <Icon size={17} strokeWidth={1.8} /> <span>{n.label}</span>
                {n.badge && urgentPending > 0 && <span className="nav-badge">{urgentPending}</span>}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="doctor-chip">
            <UserRound size={15} aria-hidden="true" />
            <span><small>Signed in as</small><strong title={doctor}>{doctor}</strong></span>
            <button type="button" className="doctor-switch" onClick={signOut} title="Switch doctor" aria-label="Switch doctor"><LogOut size={14} /></button>
          </div>
          <label className="demo-toggle" title="Demo cases are built from unseen PTB-XL test ECGs with synthetic patient details">
            <FlaskConical size={15} aria-hidden="true" />
            <span>
              <strong>Demo data</strong>
              <small>{showDemo ? `Showing ${demoCount} demo case${demoCount === 1 ? '' : 's'}` : 'Hidden — real patients only'}</small>
            </span>
            <input type="checkbox" role="switch" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />
            <span className="switch" aria-hidden="true" />
          </label>
          <div className="connection-status">
            <span className={`status-dot ${error ? 'offline' : health?.model_ready ? 'online' : 'pending'}`} />
            <div>
              <strong>{error ? 'Backend unavailable' : !health ? 'Checking connection' : health.model_ready ? 'Backend connected' : 'Model not ready'}</strong>
              <span>{error ? 'Analysis services cannot be reached' : !health ? 'Checking API status' : health.model_ready ? `${health.ensemble_size}-model ensemble ready` : 'Model training is required'}</span>
            </div>
          </div>
          <div className="sidebar-disclaimer" role="note"><ShieldAlert size={14} aria-hidden="true" /> This project is a prototype and is not medical advice.</div>
          <div className="sidebar-note">Research prototype · PTB-XL (PhysioNet, CC BY 4.0)</div>
        </div>
      </aside>
      {navOpen && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <main className="main">
        <div className="mobile-bar">
          <button type="button" className="mobile-nav-toggle" aria-expanded={navOpen}
            aria-controls="primary-navigation" aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setNavOpen(!navOpen)}>
            {navOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <span>CardioLens <span className="mobile-bar-divider">/</span> {mobileTitle}</span>
        </div>
        {serverOutdated(health) && <OutdatedServer />}
        {error && <div className="connection-alert" role="status">
          <AlertCircle size={17} aria-hidden="true" />
          <div>
            <strong>Backend connection unavailable</strong>
            <p>ECG analysis and case data require the CardioLens API. Start it with <code>python3 Main.py</code> from the project folder.</p>
            <details><summary>Connection details</summary><span>{error}</span></details>
          </div>
        </div>}
        {page}
      </main>
    </div>
  )
}
