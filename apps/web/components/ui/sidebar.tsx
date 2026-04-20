'use client'

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode
} from 'react'

type SidebarState = 'expanded' | 'collapsed'

interface SidebarContextValue {
  state: SidebarState
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
  /** True while the sidebar width is animating between expanded/collapsed */
  transitioning: boolean
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const SIDEBAR_WIDTH = '16rem'
const SIDEBAR_WIDTH_MOBILE = '16rem'
const SIDEBAR_WIDTH_ICON = '3.5rem'
const SIDEBAR_STORAGE_KEY = 'sidebar:open'

const getPersistedOpen = (defaultOpen: boolean): boolean => {
  if (typeof window === 'undefined') {
    return defaultOpen
  }
  try {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (stored === 'true') { return true }
    if (stored === 'false') { return false }
    return defaultOpen
  } catch {
    return defaultOpen
  }
}

const classes = (...tokens: Array<string | false | null | undefined>): string => {
  return tokens.filter(Boolean).join(' ')
}

const getMobileMediaQuery = (): MediaQueryList | null => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }

  return window.matchMedia('(max-width: 1023px)')
}

const resolveMobileViewport = (): boolean => {
  return getMobileMediaQuery()?.matches ?? false
}

const withAsChild = (
  children: ReactNode,
  className: string,
  props: Record<string, unknown>
): ReactElement | null => {
  let onlyChild: ReactNode
  try {
    onlyChild = Children.only(children)
  } catch {
    return null
  }

  if (!isValidElement(onlyChild)) {
    return null
  }

  const element = onlyChild as ReactElement<Record<string, unknown> & { className?: string }>
  return cloneElement(element, {
    ...props,
    className: classes(className, element.props.className)
  })
}

interface SidebarProviderProps {
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  style?: CSSProperties
}

export const SidebarProvider = ({
  children,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  style
}: SidebarProviderProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(() => getPersistedOpen(defaultOpen))
  const [openMobile, setOpenMobile] = useState(false)
  const [isMobile, setIsMobile] = useState(resolveMobileViewport)
  const [transitioning, setTransitioning] = useState(false)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const open = openProp ?? uncontrolledOpen
  const state: SidebarState = open ? 'expanded' : 'collapsed'

  const setOpen = useCallback((nextOpen: boolean) => {
    // Mark sidebar as transitioning for the duration of the CSS animation
    setTransitioning(true)
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current)
    }
    transitionTimerRef.current = setTimeout(() => {
      setTransitioning(false)
    }, 300) // matches duration-300

    if (openProp === undefined) {
      setUncontrolledOpen(nextOpen)
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextOpen))
      } catch {
        // Ignore storage errors
      }
    }

    onOpenChange?.(nextOpen)
  }, [onOpenChange, openProp])

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current)
      return
    }

    setOpen(!open)
  }, [isMobile, open, setOpen])

  useEffect(() => {
    const mediaQuery = getMobileMediaQuery()
    if (!mediaQuery) {
      return undefined
    }

    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }

    setIsMobile(mediaQuery.matches)
    mediaQuery.addEventListener('change', onChange)

    return () => {
      mediaQuery.removeEventListener('change', onChange)
    }
  }, [])

  useEffect(() => {
    if (!isMobile) {
      setOpenMobile(false)
    }
  }, [isMobile])

  const contextValue = useMemo<SidebarContextValue>(() => ({
    state,
    open,
    setOpen,
    openMobile,
    setOpenMobile,
    isMobile,
    toggleSidebar,
    transitioning
  }), [isMobile, open, openMobile, setOpen, state, toggleSidebar, transitioning])

  const providerStyle = {
    '--sidebar-width': SIDEBAR_WIDTH,
    '--sidebar-width-mobile': SIDEBAR_WIDTH_MOBILE,
    '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
    ...style
  } as CSSProperties

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className={classes('flex w-full', className)}
        data-state={state}
        data-mobile={isMobile ? 'true' : 'false'}
        style={providerStyle}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

