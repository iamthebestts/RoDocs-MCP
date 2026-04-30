export type FastFlagKind = "FFlag" | "FInt" | "FString" | "FLog" | "Unknown";
export type FastFlagBehavior = "Fast" | "Dynamic" | "Synchronized" | "Unknown";

export interface FastFlag {
  name: string;
  value: string | number | boolean | undefined;
  valuesByTarget: Record<string, string | number | boolean> | undefined;
  kind: FastFlagKind;
  behavior: FastFlagBehavior;
  platforms: string[];
  targets: string[];
  sources: Array<{ target: string; url: string; sha?: string }>;
  description?: string | undefined;
}
export interface RawFastFlag {
  name: string;
  value: string | number | boolean;
  description?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Normalizes raw flag data into a standard FastFlag format.
 */
export function normalizeFastFlag(
  raw: RawFastFlag,
): Omit<FastFlag, "kind" | "behavior" | "platforms" | "targets" | "sources" | "valuesByTarget"> {
  return {
    name: raw.name,
    value: raw.value,
    description: raw.description,
  };
}
