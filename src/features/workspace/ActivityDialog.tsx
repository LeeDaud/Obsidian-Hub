import { useCallback, useEffect, useState } from 'react';
import type { AppConfigV2 } from '../../domain/vault';
import type { WorkflowEvent, WorkflowEventQuery } from '../../domain/workspace';
import { toAppError } from '../../domain/appError';
import type { VaultGateway } from '../../services/vaultGateway';
import { WorkspaceDialog } from './WorkspaceDialog';

function actionLabel(event: WorkflowEvent) {
  if (event.kind === 'noteCreated') {
    return event.detail?.noteKind === 'output' ? '创建输出笔记' : '创建认知笔记';
  }
  if (event.kind === 'taskUpdated') return event.detail?.complete ? '完成任务' : '恢复任务';
  return event.detail?.reviewed ? '标为已阅' : '恢复待处理';
}

export function ActivityDialog({
  config,
  gateway,
  onClose,
}: {
  config: AppConfigV2;
  gateway: VaultGateway;
  onClose(): void;
}) {
  const [result, setResult] = useState<WorkflowEventQuery | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const vaultNames = new Map(config.vaults.map((vault) => [vault.id, vault.name]));

  const load = useCallback(async () => {
    if (!gateway.loadWorkflowEvents) {
      setError('当前运行环境不支持工作流活动。');
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await gateway.loadWorkflowEvents());
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setBusy(false);
    }
  }, [gateway]);

  useEffect(() => void load(), [load]);

  async function clear() {
    if (!gateway.clearWorkflowEvents) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await gateway.clearWorkflowEvents());
      setConfirmClear(false);
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setBusy(false);
    }
  }

  function noteLabel(reference: WorkflowEvent['source']) {
    if (!reference) return '无文件引用';
    return `${vaultNames.get(reference.vaultId) ?? reference.vaultId} / ${reference.relativePath}`;
  }

  return (
    <WorkspaceDialog title="工作流活动" onClose={onClose} busy={busy} className="activity-dialog">
      {busy && !result && <p className="workspace-subtle">正在读取活动…</p>}
      {error && (
        <p className="workspace-alert" role="alert">
          {error}
        </p>
      )}
      {result?.hasWarnings && (
        <p className="workspace-alert" role="status">
          已跳过 {result.skippedLines} 条损坏或不兼容的活动记录，其余记录仍可使用。
        </p>
      )}
      {result && !result.events.length && !busy && (
        <div className="activity-empty">
          <strong>还没有工作流活动</strong>
          <p>创建笔记、更新任务或标记灵感后会记录在这里。</p>
        </div>
      )}
      {!!result?.events.length && (
        <ol className="activity-list">
          {result.events.map((event) => {
            const reference = event.target ?? event.source;
            return (
              <li key={event.id}>
                <span className={`activity-outcome is-${event.outcome}`} aria-hidden="true" />
                <div>
                  <strong>
                    {actionLabel(event)} · {event.outcome === 'succeeded' ? '成功' : '失败'}
                  </strong>
                  <span title={noteLabel(reference)}>
                    {noteLabel(reference)}
                    {event.errorCode ? ` · ${event.errorCode}` : ''}
                  </span>
                </div>
                <time dateTime={event.occurredAt}>
                  {new Intl.DateTimeFormat('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(event.occurredAt))}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      {confirmClear && (
        <p className="workspace-alert" role="alert">
          只会清空 Hub 活动记录，不会修改任何笔记或任务。确定继续吗？
        </p>
      )}
      <footer>
        {confirmClear ? (
          <>
            <button type="button" disabled={busy} onClick={() => setConfirmClear(false)}>
              取消
            </button>
            <button type="button" disabled={busy} onClick={() => void clear()}>
              确认清空
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || !result?.events.length}
            onClick={() => setConfirmClear(true)}
          >
            清空活动
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void load()}>
          刷新
        </button>
      </footer>
    </WorkspaceDialog>
  );
}
