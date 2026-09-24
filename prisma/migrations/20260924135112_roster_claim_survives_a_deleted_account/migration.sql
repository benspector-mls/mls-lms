-- A roster entry outlives the account that claimed it.
--
-- `claimed_by_id` is ON DELETE SET NULL, so deleting a profile nulls it and leaves `claimed_at`
-- holding the moment they joined. The constraint this replaces required the two columns to be
-- null together, which made that update fail and took the whole deletion with it: no fellow who
-- had ever joined through a roster could be deleted at all. The failure was also hard to read,
-- because it named `roster_entries` several cascade levels below the profile somebody asked to
-- delete, and Supabase's Authentication screen reported it as an unexplained database error.
--
-- One direction only, which is what `submissions_comments_resolved_by_implies_resolved` already
-- does for the same reason. A claim with no time is still refused: an entry naming a person with
-- no moment cannot say when they joined. A time whose claimer has been deleted is permitted,
-- because that is the true state of an entry somebody joined on before their account was removed,
-- and the entry becomes claimable again — which is what freeing it should mean. Every decision
-- about whether an entry may be claimed reads `claimed_by_id`; `claimed_at` is read only for the
-- order the roster is printed in.

ALTER TABLE public."roster_entries"
  DROP CONSTRAINT "roster_entries_claim_is_whole";

ALTER TABLE public."roster_entries"
  ADD CONSTRAINT "roster_entries_claim_implies_claimed_at"
  CHECK ("claimed_at" IS NOT NULL OR "claimed_by_id" IS NULL);
