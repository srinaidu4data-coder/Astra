import type { Mission as SharedMission } from "@btp-odyssey/shared";

export type Mission = SharedMission;

export interface StepAnswer {
  stepId: string;
  text?: string;
  selectedOptionIds?: string[];
  configPatch?: Record<string, unknown>;
  diagnosis?: string;
  reflection?: string;
}
