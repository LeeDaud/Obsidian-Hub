import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { VaultGateway } from '../services/vaultGateway';

function createGateway(): VaultGateway {
  return {
    loadConfig: vi.fn().mockResolvedValue({
      schemaVersion: 2,
      workspace: { hubVaultId: null, initializedAt: null },
      preferences: { theme: 'system', sortMode: 'favoriteThenRecent', closeAfterLaunch: false },
      vaults: [
        {
          id: 'main',
          name: 'Main Vault',
          path: 'D:\\Notes\\Main',
          description: '长期知识库',
          tags: ['knowledge'],
          obsidianVaultId: null,
          favorite: true,
          favoriteOrder: 0,
          createdAt: '2026-07-14T00:00:00.000Z',
          updatedAt: '2026-07-14T00:00:00.000Z',
          lastOpenedAt: null,
          role: null,
        },
      ],
    }),
    saveConfig: vi.fn().mockImplementation(async (config) => config),
    chooseDirectory: vi.fn().mockResolvedValue('D:\\Notes\\Main'),
    chooseDirectories: vi.fn().mockResolvedValue(['D:\\Notes\\Main']),
    listObsidianVaults: vi
      .fn()
      .mockResolvedValue([{ id: 'abcdef0123456789', name: 'Main', path: 'D:\\Notes\\Main' }]),
    validateDirectory: vi
      .fn()
      .mockResolvedValue({ canonicalPath: 'D:\\Notes\\Main', suggestedName: 'Main' }),
    loadOverviewCache: vi.fn().mockResolvedValue(null),
    scanOverview: vi.fn().mockResolvedValue({
      vaultCount: 1,
      scannedVaultCount: 1,
      noteCount: 128,
      folderCount: 24,
      scannedAt: new Date('2026-07-14T10:00:00.000Z').getTime(),
    }),
    launch: vi.fn().mockResolvedValue('obsidian://open?vault=Main'),
    getBridgeStatus: vi.fn().mockResolvedValue({
      state: 'not-installed',
      installedVersion: null,
      bundledVersion: '0.1.0',
    }),
    installBridge: vi
      .fn()
      .mockResolvedValue('D:\\Notes\\Main\\.obsidian\\plugins\\obsidian-hub-bridge'),
    closeWindow: vi.fn().mockResolvedValue(undefined),
  };
}

