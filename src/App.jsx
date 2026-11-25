import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Camera from './pages/Camera.jsx'
import ScrumPoker from './pages/ScrumPoker.jsx'

export default function App() {
  return (
    <div className="app">
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/camera" element={<Camera />} />
          <Route path="/scrum-poker" element={<ScrumPoker />} />
        </Routes>
      </main>
    </div>
  )
}
