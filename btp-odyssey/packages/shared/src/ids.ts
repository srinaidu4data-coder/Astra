export type Brand<T, B extends string> = T & { readonly __brand: B };

export type CompetencyId = Brand<string, "CompetencyId">;
export type MissionId = Brand<string, "MissionId">;
export type ScenarioId = Brand<string, "ScenarioId">;
export type DomainId = Brand<string, "DomainId">;
export type ResourceId = Brand<string, "ResourceId">;
export type LearnerId = Brand<string, "LearnerId">;
export type SessionId = Brand<string, "SessionId">;
export type EvidenceId = Brand<string, "EvidenceId">;

export function asId<T extends string>(value: string): Brand<string, T> {
  return value as Brand<string, T>;
}
