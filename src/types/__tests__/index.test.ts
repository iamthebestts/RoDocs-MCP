import { describe, expectTypeOf, it } from "vitest";
import type {
  RobloxApiEntry,
  RobloxClass,
  RobloxDatatype,
  RobloxEnum,
  RobloxGlobal,
  RobloxIndexEntry,
  RobloxMemberType,
  RobloxSecurity,
  SearchOptions,
  SearchResult,
} from "../index.js";

describe("types", () => {
  it("keeps the exported unions intact", () => {
    expectTypeOf<RobloxMemberType>().toEqualTypeOf<
      "Property" | "Function" | "Event" | "Callback"
    >();
    expectTypeOf<RobloxSecurity>().toEqualTypeOf<
      | "None"
      | "LocalUserSecurity"
      | "PluginSecurity"
      | "RobloxScriptSecurity"
      | "RobloxSecurity"
      | "NotAccessibleSecurity"
    >();
    expectTypeOf<RobloxIndexEntry["kind"]>().toEqualTypeOf<"class" | "enum">();
    expectTypeOf<SearchResult["type"]>().toEqualTypeOf<"api" | "guide">();
  });

  it("keeps the public shapes assignable", () => {
    expectTypeOf<SearchOptions>().toExtend<{
      limit?: number;
      types?: ReadonlyArray<"api" | "guide">;
    }>();

    expectTypeOf<RobloxApiEntry>().toEqualTypeOf<
      RobloxClass | RobloxEnum | RobloxDatatype | RobloxGlobal
    >();
  });
});
