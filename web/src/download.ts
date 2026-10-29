/** Saves a file the app made (Export's pictures, About's source archive) through the browser's
 * own download, from a blob: URL that needs no request. */
export function download(blob: Blob, fileName: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  // The download has started from the link, and Chromium keeps a revoked blob: URL readable
  // for a navigation already under way, so it can go now: no timer, nothing left behind.
  URL.revokeObjectURL(link.href);
}
