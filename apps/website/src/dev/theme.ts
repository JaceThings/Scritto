const COOKIE = 'theme'
const YEAR = 60 * 60 * 24 * 365

export const isDark = () => document.documentElement.classList.contains('dark')

export const setTheme = (dark: boolean) => {
  document.documentElement.classList.toggle('dark', dark)
  document.cookie = `${COOKIE}=${dark ? 'dark' : 'light'}; path=/; max-age=${YEAR}; samesite=lax`
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1a1a' : '#ffffff')
}

export const bindThemeToggle = (button: HTMLButtonElement) => {
  const paint = () => {
    button.textContent = isDark() ? 'Light' : 'Dark'
    button.setAttribute('aria-pressed', String(isDark()))
  }
  paint()
  button.addEventListener('click', () => {
    setTheme(!isDark())
    paint()
  })
}
