import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { UpdateControl } from './UpdateControl';
import type { AvailableUpdate, UpdateGateway, UpdateProgress } from '../domain/update';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});

function fixture() {
  const update: AvailableUpdate = {
    version: '0.5.0',
    notes: '修复路径与启动问题',
    install: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const gateway: UpdateGateway = {
    check: vi.fn().mockResolvedValue({ currentVersion: '0.4.0', update }),
    restart: vi.fn().mockResolvedValue(undefined),
  };
  return { update, gateway };
}

async function open(gateway: UpdateGateway) {
  const user = userEvent.setup();
  render(<UpdateControl gateway={gateway} />);
  await user.click(screen.getByRole('button', { name: '检查更新' }));
  return user;
}

describe('Hub updates', () => {
  it('does not check or install automatically; shows notes and releases a deferred update', async () => {
    const { gateway, update } = fixture();
    const user = userEvent.setup();
    render(<UpdateControl gateway={gateway} />);
    expect(gateway.check).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('新版本 0.5.0')).toBeInTheDocument();
    expect(screen.getByText('当前版本 0.4.0')).toBeInTheDocument();
    expect(screen.getByText(update.notes)).toBeInTheDocument();
    expect(update.install).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '稍后再说' }));
    expect(update.close).toHaveBeenCalledOnce();
  });

  it('reports no update only after a successful check', async () => {
    const { gateway } = fixture();
    vi.mocked(gateway.check).mockResolvedValue({ currentVersion: '0.4.0', update: null });
    await open(gateway);
    expect(await screen.findByText('当前已是最新版本。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载并安装' })).not.toBeInTheDocument();
  });

  it('shows network/service errors and retries the check', async () => {
    const { gateway } = fixture();
    vi.mocked(gateway.check).mockRejectedValueOnce(new Error('404'));
    const user = await open(gateway);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法检查更新');
    expect(screen.queryByText('当前已是最新版本。')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新检查' }));
    expect(await screen.findByText('新版本 0.5.0')).toBeInTheDocument();
    expect(gateway.check).toHaveBeenCalledTimes(2);
  });

  it('shows progress, prevents duplicate installs and closing during installation, then restarts', async () => {
    const { gateway, update } = fixture();
    let report!: (value: UpdateProgress) => void;
    let finish!: () => void;
    vi.mocked(update.install).mockImplementation((callback) => {
      report = callback;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const user = await open(gateway);
    const installButton = await screen.findByRole('button', { name: '下载并安装' });
    await user.dblClick(installButton);
    expect(update.install).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '关闭更新窗口' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => report({ phase: 'downloading', downloaded: 40, total: 100 }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '40');
    act(() => report({ phase: 'installing', downloaded: 100, total: 100 }));
    expect(screen.getByText('下载完成，正在验证并安装…')).toBeInTheDocument();
    await act(async () => finish());
    expect(gateway.restart).toHaveBeenCalledOnce();
  });

  it('allows retry after a failed download or signature check without restarting', async () => {
    const { gateway, update } = fixture();
    vi.mocked(update.install).mockRejectedValueOnce(new Error('invalid signature'));
    const user = await open(gateway);
    await user.click(await screen.findByRole('button', { name: '下载并安装' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('更新未完成');
    expect(gateway.restart).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '重试下载安装' }));
    await waitFor(() => expect(gateway.restart).toHaveBeenCalledOnce());
  });

  it('retries restarting without reinstalling the update', async () => {
    const { gateway, update } = fixture();
    vi.mocked(gateway.restart).mockRejectedValueOnce(new Error('restart failed'));
    const user = await open(gateway);
    await user.click(await screen.findByRole('button', { name: '下载并安装' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('自动重启失败');
    await user.click(screen.getByRole('button', { name: '重新启动' }));
    expect(update.install).toHaveBeenCalledOnce();
    expect(gateway.restart).toHaveBeenCalledTimes(2);
  });

  it('disposes an update if its check completes after the dialog has closed', async () => {
    const { gateway, update } = fixture();
    let finish!: (value: Awaited<ReturnType<UpdateGateway['check']>>) => void;
    vi.mocked(gateway.check).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = await open(gateway);
    await user.click(screen.getByRole('button', { name: '关闭更新窗口' }));
    await act(async () => finish({ currentVersion: '0.4.0', update }));
    expect(update.close).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
