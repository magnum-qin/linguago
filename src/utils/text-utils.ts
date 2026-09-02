export function stripHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html || '';
  return template.content.textContent || '';
}

export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttribute(value: string | number | null | undefined): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

export function escapeRegExp(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 拆分包含分号的多重翻译词项列表（如 "to swallow up; to absorb; to annex"）
 */
export function splitTranslations(text: string | null | undefined): string[] {
  if (!text) return [];
  const parts = text
    .split(/;\s*|；\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  // 去重但保留先后顺序
  return Array.from(new Set(parts));
}

/**
 * 拆分音标列表（如 "/tə 'swɒl.oʊ ʌp; tə əb'zɔrb; tə æn'æks/"）
 */
export function splitPhonetics(phoneticStr: string | null | undefined): string[] {
  if (!phoneticStr) return [];
  const trimmed = phoneticStr.trim();
  if (!trimmed.includes(';') && !trimmed.includes('；')) {
    return [trimmed];
  }
  const inner = trimmed.replace(/^\/+|\/+$/g, '');
  const parts = inner
    .split(/;\s*|；\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => (p.startsWith('/') && p.endsWith('/') ? p : `/${p}/`));
}