export const useSidebar = (): SidebarContextValue => {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return context
}

export interface SidebarProps extends ComponentProps<'aside'> {
  side?: 'left' | 'right'
  variant?: 'sidebar' | 'floating' | 'inset'
  collapsible?: 'offcanvas' | 'icon' | 'none'
  dir?: 'ltr' | 'rtl'
}

export const Sidebar = ({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  className,
  children,
  dir,
  ...props
}: SidebarProps) => {
  const { state, isMobile, openMobile, setOpenMobile } = useSidebar()
  const collapsedToIcon = collapsible === 'icon' && state === 'collapsed'
  const collapsedOffcanvas = collapsible === 'offcanvas' && state === 'collapsed'

  if (isMobile && collapsible !== 'none') {
    let mobileTranslate: string
    if (openMobile) {
      mobileTranslate = 'translate-x-0'
    } else if (side === 'right') {
      mobileTranslate = 'translate-x-full'
    } else {
      mobileTranslate = '-translate-x-full'
    }

    return (
      <>
        <button
          type="button"
          className={classes(
            'fixed inset-0 z-40 bg-black/50 transition-opacity',
            openMobile ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          aria-label="Close sidebar"
          onClick={() => setOpenMobile(false)}
        />
        <aside
          className={classes(
            'fixed top-0 bottom-0 z-50 flex flex-col w-[var(--sidebar-width-mobile)] bg-sidebar-background border-r border-border transition-transform duration-300 ease-in-out',
            side === 'right' ? 'right-0 border-l border-r-0' : 'left-0',
            mobileTranslate,
            className
          )}
          data-side={side}
          data-variant={variant}
          data-collapsible={collapsible}
          data-state={state}
          dir={dir}
          {...props}
        >
          {children}
        </aside>
      </>
    )
  }

  return (
    <aside
      className={classes(
        'group sticky top-0 self-start flex flex-col h-dvh border-r border-border bg-sidebar-background transition-[width] duration-300 ease-in-out overflow-hidden',
        collapsedToIcon && 'w-[var(--sidebar-width-icon)]',
        !collapsedToIcon && !collapsedOffcanvas && 'w-[var(--sidebar-width)]',
        collapsedOffcanvas && 'w-0 border-r-0',
        side === 'right' && 'border-r-0 border-l border-border',
        className
      )}
      data-side={side}
      data-variant={variant}
      data-collapsible={collapsible}
      data-state={state}
      data-icon-collapsed={collapsedToIcon ? '' : undefined}
      dir={dir}
      {...props}
    >
      {children}
    </aside>
  )
}

export const SidebarInset = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('flex-1 min-w-0', className)} {...props} />
}

export const SidebarHeader = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('shrink-0 bg-sidebar-background p-3 border-b border-border group-data-[icon-collapsed]:p-2', className)} {...props} />
}

export const SidebarFooter = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('mt-auto shrink-0 bg-sidebar-background p-3 border-t border-border group-data-[icon-collapsed]:p-2', className)} {...props} />
}

export const SidebarContent = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('min-h-0 flex-1 overflow-y-auto p-2', className)} {...props} />
}

export const SidebarGroup = ({ className, ...props }: ComponentProps<'section'>) => {
  return <section className={classes('py-2', className)} {...props} />
}

interface SidebarGroupLabelProps extends ComponentProps<'div'> {
  asChild?: boolean
}

export const SidebarGroupLabel = ({
  asChild,
  className,
  children,
  ...props
}: SidebarGroupLabelProps) => {
  const resolvedClass = classes('px-2 py-1.5 text-xs font-medium text-muted-foreground group-data-[icon-collapsed]:hidden', className)
  if (asChild) {
    return withAsChild(children, resolvedClass, props)
  }

  return (
    <div className={resolvedClass} {...props}>
      {children}
    </div>
  )
}

