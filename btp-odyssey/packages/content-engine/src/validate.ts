import {
  CompetencySchema,
  DomainSchema,
  MissionSchema,
  type Competency,
  type Domain,
  type Mission,
} from "@btp-odyssey/shared";
import { z } from "zod";

export interface ValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface ContentBundle {
  domains: Domain[];
  competencies: Competency[];
  missions: Mission[];
}

export function validateBundle(bundle: ContentBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [i, d] of bundle.domains.entries()) {
    const r = DomainSchema.safeParse(d);
    if (!r.success) {
      for (const e of r.error.issues) {
        issues.push({
          path: `domains[${i}].${e.path.join(".")}`,
          message: e.message,
          severity: "error",
        });
      }
    }
  }

  const domainIds = new Set(bundle.domains.map((d) => d.id));
  const competencyIds = new Set<string>();

  for (const [i, c] of bundle.competencies.entries()) {
    const r = CompetencySchema.safeParse(c);
    if (!r.success) {
      for (const e of r.error.issues) {
        issues.push({
          path: `competencies[${i}].${e.path.join(".")}`,
          message: e.message,
          severity: "error",
        });
      }
    } else {
      if (competencyIds.has(c.id)) {
        issues.push({
          path: `competencies[${i}].id`,
          message: `Duplicate competency id ${c.id}`,
          severity: "error",
        });
      }
      competencyIds.add(c.id);
      if (!domainIds.has(c.domainId)) {
        issues.push({
          path: `competencies[${i}].domainId`,
          message: `Unknown domain ${c.domainId}`,
          severity: "error",
        });
      }
      for (const pre of c.prerequisites) {
        if (!competencyIds.has(pre) && !bundle.competencies.some((x) => x.id === pre)) {
          issues.push({
            path: `competencies[${i}].prerequisites`,
            message: `Unknown prerequisite ${pre}`,
            severity: "warning",
          });
        }
      }
      if (c.sources.length === 0) {
        issues.push({
          path: `competencies[${i}].sources`,
          message: "No source citations — mark confidence carefully",
          severity: "warning",
        });
      }
    }
  }

  for (const [i, m] of bundle.missions.entries()) {
    const r = MissionSchema.safeParse(m);
    if (!r.success) {
      for (const e of r.error.issues) {
        issues.push({
          path: `missions[${i}].${e.path.join(".")}`,
          message: e.message,
          severity: "error",
        });
      }
    } else {
      for (const d of m.domainIds) {
        if (!domainIds.has(d)) {
          issues.push({
            path: `missions[${i}].domainIds`,
            message: `Unknown domain ${d}`,
            severity: "error",
          });
        }
      }
      for (const c of m.competencyIds) {
        if (!competencyIds.has(c) && !bundle.competencies.some((x) => x.id === c)) {
          issues.push({
            path: `missions[${i}].competencyIds`,
            message: `Unknown competency ${c}`,
            severity: "error",
          });
        }
      }
      if (!m.fidelity) {
        issues.push({
          path: `missions[${i}].fidelity`,
          message: "Missing fidelity disclosure",
          severity: "error",
        });
      }
    }
  }

  return issues;
}

export function assertValidBundle(bundle: ContentBundle): void {
  const issues = validateBundle(bundle);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) {
    throw new Error(
      `Content validation failed:\n` +
        errors.map((e) => `- ${e.path}: ${e.message}`).join("\n"),
    );
  }
}

export const ContentManifestSchema = z.object({
  version: z.string(),
  domains: z.array(z.string()),
  competencies: z.array(z.string()),
  missions: z.array(z.string()),
});
