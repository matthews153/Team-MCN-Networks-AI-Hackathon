import { useEffect, useState } from 'react'
import { ArrowRight, Check, Pencil, ShieldAlert, Trash2, UserRound, X } from 'lucide-react'
import { api } from '../lib'
import OutdatedServer from '../components/OutdatedServer'

// Name-only sign-in (prototype): no passwords. The queue is shared by everyone;
// the name is recorded on the cases a doctor uploads and the reviews they sign.
export default function SignIn({ onSignIn, outdated }) {
  const [doctors, setDoctors] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null)   // name being renamed
  const [draft, setDraft] = useState('')

  const load = () => api.doctors().then(setDoctors).catch(() => {})
  useEffect(() => { load() }, [])

  const rename = async (old) => {
    if (!draft.trim() || draft.trim() === old) { setEditing(null); return }
    setBusy(true); setErr(null)
    try { await api.renameDoctor(old, draft); setEditing(null); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const remove = async (d) => {
    const work = d.uploads + d.reviews
    if (!confirm(`Remove ${d.name} from the sign-in list?` +
      (work ? `\n\nTheir name stays on the ${work} upload${work === 1 ? '' : 's'}/review${work === 1 ? '' : 's'} they already signed.` : ''))) return
    setBusy(true); setErr(null)
    try { await api.deleteDoctor(d.name); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const choose = async (n) => {
    setBusy(true); setErr(null)
    try { const d = await api.addDoctor(n); onSignIn(d.name) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand signin-brand">
          {/* Logo slot (64 x 64 px): put the CardioLens logo here, e.g. <img src="/logo.svg" alt="" />.
              While it is empty it takes no space. */}
          <div className="signin-logo" aria-hidden="true" />
          <div><h1>CardioLens</h1><small>ECG triage workstation</small></div>
        </div>
        {outdated && <OutdatedServer />}
        <h2>Who's reviewing?</h2>
        <p className="muted">Choose your name, or type a new one. Everyone shares the same review queue; your name is recorded on the ECGs you upload and the reviews you sign.</p>

        {doctors.length > 0 && (
          <div className="signin-list">
            {doctors.map((d) => editing === d.name ? (
              <form key={d.name} className="signin-doctor editing" onSubmit={(e) => { e.preventDefault(); rename(d.name) }}>
                <UserRound size={17} aria-hidden="true" />
                <input className="input" autoFocus value={draft} maxLength={60} aria-label={`New name for ${d.name}`}
                  onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                <button type="submit" className="icon-btn" disabled={busy || !draft.trim()} aria-label="Save name" title="Save"><Check size={15} /></button>
                <button type="button" className="icon-btn" onClick={() => setEditing(null)} aria-label="Cancel" title="Cancel"><X size={15} /></button>
              </form>
            ) : (
              <div key={d.name} className="signin-row">
                <button className="signin-doctor" disabled={busy} onClick={() => choose(d.name)}>
                  <UserRound size={17} aria-hidden="true" />
                  <span><strong>{d.name}</strong><small>{d.uploads} uploaded · {d.reviews} reviewed</small></span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
                <button className="icon-btn" disabled={busy} onClick={() => { setEditing(d.name); setDraft(d.name); setErr(null) }}
                  aria-label={`Rename ${d.name}`} title="Rename"><Pencil size={14} /></button>
                <button className="icon-btn danger" disabled={busy} onClick={() => remove(d)}
                  aria-label={`Remove ${d.name}`} title="Remove"><Trash2 size={14} /></button>
              </div>
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
