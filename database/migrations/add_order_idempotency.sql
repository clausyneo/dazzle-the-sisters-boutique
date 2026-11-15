-- Apply this migration once to an existing dazzle_boutique database.
-- Back up the database and verify that these columns/index do not already exist first.
-- This ALTER preserves all existing orders; their new nullable values remain NULL.
-- This migration is intentionally not repeatable: do not rerun it after it succeeds.
USE dazzle_boutique;

ALTER TABLE orders
  ADD COLUMN idempotency_key VARCHAR(64) NULL,
  ADD COLUMN request_fingerprint CHAR(64) NULL,
  ADD UNIQUE INDEX uq_orders_idempotency_key (idempotency_key);
