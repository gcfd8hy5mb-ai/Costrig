# COSTRIG release audit — 2026-10-08

Status: **not release-ready; authenticated integration and physical-device checks are pending.**

Baseline: main `cddb3e094ff69cb452250aa6dd702023d7e1c348`, V4.9.9, merged PR #13.
PR #13's GitHub Actions release smoke run 37725249987 succeeded. Its checks cover JavaScript syntax, local runtime references, and manifest icons, not functional integration.

Candidate: V4.9.10. Runtime filenames are retained to avoid replacing the existing loading arrangement.

## Confirmed fixes

- Renew sessions before API requests when expiry is within 60 seconds. Share concurrent refresh requests; do not restore an old account after sign-out/account change. Failed refreshes prevent writes.
- Correct the version label that the edit-history patch reset to V4.9.8.
- Preserve cents in displayed currency. Live $10.50 maintenance displayed as $11; the edit form confirmed the exact stored amount.
- Preserve a newer navigation choice while a save/refresh is completing. Live service completion could override a Reports click with equipment details.
- Add the missing Free gate to Pro reports. Live Free beta accounts could still view the reports advertised as Pro.
- Accept `technician` workspace membership and `waiting_parts` repair status, which the UI already offers. Retain all previously permitted values.
- Block direct client writes to membership and invitation tables. Existing checked RPCs perform these operations. This closes direct owner-invitation and role-write bypasses.
- Refuse owner demotion via the role RPC. Serialize invite acceptance, reject owner invitations, and preserve existing memberships rather than letting invitations change roles.
- Enforce equipment/workspace consistency for maintenance, repairs, expenses, schedules, and downtime; enforce schedule/equipment/workspace consistency for maintenance records.
- Revoke client execution of the internal activity-log trigger function.

Database migration `release_workspace_integrity` was applied to CostRig and its catalog state was verified. There were no mismatched equipment/workspace or schedule references before migration. All six added foreign keys are validated. This is **schema/permission verification, not authenticated isolation testing**. No service-role/admin credentials were used to simulate or pass account isolation tests.

## Completed verification

| Check | Result |
| --- | --- |
| Eleven local regression cases | Passed: currency precision, navigation preservation, Free reports gate, unexpired session, concurrent refresh, failed refresh/recovery, sign-out during refresh, account change during refresh, non-replayed rejected writes, equipment-specific cost totals, meter schedule boundaries |
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

### Live owner-account checks completed after secure sign-in

These checks used the production V4.9.9 frontend (which displays V4.9.8 because of the version-label bug), with the newly hardened database. They do not prove the unmerged V4.9.10 frontend changes work in a browser.

- Email/password sign-in loaded the owner's workspace. Reload renewed/restored the session and preserved saved equipment/history.
- Created `Release QA 2026-10-08` without modifying pre-existing equipment. Required-name and negative-cost validation passed. Edited mileage from 1,000 to 1,250 and make to QA Make; saved values appeared in details.
- Created $10.50 maintenance and edited it to $12.25; edited notes persisted without a duplicate record.
- Created a $20.25 Waiting on Parts repair; edited it to $21.25/In Progress and completed it. The active repair disappeared and history remained.
- Created a $3.25 other expense. QA costs total $36.75 (maintenance $12.25 + repair $21.25 + expense $3.25); live whole-dollar display rounds this to $37. The candidate formatter fixes that display.
- Created and completed a recurring 500-mile schedule at 1,250 miles; next due advanced to 1,750 miles. Created and completed a one-time date schedule; it disappeared from active schedules and remained in history.
- Home, Equipment, Reports, Profile, plan controls, VIN choice, manual entry, and tested modal controls opened. Invalid VIN lookup was rejected; public sample VIN `1HGCM82633A004352` decoded to Honda Accord/2003 with vehicle/engine fields. The sample was not saved.
- Free/Pro beta switching persisted, retained history, and gated Activity correctly. The missing Free report gate was confirmed and fixed in the candidate. Original Pro beta plan was restored.
- Delete dialog named equipment and related records. An unchecked acknowledgment blocked deletion. Actual permanent deletion was not performed.

The QA fixture and its test history remain intentionally for subsequent account-isolation/deletion checks. Notifications are blocked in the cloud browser; physical iPhone Home Screen subscription and delivery testing are required. No iPhone camera, layout, or push-delivery result is claimed.

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

- **Beta release decision (confirmed by owner 2026-10-09):** Keep Free/Pro as self-service beta access without subscriptions or billing enforcement in this release. The client and `entitlements_self_update` intentionally allow testers to switch plans. This is not secure paid entitlement enforcement; a paid launch will require a separate entitlement/billing gate.
- Supabase leaked-password protection is disabled. It remains a security advisor warning; no auth configuration or paid plan was changed.
- Six authenticated SECURITY DEFINER workspace RPC advisories remain because the app intentionally calls these authorization-checked functions. Their authenticated integration tests remain pending.
- `date_push_deliveries` intentionally has RLS and no client policies, keeping delivery bookkeeping server-only. Do not add client policies merely to remove an informational advisor notice.

Only the owner account has been signed in. A separate authenticated account, direct API isolation/role tests, candidate browser validation, and physical-device checks remain. Preserve completed evidence and rerun only checks affected by subsequent fixes.
