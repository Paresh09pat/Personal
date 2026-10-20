'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Heart, X } from 'lucide-react';

const ToastContext = createContext({ toast: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message, { tone = 'love', href, duration = 4500 } = {}) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t.slice(-3), { id, message, tone, href }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="glass animate-pop-in pointer-events-auto flex max-w-md items-center gap-3 rounded-full py-2 pl-3 pr-2 text-sm">
            <Heart className={`h-4 w-4 shrink-0 ${t.tone === 'error' ? 'text-danger' : 'fill-accent text-accent'}`} aria-hidden />
            {t.href ? (
              <a href={t.href} className="line-clamp-1 hover:underline">
                {t.message}
              </a>
            ) : (
              <span className="line-clamp-1">{t.message}</span>
            )}
            <button onClick={() => dismiss(t.id)} className="rounded-full p-1 text-muted hover:text-accent" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext).toast;
