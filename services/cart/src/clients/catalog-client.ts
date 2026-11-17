import { ApiError } from '../errors.js';

export interface CatalogProduct {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
}

export interface CatalogClient {
  getProduct(productId: string): Promise<CatalogProduct | null>;
}

export class HttpCatalogClient implements CatalogClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 3000,
  ) {}

  async getProduct(productId: string): Promise<CatalogProduct | null> {
    const url = new URL(
      `/v1/products/${encodeURIComponent(productId)}`,
      this.baseUrl,
    );

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new ApiError(
          502,
          'CATALOG_UNAVAILABLE',
          `Catalog service returned ${response.status}`,
        );
      }

      return (await response.json()) as CatalogProduct;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        503,
        'CATALOG_UNAVAILABLE',
        'Catalog service is unavailable',
      );
    }
  }
}
