# COSTRIG release audit — 2026-10-08

Status: **not release-ready; authenticated integration and physical-device checks are pending.**

Baseline: main `cddb3e094ff69cb452250aa6dd702023d7e1c348`, V4.9.9, merged PR #13.
PR #13's GitHub Actions release smoke run 37725249987 succeeded. Its checks cover JavaScript syntax, local runtime references, and manifest icons, not functional integration.

Candidate: V4.9.10. Runtime filenames are retained to avoid replacing the existing loading arrangement.

## Confirmed fixes

- Renew sessions before API requests when expiry is within 60 seconds. Share concurrent refresh requests; do not restore an old account after sign-out/account change. Failed refreshes prevent writes.
- Correct the version label that the edit-history patch reset to V4.9.8.
- Accept `technician` workspace membership and `waiting_parts` repair status, which the UI already offers. Retain all previously permitted values.
- Block direct client writes to membership and invitation tables. Existing checked RPCs perform these operations. This closes direct owner-invitation and role-write bypasses.
- Refuse owner demotion via the role RPC. Serialize invite acceptance, reject owner invitations, and preserve existing memberships rather than letting invitations change roles.
- Enforce equipment/workspace consistency for maintenance, repairs, expenses, schedules, and downtime; enforce schedule/equipment/workspace consistency for maintenance records.
- Revoke client execution of the internal activity-log trigger function.

Database migration `release_workspace_integrity` was applied to CostRig and its catalog state was verified. There were no mismatched equipment/workspace or schedule references before migration. All six added foreign keys are validated. This is **schema/permission verification, not authenticated isolation testing**. No service-role/admin credentials were used to simulate or pass account isolation tests.

## Completed verification

| Check | Result |
| --- | --- |
| Eight local regression cases | Passed: unexpired session, concurrent refresh, failed refresh/recovery, sign-out during refresh, account change during refresh, non-replayed rejected writes, equipment-specific cost totals, meter schedule boundaries |
| Affected syntax/assets/manifest smoke suite | Passed |
| Diff whitespace check | Passed |
| Public tables with RLS disabled | Zero, verified from database catalog |
| Anonymous execute permission on six workspace RPCs | Zero, preserved from prior security fix |
| Authenticated direct membership/invitation writes | Denied by grants, catalog verified |
| Six composite integrity constraints | Validated in database |
| Live reminder worker without cron authorization | HTTP 401 |
| Reminder cron | Active, every 15 minutes; four recent SQL cron executions succeeded |
| Push delivery evidence | No subscriptions and no sent deliveries; actual delivery untested |
| Live app public load | Sign-in screen renders; displayed V4.9.8 baseline bug confirmed |

Reminder infrastructure has recent HTTP 200 responses, but also two responses without an HTTP status in the inspected 24-hour window. Successful cron SQL execution alone does not prove notification delivery. No notification was sent during this audit.

## Required before merge/release

Use real authenticated accounts and publishable/anon API access only for isolation tests. Do not use database impersonation, service-role credentials, or administrative SQL to claim these tests passed.

- Account creation/email confirmation, login, logout, reload/refresh persistence, invalid credentials, session revocation, and another browser/device.
- Separate-account A→B→A flows; direct cross-workspace read/insert/update/delete denial, including child asset and schedule identifiers.
- Owner/manager/technician/viewer allow-and-deny paths, invitations, repeat acceptance, wrong email, owner protection, and direct-write denial.
- Equipment create/edit/delete, cascading history removal, concurrent/stale records, save followed by failed refresh.
- Maintenance/repair/expense creation, editing existing maintenance/repair, Waiting on Parts, repair completion, cost/history accuracy, schedule completion and recurrence.
- VIN manual entry, lookup, camera open/close/permission denial, actual barcode decoding on iPhone.
- Navigation, every modal/form, mobile scrolling/safe areas, keyboard accessibility, and no runtime console errors.
- Home Screen iPhone push subscription, disable/sign-out cleanup, 7/1/0-day delivery, timezone behavior, duplicate prevention, and tap-to-equipment routing.
- Final integration regression, merge, GitHub Pages deployment, and live version verification.

## Release decisions and residual advisories

- Free/Pro remains explicitly self-service **beta** access. The client and `entitlements_self_update` allow users to change their own plan. Client-side report/team gates are not secure paid entitlement enforcement. A paid release needs a concrete entitlement source and removal/restriction of beta access; that would change an existing feature and needs the user's decision.
- Supabase leaked-password protection is disabled. It remains a security advisor warning; no auth configuration or paid plan was changed.
- Six authenticated SECURITY DEFINER workspace RPC advisories remain because the app intentionally calls these authorization-checked functions. Their authenticated integration tests remain pending.
- `date_push_deliveries` intentionally has RLS and no client policies, keeping delivery bookkeeping server-only. Do not add client policies merely to remove an informational advisor notice.

The sign-in screen blocks the remaining live functional audit. Preserve completed evidence and rerun only checks affected by subsequent fixes.
