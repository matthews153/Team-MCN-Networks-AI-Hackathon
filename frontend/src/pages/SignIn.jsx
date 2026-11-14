import { useEffect, useState } from 'react'
import { ArrowRight, ShieldAlert, UserRound } from 'lucide-react'
import { api } from '../lib'

// Name-only sign-in (prototype): no passwords. The queue is shared by everyone;
// the name is recorded on the cases a doctor uploads and the reviews they sign.
export default function SignIn({ onSignIn }) {
  const [doctors, setDoctors] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { api.doctors().then(setDoctors).catch(() => {}) }, [])

  const choose = async (n) => {
    setBusy(true); setErr(null)
    try { const d = await api.addDoctor(n); onSignIn(d.name) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand signin-brand">
          <div className="brand-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" /><path d="M3.5 12h4l2-4 3.2 8 2.1-4H20.5" /></svg>
          </div>
          <div><h1>CardioLens</h1><small>ECG triage workstation</small></div>
        </div>
        <h2>Who's reviewing?</h2>
        <p className="muted">Choose your name, or type a new one. Everyone shares the same review queue; your name is recorded on the ECGs you upload and the reviews you sign.</p>

        {doctors.length > 0 && (
          <div className="signin-list">
            {doctors.map((d) => (
              <button key={d.name} className="signin-doctor" disabled={busy} onClick={() => choose(d.name)}>
                <UserRound size={17} aria-hidden="true" />
                <span><strong>{d.name}</strong><small>{d.uploads} uploaded · {d.reviews} reviewed</small></span>
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}

        <form className="signin-new" onSubmit={(e) => { e.preventDefault(); if (name.trim()) choose(name) }}>
          <label className="field">{doctors.length ? 'New doctor' : 'Your name'}
            <input className="input" autoFocus placeholder="e.g. Dr. Amara Okafor" value={name} maxLength={60}
              onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="btn primary" type="submit" disabled={!name.trim() || busy}>Continue <ArrowRight size={15} /></button>
        </form>
        {err && <div className="small" style={{ color: 'var(--critical)', marginTop: 8 }}>{err}</div>}
        <div className="signin-foot"><ShieldAlert size={14} aria-hidden="true" /> No passwords — names only identify who did what. This project is a prototype and is not medical advice.</div>
      </div>
    </div>
  )
}
