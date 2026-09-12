/** Removes connection strings, age identities, and common credential values from text. */
export function redact(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/giu, '[redacted database URL]')
    .replace(/AGE-SECRET-KEY-[\w-]+/giu, '[redacted age identity]')
    .replace(/(?:password|secret|token|access_key)\s*[=:]\s*[^\s,]+/giu, '$1=[redacted]');
}
