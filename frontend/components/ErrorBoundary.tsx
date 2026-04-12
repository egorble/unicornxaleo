import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary]', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#050507] p-6">
                    <div className="max-w-md w-full text-center">
                        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
                            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                        </div>

                        <h1 className="text-2xl font-black text-white mb-2">
                            Oops, something went wrong
                        </h1>
                        <p className="text-gray-400 text-sm mb-8">
                            Don't worry, your funds and cards are safe. Try refreshing the page.
                        </p>

                        <button
                            onClick={() => window.location.reload()}
                            className="bg-yc-aleo hover:bg-orange-600 text-white px-8 py-3 rounded-xl font-bold text-sm uppercase tracking-wider transition-all active:scale-95"
                        >
                            Refresh Page
                        </button>

                        {this.state.error && (
                            <details className="mt-6 text-left">
                                <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 transition-colors">
                                    Technical details
                                </summary>
                                <pre className="mt-2 text-[10px] text-gray-600 bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 overflow-auto max-h-32 font-mono">
                                    {this.state.error.message}
                                </pre>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
