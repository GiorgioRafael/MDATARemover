import { Leaf } from 'lucide-react'

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="CleanFrame — início">
      <span className="brand-mark"><Leaf size={20} strokeWidth={2.4} /></span>
      <span>CleanFrame</span>
    </a>
  )
}
