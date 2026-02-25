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
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const SIDEBAR_WIDTH = '17.5rem'
const SIDEBAR_WIDTH_MOBILE = '18rem'
const SIDEBAR_WIDTH_ICON = '4.5rem'
const SIDEBAR_KEYBOARD_SHORTCUT = 'b'

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

const isMacPlatform = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
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
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const [openMobile, setOpenMobile] = useState(false)
  const [isMobile, setIsMobile] = useState(resolveMobileViewport)

  const open = openProp ?? uncontrolledOpen
  const state: SidebarState = open ? 'expanded' : 'collapsed'

  const setOpen = useCallback((nextOpen: boolean) => {
    if (openProp === undefined) {
      setUncontrolledOpen(nextOpen)
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

    const onChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches)
    }

    setIsMobile(mediaQuery.matches)
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange as (event: MediaQueryListEvent) => void)
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(onChange as (event: MediaQueryListEvent) => void)
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', onChange as (event: MediaQueryListEvent) => void)
      } else if (typeof mediaQuery.removeListener === 'function') {
        mediaQuery.removeListener(onChange as (event: MediaQueryListEvent) => void)
      }
    }
  }, [])

  useEffect(() => {
    if (!isMobile) {
      setOpenMobile(false)
    }
  }, [isMobile])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== SIDEBAR_KEYBOARD_SHORTCUT) {
        return
      }

      const modifierPressed = isMacPlatform() ? event.metaKey : event.ctrlKey
      if (!modifierPressed) {
        return
      }

      event.preventDefault()
      toggleSidebar()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [toggleSidebar])

  const contextValue = useMemo<SidebarContextValue>(() => ({
    state,
    open,
    setOpen,
    openMobile,
    setOpenMobile,
    isMobile,
    toggleSidebar
  }), [isMobile, open, openMobile, setOpen, state, toggleSidebar])

  const providerStyle = {
    '--sidebar-width': SIDEBAR_WIDTH,
    '--sidebar-width-mobile': SIDEBAR_WIDTH_MOBILE,
    '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
    ...style
  } as CSSProperties

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className={classes('sidebar-provider', className)}
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
    return (
      <>
        <button
          type="button"
          className={classes('sidebar-mobile-overlay', openMobile && 'is-open')}
          aria-label="Close sidebar"
          onClick={() => setOpenMobile(false)}
        />
        <aside
          className={classes(
            'sidebar-mobile-panel',
            side === 'right' ? 'is-right' : 'is-left',
            openMobile && 'is-open',
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
        'sidebar-root',
        side === 'right' ? 'is-right' : 'is-left',
        variant === 'floating' && 'is-floating',
        variant === 'inset' && 'is-inset',
        collapsedToIcon && 'is-collapsed-icon',
        collapsedOffcanvas && 'is-collapsed-offcanvas',
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
  )
}

export const SidebarInset = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('sidebar-inset', className)} {...props} />
}

export const SidebarHeader = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('sidebar-header', className)} {...props} />
}

export const SidebarFooter = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('sidebar-footer', className)} {...props} />
}

export const SidebarContent = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('sidebar-content', className)} {...props} />
}

export const SidebarGroup = ({ className, ...props }: ComponentProps<'section'>) => {
  return <section className={classes('sidebar-group', className)} {...props} />
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
  const resolvedClass = classes('sidebar-group-label', className)
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
      className={classes('sidebar-group-action', className)}
      {...props}
    />
  )
}

export const SidebarGroupContent = ({ className, ...props }: ComponentProps<'div'>) => {
  return <div className={classes('sidebar-group-content', className)} {...props} />
}

export const SidebarMenu = ({ className, ...props }: ComponentProps<'ul'>) => {
  return <ul className={classes('sidebar-menu', className)} {...props} />
}

export const SidebarMenuItem = ({ className, ...props }: ComponentProps<'li'>) => {
  return <li className={classes('sidebar-menu-item', className)} {...props} />
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
  const resolvedClass = classes('sidebar-menu-button', isActive && 'is-active', className)
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
      className={classes('sidebar-menu-action', className)}
      type={type}
      {...props}
    />
  )
}

export const SidebarMenuBadge = ({ className, ...props }: ComponentProps<'span'>) => {
  return <span className={classes('sidebar-menu-badge', className)} {...props} />
}

export const SidebarMenuSub = ({ className, ...props }: ComponentProps<'ul'>) => {
  return <ul className={classes('sidebar-menu-sub', className)} {...props} />
}

export const SidebarMenuSubItem = ({ className, ...props }: ComponentProps<'li'>) => {
  return <li className={classes('sidebar-menu-sub-item', className)} {...props} />
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
  const resolvedClass = classes('sidebar-menu-sub-button', className)
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
    <div className={classes('sidebar-menu-skeleton', className)} {...props}>
      {showIcon && <span className="sidebar-menu-skeleton-icon" />}
      <span className="sidebar-menu-skeleton-line" />
    </div>
  )
}

export const SidebarTrigger = ({ className, onClick, ...props }: ComponentProps<'button'>) => {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      className={classes('sidebar-trigger', className)}
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
        className="sidebar-trigger-icon"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className="sr-only">Toggle Sidebar</span>
    </button>
  )
}

export const SidebarRail = ({ className, onClick, ...props }: ComponentProps<'button'>) => {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      className={classes('sidebar-rail', className)}
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
