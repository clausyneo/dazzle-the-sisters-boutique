-- Back up dazzle_boutique before applying this migration.
-- Adds only single-use password recovery token storage for customer accounts.
USE dazzle_boutique;

CREATE TABLE IF NOT EXISTS customer_password_resets (
  reset_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reset_id),
  UNIQUE KEY uq_customer_password_resets_token_hash (token_hash),
  KEY idx_customer_password_resets_customer_id (customer_id),
  KEY idx_customer_password_resets_expires_at (expires_at),
  CONSTRAINT fk_customer_password_resets_customer
    FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
