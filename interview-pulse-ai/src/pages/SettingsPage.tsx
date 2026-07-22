import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { clamp } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const stealth = useAppStore((s) => s.stealth)
  const updateStealth = useAppStore((s) => s.updateStealth)

  const applyOpacity = async (opacity: number) => {
    updateStealth({ opacity })
    await window.interviewPulse?.setOverlayOpacity(opacity)
  }

  const applyClickThrough = async (enabled: boolean) => {
    updateStealth({ clickThrough: enabled })
    await window.interviewPulse?.setClickThrough(enabled)
  }

  const applyProtection = async (enabled: boolean) => {
    updateStealth({ contentProtection: enabled })
    await window.interviewPulse?.setContentProtection(enabled)
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <section className="glass rounded-[28px] p-8 md:p-10">
        <h2 className="text-[17px] font-medium tracking-tight text-white/95">
          Intelligence
        </h2>
        <p className="mt-1 mb-8 text-[13px] leading-relaxed text-white/40">
          Real answers use the Python copilot API on port 8787. Demo mode only simulates the stream.
        </p>

        <div className="mb-8 rounded-[18px] glass-inset px-5 py-4 text-[13px] leading-relaxed text-white/45">
          <p className="mb-2 font-light text-white/70">Start backend</p>
          <code className="block text-[12px] text-[#5DD5E3]">
            venv\Scripts\python.exe copilot_api.py
          </code>
        </div>

        <label className="mb-8 flex items-center justify-between gap-4 text-[14px] text-white/80">
          <span className="flex items-center gap-2">
            Demo mode
            {settings.demoMode && <Badge tone="amber">On</Badge>}
          </span>
          <input
            type="checkbox"
            checked={settings.demoMode}
            onChange={(e) => updateSettings({ demoMode: e.target.checked })}
            className="h-5 w-5 accent-[#20B8CD]"
          />
        </label>

        <div className="space-y-5">
          <Field
            label="OpenAI API key"
            value={settings.openaiKey}
            onChange={(v) => updateSettings({ openaiKey: v })}
            placeholder="sk-…"
          />
          <Field
            label="Anthropic API key"
            value={settings.anthropicKey}
            onChange={(v) => updateSettings({ anthropicKey: v })}
            placeholder="sk-ant-…"
          />
          <Field
            label="Deepgram API key"
            value={settings.deepgramKey}
            onChange={(v) => updateSettings({ deepgramKey: v })}
            placeholder="dg-…"
          />
          <label>
            <span className="label-quiet">Job context</span>
            <input
              className="field"
              value={settings.jobContext}
              onChange={(e) => updateSettings({ jobContext: e.target.value })}
            />
          </label>
          <label>
            <span className="label-quiet">Tone</span>
            <select
              className="field"
              value={settings.tone}
              onChange={(e) =>
                updateSettings({
                  tone: e.target.value as 'professional' | 'casual' | 'confident',
                })
              }
            >
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
              <option value="confident">Confident</option>
            </select>
          </label>
        </div>
      </section>

      <section className="glass rounded-[28px] p-8 md:p-10">
        <h2 className="text-[17px] font-medium tracking-tight text-white/95">
          Stealth
        </h2>
        <p className="mt-1 mb-8 text-[13px] text-white/40">
          Overlay stays hidden from most screen shares. Hotkey {stealth.hotkey}.
        </p>

        <div className="space-y-6">
          <ToggleRow
            label="Hide from screen share"
            checked={stealth.contentProtection}
            onChange={(v) => void applyProtection(v)}
          />
          <ToggleRow
            label="Click-through overlay"
            checked={stealth.clickThrough}
            onChange={(v) => void applyClickThrough(v)}
          />
          <div>
            <div className="mb-3 flex justify-between text-[13px] text-white/45">
              <span>Opacity</span>
              <span>{Math.round(stealth.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(stealth.opacity * 100)}
              onChange={(e) =>
                void applyOpacity(clamp(Number(e.target.value) / 100, 0.2, 1))
              }
              className="w-full accent-[#20B8CD]"
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => void window.interviewPulse?.openOverlay()}
          >
            Open overlay
          </Button>
        </div>
      </section>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label>
      <span className="label-quiet">{label}</span>
      <input
        type="password"
        className="field"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-[14px] text-white/80">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 accent-[#20B8CD]"
      />
    </label>
  )
}
