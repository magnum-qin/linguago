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
