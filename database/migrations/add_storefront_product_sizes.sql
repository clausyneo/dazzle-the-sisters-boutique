-- Apply to an existing dazzle_boutique database after backing it up.
-- This creates only the size-stock table; it does not change products, aggregate
-- stock_quantity values, orders, order_items, or existing order history.
-- CREATE TABLE IF NOT EXISTS makes reruns safe when this table already exists.
-- If the table already exists, inspect its columns and keys before proceeding;
-- IF NOT EXISTS does not repair an existing table with a different definition.
USE dazzle_boutique;

CREATE TABLE IF NOT EXISTS storefront_product_sizes (
  product_id VARCHAR(80) NOT NULL,
  size VARCHAR(20) NOT NULL,
  stock_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, size),
  CONSTRAINT fk_storefront_product_sizes_product
    FOREIGN KEY (product_id) REFERENCES storefront_products (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
