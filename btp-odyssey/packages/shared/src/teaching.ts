import { z } from "zod";

export const ConceptCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  domainId: z.string(),
  level: z.enum(["basic", "advanced", "expert"]),
  summary: z.string(),
  explain: z.string(),
  analogy: z.string(),
  whyItMatters: z.string(),
  formalPoints: z.array(z.string()).default([]),
  commonMistakes: z.array(z.string()).default([]),
  howToRecognize: z.array(z.string()).default([]),
  howToApply: z.array(z.string()).default([]),
  relatedIds: z.array(z.string()).default([]),
  glossary: z
    .array(z.object({ term: z.string(), definition: z.string() }))
    .default([]),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        confidence: z.enum(["high", "medium", "low", "uncertain"]).default("medium"),
      }),
    )
    .default([]),
  tags: z.array(z.string()).default([]),
  /** Memory hook — short sticky phrase */
  mnemonic: z.string().optional(),
  memoryHook: z.string().optional(),
  /** Concrete situations that make the concept vivid */
  useCases: z.array(z.string()).default([]),
  /** Architect-level design trade-offs (aim ≥3) */
  designTradeoffs: z
    .array(
      z.object({
        decision: z.string(),
        optionA: z.string(),
        optionB: z.string(),
        whenChooseA: z.string(),
        whenChooseB: z.string(),
        risk: z.string(),
      }),
    )
    .default([]),
  /** Linked PLAY challenges for this concept */
  linkedGames: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        role: z.string(),
        purpose: z.string().optional(),
      }),
    )
    .default([]),
});

export type ConceptCard = z.infer<typeof ConceptCardSchema>;

export const TeachBlockSchema = z.object({
  headline: z.string(),
  explain: z.string(),
  analogy: z.string().optional(),
  whyItMatters: z.string().optional(),
  formalPoints: z.array(z.string()).default([]),
  commonMistakes: z.array(z.string()).default([]),
  workedExample: z
    .object({
      setup: z.string(),
      steps: z.array(z.string()),
      takeaway: z.string(),
    })
    .optional(),
  revealLevels: z
    .array(
      z.object({
        title: z.string(),
        body: z.string(),
      }),
    )
    .default([]),
  miniDiagram: z.string().optional(),
});

export const StepCheckSchema = z.object({
  type: z.enum(["mc", "multi", "order", "short", "match"]),
  question: z.string(),
  options: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        correct: z.boolean().default(false),
        feedback: z.string(),
      }),
    )
    .default([]),
  acceptKeywords: z.array(z.string()).default([]),
  explanation: z.string(),
  passScore: z.number().min(0).max(1).default(1),
});

export type StepCheck = z.infer<typeof StepCheckSchema>;
export type TeachBlock = z.infer<typeof TeachBlockSchema>;
