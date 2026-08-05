import { Card } from '@/components/ui/card'
import { PERSONA_LABELS } from '@/lib/demo-data'
import { useAppStore } from '@/stores/app-store'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export function AnalyticsPage() {
  const analytics = useAppStore((s) => s.analytics)
  const sessions = useAppStore((s) => s.sessions)

  const latest = analytics[analytics.length - 1]
  const avgConfidence =
    sessions.reduce((a, s) => a + s.confidence, 0) / Math.max(1, sessions.length)
  const avgFillers =
    sessions.reduce((a, s) => a + s.fillerWords, 0) / Math.max(1, sessions.length)

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <header className="max-w-xl">
        <h2 className="text-[17px] font-medium tracking-tight text-white/95">
          Your practice signals
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-white/40">
          Mock session trends — separate from Live kit answers.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat title="Confidence" value={`${Math.round(latest?.confidence ?? 0)}%`} hint="This week" />
        <Stat
          title="Technical depth"
          value={`${Math.round(latest?.technicalDepth ?? 0)}%`}
          hint="This week"
        />
        <Stat title="Avg confidence" value={`${Math.round(avgConfidence)}%`} hint="All sessions" />
        <Stat title="Avg fillers" value={avgFillers.toFixed(1)} hint="Per session" />
      </div>

      <section className="glass relative overflow-hidden rounded-[28px] p-8 md:p-10">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#5DD5E3]/35 to-transparent"
          aria-hidden
        />
        <div className="mb-8">
          <h2 className="text-[17px] font-medium tracking-tight text-white/95">Trends</h2>
          <p className="mt-1 text-[13px] text-white/40">Seven-day interview signals</p>
        </div>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={analytics}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.25)" fontSize={11} axisLine={false} tickLine={false} />
              <YAxis stroke="rgba(255,255,255,0.25)" fontSize={11} domain={[0, 100]} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: '#141414',
                  border: '1px solid rgba(32,184,205,0.25)',
                  borderRadius: 4,
                  fontWeight: 300,
                  letterSpacing: '0.08em',
                }}
              />
              <Area type="monotone" dataKey="confidence" stroke="#20B8CD" fill="transparent" strokeWidth={1.5} />
              <Area type="monotone" dataKey="starScore" stroke="#5DD5E3" fill="transparent" strokeWidth={1.5} />
              <Area type="monotone" dataKey="technicalDepth" stroke="#8A8A88" fill="transparent" strokeWidth={1} />
              <Area type="monotone" dataKey="fillerRate" stroke="#E8C547" fill="transparent" strokeWidth={1} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="glass rounded-[28px] p-8 md:p-10">
        <h2 className="mb-6 text-[17px] font-medium tracking-tight text-white/95">
          Sessions
        </h2>
        <div className="overflow-auto">
          <table className="w-full min-w-[680px] text-left">
            <thead className="text-[12px] text-white/35">
              <tr>
                <th className="pb-4 font-light">Role / persona</th>
                <th className="pb-4 font-light">Grade</th>
                <th className="pb-4 font-light">Qs</th>
                <th className="pb-4 font-light">Overall</th>
                <th className="pb-4 font-light">STAR</th>
                <th className="pb-4 font-light">Depth</th>
                <th className="pb-4 font-light">Fillers</th>
                <th className="pb-4 font-light">Notes</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-white/[0.06] text-[14px] text-white/80">
                  <td className="py-4 pr-4">
                    <div>{s.jobTitle || PERSONA_LABELS[s.persona]}</div>
                    <div className="text-[11px] text-white/35">
                      {PERSONA_LABELS[s.persona]}
                      {s.difficulty ? ` · ${s.difficulty}` : ''}
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-[#20B8CD]">{s.grade ?? '—'}</td>
                  <td className="py-4 pr-4 text-white/50">{s.questions}</td>
                  <td className="py-4 pr-4 text-[#5DD5E3]">
                    {s.overall != null ? `${s.overall}%` : `${s.confidence}%`}
                  </td>
                  <td className="py-4 pr-4 text-[#20B8CD]">{s.starCoverage}%</td>
                  <td className="py-4 pr-4">{s.technicalDepth}%</td>
                  <td className="py-4 pr-4 text-[#E8C547]">{s.fillerWords}</td>
                  <td className="py-4 text-[13px] text-white/40">{s.notes.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Stat({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card className="!p-6 md:!p-7">
      <div className="text-[12px] text-white/35">{title}</div>
      <div className="mt-2 text-[28px] font-medium tracking-tight text-white/95">{value}</div>
      <div className="mt-1 text-[12px] text-white/30">{hint}</div>
    </Card>
  )
}
