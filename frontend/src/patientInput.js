// Helpers for filling in patient context: voice dictation, pulling details out of
// dictated text, and reading age/sex stored inside uploaded ECG files.
import { useEffect, useRef, useState } from 'react'
import { SYMPTOMS } from './lib'

// ---------------------------------------------------------------- dictation
// Uses the browser's built-in speech recognition (Chrome, Edge, Safari). In Chrome the
// audio is transcribed by Google's speech service, so avoid dictating identifiable details.
export function useDictation(onFinalText) {
  const Rec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const recRef = useRef(null)
  const cbRef = useRef(onFinalText)
  cbRef.current = onFinalText

  useEffect(() => () => recRef.current?.abort(), [])

  const start = () => {
    if (!Rec || listening) return
    const r = new Rec()
    r.lang = navigator.language || 'en-US'
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let fin = '', mid = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) fin += t; else mid += t
      }
      if (fin.trim()) cbRef.current(fin.trim())
      setInterim(mid)
    }
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'Microphone access was blocked — allow it in the browser to dictate.'
        : e.error === 'no-speech' ? 'No speech heard — try again.' : `Dictation stopped (${e.error}).`)
    }
    r.onend = () => { setListening(false); setInterim('') }
    setError(null)
    try { r.start(); recRef.current = r; setListening(true) } catch (err) { setError(String(err.message || err)) }
  }
  const stop = () => recRef.current?.stop()
  return { supported: !!Rec, listening, interim, error, start, stop, toggle: () => (listening ? stop() : start()) }
}

// ---------------------------------------------------------------- dictated text → fields
const SYMPTOM_WORDS = {
  'chest pain': /\bchest (pain|tightness|pressure|discomfort)\b|\bangina\b/i,
  'shortness of breath': /\b(short(ness)? of breath|breathless(ness)?|dyspn(o)?ea|trouble breathing|difficulty breathing)\b/i,
  palpitations: /\b(palpitations?|racing heart|heart (is )?racing|pounding heart|fluttering)\b/i,
  dizziness: /\b(dizz(y|iness)|light[- ]?headed(ness)?|vertigo)\b/i,
  syncope: /\b(syncope|faint(ed|ing)?|passed out|blacked out|collapsed?)\b/i,
  fatigue: /\b(fatigue|tired(ness)?|exhausted|exhaustion|weakness)\b/i,
}

const WORD_NUMBERS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

// true if the symptom is mentioned and not negated ("no chest pain", "denies dizziness")
function mentioned(text, re) {
  if (!re) return false
  const g = new RegExp(re.source, 'gi')
  for (const m of text.matchAll(g)) {
    const before = text.slice(Math.max(0, m.index - 30), m.index)
    if (!/\b(no|not|denies|denied|without|negative for)\b(?:(?!\b(?:but|however|and has|with)\b)[^.,;])*$/i.test(before)) return true
  }
  return false
}

function findAge(text) {
  const m = text.match(/\b(\d{1,3})[\s-]*(?:years?[\s-]*old|yrs?\b|y\/?o\b|years?\b)/i)
    || text.match(/\b(?:age|aged)\s*(?:is\s*)?(\d{1,3})\b/i)
  if (m) { const a = Number(m[1]); return a > 0 && a < 120 ? a : null }
  const w = text.match(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]?(one|two|three|four|five|six|seven|eight|nine)?[\s-]*years?[\s-]*old\b/i)
  if (w) {
    const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
    return WORD_NUMBERS[w[1].toLowerCase()] + (w[2] ? ones.indexOf(w[2].toLowerCase()) : 0)
  }
  return null
}

function findSex(text) {
  if (/\b(female|woman|lady|girl|she|her)\b/i.test(text)) return 'F'
  if (/\b(male|man|gentleman|boy|he|his)\b/i.test(text)) return 'M'
  return null
}

/** Pull age, sex and symptoms out of dictated text. Only empty fields are filled;
 *  symptoms are added. The full text always goes into the clinical notes. */
export function applyDictation(text, patient) {
  const next = { ...patient }
  const filled = []
  const age = findAge(text)
  if (age != null && patient.age === '') { next.age = String(age); filled.push(`age ${age}`) }
  const sex = findSex(text)
  if (sex && !patient.sex) { next.sex = sex; filled.push(sex === 'F' ? 'female' : 'male') }
  const syms = SYMPTOMS.filter((s) => mentioned(text, SYMPTOM_WORDS[s]) && !patient.symptoms.includes(s))
  if (syms.length) { next.symptoms = [...patient.symptoms, ...syms]; filled.push(...syms) }
  const sentence = text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.')
  next.notes = patient.notes ? `${patient.notes.trimEnd()} ${sentence}` : sentence
  return { patient: next, filled }
}

// ---------------------------------------------------------------- age/sex inside files
const AGE_RE = /\bage\b[^0-9a-z]{0,4}(\d{1,3}(?:\.\d+)?)/i
const SEX_RE = /\b(?:sex|gender)\b[^a-z]{0,4}(male|female|man|woman|m|f)\b/i
const normSex = (v) => {
  const s = String(v ?? '').trim().toLowerCase()
  return ['m', 'male', 'man'].includes(s) ? 'M' : ['f', 'female', 'woman'].includes(s) ? 'F' : null
}

/** Age/sex stored in a WFDB header's comments ("# Age: 63", "# Sex: F") or in a JSON
 *  file's "age"/"sex"/"gender" fields. Returns {} when the file carries none. */
export async function readDemographics(file) {
  const ext = (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase()
  if (!['.hea', '.json'].includes(ext) || file.size > 30e6) return {}
  try {
    const text = await file.text()
    const out = {}
    if (ext === '.hea') {
      const comments = text.split(/\r?\n/).filter((l) => l.trim().startsWith('#')).join('\n')
      const a = comments.match(AGE_RE); if (a && +a[1] > 0 && +a[1] < 120) out.age = Math.round(+a[1])
      const s = comments.match(SEX_RE); if (s && normSex(s[1])) out.sex = normSex(s[1])
    } else {
      const obj = JSON.parse(text)
      const src = obj && typeof obj === 'object' ? (obj.patient || obj) : {}
      if (+src.age > 0 && +src.age < 120) out.age = Math.round(+src.age)
      if (normSex(src.sex ?? src.gender)) out.sex = normSex(src.sex ?? src.gender)
    }
    return out
  } catch { return {} }
}
