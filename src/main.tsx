// MIT License - Copyright (c) fintonlabs.com
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { EditorProvider } from './state'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorProvider>
      <App />
    </EditorProvider>
  </StrictMode>,
)
