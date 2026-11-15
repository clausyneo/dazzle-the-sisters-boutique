CREATE DATABASE IF NOT EXISTS dazzle_boutique;
USE dazzle_boutique;

CREATE TABLE IF NOT EXISTS customers (
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

CREATE TABLE IF NOT EXISTS customer_sessions (
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

CREATE TABLE IF NOT EXISTS admin_users (
  admin_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(254) NOT NULL,
  password_salt CHAR(32) CHARACTER SET ascii NOT NULL,
  password_hash CHAR(128) CHARACTER SET ascii NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (admin_id),
  UNIQUE KEY uq_admin_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id),
  UNIQUE KEY uq_admin_sessions_token_hash (token_hash),
  KEY idx_admin_sessions_admin_id (admin_id),
  KEY idx_admin_sessions_expires_at (expires_at),
  CONSTRAINT fk_admin_sessions_admin
    FOREIGN KEY (admin_id) REFERENCES admin_users (admin_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS storefront_products (
  product_id VARCHAR(80) NOT NULL,
  product_name VARCHAR(150) NOT NULL,
  current_price DECIMAL(10, 2) UNSIGNED NOT NULL,
  stock_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS storefront_product_sizes (
  product_id VARCHAR(80) NOT NULL,
  size VARCHAR(20) NOT NULL,
  stock_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, size),
  CONSTRAINT fk_storefront_product_sizes_product
    FOREIGN KEY (product_id) REFERENCES storefront_products (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  order_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NULL,
  order_number VARCHAR(32) NOT NULL,
  customer_name VARCHAR(150) NOT NULL,
  mobile_number VARCHAR(20) NOT NULL,
  email VARCHAR(254) NULL,
  delivery_address VARCHAR(500) NOT NULL,
  city VARCHAR(100) NOT NULL,
  pin_code VARCHAR(10) NOT NULL,
  total_amount DECIMAL(10, 2) UNSIGNED NOT NULL,
  payment_method ENUM('COD') NOT NULL DEFAULT 'COD',
  payment_status ENUM('Pending', 'Paid') NOT NULL DEFAULT 'Pending',
  order_status ENUM(
    'Order Placed',
    'Confirmed',
    'Processing',
    'Ready for Dispatch',
    'Shipped',
    'Delivered',
    'Cancelled'
  ) NOT NULL DEFAULT 'Order Placed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idempotency_key VARCHAR(64) NULL,
  request_fingerprint CHAR(64) NULL,
  PRIMARY KEY (order_id),
  KEY idx_orders_customer_created (customer_id, created_at),
  UNIQUE KEY uq_orders_order_number (order_number),
  UNIQUE KEY uq_orders_idempotency_key (idempotency_key),
  CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  order_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id VARCHAR(80) NOT NULL,
  product_name_snapshot VARCHAR(150) NOT NULL,
  product_price_snapshot DECIMAL(10, 2) UNSIGNED NOT NULL,
  selected_size VARCHAR(20) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  item_subtotal DECIMAL(10, 2) UNSIGNED NOT NULL,
  PRIMARY KEY (order_item_id),
  KEY idx_order_items_order_id (order_id),
  KEY idx_order_items_product_id (product_id),
  CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders (order_id),
  CONSTRAINT fk_order_items_storefront_product
    FOREIGN KEY (product_id) REFERENCES storefront_products (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_notifications (
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

-- INSERT IGNORE preserves existing storefront rows with these product IDs.
INSERT IGNORE INTO storefront_products
  (product_id, product_name, current_price, stock_quantity, is_active)
VALUES
  ('meera-floral-kurti', 'Meera Floral Kurti', 1499.00, 5, 1),
  ('gulabi-everyday-kurti', 'Gulabi Everyday Kurti', 1899.00, 3, 1),
  ('noor-embroidered-suit', 'Noor Embroidered Suit', 3299.00, 6, 1),
  ('zari-festive-suit-set', 'Zari Festive Suit Set', 4599.00, 4, 1),
  ('rani-celebration-lehenga', 'Rani Celebration Lehenga', 7999.00, 0, 1),
  ('gulnaar-party-lehenga', 'Gulnaar Party Lehenga', 6899.00, 6, 1),
  ('madhuri-woven-saree', 'Madhuri Woven Saree', 3799.00, 8, 1),
  ('chandni-festive-saree', 'Chandni Festive Saree', 5499.00, 4, 1),
  ('aarohi-anarkali-suit', 'Aarohi Anarkali Suit', 4299.00, 3, 1),
  ('saanvi-printed-anarkali', 'Saanvi Printed Anarkali', 2899.00, 7, 1),
  ('ira-printed-co-ord-set', 'Ira Printed Co-ord Set', 2499.00, 5, 1),
  ('sitara-embroidered-co-ord', 'Sitara Embroidered Co-ord', 3599.00, 1, 1),
  ('maroon-embroidered-kurti', 'Maroon Embroidered Kurti', 1499.00, 2, 1);
