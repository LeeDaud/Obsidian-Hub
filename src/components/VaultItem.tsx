import type { CSSProperties } from 'react';
import type { BridgeState, VaultListItem } from '../domain/vault';
import { formatLastOpened } from '../features/vaults/vaultSelectors';

interface VaultItemProps {
  vault: VaultListItem;
  selected: boolean;
  opening: boolean;
  installingBridge: boolean;
  bridgeState: BridgeState;
  onSelect(): void;
  onOpen(): void;
  onToggleFavorite(): void;
  onRepair(): void;
  onRemove(): void;
  onBridgeAction(): void;
}

export function VaultItem({
  vault,
  selected,
  opening,
  installingBridge,
  bridgeState,
  onSelect,
  onOpen,
  onToggleFavorite,
  onRepair,
  onRemove,
  onBridgeAction,
}: VaultItemProps) {
  const hue = [...vault.id].reduce((value, character) => value + character.charCodeAt(0), 0) % 360;
  const style = { '--vault-hue': hue } as CSSProperties;
  const bridgeLabels: Record<BridgeState, string> = {
    checking: 'Bridge 检查中',
    'not-installed': 'Bridge 未安装',
    installed: 'Bridge 已自动启用',
    outdated: 'Bridge 可更新',
    unknown: 'Bridge 状态未知',
  };
  const bridgeAction =
    bridgeState === 'not-installed'
      ? '安装 Bridge'
      : bridgeState === 'outdated'
        ? '更新 Bridge'
        : bridgeState === 'unknown'
          ? '重试安装'
          : null;

  return (
    <article
      className={`vault-item${selected ? ' is-selected' : ''}${vault.pathStatus === 'invalid' ? ' is-invalid' : ''}`}
      data-vault-id={vault.id}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      style={style}
      onClick={onSelect}
      onDoubleClick={vault.pathStatus === 'valid' ? onOpen : undefined}
    >
      <span className="vault-color-mark" aria-hidden="true" />
      <span className="vault-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
        </svg>
      </span>

      <div className="vault-main">
        <div className="vault-title-row">
          <strong>{vault.name}</strong>
          {vault.pathStatus === 'checking' ? <span className="state-pill">检查中</span> : null}
          {vault.pathStatus === 'invalid' ? (
            <span className="state-pill error">路径失效</span>
          ) : null}
          <span className={`state-pill bridge-state bridge-state--${bridgeState}`}>
            {bridgeLabels[bridgeState]}
          </span>
        </div>
        {vault.description ? <p>{vault.description}</p> : null}
      </div>

      <div className="vault-meta">
        <span>{opening ? '正在打开…' : formatLastOpened(vault.lastOpenedAt)}</span>
        {vault.tags.length ? <span>{vault.tags.slice(0, 2).join(' · ')}</span> : null}
      </div>

      <div className="vault-actions">
        {bridgeAction && vault.pathStatus === 'valid' ? (
          <button
            type="button"
            className="text-button bridge-action"
            disabled={installingBridge}
            onClick={(event) => {
              event.stopPropagation();
              onBridgeAction();
            }}
          >
            {installingBridge ? '处理中…' : bridgeAction}
          </button>
        ) : null}
        {vault.pathStatus === 'invalid' ? (
          <button
            type="button"
            className="text-button"
            onClick={(event) => {
              event.stopPropagation();
              onRepair();
            }}
          >
            修复路径
          </button>
        ) : null}
        <button
          type="button"
          className={`row-icon-button${vault.favorite ? ' is-active' : ''}`}
          aria-label={vault.favorite ? `取消收藏 ${vault.name}` : `收藏 ${vault.name}`}
          title={vault.favorite ? '取消收藏' : '收藏'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
          </svg>
        </button>
        <button
          type="button"
          className="row-icon-button remove-action"
          aria-label={`从启动器移除 ${vault.name}`}
          title="从启动器移除"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5M14 11v5" />
          </svg>
        </button>
        <button
          type="button"
          className="open-button"
          aria-label={`打开 ${vault.name}`}
          disabled={opening || vault.pathStatus !== 'valid'}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M14 7l5 5-5 5" />
          </svg>
        </button>
      </div>
    </article>
  );
}