export const SidebarGroupAction = ({ className, ...props }: ComponentProps<'button'>) => {
  return (
    <button
      type="button"
      className={classes('absolute right-2 top-2 flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer', className)}
      {...props}
    />
  )
}

export const SidebarGroupContent = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('', className)} {...props} />
}

export const SidebarMenu = ({ className, ...props }: ComponentProps<'ul'>) => {
  return <ul className={classes('list-none m-0 p-0 space-y-1', className)} {...props} />
}

export const SidebarMenuItem = ({ className, ...props }: ComponentProps<'li'>) => {
  return <li className={classes('relative', className)} {...props} />
}

interface SidebarMenuButtonProps extends ComponentProps<'button'> {
  asChild?: boolean
  isActive?: boolean
}

export const SidebarMenuButton = ({
  asChild,
  isActive = false,
  className,
  children,
  type = 'button',
  ...props
}: SidebarMenuButtonProps) => {
  const resolvedClass = classes(
    'w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer transition-colors overflow-hidden',
    'group-data-[icon-collapsed]:justify-center group-data-[icon-collapsed]:px-0',
    isActive && 'bg-accent text-foreground font-medium',
    className
  )
  const dataProps = {
    'data-active': isActive ? 'true' : 'false'
  }

  if (asChild) {
    return withAsChild(children, resolvedClass, { ...dataProps, ...props })
  }

  return (
    <button className={resolvedClass} type={type} {...dataProps} {...props}>
      {children}
    </button>
  )
}

export const SidebarMenuAction = ({ className, type = 'button', ...props }: ComponentProps<'button'>) => {
  return (
    <button
      className={classes('absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer opacity-0 group-hover:opacity-100', className)}
      type={type}
      {...props}
    />
  )
}

export const SidebarMenuBadge = ({ className, ...props }: ComponentProps<'span'>) => {
  return <span className={classes('ml-auto text-xs font-medium text-muted-foreground', className)} {...props} />
}

export const SidebarMenuSub = ({ className, ...props }: ComponentProps<'ul'>) => {
  return <ul className={classes('list-none m-0 pl-4 border-l border-border space-y-1', className)} {...props} />
}

export const SidebarMenuSubItem = ({ className, ...props }: ComponentProps<'li'>) => {
  return <li className={classes('relative', className)} {...props} />
}

interface SidebarMenuSubButtonProps extends ComponentProps<'button'> {
  asChild?: boolean
}

export const SidebarMenuSubButton = ({
  asChild,
  className,
  children,
  type = 'button',
  ...props
}: SidebarMenuSubButtonProps) => {
  const resolvedClass = classes('w-full flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer transition-colors', className)
  if (asChild) {
    return withAsChild(children, resolvedClass, props)
  }

  return (
    <button className={resolvedClass} type={type} {...props}>
      {children}
    </button>
  )
}

interface SidebarMenuSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  showIcon?: boolean
}

export const SidebarMenuSkeleton = ({ showIcon = true, className, ...props }: SidebarMenuSkeletonProps) => {
  return (
    <div className={classes('flex items-center gap-2 px-2 py-1.5', className)} {...props}>
      {showIcon && <span className="w-4 h-4 rounded bg-muted animate-pulse shrink-0" />}
      <span className="h-3 flex-1 rounded bg-muted animate-pulse" />
    </div>
  )
}

export const SidebarTrigger = ({ className, onClick, ...props }: ComponentProps<'button'>) => {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      className={classes('w-8 h-8 flex items-center justify-center rounded-md hover:bg-accent cursor-pointer', className)}
      type="button"
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          toggleSidebar()
        }
      }}
      {...props}
    >
      <svg
        className="w-4 h-4"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="sr-only">Toggle Sidebar</span>
    </button>
  )
}

export const SidebarRail = ({ className, onClick, ...props }: ComponentProps<'button'>) => {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      className={classes('absolute right-0 top-0 bottom-0 w-1 hover:bg-border cursor-col-resize', className)}
      type="button"
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          toggleSidebar()
        }
      }}
      {...props}
    />
  )
}
