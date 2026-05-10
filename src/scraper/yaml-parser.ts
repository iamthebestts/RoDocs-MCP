import yaml from "js-yaml";
import type { CodeSample, RichMember, RobloxDocEntry } from "./fetch.js";

interface RawParameter {
  name: string;
  type: string;
  default?: string | number | boolean;
  summary: string;
}

interface RawReturn {
  type: string;
  summary: string;
}

interface RawMember {
  name: string;
  summary: string;
  description?: string;
  type?: string;
  default?: string | number | boolean | null;
  parameters?: RawParameter[];
  returns?: RawReturn[];
  code_samples?: string[];
  tags?: string[];
  security?: { read?: string; write?: string } | string;
  thread_safety?: string;
  deprecation_message?: string;
  capabilities?: string[];
}

interface RawEnumItem {
  name: string;
  summary: string;
  value: number;
  code_samples?: string[];
  tags?: string[];
  deprecation_message?: string;
}

interface RawMathOp {
  name: string;
  operation: string;
  summary: string;
  description?: string;
  type_a: string;
  type_b: string;
  return_type: string;
  code_samples?: string[];
  tags?: string[];
  deprecation_message?: string;
}

interface RawConstant {
  name: string;
  type: string;
  summary: string;
  description?: string;
  code_samples?: string[];
  tags?: string[];
  deprecation_message?: string;
}

interface RawYaml {
  name: string;
  type: "class" | "library" | "datatype" | "enum" | "global";
  summary?: string;
  description?: string;
  inherits?: string[];
  descendants?: string[];
  tags?: string[];
  deprecation_message?: string;
  code_samples?: string[];
  memory_category?: string;
  // class
  properties?: RawMember[];
  methods?: RawMember[];
  events?: RawMember[];
  callbacks?: RawMember[];
  // library + global + datatype
  functions?: RawMember[];
  // datatype
  constructors?: RawMember[];
  constants?: RawConstant[];
  math_operations?: RawMathOp[];
  // enum
  items?: RawEnumItem[];
}

export function parseYamlToDocEntry(yamlContent: string): RobloxDocEntry {
  const loaded = yaml.load(yamlContent);
  if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) {
    throw new Error("Invalid creator-docs YAML: expected a document object.");
  }
  const parsed = loaded as RawYaml;
  const description = parsed.description ?? "";
  if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
    throw new Error("Invalid creator-docs YAML: missing API name.");
  }
  if (!["class", "library", "datatype", "enum", "global"].includes(parsed.type)) {
    throw new Error(`Invalid creator-docs YAML: unsupported API type "${String(parsed.type)}".`);
  }

  const properties = [
    ...(parsed.properties ?? []).map(mapMember),
    ...(parsed.constants ?? []).map(mapConstant),
    ...(parsed.items ?? []).map(mapEnumItem),
  ];

  const methods = [
    ...(parsed.methods ?? []).map(mapMember),
    ...(parsed.functions ?? []).map(mapMember),
    ...(parsed.constructors ?? []).map(mapConstructor),
    ...(parsed.math_operations ?? []).map(mapMathOp),
  ];

  const ownMembers = {
    properties,
    methods,
    events: (parsed.events ?? []).map(mapMember),
    callbacks: (parsed.callbacks ?? []).map(mapMember),
  };

  const depMsg = parsed.deprecation_message ?? "";

  return {
    class: {
      kind: parsed.type,
      name: parsed.name,
      summary: parsed.summary ?? firstLine(description),
      description,
      inherits: parsed.inherits ?? [],
      descendants: parsed.descendants ?? [],
      tags: parsed.tags ?? [],
      deprecationMessage: depMsg,
      codeSamples: collectCodeSamples(parsed, description),
      ownMembers,
    },
    inheritedMembers: [],
  };
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

function flattenSecurity(
  sec: { read?: string; write?: string } | string | undefined | null,
): string | null {
  if (typeof sec === "string") return sec;
  if (typeof sec === "object" && sec !== null) {
    const r = sec.read ?? "None";
    const w = sec.write ?? "None";
    return r === w ? r : `${r}/${w}`;
  }
  return null;
}

function mapParameter(p: RawParameter): { name: string; type: string; default?: string } {
  const parameter: { name: string; type: string; default?: string } = {
    name: p.name,
    type: p.type,
  };
  if (p.default !== undefined && p.default !== "") {
    parameter.default = String(p.default);
  }
  return parameter;
}

