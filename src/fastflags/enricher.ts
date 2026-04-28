import { FastFlag, FastFlagKind, FastFlagBehavior } from "./parser.js";

/**
 * Enriches a FastFlag by infering its kind and behavior from its name.
 */
export function enrichFastFlag(flag: FastFlag): FastFlag {
	const name = flag.name;
	let kind: FastFlagKind = "Unknown";
	let behavior: FastFlagBehavior = "Unknown";

	// 1. Infer Kind
	// We check for exact prefixes to avoid false positives like "UnknownFlag"
	if (name.startsWith("FInt") || name.startsWith("DFInt") || name.startsWith("SFInt")) {
		kind = "FInt";
	} else if (name.startsWith("FString") || name.startsWith("DFString") || name.startsWith("SFString")) {
		kind = "FString";
	} else if (name.startsWith("FLog") || name.startsWith("DFLog") || name.startsWith("SFLog")) {
		kind = "FLog";
	} else if (name.startsWith("FFlag") || name.startsWith("DFFlag") || name.startsWith("SFFlag") || name.startsWith("FBoolean")) {
		kind = "FFlag";
	}

	// 2. Infer Behavior
	if (name.startsWith("FFlag") || name.startsWith("FInt") || name.startsWith("FString") || name.startsWith("FLog")) {
		behavior = "Fast";
	} else if (name.startsWith("DF")) {
		behavior = "Dynamic";
	} else if (name.startsWith("SF")) {
		behavior = "Synchronized";
	}

	return {
		...flag,
		kind,
		behavior,
	};
}
