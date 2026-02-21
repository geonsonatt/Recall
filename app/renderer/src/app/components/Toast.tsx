interface ToastProps {
  message: string;
  type?: 'info' | 'error' | 'success';
}

export function Toast({ message, type = 'info' }: ToastProps) {
  if (!message) {
    return null;
  }

  return (
    <div className={`toast toast-${type}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
