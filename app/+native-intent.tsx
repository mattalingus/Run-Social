export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  // Preserve specific deep links used by the app
  if (path.includes("/reset-password")) {
    return path;
  }
  // Android foreground service notification tap: live tracking screens
  if (path.includes("/run-tracking") || path.includes("/run-live/")) {
    return path;
  }
  // Friend-request / accepted notification tap: open notifications screen
  if (path.includes("/notifications")) {
    return path;
  }
  // Shared route deep link
  if (path.includes("/path/")) {
    return path;
  }
  return '/';
}
