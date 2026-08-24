import { ACCESS_TOKEN_KEY, storage } from './storage';

const DEFAULT_API_URL = 'http://localhost:8000';
export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined)?.replace(/\/$/, '') ?? DEFAULT_API_URL;

const FIELD_LABELS: Record<string, string> = {
  email: '이메일',
  password: '비밀번호',
  name: '이름',
  amount: '금액',
  currency: '통화',
  transaction_date: '거래일자',
  start_date: '시작일자',
  end_date: '종료일자',
  category_id: '카테고리',
  payee: '거래처',
  memo: '메모',
  type: '유형',
  frequency: '반복 주기',
  interval: '반복 간격',
  role: '역할',
  rate_to_base: '환율',
};

const COMMON_ERROR_TRANSLATIONS: Record<string, string> = {
  'Invalid credentials': '이메일 또는 비밀번호가 일치하지 않습니다',
  'Email already registered': '이미 등록된 이메일 주소입니다',
  'Account disabled': '비활성화된 계정입니다. 관리자에게 문의하세요',
  'Could not validate credentials': '로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요',
  'Not authenticated': '로그인이 필요합니다',
  'Not a member of this ledger': '이 가계부에 접근 권한이 없습니다',
  'Insufficient permissions': '작업을 수행할 권한이 없습니다',
  'Ledger not found': '가계부를 찾을 수 없습니다',
  'Category not found': '카테고리를 찾을 수 없습니다',
  'Invalid category': '유효하지 않은 카테고리입니다',
  'Invalid category for this ledger': '이 가계부에 속하지 않은 카테고리입니다',
  'Category type does not match': '카테고리 유형이 일치하지 않습니다',
  'Category type does not match transaction type': '카테고리 유형이 거래 유형과 일치하지 않습니다',
  'Budget not found': '예산 항목을 찾을 수 없습니다',
  'Budget already exists for this scope': '해당 항목에 이미 설정된 예산이 있습니다',
  'One or more tags are invalid for this ledger': '유효하지 않은 태그가 포함되어 있습니다',
  'Tag not found': '태그를 찾을 수 없습니다',
  'User with that email not found': '해당 이메일로 가입된 사용자를 찾을 수 없습니다',
  'User is already a member': '이미 이 가계부에 참여 중인 멤버입니다',
  'Cannot remove the owner': '가계부 소유자는 제거할 수 없습니다',
  'AI features are disabled (no ANTHROPIC_API_KEY)': 'AI 기능이 비활성화되어 있습니다 (API 키 필요)',
  'Claude API error': 'AI 서비스 응답 중 오류가 발생했습니다',
};

interface ValidationErrorItem {
  loc?: Array<string | number>;
  msg?: string;
  type?: string;
  ctx?: Record<string, unknown>;
}

