# Content Authoring Schema

Curriculum lives under `content/` as JSON validated by Zod schemas in `@btp-odyssey/shared`.

## Layout

```
content/
  domains/*.json
  competencies/*.json
  missions/*.json
```

## Required fields (mission)

- `id`, `title`, `summary`  
- `domainIds`, `competencyIds`, `targetLevel`  
- `fidelity` (tier + represented/simplified/omitted/differences + dates)  
- `steps[]` with `kind` from learning loop vocabulary  
- `sources[]` with confidence  
- `assessmentRubric[]`  

## Validation

```bash
npm run validate:content
```

Errors block load. Warnings (e.g., empty sources) print but allow draft work.

## States

`reviewStatus`: draft | in_review | approved | expired | deprecated  

R1 content ships as `in_review` — not marketed as expert-verified SAP truth.

## Publishing (planned)

Draft → review → approved → publish with version + rollback (R7 content ops).
