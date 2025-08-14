BEGIN;

----------------------------------------------------------------------
-- A) TABLE / COLUMN RENAMES
----------------------------------------------------------------------

-- parent_student_links -> mentor_learner_links
ALTER TABLE IF EXISTS parent_student_links RENAME TO mentor_learner_links;

-- link-table columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='mentor_learner_links' AND column_name='parent_id') THEN
    EXECUTE 'ALTER TABLE mentor_learner_links RENAME COLUMN parent_id TO mentor_id';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='mentor_learner_links' AND column_name='student_id') THEN
    EXECUTE 'ALTER TABLE mentor_learner_links RENAME COLUMN student_id TO learner_id';
  END IF;
END$$;

-- users.age_group -> users.skill_level (schema rename)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='users' AND column_name='age_group') THEN
    EXECUTE 'ALTER TABLE users RENAME COLUMN age_group TO skill_level';
  END IF;
END$$;

-- OPTIONAL: if users still has a parent_id FK, rename to mentor_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='users' AND column_name='parent_id') THEN
    EXECUTE 'ALTER TABLE users RENAME COLUMN parent_id TO mentor_id';
    EXECUTE 'ALTER TABLE users RENAME CONSTRAINT IF EXISTS users_parent_id_fkey TO users_mentor_id_fkey';
    EXECUTE 'ALTER INDEX IF EXISTS idx_users_parent_id RENAME TO idx_users_mentor_id';
  END IF;
END$$;

----------------------------------------------------------------------
-- B) DATA MIGRATION: user_type and skill_level values
----------------------------------------------------------------------

-- Drop user_type CHECK (if present) so updates won’t fail
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname  = 'users_user_type_check'
      AND contype  = 'c'
  ) THEN
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT users_user_type_check';
  END IF;
END$$;

-- Swap values (idempotent)
UPDATE users SET user_type = 'mentor'  WHERE user_type = 'parent';
UPDATE users SET user_type = 'learner' WHERE user_type = 'student';

-- Skill level value mappings (idempotent)
UPDATE users SET skill_level = 'beginner'     WHERE skill_level IN ('elementary','Elementary (Under 13)','Elementary (5-8)','under 13','Under 13');
UPDATE users SET skill_level = 'intermediate' WHERE skill_level IN ('middle','Middle School (10-13)','Middle School (13-14)');
UPDATE users SET skill_level = 'advanced'     WHERE skill_level IN ('high','High School (13+)','High School (15-17)');
UPDATE users SET skill_level = 'expert'       WHERE skill_level IN ('adult','Adult (18+)');

-- Set sane defaults (optional; harmless if already set differently)
ALTER TABLE users ALTER COLUMN user_type   SET DEFAULT 'learner';
ALTER TABLE users ALTER COLUMN skill_level SET DEFAULT 'intermediate';

-- Recreate a CHECK on user_type that matches values now present
DO $$
DECLARE vals text;
BEGIN
  SELECT string_agg(quote_literal(user_type), ',')
    INTO vals
  FROM (SELECT DISTINCT user_type FROM users WHERE user_type IS NOT NULL) s;

  IF vals IS NULL OR vals = '' THEN
    vals := '''mentor'',''learner''';
  END IF;

  EXECUTE 'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check';
  EXECUTE format(
    'ALTER TABLE users ADD CONSTRAINT users_user_type_check CHECK (user_type IS NULL OR user_type IN (%s))',
    vals
  );
END$$;

----------------------------------------------------------------------
-- C) COSMETIC: rename legacy index names on link table if they exist
----------------------------------------------------------------------
DO $$
BEGIN
  PERFORM 1 FROM pg_class WHERE relname='idx_parent_student_links_parent_id';
  IF FOUND THEN
    EXECUTE 'ALTER INDEX idx_parent_student_links_parent_id RENAME TO idx_mentor_learner_links_mentor_id';
  END IF;

  PERFORM 1 FROM pg_class WHERE relname='idx_parent_student_links_student_id';
  IF FOUND THEN
    EXECUTE 'ALTER INDEX idx_parent_student_links_student_id RENAME TO idx_mentor_learner_links_learner_id';
  END IF;
END$$;

COMMIT;
