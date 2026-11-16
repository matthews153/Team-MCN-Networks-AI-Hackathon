import { SlidersHorizontal, Sun } from 'lucide-react'
import { Card } from '../components/ui'
import { STANDARD_DENSITY } from '../lib'

const THEMES = [
  { value: 'clinical', name: 'Default', description: 'Balanced hospital workspace' },
  { value: 'bright', name: 'Bright', description: 'A lighter, open canvas' },
  { value: 'midnight', name: 'Dark', description: 'Low-light workstation' },
  { value: 'sage', name: 'Sage', description: 'Soft, muted green surfaces' },
]

export default function Settings({ display, onChange }) {
  const brightnessLabel = display.brightness < 35 ? 'Dim' : display.brightness > 65 ? 'Bright' : 'Normal'
  const densityLabel = display.density < 50 ? 'Compact' : display.density === STANDARD_DENSITY ? 'Standard' : display.density < STANDARD_DENSITY ? 'Balanced' : 'Spacious'

  return (
    <div className="settings-page">
      <header className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Adjust the display to suit your workspace.</p>
        </div>
      </header>

      <Card
        className="settings-card"
        title="Display preferences"
        sub="These choices are saved for your signed-in account in this browser."
        icon={<SlidersHorizontal size={16} aria-hidden="true" />}
      >
        <div className="settings-content">
          <section className="settings-row" aria-labelledby="brightness-heading">
            <div className="settings-copy">
              <h4 id="brightness-heading"><Sun size={15} aria-hidden="true" /> Brightness</h4>
              <p>Raise or lower the workspace surface brightness.</p>
            </div>
            <div className="range-setting">
              <div className="range-readout"><span>{brightnessLabel}</span><output htmlFor="brightness-range">{display.brightness}%</output></div>
              <input
                id="brightness-range"
                className="settings-range"
                type="range"
                min="0"
                max="100"
                step="1"
                value={display.brightness}
                style={{ '--range-progress': `${display.brightness}%` }}
                aria-label="Screen brightness"
                aria-valuetext={`${brightnessLabel}, ${display.brightness} percent`}
                onChange={(event) => onChange('brightness', Number(event.target.value))}
              />
              <div className="range-labels" aria-hidden="true"><span>Dim</span><span>Normal</span><span>Bright</span></div>
            </div>
          </section>

          <section className="settings-theme" aria-labelledby="theme-heading">
            <div className="settings-copy">
              <h4 id="theme-heading">Color theme</h4>
              <p>Choose a workspace palette. ECG traces retain their high-contrast display.</p>
            </div>
            <fieldset className="theme-options">
              <legend className="sr-only">Color theme</legend>
              {THEMES.map((theme) => (
                <label key={theme.value} className={`theme-option${display.theme === theme.value ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="theme"
                    value={theme.value}
                    checked={display.theme === theme.value}
                    onChange={() => onChange('theme', theme.value)}
                  />
                  <span className={`theme-preview theme-preview-${theme.value}`} aria-hidden="true">
                    <span className="theme-preview-sidebar" />
                    <span className="theme-preview-main">
                      <span className="theme-preview-heading" />
                      <span className="theme-preview-panel" />
                      <span className="theme-preview-accent" />
                    </span>
                  </span>
                  <span className="theme-option-copy">
                    <strong>{theme.name}</strong>
                    <small>{theme.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>

          <section className="settings-row" aria-labelledby="density-heading">
            <div className="settings-copy">
              <h4 id="density-heading">Interface spacing</h4>
              <p>Adjust spacing across panels, tables and navigation, up to twice the standard amount.</p>
            </div>
            <div className="range-setting">
              <div className="range-readout"><span>{densityLabel}</span><output htmlFor="density-range">{display.density}%</output></div>
              <input
                id="density-range"
                className="settings-range"
                type="range"
                min="0"
                max="200"
                step="1"
                value={display.density}
                style={{ '--range-progress': `${display.density / 2}%` }}
                aria-label="Interface spacing"
                aria-valuetext={`${densityLabel}, ${display.density} percent`}
                onChange={(event) => onChange('density', Number(event.target.value))}
              />
              <div className="range-labels" aria-hidden="true"><span>Compact</span><span style={{ left: `${STANDARD_DENSITY / 2}%` }}>Standard</span><span>2× spacious</span></div>
            </div>
          </section>
        </div>
      </Card>
    </div>
  )
}
