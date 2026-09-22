import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { VaultGateway } from '../services/vaultGateway';

function createGateway(): VaultGateway {
  return {
    loadConfig: vi.fn().mockResolvedValue({
      schemaVersion: 1,
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
        },
      ],
    }),
    saveConfig: vi.fn().mockImplementation(async (config) => config),
    chooseDirectory: vi.fn().mockResolvedValue('D:\\Notes\\Main'),
    chooseDirectories: vi.fn().mockResolvedValue(['D:\\Notes\\Main']),
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
      expect(gateway.launch).toHaveBeenCalledWith({ name: 'Main Vault', obsidianVaultId: null }),
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
