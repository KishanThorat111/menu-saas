-- AlterTable: Convert slug from TEXT to CHAR(6) for base32 menu codes
-- Base32 alphabet: A-Z, 2-7 (RFC 4648) — optimal for QR alphanumeric mode

-- Step 1: Convert existing slugs to 6-char uppercase base32 codes
-- Generate a unique base32 code for each existing hotel
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
  attempts INT;
  code_exists BOOLEAN;
BEGIN
  FOR r IN SELECT id FROM "Hotel" ORDER BY "createdAt" ASC LOOP
    attempts := 0;
    LOOP
      -- Generate random 6-char base32 string using A-Z and 2-7
      new_code := '';
      FOR i IN 1..6 LOOP
        new_code := new_code || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', floor(random() * 32 + 1)::int, 1);
      END LOOP;

      -- Check for collision
      SELECT EXISTS(SELECT 1 FROM "Hotel" WHERE "slug" = new_code AND "id" != r.id) INTO code_exists;
      EXIT WHEN NOT code_exists;

      attempts := attempts + 1;
      IF attempts > 100 THEN
        RAISE EXCEPTION 'Could not generate unique base32 code after 100 attempts for hotel %', r.id;
      END IF;
    END LOOP;

    UPDATE "Hotel" SET "slug" = new_code WHERE "id" = r.id;
  END LOOP;
END $$;

-- Step 2: Alter column type to CHAR(6)
ALTER TABLE "Hotel" ALTER COLUMN "slug" TYPE CHAR(6);

-- Step 3: Add CHECK constraint for base32 format
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_slug_base32_check" CHECK ("slug" ~ '^[A-Z2-7]{6}$');
