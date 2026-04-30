export type FastFlagKind = "FFlag" | "FInt" | "FString" | "FLog" | "FBoolean" | "Unknown";
export type FastFlagBehavior = "Fast" | "Dynamic" | "Synchronized" | "Unknown";

export interface FastFlag {
  name: string;
  value: string | number | boolean;
  kind: FastFlagKind;
  behavior: FastFlagBehavior;
  platforms: string[];
  channels: string[];
  description: string | undefined;
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
export function normalizeFastFlag(raw: RawFastFlag): FastFlag {
  return {
    name: raw.name,
    value: raw.value,
    kind: "Unknown", // Will be filled by enricher
    behavior: "Unknown", // Will be filled by enricher
    platforms: [],
    channels: [],
    description: raw.description,
  };
}
