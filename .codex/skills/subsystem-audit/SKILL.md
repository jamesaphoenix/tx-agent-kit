---
name: subsystem-audit
description: Audit all design docs against the canonical system design for coverage, drift, duplication, interfaces, YAML schema, self-containment, and dependency graph validity. Use when adding new subsystems, verifying spec quality, or preparing for task decomposition.
argument-hint: "[--fix] [--doc <name>]"
metadata:
  short-description: "Audit design docs against canonical source of truth"
---

# Subsystem Design Doc Audit

Audit all design docs at `specs/design/` against the canonical source of truth at `specs/original-system-design.md`. Identifies gaps, drift, duplication, missing interfaces, invalid YAML, broken dependencies, and incomplete specs. Optionally fixes issues in-place.

**Canonical source:** `specs/original-system-design.md` is the single source of truth. When there is a conflict between a design doc and the canonical source, the canonical source wins.

## Workflow State Machine

```
START
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 0: READ CANONICAL SOURCE                        │
│                                                      │
│ Read specs/original-system-design.md section 3       │
│ (Subsystems) to get the authoritative list of 17     │
│ subsystems. Also check for unlisted subsystems       │
│ (e.g. Knowledge Base at /v1/knowledge/).             │
│                                                      │
│ If --doc <name> is provided, audit only that doc.    │
│ Otherwise audit all 15 design docs.                  │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: SUBSYSTEM COVERAGE                           │
│                                                      │
│ Map each of the 17 subsystems to a design doc.       │
│ Report any subsystem without a dedicated doc.        │
│                                                      │
│ Current mapping (15 docs → 17+1 subsystems):         │
│  tenancy-model    → #1 Auth, #2 Org/Team             │
│  billing-pricing  → #3 Billing, #4 Credit            │
│  notifications    → #5 Notifications                 │
│  webhooks         → #6 Webhooks                      │
│  assets           → #7 Assets, #8 Uploader, #9 Ret. │
│  social-platform  → #10 OAuth, #11 Publisher         │
│  analytics        → #12 Analytics                    │
│  ai-generation    → #13 AI Generation                │
│  prompt-bandit    → #14 Experiments                  │
│  temporal-wf      → #15 Workflows                    │
│  rendering-arch   → Campaigns + Rendering            │
│  content-pipeline → Content lifecycle                │
│  knowledge-base   → Knowledge Base (unlisted)        │
│  scraping         → Trend Discovery (deferred)       │
│  overview         → Cross-cutting                    │
│                                                      │
│ ├─ GAP FOUND → If --fix, create new design doc       │
│ │              using the design-doc skill pattern     │
│ └─ ALL COVERED → Continue                            │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: INTERFACES CHECK                             │
│                                                      │
│ Grep for `_No interfaces defined yet._` across all   │
│ design docs.                                         │
│                                                      │
│ ├─ FOUND → If --fix, write Effect-style interfaces:  │
│ │   - Read packages/core/src/domains/ for patterns   │
│ │   - Context.Tag ports, services, layers            │
│ │   - Repository ports with ListParams/PaginatedResult│
│ │   - Application services with CoreError            │
│ │   - Middleware (if applicable)                      │
│ │   - API route contracts                            │
│ └─ NONE → Continue                                   │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: YAML SCHEMA VALIDATION                       │
│                                                      │
│ Check all invariants/failure_modes/verification       │
│ YAML blocks for correct tx schema:                   │
│                                                      │
│ invariants:                                          │
│   - id: INV-XXX-NNN     # ^INV-[A-Z0-9-]+$          │
│     statement: "..."                                 │
│     severity: critical|high|medium|low               │
│     verified_by: [REQ-XXX-NNN]  # minItems(1)       │
│                                                      │
│ failure_modes:                                       │
│   - condition: "..."                                 │
│     impact: "..."                                    │
│     handling: "..."                                  │
│                                                      │
│ verification:                                        │
│   - requirement_id: REQ-XXX-NNN  # ^REQ-[A-Z0-9-]+$ │
│     test_type: unit|integration|e2e|property|manual  │
│     target: "..."                                    │
│                                                      │
│ WRONG field names to catch:                          │
│   invariants: description→statement, no verified_by  │
│   failure_modes: trigger→condition, mitigation→handling│
│   verification: id→requirement_id, type→test_type,   │
│                 description→target, VER-→REQ-        │
│                                                      │
│ ├─ ISSUES → If --fix, rewrite with correct fields    │
│ └─ CLEAN → Continue                                  │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: DUPLICATION AUDIT                            │
│                                                      │
│ Check for content duplicated across docs.            │
│ Each subsystem doc should own its content — no       │
│ copy-paste between docs. Cross-cutting concerns      │
│ belong in overview-design.md only.                   │
│                                                      │
│ Check for:                                           │
│  - Same DB table schema in multiple docs             │
│  - Same Effect port defined in multiple docs         │
│  - Identical paragraphs copy-pasted                  │
│  - Same ASCII diagrams repeated                      │
│                                                      │
│ Ownership rules:                                     │
│  agent_threads/messages → ai-generation-design       │
│  credit_ledger/usage_records → billing-pricing       │
│  team_media_assets → assets-design                   │
│  social_accounts → social-platform-design            │
│  campaigns → rendering-architecture-design           │
│  content items/assets/posts → content-pipeline       │
│  post_performance → analytics-design                 │
│  knowledge/diffs → knowledge-base-design             │
│                                                      │
│ ├─ DUPES → If --fix, keep in owner doc, replace      │
│ │          duplicate with cross-reference:            │
│ │          "See [x-design](x-design.md) for Y."      │
│ └─ CLEAN → Continue                                  │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: SELF-CONTAINMENT CHECK                       │
│                                                      │
│ Each design doc must have these H1 sections:         │
│  - Summary                                           │
│  - Architecture (enough detail to implement from)    │
│  - Data Model (tables this subsystem OWNS)           │
│  - Interfaces (Effect ports + services + API routes) │
│  - Invariants (non-empty YAML)                       │
│  - Failure Modes (non-empty YAML)                    │
│  - Verification (non-empty YAML)                     │
│                                                      │
│ ├─ INCOMPLETE → If --fix, add missing sections       │
│ └─ COMPLETE → Continue                               │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: CANONICAL DRIFT CHECK                        │
│                                                      │
│ For each design doc, read its corresponding section  │
│ from specs/original-system-design.md.                │
│                                                      │
│ Section mapping:                                     │
│  §1  → tenancy-model-design                         │
│  §2  → assets-design                                │
│  §4  → content-pipeline-design                      │
│  §5  → rendering-architecture-design                │
│  §6  → social-platform-integration-design            │
│  §9  → billing-and-pricing-design                   │
│  §10 → analytics-design                             │
│  §11 → scraping-and-trend-discovery-design           │
│  §13 → temporal-workflows-design                    │
│  §3,7,8,12,14-20 → overview-design                  │
│                                                      │
│ Report:                                              │
│  MISSING — canonical has it, design doc doesn't      │
│  CONTRADICTION — design doc disagrees with canonical │
│  OK — content matches                                │
│                                                      │
│ ├─ DRIFT → If --fix, add missing content / fix       │
│ │          contradictions (canonical wins)            │
│ └─ ALIGNED → Continue                                │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: DEPENDENCY GRAPH VALIDATION                  │
│                                                      │
│ Read `depends_on` from all doc frontmatter.          │
│ Build the full dependency graph.                     │
│                                                      │
│ Validate:                                            │
│  - No circular dependencies                          │
│  - Graph forms a clean DAG                           │
│  - depends_on reflects BUILD ORDER                   │
│  - Every doc that uses tables/ports from another     │
│    subsystem lists it in depends_on                  │
│                                                      │
│ Print topological sort (build order):                │
│                                                      │
│  Layer 0: overview, temporal-workflows, tenancy-model│
│  Layer 1: assets, billing, notifications, scraping,  │
│           social-platform, webhooks                  │
│  Layer 2: ai-generation, analytics, content-pipeline │
│  Layer 3: knowledge-base, rendering-architecture     │
│  Layer 4: experiments-design                   │
│                                                      │
│ ├─ ISSUES → If --fix, update depends_on              │
│ └─ VALID DAG → Continue                              │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: SYNC                                         │
│                                                      │
│ source ~/.zshrc >/dev/null 2>&1; eval 'tx doc sync'  │
│                                                      │
│ ├─ ALL SYNCED → Print summary report                 │
│ └─ ERRORS → Fix and re-sync                         │
└─────────────────────────────────────────────────────┘
  │
  ▼
DONE — Print summary table
```

