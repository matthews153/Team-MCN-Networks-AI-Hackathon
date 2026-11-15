import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, BrainCircuit, FlaskConical, Info, LogOut, Settings2, ShieldAlert, UserRound, LayoutDashboard, ListChecks, Menu, Upload, X } from 'lucide-react'
import { api, getDoctor, serverOutdated, setDoctor } from './lib'
import SignIn from './pages/SignIn'
import OutdatedServer from './components/OutdatedServer'
import Dashboard from './pages/Dashboard'
import Analyze from './pages/Analyze'
import Queue from './pages/Queue'
import CaseDetail from './pages/CaseDetail'
import ModelInsights from './pages/ModelInsights'
import About from './pages/About'
import Settings from './pages/Settings'

const NAV = [
  { hash: '#/', label: 'Dashboard', icon: LayoutDashboard },
  { hash: '#/analyze', label: 'New analysis', icon: Upload },
  { hash: '#/queue', label: 'Review queue', icon: ListChecks, badge: true },
  { hash: '#/model', label: 'Model insights', icon: BrainCircuit },
  { hash: '#/about', label: 'About & limits', icon: Info },
  { hash: '#/settings', label: 'Settings', icon: Settings2 },
]
const THEMES = ['clinical', 'bright', 'midnight', 'sage']

function storedRange(key, fallback, max = 100) {
  const saved = localStorage.getItem(key)
  if (saved === 'comfortable') return 0
  if (saved === 'compact') return 100
  if (saved === null || saved === '') return fallback
  const value = Number(saved)
  return Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback
}

function storedDensity() {
  const saved = localStorage.getItem('cardiolens.density')
  const currentScale = localStorage.getItem('cardiolens.density.version') === '2'
  if (saved === 'comfortable') return 100
  if (saved === 'compact') return 0
  if (saved === null || saved === '') return 100
  const value = Number(saved)
  if (!Number.isFinite(value)) return 100
  return currentScale
    ? Math.max(0, Math.min(200, value))
    : Math.max(0, Math.min(100, 100 - value))
}

function loadDisplaySettings() {
  const savedTheme = localStorage.getItem('cardiolens.theme')
  const oldBrightness = localStorage.getItem('cardiolens.brightness')
  const legacyTheme = { bright: 'bright', dark: 'midnight', soft: 'sage', balanced: 'clinical', normal: 'clinical' }
  return {
    brightness: storedRange('cardiolens.brightness', 50),
    theme: THEMES.includes(savedTheme) ? savedTheme : legacyTheme[oldBrightness] || 'clinical',
    density: storedDensity(),
  }
}

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
  const [displaySettings, setDisplaySettings] = useState(loadDisplaySettings)
  const updateDisplaySetting = (key, value) => {
    localStorage.setItem(`cardiolens.${key}`, value)
    if (key === 'density') localStorage.setItem('cardiolens.density.version', '2')
    setDisplaySettings((current) => ({ ...current, [key]: value }))
  }
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = displaySettings.theme
    root.dataset.brightnessSide = displaySettings.brightness < 50 ? 'down' : 'up'
    root.style.setProperty('--brightness-adjust', `${Math.abs(displaySettings.brightness - 50) * 0.3}%`)
    const spacing = displaySettings.density
    const setSpacing = (name, compact, standard) => {
      const value = spacing <= 100
        ? compact + (standard - compact) * spacing / 100
        : standard * (1 + (spacing - 100) / 100)
      root.style.setProperty(name, `${value}px`)
    }
    setSpacing('--density-gap', 10, 16)
    setSpacing('--density-card-y', 12, 18)
    setSpacing('--density-card-x', 16, 20)
    setSpacing('--density-header-gap', 9, 13)
    setSpacing('--density-header-pad', 8, 10)
    setSpacing('--density-table-y', 6, 10)
    setSpacing('--density-table-x', 9, 11)
    setSpacing('--density-kpi-y', 10, 14)
    setSpacing('--density-kpi-x', 12, 15)
    setSpacing('--density-nav-height', 40, 44)
    setSpacing('--density-nav-y', 8, 10)
  }, [displaySettings])

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
  else if (hash.startsWith('#/settings')) page = <Settings display={displaySettings} onChange={updateDisplaySetting} />
  else page = <Dashboard cases={visibleCases} demo={demo} health={health} onChange={refresh} />

  return (
    <div className="app">
      <aside className={`sidebar ${navOpen ? 'nav-open' : ''}`}>
        <div className="brand">
          <h1>CardioLens</h1>
        </div>
        <nav id="primary-navigation" className={`nav-list ${navOpen ? 'open' : ''}`} aria-label="Primary navigation">
          {NAV.map((n) => {
            const active = n.hash === '#/' ? (hash === '#/' || hash === '') : hash.startsWith(n.hash)
            const Icon = n.icon
            return (
              <button key={n.hash} className={`nav-item ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => { window.location.hash = n.hash; setNavOpen(false) }}>
                <Icon size={18} strokeWidth={1.8} /> <span>{n.label}</span>
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
