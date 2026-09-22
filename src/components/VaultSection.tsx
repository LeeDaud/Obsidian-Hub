import type { BridgeState, VaultListItem } from '../domain/vault';
import { VaultItem } from './VaultItem';

interface VaultSectionProps {
  title: string;
  vaults: VaultListItem[];
  selectedId: string | null;
  openingId: string | null;
  installingBridgeId: string | null;
  bridgeStates: Record<string, BridgeState>;
  hasOutdatedBridges: boolean;
  updatingAllBridges: boolean;
  onSelect(id: string): void;
  onOpen(vault: VaultListItem): void;
  onToggleFavorite(vault: VaultListItem): void;
  onRepair(vault: VaultListItem): void;
  onRemove(vault: VaultListItem): void;
  onBridgeAction(vault: VaultListItem): void;
  onUpdateAllBridges(): void;
}

export function VaultSection(props: VaultSectionProps) {
  if (!props.vaults.length) return null;
  return (
    <section className="vault-section" aria-labelledby={`section-${props.title}`}>
      <header>
        <h2 id={`section-${props.title}`}>{props.title}</h2>
        {props.hasOutdatedBridges ? (
          <button
            type="button"
            className="text-button"
            disabled={props.updatingAllBridges}
            onClick={props.onUpdateAllBridges}
          >
            {props.updatingAllBridges ? '更新中…' : '全部更新 Bridge'}
          </button>
        ) : null}
        <span>{props.vaults.length}</span>
      </header>
      <div className="vault-list" role="listbox" aria-label={props.title}>
        {props.vaults.map((vault) => (
          <VaultItem
            key={vault.id}
            vault={vault}
            selected={props.selectedId === vault.id}
            opening={props.openingId === vault.id}
            installingBridge={props.installingBridgeId === vault.id}
            bridgeState={props.bridgeStates[vault.id] ?? 'checking'}
            onSelect={() => props.onSelect(vault.id)}
            onOpen={() => props.onOpen(vault)}
            onToggleFavorite={() => props.onToggleFavorite(vault)}
            onRepair={() => props.onRepair(vault)}
            onRemove={() => props.onRemove(vault)}
            onBridgeAction={() => props.onBridgeAction(vault)}
          />
        ))}
      </div>
    </section>
  );
}
