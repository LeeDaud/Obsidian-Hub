import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { NewVaultInput, ObsidianVaultEntry, VaultValidationResult } from '../domain/vault';
import { toAppError } from '../domain/appError';

interface AddVaultDialogProps {
  onChooseDirectories(): Promise<VaultValidationResult[]>;
  onImportObsidian(): Promise<ObsidianVaultEntry[]>;
  onSubmit(inputs: NewVaultInput[]): Promise<void>;
  onClose(): void;
}

interface PendingVault {
  path: string;
  name: string;
  obsidianVaultId?: string;
}

export function AddVaultDialog({
  onChooseDirectories,
  onImportObsidian,
  onSubmit,
  onClose,
}: AddVaultDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<PendingVault[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function appendVaults(vaults: Array<{ path: string; name: string; obsidianVaultId?: string }>) {
    setPending((current) => {
      const merged = [...current];
      for (const vault of vaults) {
        const exists = merged.some(
          (item) => item.path.toLocaleLowerCase() === vault.path.toLocaleLowerCase(),
        );
        if (!exists) {
          merged.push({
            path: vault.path,
            name: vault.name,
            obsidianVaultId: vault.obsidianVaultId,
          });
        }
      }
      return merged;
    });
  }

  async function chooseDirectories() {
    setBusy(true);
    setError(null);
    try {
      const results = await onChooseDirectories();
      if (results.length === 0) return;
      appendVaults(
        results.map((result) => ({ path: result.canonicalPath, name: result.suggestedName })),
      );
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setBusy(false);
    }
  }

  async function importFromObsidian() {
    setBusy(true);
    setError(null);
    try {
      const vaults = await onImportObsidian();
      if (vaults.length === 0) {
        setError('未发现 Obsidian 已注册的仓库。');
        return;
      }
      appendVaults(
        vaults.map((vault) => ({
          path: vault.path,
          name: vault.name,
          obsidianVaultId: vault.id,
        })),
      );
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
          obsidianVaultId: item.obsidianVaultId ?? null,
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
            <p>选择文件夹，或从 Obsidian 已注册仓库一键导入。</p>
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
          <div className="dialog-grid">
            <button
              type="button"
              className="path-picker"
              onClick={chooseDirectories}
              disabled={busy}
            >
              选择文件夹（可多选）
            </button>
            <button
              type="button"
              className="path-picker"
              onClick={importFromObsidian}
              disabled={busy}
            >
              从 Obsidian 导入
            </button>
          </div>
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
