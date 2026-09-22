import { useEffect, useMemo, useState } from 'react';
import type {
  AppConfigV1,
  BridgeState,
  NewVaultInput,
  ObsidianVaultEntry,
  SortMode,
  VaultEntry,
  VaultListItem,
  VaultOverview,
  VaultValidationResult,
} from '../domain/vault';
import { AppError, toAppError } from '../domain/appError';
import { tauriVaultGateway, type VaultGateway } from '../services/vaultGateway';
import { LauncherHeader } from '../components/LauncherHeader';
import { VaultSection } from '../components/VaultSection';
import { EmptyState } from '../components/EmptyState';
import { StatusBar } from '../components/StatusBar';
import { AddVaultDialog } from '../components/AddVaultDialog';
import { BackgroundLayer } from '../components/BackgroundLayer';
import { DailyClosing, GreetingHeader } from '../components/GreetingHeader';
import { LibraryOverview } from '../components/LibraryOverview';
import { DailyPoster } from '../components/DailyPoster';
import { QuickActionDock } from '../components/QuickActionDock';
import { matchesVault, sortVaults } from '../features/vaults/vaultSelectors';
import '../styles/app.css';

interface AppProps {
  gateway?: VaultGateway;
}

export function App({ gateway = tauriVaultGateway }: AppProps) {
  const [config, setConfig] = useState<AppConfigV1 | null>(null);
  const [pathStatuses, setPathStatuses] = useState<Record<string, VaultListItem['pathStatus']>>({});
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [installingBridgeId, setInstallingBridgeId] = useState<string | null>(null);
  const [bridgeStates, setBridgeStates] = useState<Record<string, BridgeState>>({});
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [status, setStatus] = useState('就绪');
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [overviewRefreshing, setOverviewRefreshing] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const loaded = await gateway.loadConfig();
        if (cancelled) return;
        setConfig(loaded);
        setPathStatuses(Object.fromEntries(loaded.vaults.map((vault) => [vault.id, 'checking'])));
        setBridgeStates(Object.fromEntries(loaded.vaults.map((vault) => [vault.id, 'checking'])));
        setSelectedId(loaded.vaults[0]?.id ?? null);
        await Promise.all(
          loaded.vaults.map(async (vault) => {
            try {
              await gateway.validateDirectory(vault.path);
              if (!cancelled) setPathStatuses((current) => ({ ...current, [vault.id]: 'valid' }));
            } catch {
              if (!cancelled) setPathStatuses((current) => ({ ...current, [vault.id]: 'invalid' }));
            }
          }),
        );
        if (gateway.getBridgeStatus) {
          await Promise.all(
            loaded.vaults.map(async (vault) => {
              try {
                const bridge = await gateway.getBridgeStatus!(vault.path, vault.id);
                if (!cancelled) {
                  setBridgeStates((current) => ({ ...current, [vault.id]: bridge.state }));
                }
              } catch {
                if (!cancelled) {
                  setBridgeStates((current) => ({ ...current, [vault.id]: 'unknown' }));
                }
              }
            }),
          );
        }
      } catch (reason) {
        if (!cancelled) setError(toAppError(reason).message);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  const vaults = useMemo<VaultListItem[]>(
    () =>
      (config?.vaults ?? []).map((vault) => ({
        ...vault,
        pathStatus: pathStatuses[vault.id] ?? 'checking',
      })),
    [config, pathStatuses],
  );
  const visibleVaults = useMemo(
    () =>
      sortVaults(
        vaults.filter((vault) => matchesVault(vault, query)),
        config?.preferences.sortMode ?? 'favoriteThenRecent',
      ),
    [config?.preferences.sortMode, query, vaults],
  );
  const overviewPaths = useMemo(() => config?.vaults.map((vault) => vault.path) ?? [], [config]);

  useEffect(() => {
    if (!config || !gateway.getBridgeStatus) return;
    let cancelled = false;
    async function refreshBridgeStates() {
      await Promise.all(
        config!.vaults.map(async (vault) => {
          try {
            const bridge = await gateway.getBridgeStatus!(vault.path, vault.id);
            if (!cancelled) {
              setBridgeStates((current) => ({ ...current, [vault.id]: bridge.state }));
            }
          } catch {
            if (!cancelled) {
              setBridgeStates((current) => ({ ...current, [vault.id]: 'unknown' }));
            }
          }
        }),
      );
    }
    void refreshBridgeStates();
    const interval = window.setInterval(() => void refreshBridgeStates(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [config, gateway]);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    async function loadAndRefreshOverview() {
      setOverviewError(null);
      try {
        const cached = await gateway.loadOverviewCache(overviewPaths);
        if (!cancelled && cached) setOverview(cached);
      } catch {
        // A missing or damaged cache must never block a fresh background scan.
      }
      if (!cancelled) setOverviewRefreshing(true);
      try {
        const refreshed = await gateway.scanOverview(overviewPaths);
        if (!cancelled) setOverview(refreshed);
      } catch (reason) {
        if (!cancelled) setOverviewError(toAppError(reason).message);
      } finally {
        if (!cancelled) setOverviewRefreshing(false);
      }
    }
    void loadAndRefreshOverview();
    return () => {
      cancelled = true;
    };
  }, [config, gateway, overviewPaths]);

  useEffect(() => {
    if (!visibleVaults.some((vault) => vault.id === selectedId)) {
      setSelectedId(visibleVaults[0]?.id ?? null);
    }
  }, [selectedId, visibleVaults]);

  async function persist(next: AppConfigV1) {
    const saved = await gateway.saveConfig(next);
    setConfig(saved);
    return saved;
  }

  async function chooseDirectory(): Promise<VaultValidationResult | null> {
    const path = await gateway.chooseDirectory();
    return path ? gateway.validateDirectory(path) : null;
  }

  async function chooseDirectories(): Promise<VaultValidationResult[]> {
    const paths = await gateway.chooseDirectories();
    if (!paths) return [];
    const results: VaultValidationResult[] = [];
    for (const path of paths) {
      try {
        results.push(await gateway.validateDirectory(path));
      } catch {
        // 跳过无效目录，继续处理其余选择
      }
    }
    return results;
  }

  async function importObsidianVaults(): Promise<ObsidianVaultEntry[]> {
    const vaults = await gateway.listObsidianVaults();
    if (!config) return vaults;
    const existing = new Set(
      config.vaults.map((vault) => vault.path.replace(/[\\/]+$/, '').toLocaleLowerCase()),
    );
    return vaults.filter(
      (vault) => !existing.has(vault.path.replace(/[\\/]+$/, '').toLocaleLowerCase()),
    );
  }

  async function addVaults(inputs: NewVaultInput[]) {
    if (!config) return;
    const existingPaths = new Set(
      config.vaults.map((vault) => vault.path.replace(/[\\/]+$/, '').toLocaleLowerCase()),
    );
    const now = new Date().toISOString();
    const entries: VaultEntry[] = [];
    let skipped = 0;
    for (const input of inputs) {
      const normalized = input.path.replace(/[\\/]+$/, '').toLocaleLowerCase();
      if (existingPaths.has(normalized)) {
        skipped += 1;
        continue;
      }
      existingPaths.add(normalized);
      entries.push({
        id: crypto.randomUUID(),
        ...input,
        name: input.name.trim(),
        description: input.description.trim(),
        tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
        favorite: false,
        favoriteOrder: null,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      });
    }
    if (entries.length === 0) {
      throw new AppError({
        code: 'VAULT_DUPLICATE_PATH',
        message: '所选仓库都已经添加过。',
      });
    }
    await persist({ ...config, vaults: [...config.vaults, ...entries] });
    for (const entry of entries) {
      setPathStatuses((current) => ({ ...current, [entry.id]: 'valid' }));
      setBridgeStates((current) => ({ ...current, [entry.id]: 'not-installed' }));
    }
    setSelectedId(entries[0].id);
    setShowAddDialog(false);
    setStatus(
      skipped > 0
        ? `已添加 ${entries.length} 个仓库，跳过 ${skipped} 个重复。`
        : `已添加 ${entries.length} 个仓库`,
    );
  }

  async function handleBridgeAction(vault: VaultListItem) {
    if (!gateway.installBridge) {
      setError('当前版本不支持安装 Bridge。');
      return;
    }
    setInstallingBridgeId(vault.id);
    setError(null);
    setStatus(`正在为 ${vault.name} 安装 Bridge…`);
    try {
      await gateway.installBridge(vault.path, vault.id);
      setBridgeStates((current) => ({ ...current, [vault.id]: 'installed' }));
      setStatus(`Bridge 已自动启用于 ${vault.name}。若 Obsidian 正在运行，重启后生效。`);
    } catch (reason) {
      setBridgeStates((current) => ({ ...current, [vault.id]: 'unknown' }));
      setError(`Bridge 安装失败：${toAppError(reason).message}`);
    } finally {
      setInstallingBridgeId(null);
    }
  }

  async function toggleFavorite(vault: VaultListItem) {
    if (!config) return;
    const nextOrder = vault.favorite
      ? null
      : Math.max(-1, ...config.vaults.map((item) => item.favoriteOrder ?? -1)) + 1;
    await persist({
      ...config,
      vaults: config.vaults.map((item) =>
        item.id === vault.id
          ? {
              ...item,
              favorite: !item.favorite,
              favoriteOrder: nextOrder,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    });
  }

  async function changeSortMode(sortMode: SortMode) {
    if (!config) return;
    await persist({ ...config, preferences: { ...config.preferences, sortMode } });
  }

  async function launchVault(vault: VaultListItem) {
    if (!config || openingId || vault.pathStatus !== 'valid') return;
    setOpeningId(vault.id);
    setSelectedId(vault.id);
    setError(null);
    setStatus(`正在打开 ${vault.name}…`);
    try {
      await gateway.launch({ name: vault.name, obsidianVaultId: vault.obsidianVaultId });
      const openedAt = new Date().toISOString();
      const saved = await persist({
        ...config,
        vaults: config.vaults.map((item) =>
          item.id === vault.id ? { ...item, lastOpenedAt: openedAt, updatedAt: openedAt } : item,
        ),
      });
      setStatus(`已将 ${vault.name} 交给 Obsidian`);
      if (saved.preferences.closeAfterLaunch) await gateway.closeWindow();
    } catch (reason) {
      setError(toAppError(reason).message);
    } finally {
      setOpeningId(null);
    }
  }

  async function repairVault(vault: VaultListItem) {
    if (!config) return;
    try {
      const result = await chooseDirectory();
      if (!result) return;
      const normalized = result.canonicalPath.replace(/[\\/]+$/, '').toLocaleLowerCase();
      if (
        config.vaults.some(
          (item) =>
            item.id !== vault.id &&
            item.path.replace(/[\\/]+$/, '').toLocaleLowerCase() === normalized,
        )
      ) {
        throw new AppError({
          code: 'VAULT_DUPLICATE_PATH',
          message: '新的路径已经属于另一个仓库。',
        });
      }
      await persist({
        ...config,
        vaults: config.vaults.map((item) =>
          item.id === vault.id
            ? { ...item, path: result.canonicalPath, updatedAt: new Date().toISOString() }
            : item,
        ),
      });
      setPathStatuses((current) => ({ ...current, [vault.id]: 'valid' }));
      setStatus(`已修复 ${vault.name} 的路径`);
    } catch (reason) {
      setError(toAppError(reason).message);
    }
  }

  async function removeVault(vault: VaultListItem) {
    if (!config) return;
    const confirmed = window.confirm(
      `从 Obsidian Hub 移除“${vault.name}”？\n\n只会删除启动器记录，不会删除本地仓库或其中的文件。`,
    );
    if (!confirmed) return;
    try {
      await persist({ ...config, vaults: config.vaults.filter((item) => item.id !== vault.id) });
      setStatus(`已从启动器移除 ${vault.name}`);
    } catch (reason) {
      setError(toAppError(reason).message);
    }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visibleVaults.length) return;
      const currentIndex = Math.max(
        0,
        visibleVaults.findIndex((vault) => vault.id === selectedId),
      );
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (currentIndex + direction + visibleVaults.length) % visibleVaults.length;
      setSelectedId(visibleVaults[nextIndex].id);
      document
        .querySelector<HTMLElement>(`[data-vault-id="${visibleVaults[nextIndex].id}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = visibleVaults.find((vault) => vault.id === selectedId);
      if (selected) void launchVault(selected);
    } else if (event.key === 'Escape') {
      if (query) setQuery('');
      else void gateway.closeWindow();
    }
  }

  async function refreshOverview() {
    if (overviewRefreshing) return;
    setOverviewRefreshing(true);
    setOverviewError(null);
    try {
      setOverview(await gateway.scanOverview(overviewPaths));
    } catch (reason) {
      setOverviewError(toAppError(reason).message);
    } finally {
      setOverviewRefreshing(false);
    }
  }

  function pickRandomVault() {
    if (!visibleVaults.length) return;
    const candidates = visibleVaults.filter((vault) => vault.id !== selectedId);
    const pool = candidates.length ? candidates : visibleVaults;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    setSelectedId(picked.id);
    setStatus(`已为你选中 ${picked.name}`);
    const element = document.querySelector<HTMLElement>(`[data-vault-id="${picked.id}"]`);
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' });
    }
  }

  const selectedVault = visibleVaults.find((vault) => vault.id === selectedId) ?? null;

  return (
    <main className="app-shell">
      <BackgroundLayer />
      <LauncherHeader
        query={query}
        sortMode={config?.preferences.sortMode ?? 'favoriteThenRecent'}
        onQueryChange={setQuery}
        onSearchKeyDown={handleSearchKeyDown}
        onSortChange={(mode) => void changeSortMode(mode)}
        onAdd={() => setShowAddDialog(true)}
      />
      <section className="vault-content immersive-content" aria-label="仓库列表">
        {!config && !error ? (
          <div className="loading-state">
            <span />
            <p>正在读取仓库…</p>
          </div>
        ) : null}
        {!config && error ? (
          <div className="empty-state error-state" role="alert">
            <span className="empty-icon" aria-hidden="true">
              !
            </span>
            <strong>无法读取仓库列表</strong>
            <p>{error}</p>
            <div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => window.location.reload()}
              >
                重新加载
              </button>
            </div>
          </div>
        ) : null}
        {config && !visibleVaults.length ? (
          <EmptyState
            searching={Boolean(query)}
            onAdd={() => setShowAddDialog(true)}
            onClear={() => setQuery('')}
          />
        ) : null}
        {config && visibleVaults.length ? (
          <div className={`launcher-stage${query ? ' is-searching' : ''}`}>
            <div className="launcher-main-column">
              {!query ? <GreetingHeader /> : null}
              {!query ? (
                <div className="overview-composition">
                  <LibraryOverview
                    overview={overview}
                    refreshing={overviewRefreshing}
                    error={overviewError}
                    onRefresh={() => void refreshOverview()}
                  />
                  <DailyPoster overview={overview} />
                </div>
              ) : null}
              <VaultSection
                title={query ? '搜索结果' : '所有仓库'}
                vaults={visibleVaults}
                selectedId={selectedId}
                openingId={openingId}
                installingBridgeId={installingBridgeId}
                bridgeStates={bridgeStates}
                onSelect={setSelectedId}
                onOpen={(vault) => void launchVault(vault)}
                onToggleFavorite={(vault) => void toggleFavorite(vault)}
                onRepair={(vault) => void repairVault(vault)}
                onRemove={(vault) => void removeVault(vault)}
                onBridgeAction={(vault) => void handleBridgeAction(vault)}
              />
              {!query ? (
                <QuickActionDock
                  canOpen={Boolean(
                    selectedVault && selectedVault.pathStatus === 'valid' && !openingId,
                  )}
                  canPickRandom={visibleVaults.length > 0}
                  refreshing={overviewRefreshing}
                  onAdd={() => setShowAddDialog(true)}
                  onRefresh={() => void refreshOverview()}
                  onPickRandom={pickRandomVault}
                  onOpenSelected={() => {
                    if (selectedVault) void launchVault(selectedVault);
                  }}
                />
              ) : null}
              {!query ? <DailyClosing /> : null}
            </div>
          </div>
        ) : null}
      </section>
      <StatusBar count={config?.vaults.length ?? 0} message={status} error={error} />
      {showAddDialog ? (
        <AddVaultDialog
          onChooseDirectories={chooseDirectories}
          onImportObsidian={importObsidianVaults}
          onSubmit={addVaults}
          onClose={() => setShowAddDialog(false)}
        />
      ) : null}
    </main>
  );
}
