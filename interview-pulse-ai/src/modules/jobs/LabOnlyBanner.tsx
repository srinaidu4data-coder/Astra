/**
 * Always-visible lab banner — Microsoft Contoso review: never hide "lab only".
 */
import { isJobSearchLabHost } from '@/services/jobsearch'
import { FlaskConical } from 'lucide-react'

export function LabOnlyBanner() {
  const lab = isJobSearchLabHost()
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-[#fdd663]/25 bg-[#fdd663]/10 px-3 py-2 text-[12px] text-[#fdd663]"
      role="status"
      data-testid="lab-only-banner"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 leading-snug">
        <strong className="font-medium">Localhost lab only.</strong>{' '}
        {lab
          ? 'Not Contoso-ready. You own every claim and every Submit. CAPTCHA/login stay manual.'
          : 'Host is not a lab hostname — apply features may be disabled.'}
      </span>
    </div>
  )
}
