export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
}

export interface ProductPage {
  items: Product[];
  total: number;
}
