-- Demo inventory only for the college project. These are not actual boutique
-- stock counts. Replace them only after inventory has been physically verified.
-- Fresh installations only: run after checkout_schema.sql.
-- For an existing database with historical orders, use
-- seed_existing_product_size_stock.sql instead. Do not run both seeds.
-- Existing product-size quantities are never overwritten.
USE dazzle_boutique;

INSERT IGNORE INTO storefront_product_sizes
  (product_id, size, stock_quantity)
VALUES
  ('meera-floral-kurti', 'XS', 0),
  ('meera-floral-kurti', 'S', 1),
  ('meera-floral-kurti', 'M', 2),
  ('meera-floral-kurti', 'L', 1),
  ('meera-floral-kurti', 'XL', 1),
  ('meera-floral-kurti', 'XXL', 0),

  ('gulabi-everyday-kurti', 'XS', 0),
  ('gulabi-everyday-kurti', 'S', 1),
  ('gulabi-everyday-kurti', 'M', 1),
  ('gulabi-everyday-kurti', 'L', 1),
  ('gulabi-everyday-kurti', 'XL', 0),
  ('gulabi-everyday-kurti', 'XXL', 0),

  ('noor-embroidered-suit', 'XS', 1),
  ('noor-embroidered-suit', 'S', 1),
  ('noor-embroidered-suit', 'M', 1),
  ('noor-embroidered-suit', 'L', 1),
  ('noor-embroidered-suit', 'XL', 1),
  ('noor-embroidered-suit', 'XXL', 1),

  ('zari-festive-suit-set', 'XS', 0),
  ('zari-festive-suit-set', 'S', 1),
  ('zari-festive-suit-set', 'M', 1),
  ('zari-festive-suit-set', 'L', 1),
  ('zari-festive-suit-set', 'XL', 1),
  ('zari-festive-suit-set', 'XXL', 0),

  ('rani-celebration-lehenga', 'XS', 0),
  ('rani-celebration-lehenga', 'S', 0),
  ('rani-celebration-lehenga', 'M', 0),
  ('rani-celebration-lehenga', 'L', 0),
  ('rani-celebration-lehenga', 'XL', 0),
  ('rani-celebration-lehenga', 'XXL', 0),

  ('gulnaar-party-lehenga', 'XS', 1),
  ('gulnaar-party-lehenga', 'S', 1),
  ('gulnaar-party-lehenga', 'M', 1),
  ('gulnaar-party-lehenga', 'L', 1),
  ('gulnaar-party-lehenga', 'XL', 1),
  ('gulnaar-party-lehenga', 'XXL', 1),

  ('madhuri-woven-saree', 'Free Size', 8),
  ('chandni-festive-saree', 'Free Size', 4),

  ('aarohi-anarkali-suit', 'XS', 0),
  ('aarohi-anarkali-suit', 'S', 1),
  ('aarohi-anarkali-suit', 'M', 1),
  ('aarohi-anarkali-suit', 'L', 1),
  ('aarohi-anarkali-suit', 'XL', 0),
  ('aarohi-anarkali-suit', 'XXL', 0),

  ('saanvi-printed-anarkali', 'XS', 1),
  ('saanvi-printed-anarkali', 'S', 1),
  ('saanvi-printed-anarkali', 'M', 2),
  ('saanvi-printed-anarkali', 'L', 1),
  ('saanvi-printed-anarkali', 'XL', 1),
  ('saanvi-printed-anarkali', 'XXL', 1),

  ('ira-printed-co-ord-set', 'XS', 0),
  ('ira-printed-co-ord-set', 'S', 1),
  ('ira-printed-co-ord-set', 'M', 1),
  ('ira-printed-co-ord-set', 'L', 1),
  ('ira-printed-co-ord-set', 'XL', 1),
  ('ira-printed-co-ord-set', 'XXL', 1),

  ('sitara-embroidered-co-ord', 'XS', 0),
  ('sitara-embroidered-co-ord', 'S', 0),
  ('sitara-embroidered-co-ord', 'M', 1),
  ('sitara-embroidered-co-ord', 'L', 0),
  ('sitara-embroidered-co-ord', 'XL', 0),
  ('sitara-embroidered-co-ord', 'XXL', 0),

  ('maroon-embroidered-kurti', 'XS', 0),
  ('maroon-embroidered-kurti', 'S', 0),
  ('maroon-embroidered-kurti', 'M', 1),
  ('maroon-embroidered-kurti', 'L', 1),
  ('maroon-embroidered-kurti', 'XL', 0),
  ('maroon-embroidered-kurti', 'XXL', 0);