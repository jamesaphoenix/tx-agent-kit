# Example: Project Overview Source

Source document pattern:

- `/<some-source-path>/specs/<overview-or-requirements-doc>.md`

Concrete example used for this reference:

- `/<some-source-path>/specs/requirements.md`

Why this is a strong overview example:

- It captures project-level context that spans multiple eventual PRDs and design docs.
- It keeps user groups, launch scope, platform strategy, and governance constraints together.
- It demonstrates that an overview can stay rich and narrative before downstream decomposition happens.

Representative excerpt:

```md
---
kind: spec
spec_type: overview
name: project-overview-source
title: "Project Overview Source"
status: draft
version: 1
summary: "High-detail overview and operating context source document for a product rewrite."
domain: platform
tags:
  - overview
  - requirements
  - product
  - example
plan: ~/.codex/plans/project-product-requirements.md
---

# Plan

Plan file: [~/.codex/plans/project-product-requirements.md](~/.codex/plans/project-product-requirements.md)

# Summary

This document is a high-fidelity overview source for a product rewrite. It demonstrates how
a project-level overview can retain business context, actors, launch scope, platform targets,
governance constraints, and phased delivery decisions.

# Detailed Source Material

## Project - Business Requirements

## 1. What is the product?

The product helps operational teams turn repeatable work into measurable, auditable workflows.
It combines workspace management, structured content, approvals, reporting, and automation into
one system of record.

### Target Audience

The primary audience is internal operators and administrators who need reliable workflows,
clear ownership, and fast access to the current state of each work item.

## 3. Actors

| Actor | Description |
|-------|-------------|
| Operator | Primary day-to-day user |
| Reviewer | Reviews submitted work before completion |
| Team Admin | Manages membership and permissions |
| Organization Admin | Manages billing and organization-wide settings |

## 4. High Level Features

- Workspace management
- Structured records
- Approval workflow
- Reporting
- Knowledge base
- Billing and usage
- Team and role management

## 5. Platform Support

- Web application
- API
- Worker processes
- Local development infrastructure
```

Use an overview like this when the user is still describing the product, the launch boundary,
and the top-level system context. Do not prematurely force it into one subsystem's vocabulary.
