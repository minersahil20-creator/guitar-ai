import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
  resetKey?: unknown
}

interface State {
  hasError: boolean
  error: Error | null
  prevResetKey?: unknown
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    prevResetKey: this.props.resetKey,
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  public static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.prevResetKey) {
      return {
        hasError: false,
        error: null,
        prevResetKey: props.resetKey,
      }
    }
    return null
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="card my-4 p-5 border-red-500/30 bg-red-500/5 space-y-3">
          <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
            <AlertTriangle size={17} />
            {this.props.fallbackTitle || 'Unable to display this section'}
          </div>
          <p className="text-xs text-slate-400 font-mono bg-ink-900/90 p-3 rounded-lg border border-ink-700 overflow-x-auto">
            {this.state.error?.message || String(this.state.error)}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink-800 text-xs font-medium text-slate-200 hover:bg-ink-700 hover:text-amber-300 transition">
            <RefreshCw size={12} /> Reload section
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
