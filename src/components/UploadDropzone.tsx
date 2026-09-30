import { ClipboardPaste, ImagePlus, Images, LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { imageFromPaste, NO_CLIPBOARD_IMAGE, readClipboardImage } from '../lib/clipboard'
import { formatBytes } from '../lib/format'
import { MAX_BATCH_FILES } from '../lib/batch'

interface Props {
  files: File[]
  previewUrl: string | null
  disabled?: boolean
  onFiles: (files: File[]) => void
  onPasteImage: (file: File) => Promise<void>
  onError: (message: string) => void
  onClear: () => void
}

export function UploadDropzone({ files, previewUrl, disabled, onFiles, onPasteImage, onError, onClear }: Props) {
  const file = files[0] ?? null
  const multiple = files.length > 1
  const inputRef = useRef<HTMLInputElement>(null)
  const clipboardBusy = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [pasting, setPasting] = useState(false)
  const busy = disabled || pasting

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (disabled || clipboardBusy.current || event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return
      const image = imageFromPaste(event.clipboardData)
      event.preventDefault()
      if (!image) { onError(NO_CLIPBOARD_IMAGE); return }
      clipboardBusy.current = true
      setPasting(true)
      void onPasteImage(image).finally(() => {
        clipboardBusy.current = false
        setPasting(false)
      })
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [disabled, onError, onPasteImage])

  const pasteImage = async () => {
    if (busy || clipboardBusy.current) return
    clipboardBusy.current = true
    setPasting(true)
    try {
      const image = await readClipboardImage()
      await onPasteImage(image)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Não foi possível colar a imagem.')
    } finally {
      clipboardBusy.current = false
      setPasting(false)
    }
  }

  const receive = (files: FileList | null) => {
    if (busy || clipboardBusy.current) return
    if (files?.length) onFiles(Array.from(files))
  }

  return (
    <div
      className={`dropzone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''} ${multiple ? 'has-multiple' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); receive(event.dataTransfer.files) }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        onChange={(event) => { receive(event.target.files); event.target.value = '' }}
        disabled={busy}
      />
      {file && (previewUrl || multiple) ? (
        <div className="dropzone-file">
          <div className="dropzone-thumb-wrap">
            {previewUrl ? <img className="dropzone-thumb" src={previewUrl} alt="Prévia da imagem selecionada" /> : <span className="dropzone-thumb-placeholder"><Images size={28} /></span>}
            <button className="remove-file" onClick={onClear} type="button" aria-label={multiple ? 'Remover fotos' : 'Remover imagem'} disabled={busy}>
              <X size={16} />
            </button>
          </div>
          <div className="dropzone-file-copy">
            <strong>{multiple ? `${files.length} fotos selecionadas` : file.name}</strong>
            <span>{formatBytes(files.reduce((total, image) => total + image.size, 0))}{multiple ? ' no total' : ''}</span>
          </div>
          <button className="text-button" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{multiple ? 'Trocar fotos' : 'Trocar imagem'}</button>
        </div>
      ) : (
        <div className="dropzone-start">
          <button className="dropzone-empty" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            <span className="upload-icon"><ImagePlus size={25} /></span>
            <span><strong>Arraste até {MAX_BATCH_FILES} fotos aqui</strong></span>
            <span className="select-copy">ou selecione do computador</span>
            <small>JPG, PNG ou WEBP · máximo de 25 MB por foto</small>
          </button>
          <div className="clipboard-option">
            <button className="paste-button" type="button" onClick={pasteImage} disabled={busy} aria-describedby="paste-hint">
              {pasting ? <LoaderCircle className="spinner" size={18} /> : <ClipboardPaste size={18} />}
              {pasting ? 'Lendo imagem…' : 'Colar imagem'}
            </button>
            <p id="paste-hint">Ou use <kbd>Ctrl + V</kbd> / <kbd>⌘ + V</kbd>. A imagem colada será limpa automaticamente.</p>
          </div>
        </div>
      )}
    </div>
  )
}
