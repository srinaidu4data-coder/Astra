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
          <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
            {this.state.error.message || 'Unknown error'}
          </p>
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
              background: '#20B8CD',
              border: 0,
              borderRadius: 999,
              color: '#fff',
              padding: '10px 18px',
              cursor: 'pointer',
            }}
          >
            Clear session & sign in again
          </button>
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
