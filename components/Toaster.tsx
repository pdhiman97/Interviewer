import React, { useState, useEffect, useCallback } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

let toastCount = 0;

const toastEmitter = {
  listeners: new Set<(toast: ToastMessage) => void>(),
  subscribe(callback: (toast: ToastMessage) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  },
  emit(message: string, type: ToastType) {
    toastCount += 1;
    const newToast: ToastMessage = { id: toastCount, message, type };
    this.listeners.forEach(listener => listener(newToast));
  },
};

export const toast = {
  success: (message: string) => toastEmitter.emit(message, 'success'),
  error: (message: string) => toastEmitter.emit(message, 'error'),
  info: (message: string) => toastEmitter.emit(message, 'info'),
};

const Toast: React.FC<{ message: ToastMessage; onDismiss: (id: number) => void }> = ({ message, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(message.id);
    }, 5000);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  const baseClasses = "flex items-center w-full max-w-xs p-4 my-2 text-white rounded-lg shadow-lg";
  const typeClasses = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
  };

  return (
    <div className={`${baseClasses} ${typeClasses[message.type]}`} role="alert">
      <div className="ms-3 text-sm font-medium">{message.message}</div>
      <button
        type="button"
        className="ms-auto -mx-1.5 -my-1.5 bg-white/20 text-white hover:text-white rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-white/30 inline-flex items-center justify-center h-8 w-8"
        onClick={() => onDismiss(message.id)}
        aria-label="Close"
      >
        <span className="sr-only">Close</span>
        <svg className="w-3 h-3" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14">
          <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"/>
        </svg>
      </button>
    </div>
  );
};

export const Toaster: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const unsubscribe = toastEmitter.subscribe((newToast) => {
      setToasts((currentToasts) => [...currentToasts, newToast]);
    });
    return () => unsubscribe();
  }, []);

  const handleDismiss = useCallback((id: number) => {
    setToasts((currentToasts) => currentToasts.filter(t => t.id !== id));
  }, []);

  return (
    <div className="fixed top-5 right-5 z-50">
      {toasts.map((t) => (
        <Toast key={t.id} message={t} onDismiss={handleDismiss} />
      ))}
    </div>
  );
};
