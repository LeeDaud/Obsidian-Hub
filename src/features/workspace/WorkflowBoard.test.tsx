import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppConfigV2, VaultRole } from '../../domain/vault';
import type { WorkflowLink, WorkspaceNote, WorkspaceSnapshot } from '../../domain/workspace';
import type { VaultGateway } from '../../services/vaultGateway';
import { WorkflowBoard } from './WorkflowBoard';
const roles: VaultRole[] = ['echo', 'main', 'output', 'knowledge'];
const config: AppConfigV2 = {
  schemaVersion: 2,
  preferences: { theme: 'system', sortMode: 'name', closeAfterLaunch: false },
  workspace: { hubVaultId: null, initializedAt: null },
  vaults: roles.map((role) => ({
    id: role,
    name: role,
    path: `D:/notes/${role}`,
    role,
    description: '',
    tags: [],
    obsidianVaultId: null,
    favorite: false,
    favoriteOrder: null,
    createdAt: '',
    updatedAt: '',
    lastOpenedAt: null,
  })),
};
function note(role: string, title = role, modifiedAt = 1): WorkspaceNote {
  return {
    id: `${role}:${title}.md`,
    vaultId: role,
    vaultName: role,
    relativePath: `${title}.md`,
    fileName: `${title}.md`,
    title,
    modifiedAt,
    aliases: [],
    tags: [],
    size: 20,
    contentHash: `${role}-hash`,
  };
}
const notes = roles.map((role) => note(role));
const edge: WorkflowLink = {
  source: { vaultId: 'echo', relativePath: 'echo.md' },
  target: { vaultId: 'main', relativePath: 'main.md' },
  kind: 'origin',
};
const snapshot: WorkspaceSnapshot = {
  notes,
  tasks: [],
  vaultStatuses: roles.map((role) => ({ vaultId: role, online: true, readErrors: 0 })),
  scannedAt: 1,
  fromCache: false,
};
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
});
function setup(extra: Partial<WorkspaceSnapshot> = {}, stored: WorkflowLink[] = []) {
  const gateway = {
    loadWorkflowLinks: vi.fn().mockResolvedValue({ schemaVersion: 1, links: stored }),
    setWorkflowLink: vi.fn().mockImplementation(async (request) => ({
      schemaVersion: 1,
      links: request.linked ? [request.link] : [],
    })),
  } as unknown as VaultGateway;
  const onPreview = vi.fn(),
    onCreate = vi.fn(),
    onOpen = vi.fn();
  render(
    <WorkflowBoard
      config={config}
      snapshot={{ ...snapshot, ...extra }}
      gateway={gateway}
      query=""
      busy={false}
      onPreview={onPreview}
      onCreate={onCreate}
      onOpen={onOpen}
    />,
  );
  return { gateway, onPreview, onCreate };
}
async function select(role: string) {
  await userEvent.click(
    within(
      screen.getByRole('region', { name: `${role[0].toUpperCase() + role.slice(1)} 看板` }),
    ).getByRole('button'),
  );
}
describe('four vault workflow board', () => {
  it('shows all columns in order and sorts newest notes first without inferring title relationships', async () => {
    setup({
      notes: [note('echo', 'older', 1), note('echo', 'newer', 3), note('main', 'newer', 2)],
    });
    const column = screen.getByRole('region', { name: 'Echo 看板' });
    expect(
      within(column)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([expect.stringContaining('newer'), expect.stringContaining('older')]);
    await userEvent.click(within(column).getAllByRole('button')[0]);
    expect(screen.getByText('尚无已确认下游')).toBeInTheDocument();
    expect(screen.getByText(/尚无已确认关联/)).toBeInTheDocument();
  });
  it('requires explicit selection and confirmation and persists hashes without creating or editing notes', async () => {
    const { gateway, onCreate } = setup();
    await select('echo');
    const button = screen.getByRole('button', { name: '关联已有笔记' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: '关联已有笔记' });
    expect(within(dialog).getByRole('button', { name: '确认关联' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio'));
    expect(gateway.setWorkflowLink).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: '确认关联' }));
    await waitFor(() =>
      expect(gateway.setWorkflowLink).toHaveBeenCalledWith({
        link: edge,
        linked: true,
        sourceHash: 'echo-hash',
        targetHash: 'main-hash',
      }),
    );
    expect(onCreate).not.toHaveBeenCalled();
    expect(await screen.findByText('Hub 手动关联')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '解除手动关联' }));
    await waitFor(() =>
      expect(gateway.setWorkflowLink).toHaveBeenLastCalledWith(
        expect.objectContaining({ linked: false }),
      ),
    );
  });
  it('uses preview for Echo creation and direct creation for Main', async () => {
    const { onPreview, onCreate } = setup();
    await select('echo');
    await userEvent.click(screen.getByRole('button', { name: '预览后创建认知' }));
    expect(onPreview).toHaveBeenCalledWith(notes[0]);
    expect(onCreate).not.toHaveBeenCalled();
    await select('main');
    await userEvent.click(screen.getByRole('button', { name: '创建输出笔记' }));
    expect(onCreate).toHaveBeenCalledWith(notes[1]);
  });
  it('shows an offline source and retains metadata relationships when manual links fail', async () => {
    setup({
      relations: [edge],
      notes: notes.slice(1),
      vaultStatuses: [{ vaultId: 'echo', online: false, readErrors: 0 }],
    });
    await select('main');
    expect(screen.getByText(/echo \/ echo.md（仓库离线）/)).toBeInTheDocument();
    expect(screen.getByText('笔记来源字段')).toBeInTheDocument();
  });
  it('keeps the confirmation open on conflict and does not show a successful relationship', async () => {
    const { gateway } = setup();
    vi.mocked(gateway.setWorkflowLink!).mockRejectedValue({
      code: 'WORKSPACE_CONFLICT',
      message: '笔记已变化',
    });
    await select('echo');
    const button = screen.getByRole('button', { name: '关联已有笔记' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: '关联已有笔记' });
    await userEvent.click(within(dialog).getByRole('radio'));
    await userEvent.click(within(dialog).getByRole('button', { name: '确认关联' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('笔记已变化'));
    expect(screen.queryByText('Hub 手动关联')).not.toBeInTheDocument();
  });
});
