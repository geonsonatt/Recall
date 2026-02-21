const ERROR_CODE_PATTERN = /^\[([A-Z0-9_]+)\]\s*(.*)$/;

function parseAppErrorLike(error: any, fallbackCode: string) {
  if (!error) {
    return {
      code: fallbackCode,
      message: 'Неизвестная ошибка',
    };
  }

  const rawCode = String(error.code || '').trim();
  const rawMessage = String(error.message || '').trim();
  if (rawCode && rawMessage) {
    return {
      code: rawCode,
      message: rawMessage.replace(/^\[[A-Z0-9_]+\]\s*/, ''),
    };
  }

  const parsed = ERROR_CODE_PATTERN.exec(rawMessage);
  if (parsed) {
    return {
      code: parsed[1],
      message: parsed[2] || 'Неизвестная ошибка',
    };
  }

  return {
    code: fallbackCode,
    message: rawMessage || 'Неизвестная ошибка',
  };
}

export interface UiErrorInfo {
  code: string;
  message: string;
  text: string;
}

export function toUiErrorInfo(error: unknown, fallbackCode = 'E_UI_UNKNOWN'): UiErrorInfo {
  const parsed = parseAppErrorLike(error as any, fallbackCode);
  const code = String(parsed?.code || fallbackCode);
  const message = String(parsed?.message || 'Неизвестная ошибка');
  return {
    code,
    message,
    text: `[${code}] ${message}`,
  };
}

export function formatErrorToast(
  prefix: string,
  error: unknown,
  fallbackCode = 'E_UI_UNKNOWN',
): string {
  const normalizedPrefix = String(prefix || '').trim();
  const info = toUiErrorInfo(error, fallbackCode);
  if (!normalizedPrefix) {
    return info.text;
  }
  return `${normalizedPrefix}: ${info.text}`;
}
