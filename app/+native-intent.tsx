export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  if (path.includes("/reset-password")) {
    return path;
  }
  return '/';
}
