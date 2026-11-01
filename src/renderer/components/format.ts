export const sizeLabel = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const parentPath = (path: string) =>
  path.replace(/\/+$/, '').slice(0, path.replace(/\/+$/, '').lastIndexOf('/')) || '/';
export const displayPath = (path: string) => path.replace(/[\x00-\x1f\x7f]/g, ' ');