function displayNameFromIdentifier(identifier: string): string {
  return identifier
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function mapCodeSample(identifier: string, description = ""): CodeSample {
  return {
    identifier,
    displayName: displayNameFromIdentifier(identifier),
    description,
    language: "luau",
    code: "",
  };
}

function collectCodeSamples(parsed: RawYaml, description: string): CodeSample[] {
  const byIdentifier = new Map<string, CodeSample>();
  const add = (identifiers: string[] | undefined, description = "") => {
    for (const identifier of identifiers ?? []) {
      if (!byIdentifier.has(identifier)) {
        byIdentifier.set(identifier, mapCodeSample(identifier, description));
      }
    }
  };

  add(parsed.code_samples, parsed.summary ?? firstLine(description));
  for (const member of [
    ...(parsed.properties ?? []),
    ...(parsed.methods ?? []),
    ...(parsed.events ?? []),
    ...(parsed.callbacks ?? []),
    ...(parsed.functions ?? []),
    ...(parsed.constructors ?? []),
  ]) {
    add(member.code_samples, member.summary);
  }
  for (const constant of parsed.constants ?? []) {
    add(constant.code_samples, constant.summary);
  }
  for (const item of parsed.items ?? []) {
    add(item.code_samples, item.summary);
  }
  for (const op of parsed.math_operations ?? []) {
    add(op.code_samples, op.summary);
  }

  return [...byIdentifier.values()];
}

function mapMember(m: RawMember): RichMember {
  const depMsg = m.deprecation_message ?? "";
  return {
    name: m.name,
    summary: m.summary,
    type: m.type ?? undefined,
    parameters: m.parameters?.map(mapParameter) ?? [],
    returns: m.returns?.[0]?.type,
    tags: m.tags ?? [],
    deprecationMessage: depMsg,
    isDeprecated: depMsg !== "" || (m.tags ?? []).includes("Deprecated"),
    inheritedFrom: "",
    threadSafety: m.thread_safety ?? null,
    security: flattenSecurity(m.security),
  };
}

function mapConstructor(m: RawMember): RichMember {
  const depMsg = m.deprecation_message ?? "";
  return {
    name: m.name,
    summary: m.summary,
    type: "constructor",
    parameters: m.parameters?.map(mapParameter) ?? [],
    returns: undefined,
    tags: [...(m.tags ?? []), "Constructor"],
    deprecationMessage: depMsg,
    isDeprecated: depMsg !== "" || (m.tags ?? []).includes("Deprecated"),
    inheritedFrom: "",
    threadSafety: null,
    security: null,
  };
}

function mapConstant(c: RawConstant): RichMember {
  const depMsg = c.deprecation_message ?? "";
  return {
    name: c.name,
    summary: c.summary,
    type: c.type,
    parameters: [],
    returns: undefined,
    tags: [...(c.tags ?? []), "Constant"],
    deprecationMessage: depMsg,
    isDeprecated: depMsg !== "" || (c.tags ?? []).includes("Deprecated"),
    inheritedFrom: "",
    threadSafety: null,
    security: null,
  };
}

function mapEnumItem(item: RawEnumItem): RichMember {
  const depMsg = item.deprecation_message ?? "";
  return {
    name: item.name,
    summary: item.summary,
    type: `${item.value}`,
    parameters: [],
    returns: undefined,
    tags: [...(item.tags ?? []), "EnumItem"],
    deprecationMessage: depMsg,
    isDeprecated: depMsg !== "" || (item.tags ?? []).includes("Deprecated"),
    inheritedFrom: "",
    threadSafety: null,
    security: null,
  };
}

function mapMathOp(op: RawMathOp): RichMember {
  const depMsg = op.deprecation_message ?? "";
  return {
    name: op.name,
    summary: op.summary,
    type: "math_operation",
    parameters: [
      { name: "a", type: op.type_a },
      { name: "b", type: op.type_b },
    ],
    returns: op.return_type,
    tags: [...(op.tags ?? []), "MathOperation"],
    deprecationMessage: depMsg,
    isDeprecated: depMsg !== "" || (op.tags ?? []).includes("Deprecated"),
    inheritedFrom: "",
    threadSafety: null,
    security: null,
  };
}
