# Shared review UI and date provenance — 2026-10-13

The shared-counter review now uses a separated current/proposed counter summary, responsive effect cards, explicit unlock versus stays-locked badges, accessible proposed-progress bars, and a dedicated confirmation footer. Technical statistic identifiers use compact code styling. No achievement writes occur while rendering or reviewing.

Unlock dates from Steam are labelled Steam-reported unlock date. Confirmed journal entries additionally expose panelOperationAt and, when available, panelVerifiedAt. Historical receipts retain their original checkedAt as the operation-recorded time; it is not invented as an exact verification time. Future confirmed writes record verifiedAt after the independent read. If a Steam timestamp predates the recorded operation by more than a day, the UI explains that these are separate sources. Steam metadata is neither overwritten nor reset.

Live read-only evidence: TF2 TF_GET_HEALPOINTS (Team Doctor) receipt confirmed, operation recorded 2026-10-13T19:25:50.878Z. Steam acknowledged result 1, without stale or rejected stats. Fresh verification observed Team Doctor unlocked and TF_MEDIC_HEAL_GRIND (Chief of Staff) locked, both at counter 25000; no unrelated statistic or achievement changes. The record is persisted in Neon. The exact origin of the user-reported February 2022 Steam date is not established from this receipt; prior raw timestamps were not recorded. The panel cannot claim that this metadata represents the time of the test.

Regression tests cover distinct date labels without changing Steam metadata and accurate proposed bars (Chief 25000/1000000 = 2.5%). This update does not send new activations.
