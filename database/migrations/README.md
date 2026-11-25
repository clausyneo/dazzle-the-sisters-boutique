# Database migrations

This repository uses manually reviewed SQL migrations; there is no automatic
migration runner. Back up the database and verify the target schema before
applying a migration. Do not replay a migration just because the application
starts successfully.

## Customer measurement profiles

`add_customer_measurement_profiles.sql` is an additive migration that depends
on the active `customers` table created by
`add_customer_accounts_notifications.sql`. It creates
`customer_measurement_profiles` and `customer_measurement_values`; it does not
alter or copy data from the legacy `users`, `measurements`, or
`custom_order_measurements` tables. The migration intentionally has no `USE`
statement: select and verify the target schema before running it so the script
cannot silently switch to a database with the production name.

### Safe execution procedure

1. Use a dedicated non-production TiDB/MySQL instance and credentials that
   cannot access production. Confirm the instance identity in the provider
   console, then connect and verify `SELECT VERSION(), DATABASE();`. Do not
   infer that an endpoint is non-production from its name.
2. For TiDB, confirm the application connection uses
   `@@tidb_txn_mode = 'pessimistic'`. `SELECT ... FOR UPDATE` only serializes
   these profile-creation transactions in pessimistic mode. The backend uses
   the driver's normal `beginTransaction()` and does not explicitly request
   TiDB's `BEGIN PESSIMISTIC`; newly created TiDB clusters default to
   pessimistic mode, but upgraded or reconfigured clusters may differ. Verify
   the mode through the same session configuration the application pool uses.
3. Confirm the TiDB version. Foreign-key enforcement is generally available
   starting in TiDB v8.5.0. Versions v6.6.0–v8.4.x have experimental support;
   earlier versions can accept foreign-key syntax without enforcing the
   constraints. Use a supported TiDB version or a verified MySQL version.
4. Create and verify a restorable backup of the non-production target. Confirm
   that the active `customers` table exists and `customer_id` is an unsigned
   `BIGINT` primary key, and that neither measurement table already exists.
5. Select the intended database in the SQL client, verify `DATABASE()` again,
   and run the migration statements in order. DDL may commit independently;
   do not rely on wrapping both `CREATE TABLE` statements in a transaction.
6. Verify both tables with `SHOW CREATE TABLE`, including the two foreign
   keys, indexes, data types, and `ON DELETE CASCADE` rules.
7. Run `npm test` and `npm run check` locally. Separately, use a synthetic
   customer against the non-production application/database to verify
   create/list/update/delete behavior, customer/profile cascades, and
   concurrent creation at the 20-profile limit. For the race test, start with
   19 profiles and confirm only one of two simultaneous creates succeeds;
   remove only the synthetic test account and its test data afterward.
8. Only after these checks pass should a separately approved deployment
   procedure schedule the production migration and application rollout.

Do not proceed until these preconditions are confirmed:

1. A current, restorable backup exists.
2. The target is a verified non-production instance with a compatible engine
   and version.
3. For TiDB, pessimistic transaction mode is confirmed for the application
   sessions so the 20-profile limit is serialized.
4. The selected schema and active `customers.customer_id` definition are
   verified, and neither new table exists.

If `customer_measurement_profiles` was created but creation of
`customer_measurement_values` failed, do not blindly rerun the whole migration
or drop either table. Stop profile API traffic, inspect both tables with
`SHOW CREATE TABLE`, and confirm that the first table matches this migration
and contains no profile rows. If it matches and is empty, apply only the
`CREATE TABLE customer_measurement_values` statement from this migration, then
verify both tables and foreign keys. If the first table differs or contains
rows, stop and use the database recovery process with a verified backup before
proceeding.

Measurement values are persisted as centimetres in `value_cm`. The API accepts
and returns values in each profile's `unit_preference` (`cm` or `in`). The
backend allowlists garment categories and category-specific field names.
Profile creation is limited to 20 per customer. Concurrent creates are
serialized by locking that customer's row in the active `customers` table;
TiDB deployments must use a transaction mode that enforces `SELECT ... FOR
UPDATE` locks.
`last_updated_by_type` and `last_updated_by_id` identify the authenticated
customer or admin actor; the ID is polymorphic, so it intentionally has no
foreign key to either identity table.

Deleting a profile cascades only to its measurement-value rows. The new schema
does not link profiles to orders, and the migration leaves all existing
customer, order, and legacy measurement records untouched.
