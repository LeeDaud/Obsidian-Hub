import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
function setup(extra: Partial<WorkspaceSnapshot> = {}, stored: WorkflowLink[] = []) {
  let currentLinks = [...stored];
  const gateway = {
    loadWorkflowLinks: vi.fn().mockResolvedValue({ schemaVersion: 1, links: stored }),
    setWorkflowLink: vi.fn().mockImplementation(async (request) => ({
      schemaVersion: 1,
      links: (currentLinks = request.linked ? [...currentLinks, request.link] : []),
    })),
  } as unknown as VaultGateway;
  const onPreview = vi.fn(),
    onCreate = vi.fn(),
    onOpen = vi.fn();
  const props = { config, gateway, query: '', busy: false, onPreview, onCreate, onOpen };
  const rendered = render(
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
  return {
    gateway,
    onPreview,
    onCreate,
    rerenderSnapshot(next: WorkspaceSnapshot) {
      rendered.rerender(<WorkflowBoard {...props} snapshot={next} />);
    },
    rerenderQuery(query: string) {
      rendered.rerender(
        <WorkflowBoard {...props} query={query} snapshot={{ ...snapshot, ...extra }} />,
      );
    },
  };
}
async function select(role: string) {
  await userEvent.click(
    within(
      screen.getByRole('region', { name: `${role[0].toUpperCase() + role.slice(1)} 看板` }),
    ).getByRole('button', { name: /^选择 / }),
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
        .getAllByRole('button', { name: /^选择 / })
        .map((b) => b.textContent),
    ).toEqual([expect.stringContaining('newer'), expect.stringContaining('older')]);
    await userEvent.click(within(column).getAllByRole('button', { name: /^选择 / })[0]);
    expect(screen.getByText('尚无已确认下游')).toBeInTheDocument();
    expect(screen.getByText(/尚无已确认关联/)).toBeInTheDocument();
  });
  it('selects a card inside the board and writes only after confirmation, retaining the anchor', async () => {
    const { gateway, onCreate, onPreview } = setup();
    await select('echo');
    const button = screen.getByRole('button', { name: /^关联此认知：/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(gateway.setWorkflowLink).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: '待确认关联' })).toHaveTextContent('echo.md');
    expect(screen.getByRole('button', { name: /^选择 echo/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: '预览下游' }));
    expect(onPreview).toHaveBeenCalledWith(notes[1]);
    expect(screen.getByRole('button', { name: '确认关联' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '确认关联' }));
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
    expect(screen.getByText('已关联')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^关联此认知：/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '解除手动关联' }));
    await waitFor(() =>
      expect(gateway.setWorkflowLink).toHaveBeenLastCalledWith(
        expect.objectContaining({ linked: false }),
      ),
    );
  });
  it.each([
    ['main', '关联来源灵感', 'echo', 'main', 'origin'],
    ['main', '关联此输出', 'main', 'output', 'origin'],
    ['output', '关联来源认知', 'main', 'output', 'origin'],
    ['output', '引用此资料', 'knowledge', 'output', 'reference'],
    ['knowledge', '关联引用此资料的输出', 'knowledge', 'output', 'reference'],
  ])(
    'normalizes an association started from %s with %s',
    async (selected, label, source, target, kind) => {
      const { gateway } = setup();
      await select(selected);
      const button = screen.getByRole('button', { name: new RegExp('^' + label + '：') });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      await userEvent.click(screen.getByRole('button', { name: '确认关联' }));
      await waitFor(() =>
        expect(gateway.setWorkflowLink).toHaveBeenCalledWith({
          link: {
            source: { vaultId: source, relativePath: source + '.md' },
            target: { vaultId: target, relativePath: target + '.md' },
            kind,
          },
          linked: true,
          sourceHash: source + '-hash',
          targetHash: target + '-hash',
        }),
      );
    },
  );
  it('cancels with Escape and returns focus to the candidate action without writing', async () => {
    const { gateway } = setup();
    await select('echo');
    const button = screen.getByRole('button', { name: /^关联此认知：/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: '确认关联' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: '确认关联' })).not.toBeInTheDocument();
    expect(gateway.setWorkflowLink).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });
  it('does not cancel the pending association when Escape belongs to a preview dialog', async () => {
    setup();
    await select('echo');
    const button = screen.getByRole('button', { name: /^关联此认知：/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const close = document.createElement('button');
    close.textContent = '预览关闭';
    dialog.append(close);
    document.body.append(dialog);
    close.focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: '确认关联' })).toBeInTheDocument();
    dialog.remove();
  });
  it('keeps the selected note and pending endpoints visible through global and column filters', async () => {
    const { rerenderQuery } = setup();
    await select('echo');
    const button = screen.getByRole('button', { name: /^关联此认知：/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索 Main 关联笔记' }), 'no-match');
    rerenderQuery('nothing');
    expect(screen.getByRole('button', { name: /^选择 echo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^选择 main/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^选择 output/ })).not.toBeInTheDocument();
  });
  it('changes browsing selection without implicitly creating an association', async () => {
    const { gateway } = setup();
    await select('echo');
    await select('main');
    expect(gateway.setWorkflowLink).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^选择 main/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('locks browse, cancel and save during an in-flight write', async () => {
    const { gateway } = setup();
    let finish!: (value: { schemaVersion: 1; links: WorkflowLink[] }) => void;
    vi.mocked(gateway.setWorkflowLink!).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await select('echo');
    const button = screen.getByRole('button', { name: /^关联此认知：/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: '确认关联' }));
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^选择 main/ })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: '保存中…' })).toBeInTheDocument();
    expect(gateway.setWorkflowLink).toHaveBeenCalledTimes(1);
    finish({ schemaVersion: 1, links: [edge] });
    await screen.findByText('关联已保存。');
  });
  it('blocks confirmation after a refresh changes a captured hash until the target is reselected', async () => {
    const { gateway, rerenderSnapshot } = setup();
    await select('echo');
    const button = screen.getByRole('button', { name: /^关联此认知：/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    rerenderSnapshot({
      ...snapshot,
      scannedAt: 2,
      notes: notes.map((n) => (n.vaultId === 'main' ? { ...n, contentHash: 'changed-hash' } : n)),
    });
    expect(screen.getByRole('alert')).toHaveTextContent('笔记已变化');
    expect(screen.getByRole('button', { name: '确认关联' })).toBeDisabled();
    expect(gateway.setWorkflowLink).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: '确认关联' }));
    await waitFor(() =>
      expect(gateway.setWorkflowLink).toHaveBeenCalledWith(
        expect.objectContaining({ targetHash: 'changed-hash' }),
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
  it('retains the pending choice after a failed write and can retry without a modal', async () => {
    const { gateway } = setup();
    vi.mocked(gateway.setWorkflowLink!).mockRejectedValueOnce({
      code: 'WORKSPACE_CONFLICT',
      message: '笔记已变化，请刷新后重试。',
    });
    await select('echo');
    const button = screen.getByRole('button', { name: /^关联此认知：/ });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: '确认关联' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('笔记已变化'));
    expect(screen.getByRole('region', { name: '待确认关联' })).toBeInTheDocument();
    expect(screen.queryByText('Hub 手动关联')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认关联' }));
    await screen.findByText('关联已保存。');
  });
  it('blocks new associations on a load failure while allowing notes to be browsed', async () => {
    const { gateway, rerenderSnapshot } = setup();
    vi.mocked(gateway.loadWorkflowLinks!).mockRejectedValue({
      code: 'WORKFLOW_LINKS_INVALID',
      message: '关联存储损坏',
    });
    rerenderSnapshot({ ...snapshot, scannedAt: 2 });
    await select('echo');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('关联存储损坏'));
    expect(screen.getByRole('button', { name: /^关联此认知：/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '预览笔记' })).toBeEnabled();
  });
});
