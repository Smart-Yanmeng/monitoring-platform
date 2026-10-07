import { useEffect, useRef, useState } from 'react'

export type SelectOption = { value: string; label: string }

type Props = {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  title?: string
  className?: string
}

/** 自定义下拉框：深色主题，点击外部/ESC 关闭，选中项高亮 */
export default function Select({ value, options, onChange, placeholder, title, className }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value)

  return (
    <div className={'select' + (className ? ' ' + className : '')} ref={rootRef} title={title}>
      <button
        type="button"
        className={open ? 'select-trigger open' : 'select-trigger'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={current ? 'select-value' : 'select-value placeholder'}>
          {current ? current.label : (placeholder ?? '请选择')}
        </span>
        <span className="select-arrow" />
      </button>
      {open && (
        <ul className="select-menu" role="listbox">
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={o.value === value ? 'select-option active' : 'select-option'}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
          {options.length === 0 && (
            <li>
              <span className="select-empty">暂无选项</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