## How to Run

### Quick check (report only, no changes)
```
/subsystem-audit
```

### Fix all issues
```
/subsystem-audit --fix
```

### Audit a single doc
```
/subsystem-audit --doc analytics-design
```

### Run as a loop (every 10 minutes)
```
/loop 10m /subsystem-audit --fix
```

## Summary Report Format

After the audit, print:

```
Subsystem Audit Report
═══════════════════════════════════════════
Canonical source: specs/original-system-design.md
Design docs:      15
PRDs:             9
tx doc sync:      24/24 passed

Check                    Status
─────────────────────────────────
1. Subsystem coverage    ✓ 0 gaps
2. Interfaces            ✓ 0 missing
3. YAML schema           ✓ 0 violations
4. Duplication           ✓ clean
5. Self-containment      ✓ complete
6. Canonical drift       ✓ no drift
7. Dependency graph      ✓ valid DAG (5 layers)
8. tx doc sync           ✓ 24/24

Build Order (for task decomposition):
  L0: overview, temporal-workflows, tenancy-model
  L1: assets, billing, notifications, scraping, social-platform, webhooks
  L2: ai-generation, analytics, content-pipeline
  L3: knowledge-base, rendering-architecture
  L4: experiments-design
```

## Rules

1. **Canonical source always wins.** If a design doc contradicts `specs/original-system-design.md`, fix the design doc.
2. **No duplication.** Each piece of content lives in exactly one doc. Use cross-references.
3. **Self-contained specs.** Each doc must be implementable on its own (with its dependencies).
4. **tx schema compliance.** All YAML blocks must pass `tx doc sync` validation.
5. **Clean DAG.** Dependencies must enable sequential task decomposition with no cycles.
6. **Use sub-agents.** Launch parallel agents for large audits to maximize throughput.
