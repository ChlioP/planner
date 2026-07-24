# Availability templates

Phase 4 stores reusable daily patterns separately from actual availability. The local cache key is
`planner_availability_templates_v1`; authenticated records use
`users/{userId}/availabilityTemplates/{templateId}`. Existing user-scoped Firestore rules cover
this collection.

Templates contain no dates and use one stable ID per template and per reusable block. Applying a
template generates ordinary Phase 3 date-specific or recurring availability blocks with new stable
IDs. Deleting a template therefore cannot delete availability already created from it.

Date application supports add-missing and replace-date-specific modes. Replace removes only
date-specific blocks on the selected dates. Recurring blocks and date overrides are preserved.
Recurring application creates one Phase 3 recurring block per template block and selected weekday.
Exact duplicates are skipped; overlaps are previewed before confirmation.

Internal backup format version 4 contains templates. Versions 1–3 remain importable with an empty
template collection. The existing emergency JSON controls remain in the recovery code but are
hidden from the normal planner interface.

The existing full-mirror Firestore synchronization behavior remains the main multi-device and
rollback risk. Export a recovery backup before opening the same account in an older build.