describe('App', () => {
  it('keeps vault management as the default page and orders navigation first', async () => {
    const gateway = createGateway();
    const loaded = await gateway.loadConfig();
    loaded.vaults[0].role = 'main';
    vi.mocked(gateway.loadConfig).mockResolvedValue(loaded);
    render(<App gateway={gateway} />);
    await screen.findByText('TODAY · SPACES');
    const navigation = screen.getByRole('navigation', { name: '主导航' });
    const buttons = Array.from(navigation.querySelectorAll('button')).map(
      (button) => button.textContent,
    );
    expect(buttons.slice(0, 2)).toEqual(['仓库管理', '工作台']);
    expect(screen.getByRole('button', { name: '仓库管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
  it('loads and displays persisted vaults', async () => {
    const gateway = createGateway();
    render(<App gateway={gateway} />);

    expect((await screen.findAllByText('Main Vault')).length).toBeGreaterThan(0);
    expect(screen.queryByText('D:\\Notes\\Main')).not.toBeInTheDocument();
    expect(await screen.findByText('128')).toBeInTheDocument();
    await waitFor(() => expect(gateway.validateDirectory).toHaveBeenCalledWith('D:\\Notes\\Main'));
  });

  it('filters vaults and opens the keyboard selection', async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<App gateway={gateway} />);

    const search = await screen.findByRole('searchbox', { name: '搜索仓库' });
    await waitFor(() => expect(gateway.validateDirectory).toHaveBeenCalledWith('D:\\Notes\\Main'));
    await user.type(search, 'knowledge');
    expect(screen.getAllByText('Main Vault').length).toBeGreaterThan(0);
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(gateway.launch).toHaveBeenCalledWith({
        name: 'Main Vault',
        obsidianVaultId: 'abcdef0123456789',
      }),
    );
    expect(gateway.saveConfig).toHaveBeenCalled();
  });

  it('changes sorting from the custom sort menu', async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<App gateway={gateway} />);

    await user.click(await screen.findByRole('button', { name: '仓库排序：智能排序' }));
    const recentOption = screen
      .getAllByRole('menuitemradio')
      .find((option) => option.getAttribute('data-sort-value') === 'recent');
    expect(recentOption).toBeDefined();
    await user.click(recentOption!);

    await waitFor(() =>
      expect(gateway.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({ sortMode: 'recent' }),
        }),
      ),
    );
  });

  it('offers real quick actions without opening a random vault automatically', async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<App gateway={gateway} />);

    await screen.findByText('TODAY · SPACES');
    await user.click(screen.getByRole('button', { name: /随便看看/ }));
    expect(gateway.launch).not.toHaveBeenCalled();

    await waitFor(() => expect(gateway.validateDirectory).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /打开所选/ }));
    await waitFor(() => expect(gateway.launch).toHaveBeenCalledTimes(1));
  });

  it('installs Bridge for an existing vault and shows auto-enabled state', async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    render(<App gateway={gateway} />);

    await user.click(await screen.findByRole('button', { name: '安装 Bridge' }));

    await waitFor(() =>
      expect(gateway.installBridge).toHaveBeenCalledWith('D:\\Notes\\Main', 'main'),
    );
    expect(await screen.findByText('Bridge 已自动启用')).toBeInTheDocument();
  });
});

