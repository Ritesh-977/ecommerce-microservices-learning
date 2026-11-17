import type { Product, ProductPage } from '../types/product.js';
import type { ListProductsInput, ProductRepository } from './product-repository.js';

export class InMemoryProductRepository implements ProductRepository {
  constructor(private readonly products: Product[] = []) {}

  async list({ limit, offset }: ListProductsInput): Promise<ProductPage> {
    return {
      items: this.products.slice(offset, offset + limit),
      total: this.products.length,
    };
  }

  async findById(id: string): Promise<Product | null> {
    return this.products.find((product) => product.id === id) ?? null;
  }
}
