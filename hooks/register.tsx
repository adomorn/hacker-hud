import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './scene.js'
import { registerSessionTools, startSessionTools } from './session-tools'

// A dark green-on-black terminal palette for the desktop app's Code tab.
const { theme, problems } = makeColors({
  label: 'Hacker HUD',
  only: 'dark',
  roles: { accent: '#39ff6a', danger: '#ff4d5e', success: '#7dff9a', warning: '#ffd34d', pro: '#3dd6ff' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#030805',
        'surface-1': '#07100a',
        'surface-2': '#0a160e',
        'surface-3': '#0e1c13',
        'text-primary': '#d9ffe3',
        'text-secondary': '#a6e8b7',
        'text-muted': '#79c28e',
      },
    },
  },
})

const SCENE_ID = 'code-rain'

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_ID, glass: { blur: 14, tint: '#020805', opacity: 0.55 } },
}

export const register: Register = on => {
  registerSessionTools(on)

  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    // The terminal never draws a theme, so the result is not reported: no nagging at every start.
    // A theme that can't be set (another mod holds the look) leaves the rest of the mod running.
    try {
      await $.theme.set(LOOK)
    } catch {
      // Keep the current look.
    }

    const started = await next(e)
    startSessionTools($)

    return started
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE_ID) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return <Svg source={SCENE} alt="Green katakana code falling down a black screen" isInteractive />
  })
}
