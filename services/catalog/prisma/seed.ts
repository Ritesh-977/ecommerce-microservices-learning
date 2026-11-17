import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const products = [
  { id: 'prod_001', name: 'Wireless Headphones', description: 'Over-ear noise-cancelling headphones', price: '129.99', currency: 'USD' },
  { id: 'prod_002', name: 'Mechanical Keyboard', description: 'Compact 75% mechanical keyboard', price: '89.50', currency: 'USD' },
  { id: 'prod_003', name: 'USB-C Hub', description: '7-in-1 USB-C hub with HDMI and Ethernet', price: '39.99', currency: 'USD' },
  { id: 'prod_004', name: 'Ergonomic Mouse', description: 'Vertical ergonomic wireless mouse', price: '49.00', currency: 'USD' },
  { id: 'prod_005', name: '27-inch Monitor', description: '1440p IPS monitor with USB-C power delivery', price: '329.00', currency: 'USD' },
  { id: 'prod_006', name: 'Laptop Stand', description: 'Adjustable aluminum laptop stand', price: '34.95', currency: 'USD' },
  { id: 'prod_007', name: 'External SSD', description: '1TB portable NVMe SSD', price: '119.99', currency: 'USD' },
  { id: 'prod_008', name: 'Webcam', description: '1080p webcam with dual microphones', price: '59.99', currency: 'USD' },
  { id: 'prod_009', name: 'Desk Mat', description: 'Large felt desk mat', price: '24.00', currency: 'USD' },
  { id: 'prod_010', name: 'Monitor Arm', description: 'Single monitor gas-spring arm', price: '79.00', currency: 'USD' },
  { id: 'prod_011', name: 'Noise-Cancelling Earbuds', description: 'Wireless earbuds with active noise cancellation', price: '99.99', currency: 'USD' },
  { id: 'prod_012', name: 'Portable Charger', description: '20000mAh power bank with USB-C PD', price: '45.00', currency: 'USD' },
];

async function main(): Promise<void> {
  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: product,
      create: product,
    });
  }
  console.log(`Seeded ${products.length} products`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
