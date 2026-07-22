// MIT License - Copyright (c) fintonlabs.com
// Front-door login. When the server reports login is required, nothing renders
// until a valid session token is held — the whole app sits behind this gate.
import { useEffect, useState } from 'react'
import { Loader2, LogIn } from 'lucide-react'
import { authStatus, login, verifyToken } from '../api'
import { Logo } from './Logo'

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('steprail')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (busy || !username || !password) return
    setBusy(true); setError('')
    const ok = await login(username.trim(), password)
    setBusy(false)
    if (ok) onSuccess()
    else { setError('Wrong username or password.'); setPassword('') }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={e => { e.preventDefault(); void submit() }}>
        <div className="login-brand"><Logo size={30} /><span>steprail</span></div>
        <div className="login-sub">Sign in to continue</div>
        <label className="login-field">
          <span>Username</span>
          <input autoFocus value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary login-submit" type="submit" disabled={busy || !username || !password}>
          {busy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />} Sign in
        </button>
      </form>
    </div>
  )
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<'checking' | 'login' | 'ok'>('checking')

  useEffect(() => {
    let alive = true
    void (async () => {
      const { required } = await authStatus()
      if (!alive) return
      if (!required) return setPhase('ok')
      // Login is on: only enter if the token we already hold is accepted.
      const ok = await verifyToken()
      if (alive) setPhase(ok ? 'ok' : 'login')
    })()
    return () => { alive = false }
  }, [])

  if (phase === 'checking') return <div className="login-screen" />
  if (phase === 'login') return <Login onSuccess={() => setPhase('ok')} />
  return <>{children}</>
}
