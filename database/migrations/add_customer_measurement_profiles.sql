-- Select and verify the intended database before running this file. It
-- intentionally does not switch databases, to avoid targeting the wrong schema.
-- Back up the target database and verify the active customers table first.
-- Run after add_customer_accounts_notifications.sql. This migration does not
-- modify the legacy users, measurements, or custom_order_measurements tables.

CREATE TABLE customer_measurement_profiles (
  profile_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  garment_category VARCHAR(40) NOT NULL,
  profile_name VARCHAR(100) NOT NULL,
  unit_preference ENUM('cm', 'in') NOT NULL DEFAULT 'cm',
  fitting_preference ENUM('SNUG', 'REGULAR', 'RELAXED') NULL,
  notes VARCHAR(1000) NULL,
  last_updated_by_type ENUM('CUSTOMER', 'ADMIN') NOT NULL,
  last_updated_by_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id),
  KEY idx_measurement_profiles_customer_updated (customer_id, updated_at),
  KEY idx_measurement_profiles_customer_category (customer_id, garment_category),
  KEY idx_measurement_profiles_category (garment_category),
  CONSTRAINT fk_measurement_profiles_customer
    FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE customer_measurement_values (
  profile_id BIGINT UNSIGNED NOT NULL,
  measurement_key VARCHAR(64) NOT NULL,
  value_cm DECIMAL(8,3) UNSIGNED NOT NULL,
  PRIMARY KEY (profile_id, measurement_key),
  CONSTRAINT fk_measurement_values_profile
    FOREIGN KEY (profile_id) REFERENCES customer_measurement_profiles (profile_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
