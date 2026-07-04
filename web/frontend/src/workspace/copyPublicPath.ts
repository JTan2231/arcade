export async function copyPublicPath(path: string, message: string, onToast: (message: string) => void): Promise<void> {
  const url = new URL(path, window.location.origin).toString();
  try {
    await navigator.clipboard.writeText(url);
    onToast(message);
  } catch {
    onToast(url);
  }
}
