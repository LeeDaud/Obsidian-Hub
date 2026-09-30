import { useEffect, useRef, useState } from 'react';
import type { UpdateCheckResult, UpdateGateway, UpdateProgress } from '../domain/update';
import { tauriUpdateGateway } from '../services/updateGateway';

type Phase =
  | 'checking'
  | 'ready'
  | 'downloading'
  | 'installing'
  | 'installed'
  | 'check-error'
  | 'install-error';

function UpdateDialog({ gateway, onClose }: { gateway: UpdateGateway; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const installing = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>('checking');
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [restartFailed, setRestartFailed] = useState(false);
  const busy = phase === 'downloading' || phase === 'installing';

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let checked: UpdateCheckResult | null = null;
    void gateway
      .check()
      .then(async (value) => {
        checked = value;
        if (cancelled) {
          await value.update?.close().catch(() => undefined);
          return;
        }
        setResult(value);
        setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('check-error');
      });
    return () => {
      cancelled = true;
      if (checked) void checked.update?.close().catch(() => undefined);
    };
  }, [gateway, attempt]);

  async function restart() {
    setRestartFailed(false);
    try {
      await gateway.restart();
    } catch {
      setRestartFailed(true);
    }
  }

  async function install() {
    if (!result?.update || installing.current) return;
    installing.current = true;
    setPhase('downloading');
    setProgress(null);
    try {
      await result.update.install((value) => {
        setProgress(value);
        setPhase(value.phase);
      });
      setPhase('installed');
      await restart();
    } catch {
      setPhase('install-error');
    } finally {
      installing.current = false;
    }
  }

  const percent = progress?.total
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : undefined;

  return (
    <dialog
      ref={dialogRef}
      className="vault-dialog update-dialog"
      aria-labelledby="update-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!installing.current) onClose();
      }}
    >
      <form onSubmit={(event) => event.preventDefault()}>
        <header>
          <div>
            <h2 id="update-title">Hub 更新</h2>
            <p>{result ? `当前版本 ${result.currentVersion}` : '检查 Obsidian Hub 的新版本'}</p>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
            aria-label="关闭更新窗口"
          >
            关闭
          </button>
        </header>
        <div className="dialog-fields" aria-live="polite" aria-busy={busy || phase === 'checking'}>
          {phase === 'checking' && <p>正在检查更新…</p>}
          {phase === 'check-error' && (
            <p role="alert">暂时无法检查更新。请检查网络，或稍后重试；更新服务可能尚未发布。</p>
          )}
          {phase === 'ready' && !result?.update && <p>当前已是最新版本。</p>}
          {result?.update && (
            <>
              <strong>新版本 {result.update.version}</strong>
              <p className="update-notes">{result.update.notes}</p>
            </>
          )}
          {busy && (
            <>
              <p>
                {phase === 'installing'
                  ? '下载完成，正在验证并安装…'
                  : `正在下载更新${percent === undefined ? '…' : ` ${percent}%`}`}
              </p>
              <progress
                aria-label="更新下载进度"
                max={100}
                value={phase === 'installing' ? 100 : percent}
              />
              <p>安装时 Hub 将退出，完成后重新启动。</p>
            </>
          )}
          {phase === 'install-error' && (
            <p role="alert">
              更新未完成，可能是下载、签名校验或安装失败。你可以重试，也可以关闭窗口继续使用当前版本。
            </p>
          )}
          {phase === 'installed' && <p>更新已安装，正在重启…</p>}
          {restartFailed && <p role="alert">自动重启失败，请关闭 Hub 后重新打开。</p>}
        </div>
        <footer>
          {phase === 'check-error' && (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setPhase('checking');
                setAttempt((value) => value + 1);
              }}
            >
              重新检查
            </button>
          )}
          {(phase === 'ready' || phase === 'install-error') && result?.update && (
            <button type="button" className="primary-button" onClick={() => void install()}>
              {phase === 'install-error' ? '重试下载安装' : '下载并安装'}
            </button>
          )}
          {phase === 'installed' && restartFailed && (
            <button type="button" className="primary-button" onClick={() => void restart()}>
              重新启动
            </button>
          )}
          {!busy && (
            <button type="button" className="secondary-button" onClick={onClose}>
              {result?.update ? '稍后再说' : '完成'}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}

export function UpdateControl({ gateway = tauriUpdateGateway }: { gateway?: UpdateGateway }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="secondary-button update-button"
        onClick={() => setOpen(true)}
      >
        检查更新
      </button>
      {open && <UpdateDialog gateway={gateway} onClose={() => setOpen(false)} />}
    </>
  );
}
