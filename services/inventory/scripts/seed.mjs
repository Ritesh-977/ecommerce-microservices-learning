import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.INVENTORY_DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  console.error('INVENTORY_DATABASE_URL is required');
  process.exit(1);
}

// Stock is keyed by Catalog product IDs. prod_003 is intentionally low stock
// so concurrent-checkout behavior can be demonstrated locally.
const stock = [
  { productId: 'prod_001', onHand: 50 },
  { productId: 'prod_002', onHand: 40 },
  { productId: 'prod_003', onHand: 2 },
  { productId: 'prod_004', onHand: 30 },
  { productId: 'prod_005', onHand: 10 },
  { productId: 'prod_006', onHand: 60 },
  { productId: 'prod_007', onHand: 15 },
  { productId: 'prod_008', onHand: 25 },
  { productId: 'prod_009', onHand: 100 },
  { productId: 'prod_010', onHand: 20 },
  { productId: 'prod_011', onHand: 35 },
  { productId: 'prod_012', onHand: 45 },
];

const pool = new Pool({ connectionString: databaseUrl });
let inserted = 0;

try {
  for (const item of stock) {
    const result = await pool.query(
      `INSERT INTO stock_items (product_id, on_hand)
       VALUES ($1, $2)
       ON CONFLICT (product_id) DO NOTHING`,
      [item.productId, item.onHand],
    );
    inserted += result.rowCount ?? 0;
  }
  console.log(`Seeded ${inserted} new stock records (${stock.length} total)`);
} catch (error) {
  console.error('Seed failed', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
