import React from 'react'

const createMockComponent = (name: string) => {
  const Component = (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode)
  Component.displayName = name
  return Component
}

export const View = createMockComponent('View')
export const Text = createMockComponent('Text')
export const TextInput = createMockComponent('TextInput')
export const TouchableOpacity = createMockComponent('TouchableOpacity')
export const Pressable = createMockComponent('Pressable')
export const ScrollView = createMockComponent('ScrollView')
export const SafeAreaView = createMockComponent('SafeAreaView')

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (
    style: Record<string, unknown> | ReadonlyArray<Record<string, unknown>> | null | undefined
  ): Record<string, unknown> => {
    const isStyleArray = (
      value: Record<string, unknown> | ReadonlyArray<Record<string, unknown>> | null | undefined
    ): value is ReadonlyArray<Record<string, unknown>> => Array.isArray(value)

    if (!style) {
      return {}
    }

    if (!isStyleArray(style)) {
      return { ...style }
    }

    const flattened: Record<string, unknown> = {}
    for (const styleEntry of style) {
      for (const [key, value] of Object.entries(styleEntry)) {
        flattened[key] = value
      }
    }

    return flattened
  }
}

export const Platform = {
  OS: 'ios' as const,
  select: <T>(obj: { ios?: T; android?: T; default?: T }): T | undefined =>
    obj.ios ?? obj.default
}

export const Alert = {
  alert: (...args: unknown[]) => {
    void args
  }
}
