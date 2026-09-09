export interface ContextAction {
  label: string
  run: () => void
  danger?: boolean
}

/** One transient, keyboard-accessible menu. A token prevents late OSM responses
 * from reopening a menu after Escape, a map movement, or another right-click. */
export class MapContextMenu {
  private element?: HTMLDivElement
  private version = 0
  private restoreFocus?: HTMLElement

  constructor() {
    document.addEventListener('pointerdown', event => {
      if (this.element && !this.element.contains(event.target as Node)) this.close()
    }, true)
    document.addEventListener('keydown', event => {
      if (!this.element) return
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault()
        event.stopPropagation(); this.close(true); return
      }
      const items = [...this.element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      if (!items.length) return
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      let next: number | undefined
      if (event.key === 'ArrowDown') next = (index + 1) % items.length
      if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index + items.length - 1) % items.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = items.length - 1
      if (next !== undefined) { event.preventDefault(); event.stopPropagation(); items[next].focus() }
    }, true)
    window.addEventListener('resize', () => this.close())
    window.addEventListener('blur', () => this.close())
  }

  open(x: number, y: number): number {
    this.close()
    this.restoreFocus = document.activeElement as HTMLElement
    const menu = document.createElement('div')
    menu.className = 'map-context-menu'; menu.setAttribute('role', 'menu'); menu.tabIndex = -1
    menu.style.left = `${x}px`; menu.style.top = `${y}px`
    this.element = menu; document.body.append(menu)
    this.fill('Loading feature…', [])
    menu.focus()
    return this.version
  }

  isOpen(token: number): boolean { return token === this.version && !!this.element }

  fill(title: string, actions: ContextAction[]): void {
    const menu = this.element
    if (!menu) return
    menu.replaceChildren(); menu.setAttribute('aria-label', title)
    const heading = document.createElement('div')
    heading.className = 'map-context-title'; heading.textContent = title; menu.append(heading)
    for (const action of actions) {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = action.label; button.setAttribute('role', 'menuitem')
      if (action.danger) button.className = 'danger'
      button.addEventListener('click', () => { this.close(true); action.run() })
      menu.append(button)
    }
    const bounds = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(bounds.top, window.innerHeight - bounds.height - 8))}px`
  }

  close(restoreFocus = false): void {
    this.version++
    this.element?.remove(); this.element = undefined
    if (restoreFocus && this.restoreFocus?.isConnected) this.restoreFocus.focus({ preventScroll: true })
    this.restoreFocus = undefined
  }
}
