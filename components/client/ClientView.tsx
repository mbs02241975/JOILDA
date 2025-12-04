
import React, { useState, useEffect, useMemo } from 'react';
import { Product, Category, CartItem, OrderStatus, PaymentMethod, TableStatus, Order } from '../../types';
import { StorageService } from '../../services/storageService';

interface Props {
  tableId: number;
}

export const ClientView: React.FC<Props> = ({ tableId }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<Category>(Category.BEBIDAS);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isBillOpen, setIsBillOpen] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<TableStatus>(TableStatus.OPEN);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [observation, setObservation] = useState('');

  // Real-time Subscriptions
  useEffect(() => {
    // Subscribe Products
    const unsubProducts = StorageService.subscribeProducts((allProducts) => {
        // Filtra produtos sem estoque e lida com campos opcionais
        const available = allProducts.filter(p => {
             // Garante que o estoque seja tratado como número
             const stock = typeof p.stock === 'string' ? parseInt(p.stock) : p.stock;
             return stock > 0;
        }).map(p => ({
            ...p,
            stock: typeof p.stock === 'string' ? parseInt(p.stock) : p.stock,
            price: typeof p.price === 'string' ? parseFloat(p.price) : p.price,
            // Fallback image se a URL estiver vazia ou quebrada no banco
            imageUrl: p.imageUrl && p.imageUrl.length > 5 ? p.imageUrl : 'https://placehold.co/200?text=Sem+Imagem'
        }));
        setProducts(available);
    });

    // Subscribe Orders (Filter for this table)
    const unsubOrders = StorageService.subscribeOrders((allOrders) => {
        // Filtra apenas pedidos desta mesa que NÃO foram pagos/arquivados ainda.
        // Assim, quando a mesa fecha, a conta zera para o próximo cliente.
        // Usa == para permitir comparação entre string e number ('1' == 1)
        setMyOrders(allOrders.filter(o => 
          // eslint-disable-next-line eqeqeq
          o.tableId == tableId && 
          o.status !== OrderStatus.PAID && 
          o.status !== OrderStatus.CANCELED
        ));
    });

    // Subscribe Table Status
    const unsubTables = StorageService.subscribeTables((tables) => {
        // Busca flexível pela mesa (string ou number)
        const myTable = tables[tableId] || tables[String(tableId)];
        setSessionStatus(myTable?.status || TableStatus.OPEN);
    });

    return () => {
        unsubProducts();
        unsubOrders();
        unsubTables();
    };
  }, [tableId]);

  const filteredProducts = useMemo(() => 
    products.filter(p => p.category === activeCategory), 
  [products, activeCategory]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => {
      return prev.map(item => {
        if (item.id === productId) {
          const newQty = Math.max(1, item.quantity + delta);
          const product = products.find(p => p.id === productId);
          if (product && newQty > product.stock) return item; 
          return { ...item, quantity: newQty };
        }
        return item;
      });
    });
  };

  const updateItemPrice = (productId: string, newPrice: number) => {
    setCart(prev => prev.map(item => 
      item.id === productId ? { ...item, price: isNaN(newPrice) ? 0 : newPrice } : item
    ));
  };

  const placeOrder = async () => {
    if (cart.length === 0) return;
    await StorageService.createOrder(tableId, cart.map(c => ({ product: c, quantity: c.quantity })), observation);
    setCart([]);
    setObservation('');
    setIsCartOpen(false);
    alert('Pedido enviado! Acompanhe o status.');
  };

  const requestBill = async () => {
    await StorageService.requestTableClose(tableId, paymentMethod);
    setIsBillOpen(false);
    alert('Fechamento solicitado. Aguarde o garçom.');
  };

  const totalCart = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const totalConsumed = myOrders.reduce((acc, order) => order.status !== OrderStatus.CANCELED ? acc + order.total : acc, 0);

  // Agrupa todos os itens consumidos para exibição na conta
  const consumedItems = useMemo(() => {
    const itemsMap = new Map<string, {name: string, qty: number, total: number}>();
    myOrders.forEach(order => {
        if(order.status !== OrderStatus.CANCELED) {
            order.items.forEach(item => {
                const existing = itemsMap.get(item.productId);
                if (existing) {
                    existing.qty += item.quantity;
                    existing.total += item.price * item.quantity;
                } else {
                    itemsMap.set(item.productId, {
                        name: item.name,
                        qty: item.quantity,
                        total: item.price * item.quantity
                    });
                }
            });
        }
    });
    return Array.from(itemsMap.values());
  }, [myOrders]);


  if (products.length === 0 && sessionStatus === TableStatus.OPEN) {
      return (
          <div className="flex flex-col h-screen items-center justify-center bg-gray-50">
             <i className="fas fa-circle-notch fa-spin text-4xl text-brand mb-4"></i>
             <p className="text-gray-500">Carregando cardápio...</p>
             <button onClick={() => window.location.reload()} className="mt-4 text-brand underline text-sm">
                 Demorando muito? Tente recarregar
             </button>
          </div>
      )
  }

  if (sessionStatus === TableStatus.CLOSING_REQUESTED) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-brand-light p-6 text-center">
        <i className="fas fa-hourglass-half text-6xl text-brand mb-4 animate-pulse"></i>
        <h2 className="text-2xl font-bold text-brand-dark">Conta Solicitada</h2>
        <p className="mt-2 text-gray-600">Aguarde o garçom para conferência e pagamento.</p>
        <div className="mt-6 bg-white p-4 rounded shadow w-full max-w-sm">
          <p className="font-bold">Total Consumido: R$ {totalConsumed.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-2">Em breve o atendente virá até você.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-brand text-white p-4 shadow-md sticky top-0 z-10 flex justify-between items-center">
        <div>
          <h1 className="font-bold text-lg">Barraca de Praia entre Família</h1>
          <p className="text-xs text-brand-light">Mesa {tableId}</p>
        </div>
        <div className="text-xs bg-white/20 px-2 py-1 rounded">
           Parcial: R$ {totalConsumed.toFixed(2)}
        </div>
      </header>

      {/* Tabs */}
      <div className="flex overflow-x-auto p-2 bg-white gap-2 shadow-sm no-scrollbar">
        {Object.values(Category).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-colors ${
              activeCategory === cat ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Products Grid */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProducts.map(product => (
            <div key={product.id} className="bg-white rounded-xl shadow-sm overflow-hidden flex flex-row h-28 border border-gray-100">
              <img src={product.imageUrl} alt={product.name} className="w-28 h-full object-cover" />
              <div className="p-3 flex-1 flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-gray-800 leading-tight">{product.name}</h3>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{product.description}</p>
                  {/* Show out of stock visual cue */}
                  {product.stock === 0 && (
                      <span className="text-xs text-red-500 font-bold">Esgotado</span>
                  )}
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="font-bold text-brand-dark">R$ {product.price.toFixed(2)}</span>
                  <button 
                    onClick={() => addToCart(product)}
                    disabled={product.stock === 0}
                    className="w-8 h-8 bg-brand rounded-full text-white flex items-center justify-center hover:bg-brand-dark active:scale-95 disabled:bg-gray-300"
                  >
                    <i className="fas fa-plus text-xs"></i>
                  </button>
                </div>
              </div>
            </div>
          ))}
          {filteredProducts.length === 0 && (
             <div className="text-center py-10 text-gray-400 col-span-full">
               Nenhum item disponível nesta categoria.
             </div>
          )}
        </div>
      </div>

      {/* Floating Action Buttons */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-3">
        <button 
          onClick={() => setIsBillOpen(true)}
          className="w-12 h-12 bg-brand-orange rounded-full text-white shadow-lg flex items-center justify-center hover:bg-orange-600"
          title="Fechar Conta"
        >
          <i className="fas fa-file-invoice-dollar"></i>
        </button>
        
        <button 
          onClick={() => setIsCartOpen(true)}
          className="w-14 h-14 bg-brand-dark rounded-full text-white shadow-lg flex items-center justify-center relative hover:scale-105 transition-transform"
        >
          <i className="fas fa-shopping-basket text-xl"></i>
          {cart.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-white">
              {cart.reduce((a, c) => a + c.quantity, 0)}
            </span>
          )}
        </button>
      </div>

      {/* Cart Modal */}
      {isCartOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:w-96 rounded-t-2xl sm:rounded-xl p-4 max-h-[90vh] flex flex-col animate-slide-up">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h2 className="text-xl font-bold">Seu Pedido</h2>
              <button onClick={() => setIsCartOpen(false)} className="text-gray-400 hover:text-gray-600">
                <i className="fas fa-times"></i>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-4">
              {cart.length === 0 ? (
                <p className="text-center text-gray-500 py-8">Seu carrinho está vazio.</p>
              ) : (
                cart.map(item => (
                  <div key={item.id} className="flex justify-between items-center bg-gray-50 p-2 rounded-lg">
                    <div className="flex-1">
                      <h4 className="font-medium">{item.name}</h4>
                      <div className="flex items-center mt-1">
                          <span className="text-xs text-gray-500 mr-1">R$</span>
                          <input 
                            type="number" 
                            min="0" 
                            step="0.50"
                            value={item.price}
                            onChange={(e) => updateItemPrice(item.id, parseFloat(e.target.value))}
                            className="w-24 text-sm border border-gray-300 rounded px-2 py-1 text-gray-700 focus:ring-brand focus:border-brand bg-white"
                          />
                          <span className="text-xs text-gray-400 ml-1">un</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => item.quantity === 1 ? removeFromCart(item.id) : updateQuantity(item.id, -1)} className="text-gray-400 hover:text-red-500">
                        <i className="fas fa-minus-circle"></i>
                      </button>
                      <span className="font-bold w-4 text-center">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, 1)} className="text-brand hover:text-brand-dark">
                        <i className="fas fa-plus-circle"></i>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 pt-4 border-t">
              <label className="block text-sm font-medium text-gray-700 mb-1">Observações (opcional):</label>
              <textarea 
                  className="w-full border border-gray-300 rounded p-2 text-sm mb-4 h-20 resize-none"
                  placeholder="Ex: Sem cebola, com gelo e limão..."
                  value={observation}
                  onChange={(e) => setObservation(e.target.value)}
              ></textarea>

              <div className="flex justify-between text-lg font-bold mb-4">
                <span>Total</span>
                <span>R$ {totalCart.toFixed(2)}</span>
              </div>
              <button 
                onClick={placeOrder}
                disabled={cart.length === 0}
                className="w-full bg-brand text-white py-3 rounded-lg font-bold hover:bg-brand-dark disabled:bg-gray-300 transition-colors"
              >
                Enviar Pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill Modal */}
      {isBillOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Fechar Conta</h2>
            <p className="mb-4 text-gray-600">Confirme o fechamento da mesa <strong>{tableId}</strong>.</p>
            
            <div className="bg-gray-50 p-4 rounded-lg mb-6 text-sm">
               <h4 className="font-bold border-b pb-2 mb-2 text-gray-700">Resumo do Consumo</h4>
               <ul className="space-y-2 mb-4">
                   {consumedItems.map((item, i) => (
                       <li key={i} className="flex justify-between">
                           <span>{item.qty}x {item.name}</span>
                           <span>R$ {item.total.toFixed(2)}</span>
                       </li>
                   ))}
               </ul>
               <div className="flex justify-between border-t pt-2 mt-2">
                 <span>Total Geral:</span>
                 <span className="font-bold text-lg">R$ {totalConsumed.toFixed(2)}</span>
               </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Forma de Pagamento</label>
              <select 
                value={paymentMethod} 
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full border-gray-300 border rounded-md p-2 focus:ring-brand focus:border-brand"
              >
                {Object.values(PaymentMethod).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setIsBillOpen(false)} className="flex-1 py-2 border border-gray-300 rounded-md hover:bg-gray-50">Cancelar</button>
              <button onClick={requestBill} className="flex-1 py-2 bg-brand-orange text-white rounded-md hover:bg-orange-600 font-bold">Solicitar Fechamento</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Footer Credits */}
      <div className="bg-white py-2 text-center text-[10px] text-gray-400 border-t">
         Desenvolvedor: Máximo Batista - (71) 98286-2569
      </div>
    </div>
  );
};
