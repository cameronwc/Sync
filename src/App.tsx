import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { detectViewerTz, saveTzOverride } from './lib/identity'
import Landing from './pages/Landing'
import Join from './pages/Join'
import Created from './pages/Created'
import EventPage from './pages/EventPage'

interface ViewerTzContextValue {
  viewerTz: string
  setViewerTz: (tz: string) => void
}

const ViewerTzContext = createContext<ViewerTzContextValue | null>(null)

export function useViewerTz(): ViewerTzContextValue {
  const ctx = useContext(ViewerTzContext)
  if (!ctx) throw new Error('useViewerTz must be used within App')
  return ctx
}

function ViewerTzProvider({ children }: { children: ReactNode }): JSX.Element {
  const [viewerTz, setViewerTzState] = useState<string>(() => detectViewerTz())

  const setViewerTz = useCallback((tz: string) => {
    saveTzOverride(tz)
    setViewerTzState(tz)
  }, [])

  const value = useMemo(() => ({ viewerTz, setViewerTz }), [viewerTz, setViewerTz])

  return <ViewerTzContext.Provider value={value}>{children}</ViewerTzContext.Provider>
}

export default function App(): JSX.Element {
  return (
    <ViewerTzProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/join" element={<Join />} />
          <Route path="/join/:code" element={<Join />} />
          <Route path="/e/:slug/created" element={<Created />} />
          <Route path="/e/:slug" element={<EventPage />} />
        </Routes>
      </HashRouter>
    </ViewerTzProvider>
  )
}
