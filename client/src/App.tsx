import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ApiDesigner from './pages/ApiDesigner'
import EndpointEditor from './pages/EndpointEditor'
import Explorer from './pages/Explorer'
import Documentation from './pages/Documentation'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="explorer" element={<Explorer />} />
          <Route path="api-designer" element={<ApiDesigner />} />
          <Route path="api-designer/new" element={<EndpointEditor />} />
          <Route path="api-designer/:id" element={<EndpointEditor />} />
          <Route path="documentation" element={<Documentation />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
