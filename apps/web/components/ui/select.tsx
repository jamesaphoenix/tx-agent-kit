'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
}

const SelectContext = React.createContext<{
  value: string
  onValueChange: (value: string) => void
}>({
  value: '',
  onValueChange: () => undefined
})

function Select({ value, defaultValue, onValueChange, children }: SelectProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? '')
  const resolvedValue = value ?? internalValue

  const handleChange = React.useCallback(
    (nextValue: string) => {
      setInternalValue(nextValue)
      onValueChange?.(nextValue)
    },
    [onValueChange]
  )

  const contextValue = React.useMemo(
    () => ({ value: resolvedValue, onValueChange: handleChange }),
    [resolvedValue, handleChange]
  )

  return (
    <SelectContext.Provider value={contextValue}>
      {children}
    </SelectContext.Provider>
  )
}

function SelectValue(props: React.ComponentProps<'span'>) {
  const { value } = React.useContext(SelectContext)
  return <span data-slot="select-value" {...props}>{value || props.children}</span>
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<'button'> & {
  size?: 'sm' | 'default'
}) {
  return (
    <button
      type="button"
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        'border-input flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="select-content"
      className={cn(
        'bg-popover text-popover-foreground relative z-50 min-w-[8rem] overflow-hidden rounded-md border shadow-md',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function SelectItem({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<'div'> & { value: string }) {
  const ctx = React.useContext(SelectContext)

  return (
    <div
      data-slot="select-item"
      role="option"
      aria-selected={ctx.value === value}
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none',
        className
      )}
      onClick={() => ctx.onValueChange(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          ctx.onValueChange(value)
        }
      }}
      tabIndex={0}
      {...props}
    >
      {children}
    </div>
  )
}

export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
}
