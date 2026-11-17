import type { Product, ProductPage } from '../types/product.js';

export interface ListProductsInput {
  limit: number;
  offset: number;
}

export interface ProductRepository {
  list(input: ListProductsInput): Promise<ProductPage>;
  findById(id: string): Promise<Product | null>;
}
