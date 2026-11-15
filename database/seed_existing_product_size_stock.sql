-- Demo inventory only for the college project; these are not actual boutique
-- stock counts. Use this file only for an existing database after the
-- storefront_product_sizes migration, and only while that table is empty.
-- Do not run the fresh-install demo seed on this database.
--
-- Missing product-size rows are seeded with the demo starting quantity minus
-- all matching historical order_items quantities (clamped at zero). INSERT
-- IGNORE leaves any already populated size-stock rows unchanged.
-- Every matching order_items row is counted regardless of order_status; check
-- cancelled, returned, or otherwise restocked orders before using this file.
-- Therefore, if any rows already exist, this script will not reconcile them;
-- inspect and reconcile those rows manually before using this file.
-- This file does not change aggregate storefront_products.stock_quantity,
-- orders, or order_items.
USE dazzle_boutique;

INSERT IGNORE INTO storefront_product_sizes
  (product_id, size, stock_quantity)
SELECT
  inventory.product_id,
  inventory.size,
  GREATEST(






    
    CAST(inventory.demo_stock AS DECIMAL(20, 0))
      - CAST(COALESCE(SUM(order_items.quantity), 0) AS DECIMAL(20, 0)),
    0
  ) AS starting_size_stock
FROM (
  SELECT 'meera-floral-kurti' AS product_id, 'XS' AS size, 0 AS demo_stock
  UNION ALL SELECT 'meera-floral-kurti', 'S', 1
  UNION ALL SELECT 'meera-floral-kurti', 'M', 2
  UNION ALL SELECT 'meera-floral-kurti', 'L', 1
  UNION ALL SELECT 'meera-floral-kurti', 'XL', 1
  UNION ALL SELECT 'meera-floral-kurti', 'XXL', 0

  UNION ALL SELECT 'gulabi-everyday-kurti', 'XS', 0
  UNION ALL SELECT 'gulabi-everyday-kurti', 'S', 1
  UNION ALL SELECT 'gulabi-everyday-kurti', 'M', 1
  UNION ALL SELECT 'gulabi-everyday-kurti', 'L', 1
  UNION ALL SELECT 'gulabi-everyday-kurti', 'XL', 0
  UNION ALL SELECT 'gulabi-everyday-kurti', 'XXL', 0

  UNION ALL SELECT 'noor-embroidered-suit', 'XS', 1
  UNION ALL SELECT 'noor-embroidered-suit', 'S', 1
  UNION ALL SELECT 'noor-embroidered-suit', 'M', 1
  UNION ALL SELECT 'noor-embroidered-suit', 'L', 1
  UNION ALL SELECT 'noor-embroidered-suit', 'XL', 1
  UNION ALL SELECT 'noor-embroidered-suit', 'XXL', 1

  UNION ALL SELECT 'zari-festive-suit-set', 'XS', 0
  UNION ALL SELECT 'zari-festive-suit-set', 'S', 1
  UNION ALL SELECT 'zari-festive-suit-set', 'M', 1
  UNION ALL SELECT 'zari-festive-suit-set', 'L', 1
  UNION ALL SELECT 'zari-festive-suit-set', 'XL', 1
  UNION ALL SELECT 'zari-festive-suit-set', 'XXL', 0

  UNION ALL SELECT 'rani-celebration-lehenga', 'XS', 0
  UNION ALL SELECT 'rani-celebration-lehenga', 'S', 0
  UNION ALL SELECT 'rani-celebration-lehenga', 'M', 0
  UNION ALL SELECT 'rani-celebration-lehenga', 'L', 0
  UNION ALL SELECT 'rani-celebration-lehenga', 'XL', 0
  UNION ALL SELECT 'rani-celebration-lehenga', 'XXL', 0

  UNION ALL SELECT 'gulnaar-party-lehenga', 'XS', 1
  UNION ALL SELECT 'gulnaar-party-lehenga', 'S', 1
  UNION ALL SELECT 'gulnaar-party-lehenga', 'M', 1
  UNION ALL SELECT 'gulnaar-party-lehenga', 'L', 1
  UNION ALL SELECT 'gulnaar-party-lehenga', 'XL', 1
  UNION ALL SELECT 'gulnaar-party-lehenga', 'XXL', 1

  UNION ALL SELECT 'madhuri-woven-saree', 'Free Size', 8
  UNION ALL SELECT 'chandni-festive-saree', 'Free Size', 4

  UNION ALL SELECT 'aarohi-anarkali-suit', 'XS', 0
  UNION ALL SELECT 'aarohi-anarkali-suit', 'S', 1
  UNION ALL SELECT 'aarohi-anarkali-suit', 'M', 1
  UNION ALL SELECT 'aarohi-anarkali-suit', 'L', 1
  UNION ALL SELECT 'aarohi-anarkali-suit', 'XL', 0
  UNION ALL SELECT 'aarohi-anarkali-suit', 'XXL', 0

  UNION ALL SELECT 'saanvi-printed-anarkali', 'XS', 1
  UNION ALL SELECT 'saanvi-printed-anarkali', 'S', 1
  UNION ALL SELECT 'saanvi-printed-anarkali', 'M', 2
  UNION ALL SELECT 'saanvi-printed-anarkali', 'L', 1
  UNION ALL SELECT 'saanvi-printed-anarkali', 'XL', 1
  UNION ALL SELECT 'saanvi-printed-anarkali', 'XXL', 1

  UNION ALL SELECT 'ira-printed-co-ord-set', 'XS', 0
  UNION ALL SELECT 'ira-printed-co-ord-set', 'S', 1
  UNION ALL SELECT 'ira-printed-co-ord-set', 'M', 1
  UNION ALL SELECT 'ira-printed-co-ord-set', 'L', 1
  UNION ALL SELECT 'ira-printed-co-ord-set', 'XL', 1
  UNION ALL SELECT 'ira-printed-co-ord-set', 'XXL', 1

  UNION ALL SELECT 'sitara-embroidered-co-ord', 'XS', 0
  UNION ALL SELECT 'sitara-embroidered-co-ord', 'S', 0
  UNION ALL SELECT 'sitara-embroidered-co-ord', 'M', 1
  UNION ALL SELECT 'sitara-embroidered-co-ord', 'L', 0
  UNION ALL SELECT 'sitara-embroidered-co-ord', 'XL', 0
  UNION ALL SELECT 'sitara-embroidered-co-ord', 'XXL', 0

  UNION ALL SELECT 'maroon-embroidered-kurti', 'XS', 0
  UNION ALL SELECT 'maroon-embroidered-kurti', 'S', 0
  UNION ALL SELECT 'maroon-embroidered-kurti', 'M', 1
  UNION ALL SELECT 'maroon-embroidered-kurti', 'L', 1
  UNION ALL SELECT 'maroon-embroidered-kurti', 'XL', 0
  UNION ALL SELECT 'maroon-embroidered-kurti', 'XXL', 0
) AS inventory
LEFT JOIN order_items
  ON order_items.product_id = inventory.product_id
  AND order_items.selected_size = inventory.size
GROUP BY inventory.product_id, inventory.size, inventory.demo_stock;
