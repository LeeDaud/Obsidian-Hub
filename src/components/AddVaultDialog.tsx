import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { NewVaultInput, VaultValidationResult } from '../domain/vault';
import { toAppError } from '../domain/appError';

interface AddVaultDialogProps {
  onChooseDirectory(): Promise<VaultValidationResult | null>;
  onSubmit(input: NewVaultInput): Promise<void>;
  onClose(): void;
}

export function AddVaultDialog({ onChooseDirectory, onSubmit, onClose }: AddVaultDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState<NewVaultInput>({
    name: '',
    path: '',
    description: '',
    tags: [],
    obsidianVaultId: null,
  });
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function chooseDirectory() {
    setBusy(true);
    setError(null);
    try {
      const result = await onChooseDirectory();
      if (result)
        setInput((current) => ({
          ...current,
          name: current.name || result.suggestedName,
          path: result.canonicalPath,
        }));
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ...input,
        tags: tagText
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
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
            <p>选择一个已经初始化的 Obsidian Vault。</p>
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
          <label>
            <span>仓库目录</span>
            <button type="button" className="path-picker" onClick={chooseDirectory} disabled={busy}>
              {input.path || '选择包含 .obsidian 的文件夹'}
            </button>
          </label>
          <label>
            <span>显示名称</span>
            <input
              value={input.name}
              onChange={(event) => setInput({ ...input, name: event.target.value })}
              required
            />
          </label>
          <label>
            <span>简短描述</span>
            <input
              value={input.description}
              onChange={(event) => setInput({ ...input, description: event.target.value })}
              placeholder="这个仓库主要用来做什么"
            />
          </label>
          <div className="dialog-grid">
            <label>
              <span>标签</span>
              <input
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                placeholder="工作, 写作"
              />
            </label>
            <label>
              <span>Vault ID（可选）</span>
              <input
                value={input.obsidianVaultId ?? ''}
                onChange={(event) =>
                  setInput({ ...input, obsidianVaultId: event.target.value || null })
                }
                placeholder="16 位十六进制 ID"
              />
            </label>
          </div>
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
          <button
            type="submit"
            className="primary-button"
            disabled={busy || !input.path || !input.name.trim()}
          >
            {busy ? '保存中…' : '添加仓库'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
