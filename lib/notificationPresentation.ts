/** Returns a same-origin application path, or null when the target is unsafe. */
export function sanitizeNotificationTargetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const target = value;
  if (!target || target !== target.trim() || !target.startsWith("/") || target.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(target)) return null;
  try {
    const parsed = new URL(target, "https://siteqube.invalid");
    if (parsed.origin !== "https://siteqube.invalid" || parsed.username || parsed.password) return null;
    if (!parsed.pathname.startsWith("/") || parsed.pathname.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(parsed.pathname)) return null;

    // Reject encoded separators/dot segments if decoding would make this a
    // protocol-relative path. Browsers and intermediaries can normalize them
    // differently after navigation, so validation covers both forms.
    let decodedPath = parsed.pathname;
    let fullyDecoded = false;
    for (let pass = 0; pass < 8; pass += 1) {
      try {
        const nextPath = decodeURIComponent(decodedPath);
        if (nextPath.startsWith("//") || nextPath.includes("\\") || /[\u0000-\u001f\u007f]/.test(nextPath)) return null;
        const normalized = new URL(nextPath, "https://siteqube.invalid");
        if (normalized.origin !== "https://siteqube.invalid" || normalized.pathname.startsWith("//")) return null;
        if (nextPath === decodedPath) {
          fullyDecoded = true;
          break;
        }
        decodedPath = nextPath;
      } catch {
        return null;
      }
    }
    if (!fullyDecoded) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/** The bell badge is the persisted feed's unread count, never a workflow total. */
export function notificationBadgeCount(unreadCount: unknown) {
  const count = Number(unreadCount);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function pendingActionsEmptyState(input: {
  count: number;
  loaded: boolean;
  hasError: boolean;
}) {
  if (input.hasError) return "error";
  if (!input.loaded) return "loading";
  return input.count > 0 ? "items" : "empty";
}
