# Contributing to autonomagic-marketplace

Thanks for considering a contribution. The marketplace is intentionally narrow in scope — read this first to know what fits.

## In scope

- **Plugin contract evolution** — adding optional fields, deprecating old ones (with semver bumps)
- **Bazaar conformance** — keeping the 402 response shape current as x402scan and other indexers evolve
- **Discovery surfaces** — improving `/.well-known/x402.json`, `/agent-card.json`, `/openapi.json` generation
- **Bug fixes** — anything that makes a working plugin fail to load, or generates invalid JSON
- **Tests** — coverage gaps in `tests/`
- **Documentation** — README, SPEC, examples

## Out of scope

- **Identity / reputation systems** — separate concern (use ENS, EIP-8004)
- **Pricing dynamics** — the marketplace stays as fixed-price-per-call with $1.00 cap
- **Auth beyond x402 payment** — x402 is the auth, full stop
- **KYC / compliance** — your service, your jurisdiction
- **GUI / dashboards** — separate project
- **Multi-asset (non-USDC) settlement** — open to discussion via issue, but a major scope expansion

## How to propose a change

1. **Open an issue first** — describe the use case + your proposed change. Most changes don't need an RFC; small surface = quick review.
2. **For spec deltas (changes to 402 response shape, plugin contract)**: please reference the relevant section of [SPEC.md](./SPEC.md) and explain whether your change is backwards-compatible.
3. **For new examples**: PRs welcome with a working `examples/<your-example>.js` that demonstrates a real use case.

## Pull request guidelines

- One logical change per PR — easier to review, easier to revert
- Include a test for any non-trivial change to `src/`
- Update SPEC.md if your change affects the public 402 response shape
- Update README.md if your change affects the install / quick-start flow
- No emoji in code (per project style); fine in PR descriptions

## Local development

```bash
git clone https://github.com/premsreelathasugeendran/autonomagic-marketplace.git
cd autonomagic-marketplace
node tests/basic.test.js
node examples/standalone-server.js   # boots a local server on :3402
```

## Releases

We follow semver from `v1.0.0` onward. Pre-1.0 versions may break the public API between minor versions; pin your deps.

## Code of conduct

Be kind, be specific, ship code. Disagreement on technical direction is welcome; ad-hominem is not.

## License

By contributing, you agree your contributions are licensed under MIT (see [LICENSE](./LICENSE)).
