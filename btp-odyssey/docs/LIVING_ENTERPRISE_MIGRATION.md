# Living Enterprise — content & runtime migration

## Principles

- No loss of cleared challenge IDs.  
- No fabricated SAP certifications.  
- Guest path never requires registration.  
- Rollback = previous container image + unchanged `data/runtime` volume.

## Runtime

| Path | Action |
|------|--------|
| `data/runtime/learner-*.json` | Keep; new fields optional |
| `data/runtime/sessions/*` | Keep mission sessions |
| Challenge pack | Split generation; full pack remains for offline tools |

## Feature flags (settings)

```
livingEnterprise: true (default)
legacyShell: false
lowStimulation: false
dataSaver: false
silentMode: false
lowPower: false
sessionGoalMinutes: 25
quietHoursStart: null
quietHoursEnd: null
graceStreakOptIn: false
```
