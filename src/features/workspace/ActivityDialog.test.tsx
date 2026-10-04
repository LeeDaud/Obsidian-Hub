import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppConfigV2 } from '../../domain/vault';
import type { VaultGateway } from '../../services/vaultGateway';
import { ActivityDialog } from './ActivityDialog';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
});

const config = {
  schemaVersion: 2,
  preferences: { theme: 'system', sortMode: 'name', closeAfterLaunch: false },
  workspace: { hubVaultId: null, initializedAt: null },
  vaults: [{ id: 'main', name: 'Leedaud' }],
} as AppConfigV2;

describe('ActivityDialog', () => {
  it('shows newest events, storage warnings and clears only after confirmation', async () => {
    const user = userEvent.setup();
    const events = {
      events: [
        {
          schemaVersion: 1 as const,
          id: 'new',
          occurredAt: '2026-10-04T02:00:00Z',
          kind: 'noteCreated' as const,
          outcome: 'succeeded' as const,
          target: { vaultId: 'main', relativePath: 'Cognition/Idea.md' },
          detail: { noteKind: 'cognition' },
        },
        {
          schemaVersion: 1 as const,
          id: 'old',
          occurredAt: '2026-10-04T01:00:00Z',
          kind: 'taskUpdated' as const,
          outcome: 'failed' as const,
          source: { vaultId: 'main', relativePath: 'Tasks.md' },
          detail: { complete: true },
          errorCode: 'NOTE_CHANGED',
        },
      ],
      hasWarnings: true,
      skippedLines: 1,
    };
    const gateway = {
      loadWorkflowEvents: vi.fn().mockResolvedValue(events),
      clearWorkflowEvents: vi
        .fn()
        .mockResolvedValue({ events: [], hasWarnings: false, skippedLines: 0 }),
    } as unknown as VaultGateway;
    render(<ActivityDialog config={config} gateway={gateway} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: '工作流活动' });
    expect(
      within(dialog).getByText('已跳过 1 条损坏或不兼容的活动记录，其余记录仍可使用。'),
    ).toBeVisible();
    expect(within(dialog).getAllByRole('listitem')[0]).toHaveTextContent('创建认知笔记 · 成功');
    expect(within(dialog).getByText('Leedaud / Cognition/Idea.md')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: '清空活动' }));
    expect(gateway.clearWorkflowEvents).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/不会修改任何笔记或任务/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: '确认清空' }));
    await waitFor(() => expect(gateway.clearWorkflowEvents).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByText('还没有工作流活动')).toBeVisible();
  });
});
