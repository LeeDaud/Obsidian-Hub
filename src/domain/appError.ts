export type AppErrorCode =
  | 'DIALOG_FAILED'
  | 'CONFIG_PATH_FAILED'
  | 'CONFIG_READ_FAILED'
  | 'CONFIG_WRITE_FAILED'
  | 'CONFIG_INVALID'
  | 'CONFIG_UNSUPPORTED_VERSION'
  | 'VAULT_PATH_NOT_FOUND'
  | 'VAULT_PATH_FORBIDDEN'
  | 'VAULT_MARKER_NOT_FOUND'
  | 'VAULT_DUPLICATE_PATH'
  | 'VAULT_NAME_INVALID'
  | 'VAULT_ID_INVALID'
  | 'OBSIDIAN_LAUNCH_FAILED'
  | 'UNKNOWN_ERROR';

export interface AppErrorPayload {
  code: AppErrorCode;
  message: string;
}

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = 'AppError';
    this.code = payload.code;
  }
}

export function toAppError(reason: unknown): AppError {
  if (reason instanceof AppError) return reason;

  if (typeof reason === 'object' && reason !== null && 'code' in reason && 'message' in reason) {
    const payload = reason as AppErrorPayload;
    return new AppError(payload);
  }

  return new AppError({ code: 'UNKNOWN_ERROR', message: '发生了无法识别的错误。' });
}
