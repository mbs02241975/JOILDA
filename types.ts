export enum Category {
  BEBIDAS = 'Bebidas',
  TIRA_GOSTO = 'Tira Gostos',
  REFEICOES = 'Refeições',
  SOBREMESAS = 'Sobremesas'
}

export enum PaymentMethod {
  DINHEIRO = 'Dinheiro',
  CARTAO_CREDITO = 'Cartão de Crédito',
  CARTAO_DEBITO = 'Cartão de Débito',
  PIX = 'PIX'
}

export enum OrderStatus {
  PENDING = 'Pendente',
  PREPARING = 'Em Preparo',
  DELIVERED = 'Entregue',
  CANCELED = 'Cancelado',
  PAID = 'Pago/Finalizado'
}

export enum TableStatus {
  OPEN = 'Aberta',
  CLOSING_REQUESTED = 'Fechamento Solicitado',
  CLOSED = 'Fechada'
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: Category;
  imageUrl: string;
  stock: number;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  tableId: number;
  items: OrderItem[];
  status: OrderStatus;
  timestamp: number;
  total: number;
  observation?: string;
}

export interface TableSession {
  tableId: number;
  status: TableStatus;
  orders: Order[];
  requestedPaymentMethod?: PaymentMethod;
}