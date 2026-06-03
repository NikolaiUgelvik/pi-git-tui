# AGENTS.md

## Style And Build Gotchas

- Biome enforces a 500-line limit per non-test source file as an error.
- When a file approaches or exceeds that limit, extract focused modules or otherwise refactor the design.
- Do not add `biome-ignore` comments or rule overrides to silence file-length errors.