describe('vault identity after moving a vault', () => {
  async function withStaleId() {
    const gateway = createGateway();
    const config = await gateway.loadConfig();
    config.vaults[0].obsidianVaultId = '1111111111111111';
    vi.mocked(gateway.loadConfig).mockResolvedValue(config);
    return gateway;
  }

  async function openSelected(user: ReturnType<typeof userEvent.setup>) {
    const button = await screen.findByRole('button', { name: /打开所选/ });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
  }

  it('replaces a stale ID before launching an already repaired path', async () => {
    const gateway = await withStaleId();
    const user = userEvent.setup();
    render(<App gateway={gateway} />);
    await openSelected(user);
    await waitFor(() =>
      expect(gateway.launch).toHaveBeenCalledExactlyOnceWith({
        name: 'Main Vault',
        obsidianVaultId: 'abcdef0123456789',
      }),
    );
    const saved = vi.mocked(gateway.saveConfig).mock.calls.at(-1)![0].vaults[0];
    expect(saved).toMatchObject({
      id: 'main',
      favorite: true,
      obsidianVaultId: 'abcdef0123456789',
    });
    expect(saved.lastOpenedAt).not.toBeNull();
  });

  it.each([
    ['\\\\?\\D:\\Moved\\Main', 'd:/moved/main/'],
    ['\\\\?\\UNC\\server\\share\\Main', '\\\\SERVER\\share\\Main\\'],
  ])('repairs the path and ID together for %s', async (canonicalPath, registeredPath) => {
    const gateway = await withStaleId();
    vi.mocked(gateway.validateDirectory)
      .mockRejectedValueOnce({ code: 'VAULT_PATH_NOT_FOUND', message: '路径不存在' })
      .mockResolvedValue({ canonicalPath, suggestedName: 'Main' });
    vi.mocked(gateway.listObsidianVaults).mockResolvedValue([
      { id: 'abcdef0123456789', name: 'Main', path: registeredPath },
    ]);
    const user = userEvent.setup();
    render(<App gateway={gateway} />);
    await user.click(await screen.findByRole('button', { name: '修复路径' }));
    await screen.findByText('已修复 Main Vault 的路径');
    expect(vi.mocked(gateway.saveConfig).mock.calls[0][0].vaults[0]).toMatchObject({
      id: 'main',
      path: canonicalPath,
      obsidianVaultId: 'abcdef0123456789',
      favorite: true,
    });
    await openSelected(user);
    await waitFor(() =>
      expect(gateway.launch).toHaveBeenCalledExactlyOnceWith({
        name: 'Main Vault',
        obsidianVaultId: 'abcdef0123456789',
      }),
    );
  });

  it('clears the old ID when repairing to an unregistered path', async () => {
    const gateway = await withStaleId();
    vi.mocked(gateway.validateDirectory)
      .mockRejectedValueOnce({ code: 'VAULT_PATH_NOT_FOUND', message: '路径不存在' })
      .mockResolvedValue({ canonicalPath: 'D:\\Moved\\Main', suggestedName: 'Main' });
    const user = userEvent.setup();
    render(<App gateway={gateway} />);
    await user.click(await screen.findByRole('button', { name: '修复路径' }));
    await screen.findByText(/此路径尚未在 Obsidian 中登记/);
    expect(vi.mocked(gateway.saveConfig).mock.calls[0][0].vaults[0]).toMatchObject({
      id: 'main',
      path: 'D:\\Moved\\Main',
      obsidianVaultId: null,
      lastOpenedAt: null,
    });
    await openSelected(user);
    await waitFor(() => expect(gateway.listObsidianVaults).toHaveBeenCalledTimes(2));
    await screen.findByText(/此路径尚未在 Obsidian 中登记/);
    expect(gateway.launch).not.toHaveBeenCalled();
    expect(gateway.closeWindow).not.toHaveBeenCalled();
  });

  it('blocks a same-name vault at another path, then recovers after registration', async () => {
    const gateway = await withStaleId();
    vi.mocked(gateway.listObsidianVaults).mockResolvedValue([
      { id: '1111111111111111', name: 'Main Vault', path: 'D:\\Other\\Main' },
    ]);
    const user = userEvent.setup();
    render(<App gateway={gateway} />);
    await openSelected(user);
    await screen.findByText(/此路径尚未在 Obsidian 中登记/);
    expect(gateway.launch).not.toHaveBeenCalled();
    expect(vi.mocked(gateway.saveConfig).mock.calls[0][0].vaults[0]).toMatchObject({
      obsidianVaultId: null,
      lastOpenedAt: null,
    });
    vi.mocked(gateway.listObsidianVaults).mockResolvedValue([
      { id: 'abcdef0123456789', name: 'Main', path: 'D:\\Notes\\Main' },
    ]);
    await openSelected(user);
    await waitFor(() =>
      expect(gateway.launch).toHaveBeenCalledExactlyOnceWith({
        name: 'Main Vault',
        obsidianVaultId: 'abcdef0123456789',
      }),
    );
  });

  it.each(['open', 'repair'])(
    'does not change records or launch when registration lookup fails during %s',
    async (action) => {
      const gateway = await withStaleId();
      vi.mocked(gateway.listObsidianVaults).mockRejectedValue({
        code: 'OBSIDIAN_CONFIG_READ_FAILED',
        message: '无法读取 Obsidian 配置。',
      });
      if (action === 'repair') {
        vi.mocked(gateway.validateDirectory).mockRejectedValueOnce({
          code: 'VAULT_PATH_NOT_FOUND',
          message: '路径不存在',
        });
      }
      const user = userEvent.setup();
      render(<App gateway={gateway} />);
      if (action === 'repair') {
        await user.click(await screen.findByRole('button', { name: '修复路径' }));
      } else {
        await openSelected(user);
      }
      await screen.findByText('无法读取 Obsidian 配置。');
      expect(gateway.launch).not.toHaveBeenCalled();
      expect(gateway.saveConfig).not.toHaveBeenCalled();
    },
  );
});