export function formatApiDetail(detail: unknown, status?: number): string {
  if (detail == null) {
    return status ? `HTTP 오류 (${status})` : '오류가 발생했습니다';
  }

  if (typeof detail === 'string') {
    const trimmed = detail.trim();
    if (!trimmed) return status ? `HTTP 오류 (${status})` : '오류가 발생했습니다';
    if (COMMON_ERROR_TRANSLATIONS[trimmed]) {
      return COMMON_ERROR_TRANSLATIONS[trimmed];
    }
    for (const [key, translated] of Object.entries(COMMON_ERROR_TRANSLATIONS)) {
      if (trimmed.includes(key)) {
        return translated;
      }
    }
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
      return status ? `HTTP 오류 (${status})` : '서버 오류가 발생했습니다';
    }
    return trimmed;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: ValidationErrorItem | unknown) => {
        if (!item || typeof item !== 'object') return String(item);
        const err = item as ValidationErrorItem;
        const lastLoc = Array.isArray(err.loc) ? String(err.loc[err.loc.length - 1]) : '';
        const fieldName = FIELD_LABELS[lastLoc] ?? (lastLoc && lastLoc !== 'body' ? lastLoc : '');
        const rawMsg = err.msg ? String(err.msg) : '';
        const errType = err.type ? String(err.type) : '';

        if (
          lastLoc === 'email' ||
          rawMsg.toLowerCase().includes('email') ||
          rawMsg.includes('valid email address')
        ) {
          return '올바른 이메일 형식을 입력해 주세요 (예: user@example.com)';
        }

        if (lastLoc === 'password' && (errType === 'string_too_short' || rawMsg.includes('at least 8'))) {
          return '비밀번호는 8자 이상이어야 합니다';
        }

        if (errType === 'missing' || rawMsg.includes('Field required')) {
          return fieldName ? `${fieldName} 항목을 입력해 주세요` : '필수 항목이 누락되었습니다';
        }

        if (errType === 'string_too_short' && err.ctx?.min_length) {
          return fieldName
            ? `${fieldName}은(는) 최소 ${err.ctx.min_length}자 이상이어야 합니다`
            : `최소 ${err.ctx.min_length}자 이상 입력해야 합니다`;
        }

        if (rawMsg.includes('greater than') || rawMsg.includes('positive')) {
          return fieldName ? `${fieldName}은(는) 0보다 큰 값이어야 합니다` : '0보다 큰 값을 입력해야 합니다';
        }

        const cleanMsg = rawMsg.replace(/^value error,\s*/i, '');
        if (COMMON_ERROR_TRANSLATIONS[cleanMsg]) {
          return COMMON_ERROR_TRANSLATIONS[cleanMsg];
        }

        return fieldName ? `${fieldName}: ${cleanMsg}` : cleanMsg;
      })
      .filter((msg): msg is string => Boolean(msg && msg.trim()));

    if (messages.length > 0) {
      return Array.from(new Set(messages)).join('\n');
    }
    return status ? `입력값 검증 실패 (${status})` : '입력값이 올바르지 않습니다';
  }

  if (typeof detail === 'object') {
    const obj = detail as Record<string, unknown>;
    if (obj.detail !== undefined) return formatApiDetail(obj.detail, status);
    if (obj.message !== undefined) return formatApiDetail(obj.message, status);
    if (obj.msg !== undefined) return formatApiDetail(obj.msg, status);
    if (obj.error !== undefined) return formatApiDetail(obj.error, status);
  }

  return status ? `HTTP 오류 (${status})` : '오류가 발생했습니다';
}

export class ApiError extends Error {
  public formattedMessage: string;

  constructor(public status: number, public detail: unknown) {
    const message = formatApiDetail(detail, status);
    super(message);
    this.formattedMessage = message;
  }
}

export function getErrorMessage(err: unknown, fallback = '오류가 발생했습니다'): string {
  if (err instanceof ApiError) {
    return err.message || err.formattedMessage || fallback;
  }
  if (err instanceof Error) {
    return err.message || fallback;
  }
  if (typeof err === 'string' && err.trim()) {
    return err.trim();
  }
  if (err && typeof err === 'object') {
    return formatApiDetail(err) || fallback;
  }
  return fallback;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
};

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = await storage.get(ACCESS_TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? safeParseJson(text) : undefined;

  if (!res.ok) {
    const detail = (payload as { detail?: unknown } | undefined)?.detail ?? text;
    throw new ApiError(res.status, detail);
  }
  return payload as T;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiUpload<T = unknown>(path: string, formData: FormData): Promise<T> {
  const token = await storage.get(ACCESS_TOKEN_KEY);
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { method: 'POST', headers, body: formData });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const payload = text ? safeParseJson(text) : undefined;
  if (!res.ok) {
    const detail = (payload as { detail?: unknown } | undefined)?.detail ?? text;
    throw new ApiError(res.status, detail);
  }
  return payload as T;
}

export async function apiDownloadBlob(path: string): Promise<Blob> {
  const token = await storage.get(ACCESS_TOKEN_KEY);
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.blob();
}
