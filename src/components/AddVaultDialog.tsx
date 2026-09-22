import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { NewVaultInput, VaultValidationResult } from '../domain/vault';
import { toAppError } from '../domain/appError';

interface AddVaultDialogProps {
  onChooseDirectories(): Promise<VaultValidationResult[]>;
  onSubmit(inputs: NewVaultInput[]): Promise<void>;
  onClose(): void;
}

interface PendingVault {
  path: string;
  name: string;
}

export function AddVaultDialog({ onChooseDirectories, onSubmit, onClose }: AddVaultDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<PendingVault[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function chooseDirectories() {
    setBusy(true);
    setError(null);
    try {
      const results = await onChooseDirectories();
      if (results.length === 0) return;
      setPending((current) => {
        const merged = [...current];
        for (const result of results) {
          const exists = merged.some(
            (item) => item.path.toLocaleLowerCase() === result.canonicalPath.toLocaleLowerCase(),
          );
          if (!exists) {
            merged.push({ path: result.canonicalPath, name: result.suggestedName });
          }
        }
        return merged;
      });
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setBusy(false);
    }
  }

  function updateName(index: number, name: string) {
    setPending((current) => current.map((item, i) => (i === index ? { ...item, name } : item)));
  }

  function remove(index: number) {
    setPending((current) => current.filter((_, i) => i !== index));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(
        pending.map((item) => ({
          name: item.name,
          path: item.path,
          description: '',
          tags: [],
          obsidianVaultId: null,
        })),
      );
    } catch (reason) {
      setError(toAppError(reason).message);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="vault-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={submit}>
        <header>
          <div>
            <h2>添加仓库</h2>
            <p>一次选择多个已初始化的 Obsidian Vault。</p>
          </div>
          <button
            type="button"
            className="row-icon-button"
            aria-label="关闭添加仓库"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="dialog-fields">
          <button type="button" className="path-picker" onClick={chooseDirectories} disabled={busy}>
            选择包含 .obsidian 的文件夹（可多选）
          </button>
          {pending.length > 0 ? (
            <ul className="pending-vault-list">
              {pending.map((item, index) => (
                <li key={item.path}>
                  <input
                    value={item.name}
                    onChange={(event) => updateName(index, event.target.value)}
                    aria-label={`仓库 ${index + 1} 名称`}
                  />
                  <span className="pending-vault-path">{item.path}</span>
                  <button
                    type="button"
                    className="row-icon-button"
                    aria-label={`移除 ${item.name}`}
                    onClick={() => remove(index)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button" disabled={busy || pending.length === 0}>
            {busy ? '添加中…' : `添加 ${pending.length} 个仓库`}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
