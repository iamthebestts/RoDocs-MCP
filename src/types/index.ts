export type RobloxMemberType = "Property" | "Function" | "Event" | "Callback";

export type RobloxSecurity =
  | "None"
  | "LocalUserSecurity"
  | "PluginSecurity"
  | "RobloxScriptSecurity"
  | "RobloxSecurity"
  | "NotAccessibleSecurity";

export interface RobloxTag {
  name: string;
}

export interface RobloxParameter {
  name: string;
  type: string;
  default?: string;
}

export interface RobloxMember {
  memberType: RobloxMemberType;
  name: string;
  description: string;
  parameters?: RobloxParameter[];
  returnType?: string;
  valueType?: string;
  security: {
    read: RobloxSecurity;
    write: RobloxSecurity;
  };
  tags: RobloxTag[];
  deprecated: boolean;
}

export interface RobloxClass {
  kind: "class";
  name: string;
  superclass: string | null;
  description: string;
  members: RobloxMember[];
  tags: RobloxTag[];
  deprecated: boolean;
}

export interface RobloxEnumItem {
  name: string;
  value: number;
  description: string;
}

export interface RobloxEnum {
  kind: "enum";
  name: string;
  description: string;
  items: RobloxEnumItem[];
  deprecated: boolean;
}

export interface RobloxDatatype {
  kind: "datatype";
  name: string;
  description: string;
  members: RobloxMember[];
  deprecated: boolean;
}

export interface RobloxGlobal {
  kind: "global";
  name: string;
  description: string;
  members: RobloxMember[];
  deprecated: boolean;
}

export type RobloxApiEntry = RobloxClass | RobloxEnum | RobloxDatatype | RobloxGlobal;

export interface ScrapeResult {
  ok: true;
  topic: string;
  entry: RobloxApiEntry;
}

export interface ScrapeError {
  ok: false;
  topic: string;
  error: string;
}

export type ScrapeOutcome = ScrapeResult | ScrapeError;

export interface RobloxIndexEntry {
  name: string;
  kind: "class" | "enum";
}

export interface IndexResult {
  ok: true;
  classes: string[];
  enums: string[];
}
