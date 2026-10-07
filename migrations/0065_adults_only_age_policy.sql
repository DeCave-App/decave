-- DeCave is now for adults (18+) only.
--
-- Accounts that confirmed an age between 13 and 17 under the previous policy
-- are asked to confirm their birth date again. The exact date was never
-- stored, so the age gate re-runs: people who have since turned 18 continue,
-- and anyone still under 18 becomes ineligible and is blocked by requireUser.
UPDATE decave_user_safety_profiles
SET age_status = 'unconfirmed',
    age_band = 'unknown',
    teen_safety_mode = 1,
    age_policy_version = '2026-10-v1-adults',
    age_acknowledged_at = NULL,
    age_verified_at = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE age_band = 'teen' OR (age_status = 'eligible' AND age_band <> 'adult');
