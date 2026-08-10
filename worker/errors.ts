import type { ErrorCode, ResponseProvider } from './types';

export class TranslateError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 500,
    public provider?: ResponseProvider,
    public model?: string
  ) {
    super(message);
  }
}
