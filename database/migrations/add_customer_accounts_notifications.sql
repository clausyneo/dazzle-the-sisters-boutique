-- Back up dazzle_boutique before applying this migration.
-- It preserves existing orders; their new customer_id values remain NULL so
-- guest orders are not automatically assigned to unverified accounts.
-- This migration is not repeatable. Verify that none of these tables,
-- columns, indexes, or constraints already exist before applying it.
USE dazzle_boutique;

CREATE TABLE customers (
  customer_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_salt CHAR(32) CHARACTER SET ascii NOT NULL,
  password_hash CHAR(128) CHARACTER SET ascii NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id),
  UNIQUE KEY uq_customers_phone (phone),
  UNIQUE KEY uq_customers_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE customer_sessions (
  session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id),
  UNIQUE KEY uq_customer_sessions_token_hash (token_hash),
  KEY idx_customer_sessions_customer_id (customer_id),
  KEY idx_customer_sessions_expires_at (expires_at),
  CONSTRAINT fk_customer_sessions_customer
    FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE orders
  ADD COLUMN customer_id BIGINT UNSIGNED NULL AFTER order_id,
  ADD KEY idx_orders_customer_created (customer_id, created_at),
  ADD CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
    ON DELETE SET NULL;

CREATE TABLE customer_notifications (
  notification_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  notification_type VARCHAR(32) NOT NULL,
  message VARCHAR(255) NOT NULL,
  order_id BIGINT UNSIGNED NULL,
  event_key VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  PRIMARY KEY (notification_id),
  UNIQUE KEY uq_customer_notifications_event_key (event_key),
  KEY idx_customer_notifications_unread (customer_id, read_at, created_at),
  CONSTRAINT fk_customer_notifications_customer
    FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_customer_notifications_order
    FOREIGN KEY (order_id) REFERENCES orders (order_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
