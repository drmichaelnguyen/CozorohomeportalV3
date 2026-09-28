# Cleaning photo references (staff vs learned)

CozoroHome AI cleaning verification compares resident completion photos to a **reference set** for the same area (`taskType` + `branchId`, and `floor` for `TRASH_D7`).

## Reference sources

`resolveCleaningReferencePhotos()` returns one of:

| Source | Meaning | Photos mandatory? | AI runs when resident submits photos? |
|--------|---------|-------------------|----------------------------------------|
| `staff` | Active rows in `CleaningReferencePhoto` (manager-uploaded) | **Yes** | Yes |
| `learned` | Completion photos from human ★4–5 approvals (fallback) | No (optional) | Yes, if photos are provided |
| `none` | No usable references | No | No (`aiVerdict = SKIPPED`) |

**Staff always wins.** If an area has any active staff reference photos (with files on disk), learned photos are ignored for verification. Uploading staff references therefore overrides learned ones automatically.

## Manager star rating

When a **human** reviewer approves a task (`POST /admin/cleaning/tasks/:id/audit`):

- Optional `qualityRating` 1–5 is stored on `CleaningAudit.qualityRating`
- The same value is mirrored to `CleaningTask.managerRating` for querying
- Allowed only with `decision = APPROVE`
- AI auto-approve (`reviewer = AI_AUTO`) **never** sets a rating (avoids AI training on itself)

If a task is later **REJECTED**, `managerRating` is cleared so its photos stop being learned references.

★4–5 approvals can teach the AI for that area when staff references are missing. The audit UI shows this hint next to the star picker.

## Learned reference selection

When falling back to learned references:

1. Tasks: same `taskType` + `branchId` (+ `floor` for trash), status `APPROVED`, `managerRating >= 4`
2. Only human audits with `qualityRating >= 4` (excludes `AI_AUTO`)
3. Photos with `excludedFromReference = true` are skipped
4. Only the last **180 days** (current kitchen/trash state)
5. Exclude the task currently being verified
6. Skip missing files on disk (`data/cleaning-completion-photos/`)
7. Order by rating desc, then most recent approval
8. Take at most **5** photos, max **2 per task**, preferring ≥2 distinct tasks

Staff can **Exclude** a bad learned photo from the Cleaning reference photos panel (sets `excludedFromReference`).

## Storage paths

| Kind | Directory |
|------|-----------|
| Staff reference | `api/data/cleaning-reference-photos/` |
| Resident completion / learned | `api/data/cleaning-completion-photos/` |

Verification reads each reference from the correct folder based on `kind`.

## Upload reliability (resident complete)

1. Client compresses photos at pick time (longest side ≤1920, JPEG ~0.8, target ≤1.5 MB)
2. Server validates and writes completion JPEGs to disk **before** changing task status
3. Status + `CleaningCompletionPhoto` rows update in one transaction
4. On failure, newly written files are deleted and status stays unchanged
5. Calendar update + AI verification (+ optional auto-approve) run **after** the response, in the background
