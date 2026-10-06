import { useEffect, useRef, type ReactNode } from 'react';

export function WorkspaceDialog({
  title,
  children,
  onClose,
  busy = false,
  className,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`workspace-dialog${className ? ` ${className}` : ''}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label={`关闭${title}`}>
          关闭
        </button>
      </header>
      {children}
    </dialog>
  );
}
