# Design System (R0)

## Principles

- Professional, cinematic, credible — not cartoon gamification  
- Learning efficacy over spectacle  
- Accessible by default  

## Tokens

| Token | Dark (default) | Light |
|-------|----------------|-------|
| `--bg` | `#0b1220` | `#f4f7fb` |
| `--surface` | `#121a2b` | `#ffffff` |
| `--border` | `#243049` | `#d7e0ee` |
| `--text` | `#e8eef9` | `#0f172a` |
| `--muted` | `#93a4c3` | `#5b6b86` |
| `--accent` | `#3b82f6` | `#2563eb` |
| `--good` | `#34d399` | `#059669` |
| `--warn` | `#fbbf24` | `#d97706` |
| `--bad` | `#f87171` | `#dc2626` |
| `--fidelity` | `#a78bfa` | `#7c3aed` |

## Typography

- UI: system-ui / Segoe UI / Inter fallback  
- Mono: ui-monospace for logs and IDs  

## Components (R1)

- App shell with world nav  
- Fidelity banner  
- Mission step player  
- Landscape graph list  
- Log / metric / trace panels  
- Mentor panel  
- Evidence summary  

## A11y

- Focus visible rings  
- Prefer `rem` spacing  
- `prefers-reduced-motion` respected (no essential info in motion only)  
- Color not sole status channel (icons + text)  

## Performance budgets (targets)

| Metric | Budget |
|--------|--------|
| Initial JS (gzipped, R1) | < 250 KB |
| Interaction to paint (local) | < 100 ms for step nav |
| API mission load | < 50 ms local |
