import { Outlet, NavLink } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutDashboard, Code2, Database, Bus, BookOpen, Loader2 } from 'lucide-react'
import { api, type DataSource } from '../lib/api'

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/explorer', label: 'Explorateur', icon: Database },
  { to: '/api-designer', label: 'API Designer', icon: Code2 },
  { to: '/documentation', label: 'Documentation', icon: BookOpen },
]

export default function Layout() {
  const qc = useQueryClient()

  const { data: sourceData } = useQuery({
    queryKey: ['source'],
    queryFn: api.source.get,
    staleTime: 10_000,
  })

  const setSource = useMutation({
    mutationFn: (source: DataSource) => api.source.set(source),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['source'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['explore'] }),
        qc.invalidateQueries({ queryKey: ['explore-route'] }),
        qc.invalidateQueries({ queryKey: ['explore-route-modes'] }),
        qc.invalidateQueries({ queryKey: ['explore-commercial-modes'] }),
        qc.invalidateQueries({ queryKey: ['explore-stop-types'] }),
        qc.invalidateQueries({ queryKey: ['explore-poi-categories'] }),
        qc.invalidateQueries({ queryKey: ['explore-stop'] }),
        qc.invalidateQueries({ queryKey: ['import-status'] }),
      ])
    },
  })

  const active = sourceData?.active ?? 'gtfs'
  const activeLabel = sourceData?.sources.find((s) => s.id === active)?.label ?? active.toUpperCase()

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-60 bg-gray-900 text-white flex flex-col flex-shrink-0">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <Bus className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-bold text-lg tracking-tight block leading-tight">Maasterplan</span>
            <div className="mt-1.5 flex items-center gap-1.5">
              <select
                className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
                value={active}
                disabled={setSource.isPending}
                onChange={(e) => setSource.mutate(e.target.value as DataSource)}
                aria-label="Source de données"
              >
                <option value="gtfs">GTFS</option>
                <option value="netex">NeTEx</option>
              </select>
              {setSource.isPending && <Loader2 className="w-3 h-3 animate-spin text-gray-400 flex-shrink-0" />}
            </div>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-gray-500">
              <span
                className={`w-1.5 h-1.5 rounded-full ${active === 'netex' ? 'bg-amber-400' : 'bg-emerald-400'}`}
              />
              Source {activeLabel}
            </span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to !== '/explorer'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-gray-800 text-xs text-gray-500">
          Sytral Mobilités · RFU
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
