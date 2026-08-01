import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/** Never leave users on a silent black screen if React crashes. */
class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crash:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || 'Unknown error'
      const isUpdateDepth = /maximum update depth/i.test(msg)
      return (
        <div
          style={{
            minHeight: '100%',
            background: '#0C0C0C',
            color: '#fff',
            fontFamily: 'Inter, system-ui, sans-serif',
            padding: 32,
            boxSizing: 'border-box',
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>
            {msg}
          </p>
          {isUpdateDepth && (
            <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 16, fontSize: 13 }}>
              Usually a React re-render loop. Hard-refresh after a deploy, or try Reload below.
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null })
                window.location.reload()
              }}
              style={{
                background: '#20B8CD',
                border: 0,
                borderRadius: 999,
                color: '#0C0C0C',
                padding: '10px 18px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Reload app
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem('astra_auth_token')
                } catch {
                  /* ignore */
                }
                window.location.hash = '#/auth'
                window.location.reload()
              }}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 999,
                color: '#fff',
                padding: '10px 18px',
                cursor: 'pointer',
              }}
            >
              Clear session & sign in again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
