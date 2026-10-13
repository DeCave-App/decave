-- The language the account chose for DeCave's own text; NULL follows the device.
ALTER TABLE decave_users ADD COLUMN locale TEXT;
