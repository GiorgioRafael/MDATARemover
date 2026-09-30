export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value)} ${units[index]}`
}

export function formatDimensions(width: number, height: number): string {
  return `${width.toLocaleString('pt-BR')} × ${height.toLocaleString('pt-BR')} px`
}

export function cleanFileName(name: string, mime: string): string {
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const base = name.replace(/\.[^.]+$/, '').replace(/-limpa$/i, '')
  return `${base}-limpa.${extension}`
}
