import type { PrismaClient, Product as PrismaProduct } from '@prisma/client';
import type { Product, ProductPage } from '../types/product.js';
import type { ListProductsInput, ProductRepository } from './product-repository.js';

function toProduct(row: PrismaProduct): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price.toNumber(),
    currency: row.currency,
  };
}

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list({ limit, offset }: ListProductsInput): Promise<ProductPage> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        orderBy: { createdAt: 'asc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.product.count(),
    ]);

    return { items: rows.map(toProduct), total };
  }

  async findById(id: string): Promise<Product | null> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    return row === null ? null : toProduct(row);
  }
}
