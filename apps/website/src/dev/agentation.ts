/// <reference types="vite/client" />
// Dev-only annotation overlay (agentation.com). The tool is React-only, so it
// gets its own island; react is a devDependency and none of this reaches the
// production bundle — main.ts only imports it behind import.meta.env.DEV.
import { Agentation } from 'agentation'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

const host = document.createElement('div')
host.id = 'agentation'
document.body.append(host)
createRoot(host).render(createElement(Agentation))
