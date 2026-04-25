# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Migrate API docs scraping to a faster, more performant approach using the `creator-docs` GitHub repository directly.

## [0.2.0] - 2026-04-25

### Added

- GitHub PAT authentication support for GitHub-backed requests through the new `--github-token` CLI flag.
- Support for `GITHUB_TOKEN` as a fallback when no explicit GitHub token is provided.

### Changed

- CLI and MCP server flows now propagate the configured GitHub token to API dump and Creator Docs fetches.
- API and guide search behavior now includes stronger alias and Luau synonym resolution for common Roblox queries.
- Search-related public TypeScript types now expose richer API and guide result metadata.

### Documentation

- Updated CLI and MCP docs to describe GitHub-authenticated usage and the current guide tooling.

### Tests

- Added coverage for GitHub token parsing, token propagation, and authenticated fetch behavior across CLI, server, and scraper layers.
- Expanded e2e coverage for guide lookup flows and MCP tool behavior.

## [1.0.0] - 2026-04-20

### Added

- Phase 1: API Reference scraping for the Roblox Creator Hub (`/reference/engine/*`).
  - Support for all 4 categories: Classes, Enums, Datatypes, and Globals.
  - 4 MCP tools: `get_api_reference`, `get_many_api_references`, `list_api_names`, `find_api_name`.
  - CLI with `--list`, `--find`, `--stdio`, and `--help` flags.
  - `MemoryCache<T>` with configurable TTL (default 10 min).
  - Full TypeScript type system: `RobloxApiEntry`, `RobloxMember`, `ScrapeOutcome`, and more.
  - Biome for linting and formatting, tsup for bundling (ESM
