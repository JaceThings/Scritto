/// <reference types="vite/client" />
// Dev-only React island; main.ts imports it behind import.meta.env.DEV.
import { Agentation } from 'agentation'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

const host = document.createElement('div')
host.id = 'agentation'
document.body.append(host)
createRoot(host).render(createElement(Agentation))
