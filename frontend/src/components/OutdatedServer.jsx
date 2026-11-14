import { AlertCircle } from 'lucide-react'

// Shown when the dashboard is newer than the API server it talks to
export default function OutdatedServer() {
  return (
    <div className="connection-alert" role="alert">
      <AlertCircle size={17} aria-hidden="true" />
      <div>
        <strong>The CardioLens server is out of date</strong>
        <p>This dashboard is newer than the server it is talking to — usually an old server is still running after a <code>git pull</code>.
          Stop it (Ctrl+C in its terminal, or close that terminal), then run <code>python3 Main.py</code> again. Until then, features such as doctor sign-in won't work.</p>
      </div>
    </div>
  )
}
