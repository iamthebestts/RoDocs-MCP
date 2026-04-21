# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Phase 2: Guide/Article scraping for tutorials, concepts, and how-to docs.
  - Categories: `/docs/scripting/*`, `/docs/luau/*`, `/docs/characters/*`, `/docs/players/*`, `/docs/input/*`, `/docs/ui/*`, `/docs/animation/*`, `/docs/cloud-services/*`, `/docs/performance-optimization/*`.
  - 3 new MCP tools: `search_guides`, `get_guide`, `list_guide_categories`.
  - CLI flags: `--guide <slug>`, `--search-guide <query>`.
  - New types: `RobloxGuide`, `GuideSection`, `GuideSearchResult`.

## [1.0.0] - 2026-04-20

### Added

- Phase 1: API Reference scraping for the Roblox Creator Hub (`/reference/engine/*`).
  - Support for all 4 categories: Classes, Enums, Datatypes, and Globals.
  - 4 MCP tools: `get_api_reference`, `get_many_api_references`, `list_api_names`, `find_api_name`.
  - CLI with `--list`, `--find`, `--stdio`, and `--help` flags.
  - `MemoryCache<T>` with configurable TTL (default 10 min).
  - Full TypeScript type system: `RobloxApiEntry`, `RobloxMember`, `ScrapeOutcome`, and more.
  - Biome for linting and formatting, tsup for bundling (ESM
