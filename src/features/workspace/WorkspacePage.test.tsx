import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppConfigV2, VaultRole } from '../../domain/vault';
import type { WorkspaceSnapshot } from '../../domain/workspace';
import type { VaultGateway } from '../../services/vaultGateway';
import { WorkspacePage } from './WorkspacePage';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
});

const roles: VaultRole[] = ['echo', 'main', 'knowledge', 'output'];
const config: AppConfigV2 = {
  schemaVersion: 2,
  preferences: { theme: 'system', sortMode: 'name', closeAfterLaunch: false },
  workspace: { hubVaultId: null, initializedAt: null },
  vaults: roles.map((role) => ({
    id: role,
    name: role,
    path: `D:/Notes/${role}`,
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

const snapshot: WorkspaceSnapshot = {
  notes: [
    {
      id: 'echo:Idea.md',
      vaultId: 'echo',
      vaultName: 'echo',
      relativePath: 'Idea.md',
      fileName: 'Idea.md',
      title: 'Idea',
      aliases: [],
      tags: [],
      modifiedAt: Date.now(),
      size: 20,
      contentHash: 'source-hash',
    },
  ],
  tasks: [
    {
      id: 'echo:Idea.md:2',
      vaultId: 'echo',
      vaultName: 'echo',
      relativePath: 'Idea.md',
      lineNumber: 2,
      text: 'Review idea',
      complete: false,
      contentHash: 'source-hash',
    },
  ],
  vaultStatuses: roles.map((role) => ({ vaultId: role, online: true, readErrors: 0 })),
  scannedAt: Date.now(),
  fromCache: false,
};

function gateway(): VaultGateway {
  return {
    loadConfig: vi.fn().mockResolvedValue(config),
    saveConfig: vi.fn().mockImplementation(async (value) => value),
    chooseDirectory: vi.fn(),
    chooseDirectories: vi.fn(),
    validateDirectory: vi.fn(),
    listObsidianVaults: vi.fn(),
    loadOverviewCache: vi.fn(),
    scanOverview: vi.fn(),
    launch: vi.fn(),
    closeWindow: vi.fn(),
    scanWorkspace: vi.fn().mockResolvedValue(snapshot),
    loadWorkspaceState: vi
      .fn()
      .mockResolvedValue({ schemaVersion: 1, todayPlan: {}, reviewed: [] }),
    createWorkspaceNote: vi.fn().mockImplementation(async (request) => ({
      vaultId: request.kind === 'cognition' ? 'main' : 'output',
      relativePath: `${request.title}.md`,
      contentHash: 'new-hash',
    })),
    openWorkspaceNote: vi.fn().mockResolvedValue('obsidian://open'),
    readWorkspaceNote: vi.fn().mockImplementation(async (vaultId, relativePath) => ({
      vaultId,
      vaultName: vaultId,
      relativePath,
      content: '# Preview\n\n<script>unsafe()</script>\n',
      contentHash: 'current-hash',
      changed: true,
    })),
    setWorkspaceTaskComplete: vi
      .fn()
      .mockResolvedValue({ vaultId: 'echo', relativePath: 'Idea.md', contentHash: 'new-hash' }),
    setTodayTask: vi.fn().mockResolvedValue({ schemaVersion: 1, todayPlan: {}, reviewed: [] }),
    setEchoReviewed: vi
      .fn()
      .mockResolvedValue({ schemaVersion: 1, todayPlan: {}, reviewed: ['echo:Idea.md'] }),
  };
}

describe('WorkspacePage', () => {
  it('previews a note in Hub without executing HTML and opens Obsidian only on request', async () => {
    const user = userEvent.setup();
    const api = gateway();
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: '待处理灵感' }));
    await user.click(await screen.findByRole('button', { name: 'Idea' }));
    const dialog = await screen.findByRole('dialog', { name: 'Idea' });
    expect(api.readWorkspaceNote).toHaveBeenCalledWith('echo', 'Idea.md', 'source-hash');
    expect(within(dialog).getByRole('heading', { name: 'Preview' })).toBeVisible();
    expect(within(dialog).getByText('<script>unsafe()</script>')).toBeVisible();
    expect(dialog.querySelector('script')).toBeNull();
    expect(within(dialog).getByText('文件已变化，当前显示磁盘最新内容')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '标为已阅' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '添加认知笔记' })).toBeVisible();
    expect(api.openWorkspaceNote).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '在 Obsidian 中打开' }));
    expect(api.openWorkspaceNote).toHaveBeenCalledWith('echo', 'Idea.md');
  });
  it('saves stage folders in workflow settings before creating notes', async () => {
    const user = userEvent.setup();
    const api = gateway();
    const changed = vi.fn();
    render(<WorkspacePage config={config} gateway={api} onConfigChange={changed} />);
    await user.click(screen.getByRole('button', { name: '工作流设置' }));
    await user.type(screen.getByLabelText('Main 默认保存目录'), 'Cognition');
    await user.type(screen.getByLabelText('Output 默认保存目录'), 'Articles');
    await user.click(screen.getByRole('button', { name: '保存工作流' }));
    await waitFor(() =>
      expect(changed).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: { ...config.workspace, mainFolder: 'Cognition', outputFolder: 'Articles' },
        }),
      ),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('blocks invalid workflow directories and keeps settings open on save failure', async () => {
    const user = userEvent.setup();
    const api = gateway();
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '工作流设置' }));
    await user.type(screen.getByLabelText('Main 默认保存目录'), '../echo');
    await user.click(screen.getByRole('button', { name: '保存工作流' }));
    expect(api.saveConfig).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Main 默认保存目录'));
    await user.type(screen.getByLabelText('Main 默认保存目录'), 'Missing');
    vi.mocked(api.saveConfig).mockRejectedValue({
      code: 'NOTE_PARENT_MISSING',
      message: '目标文件夹不存在',
    });
    await user.click(screen.getByRole('button', { name: '保存工作流' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
      '目标文件夹不存在',
    );
  });
  it('creates directly in Main without a Hub vault and opens the result', async () => {
    const user = userEvent.setup();
    const api = gateway();
    vi.mocked(api.createWorkspaceNote!).mockResolvedValue({
      vaultId: 'main',
      relativePath: '认知/新的认知.md',
      contentHash: 'new-hash',
    });
    render(
      <WorkspacePage
        config={{ ...config, workspace: { ...config.workspace, mainFolder: '认知' } }}
        gateway={api}
        onConfigChange={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('button', { name: '待处理灵感' }));
    await user.click(await screen.findByRole('button', { name: '预览' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Idea' })).getByRole('button', {
        name: '添加认知笔记',
      }),
    );
    await user.clear(screen.getByLabelText('笔记标题'));
    await user.paste('新的认知');
    expect(screen.queryByLabelText('保存目录')).not.toBeInTheDocument();
    expect(screen.getByText('将创建：main / 认知/新的认知.md')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '创建并打开' }));
    await waitFor(() =>
      expect(api.createWorkspaceNote).toHaveBeenCalledWith({
        kind: 'cognition',
        title: '新的认知',
        source: { vaultId: 'echo', relativePath: 'Idea.md', contentHash: 'source-hash' },
        references: [],
      }),
    );
    await waitFor(() =>
      expect(api.openWorkspaceNote).toHaveBeenCalledWith('main', '认知/新的认知.md'),
    );
  });

  it('updates one task in place without rescanning the workspace', async () => {
    const user = userEvent.setup();
    const api = gateway();
    let finish!: (value: { vaultId: string; relativePath: string; contentHash: string }) => void;
    vi.mocked(api.setWorkspaceTaskComplete!).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    const checkbox = await screen.findByRole('checkbox', { name: '完成 Review idea' });
    await waitFor(() => expect(api.scanWorkspace).toHaveBeenCalledTimes(1));
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(api.scanWorkspace).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(api.setWorkspaceTaskComplete).toHaveBeenCalledWith(
        'echo',
        'Idea.md',
        2,
        'source-hash',
        true,
      ),
    );
    finish({ vaultId: 'echo', relativePath: 'Idea.md', contentHash: 'updated-hash' });
    await waitFor(() => expect(checkbox).not.toBeDisabled());
    expect(api.scanWorkspace).toHaveBeenCalledTimes(1);
  });

  it('rolls back an optimistic task update when the file write fails', async () => {
    const user = userEvent.setup();
    const api = gateway();
    vi.mocked(api.setWorkspaceTaskComplete!).mockRejectedValue({
      code: 'CONTENT_CHANGED',
      message: '源笔记已变化，请刷新后重试。',
    });
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    const checkbox = await screen.findByRole('checkbox', { name: '完成 Review idea' });
    await user.click(checkbox);
    expect(await screen.findByRole('alert')).toHaveTextContent('源笔记已变化，请刷新后重试。');
    expect(checkbox).not.toBeChecked();
    expect(api.scanWorkspace).toHaveBeenCalledTimes(1);
  });

  it('creates an Output note with selected Knowledge references', async () => {
    const user = userEvent.setup();
    const api = gateway();
    const main = {
      ...snapshot.notes[0],
      id: 'main:Main.md',
      vaultId: 'main',
      relativePath: 'Main.md',
      title: 'Main',
    };
    const references = ['A', 'B'].map((title) => ({
      ...snapshot.notes[0],
      id: `knowledge:${title}.md`,
      vaultId: 'knowledge',
      relativePath: `${title}.md`,
      title,
    }));
    vi.mocked(api.scanWorkspace!).mockResolvedValue({ ...snapshot, notes: [main, ...references] });
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '认知' }));
    await user.click(await screen.findByRole('button', { name: '创建输出笔记' }));
    const dialog = screen.getByRole('dialog', { name: '创建输出笔记' });
    for (const checkbox of within(dialog).getAllByRole('checkbox')) await user.click(checkbox);
    await user.click(within(dialog).getByRole('button', { name: '创建并打开' }));
    await waitFor(() =>
      expect(api.createWorkspaceNote).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'output',
          references: references.map((n) => ({
            vaultId: n.vaultId,
            relativePath: n.relativePath,
            contentHash: n.contentHash,
          })),
        }),
      ),
    );
    await waitFor(() => expect(api.openWorkspaceNote).toHaveBeenCalledWith('output', 'Main.md'));
  });

  it('blocks invalid names and known case-insensitive target conflicts', async () => {
    const user = userEvent.setup();
    const api = gateway();
    vi.mocked(api.scanWorkspace!).mockResolvedValue({
      ...snapshot,
      notes: [
        ...snapshot.notes,
        { ...snapshot.notes[0], id: 'main:idea.md', vaultId: 'main', relativePath: 'idea.md' },
      ],
    });
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '待处理灵感' }));
    await user.click(await screen.findByRole('button', { name: '预览' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Idea' })).getByRole('button', {
        name: '添加认知笔记',
      }),
    );
    expect(screen.getByRole('button', { name: '创建并打开' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '打开已有笔记' }));
    expect(api.openWorkspaceNote).toHaveBeenCalledWith('main', 'idea.md');
    await user.clear(screen.getByLabelText('笔记标题'));
    await user.type(screen.getByLabelText('笔记标题'), 'CON');
    expect(screen.getByRole('button', { name: '创建并打开' })).toBeDisabled();
    expect(api.createWorkspaceNote).not.toHaveBeenCalled();
  });

  it('keeps the dialog and shows a backend conflict without retrying', async () => {
    const user = userEvent.setup();
    const api = gateway();
    vi.mocked(api.createWorkspaceNote!).mockRejectedValue({
      code: 'NOTE_TARGET_EXISTS',
      message: '目标笔记已存在',
    });
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '待处理灵感' }));
    await user.click(await screen.findByRole('button', { name: '预览' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Idea' })).getByRole('button', {
        name: '添加认知笔记',
      }),
    );
    await user.click(screen.getByRole('button', { name: '创建并打开' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('目标笔记已存在');
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(api.openWorkspaceNote).not.toHaveBeenCalled();
  });

  it('does not recreate a successfully saved note when opening fails', async () => {
    const user = userEvent.setup();
    const api = gateway();
    vi.mocked(api.openWorkspaceNote!).mockRejectedValue({
      code: 'OBSIDIAN_LAUNCH_FAILED',
      message: 'Obsidian 未能打开',
    });
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '待处理灵感' }));
    await user.click(await screen.findByRole('button', { name: '预览' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Idea' })).getByRole('button', {
        name: '添加认知笔记',
      }),
    );
    await user.click(screen.getByRole('button', { name: '创建并打开' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Obsidian 未能打开');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.createWorkspaceNote).toHaveBeenCalledTimes(1);
  });

  it('paginates all notes and searches across roles on the same page', async () => {
    const user = userEvent.setup();
    const api = gateway();
    vi.mocked(api.scanWorkspace!).mockResolvedValue({
      ...snapshot,
      notes: Array.from({ length: 12 }, (_, index) => ({
        ...snapshot.notes[0],
        id: String(index),
        title: `Idea ${index}`,
        modifiedAt: 100 - index,
      })),
    });
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '最近内容' }));
    await screen.findByRole('button', { name: 'Idea 0' });
    expect(screen.queryByRole('button', { name: 'Idea 11' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.queryByRole('button', { name: 'Idea 0' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: '搜索全部笔记' }), 'Idea 11');
    expect(screen.getByRole('button', { name: 'Idea 11' })).toBeVisible();
    expect(screen.getByRole('heading', { name: /知识工作台/ })).toBeVisible();
  });

  it('shows all tasks by default and orders them by the source note modification time', async () => {
    const api = gateway();
    const older = {
      ...snapshot.notes[0],
      id: 'echo:Old.md',
      relativePath: 'Old.md',
      title: 'Old',
      modifiedAt: 10,
    };
    const newer = {
      ...snapshot.notes[0],
      id: 'echo:New.md',
      relativePath: 'New.md',
      title: 'New',
      modifiedAt: 20,
    };
    vi.mocked(api.scanWorkspace!).mockResolvedValue({
      ...snapshot,
      notes: [older, newer],
      tasks: [
        {
          ...snapshot.tasks[0],
          id: 'old',
          relativePath: 'Old.md',
          lineNumber: 2,
          text: 'Older task',
        },
        {
          ...snapshot.tasks[0],
          id: 'new-2',
          relativePath: 'New.md',
          lineNumber: 8,
          text: 'Newer task second',
        },
        {
          ...snapshot.tasks[0],
          id: 'new-1',
          relativePath: 'New.md',
          lineNumber: 3,
          text: 'Newer task first',
        },
      ],
    });
    render(<WorkspacePage config={config} gateway={api} onConfigChange={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '所有任务' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: '今日任务' })).not.toBeInTheDocument();
    const titles = screen
      .getAllByRole('button', { name: /task/ })
      .map((button) => button.textContent);
    expect(titles).toEqual(['Newer task first', 'Newer task second', 'Older task']);
  });
});
