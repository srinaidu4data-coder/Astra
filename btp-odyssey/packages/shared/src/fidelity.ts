/**
 * Simulation fidelity tiers (product requirement §9).
 * The UI must never mislead learners about fidelity.
 */
export type FidelityTier =
  | "tier1_conceptual"
  | "tier2_behavioral"
  | "tier3_sandbox";

export const FIDELITY_LABELS: Record<FidelityTier, string> = {
  tier1_conceptual:
    "Conceptual simulation — teaches concepts and trade-offs; does not reproduce exact SAP runtime behavior.",
  tier2_behavioral:
    "Behaviorally representative — models major inputs, outputs, dependencies, and failures with documented simplifications.",
  tier3_sandbox:
    "High-fidelity sandbox — uses an approved isolated or verified compatible environment.",
};

export interface FidelityDisclosure {
  tier: FidelityTier;
  behaviorsRepresented: string[];
  behaviorsSimplified: string[];
  behaviorsOmitted: string[];
  differencesFromReal: string[];
  lastVerificationDate: string; // ISO date
  knownLimitations: string[];
  sourceVersions: string[];
}
