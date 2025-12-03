import { Product, Category, Order, TableSession, TableStatus, OrderStatus } from '../types';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, updateDoc, doc, deleteDoc, onSnapshot, query, orderBy, setDoc, getDocs, increment, where, limit } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

// --- Configuration Interface ---
export interface DatabaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

// --- Initial Mock Data ---
const INITIAL_PRODUCTS: Product[] = [
  { id: '1', name: 'Cerveja Gelada 600ml', description: 'Estupidamente gelada', price: 15.00, category: Category.BEBIDAS, stock: 48, imageUrl: 'https://picsum.photos/200/200?random=1' },
  { id: '2', name: 'Água de Coco', description: 'Natural da fruta', price: 8.00, category: Category.BEBIDAS, stock: 20, imageUrl: 'https://picsum.photos/200/200?random=2' },
  { id: '3', name: 'Isca de Peixe', description: 'Acompanha molho tártaro', price: 45.00, category: Category.TIRA_GOSTO, stock: 10, imageUrl: 'https://picsum.photos/200/200?random=3' },
  { id: '4', name: 'Batata Frita', description: 'Porção generosa', price: 25.00, category: Category.TIRA_GOSTO, stock: 15, imageUrl: 'https://picsum.photos/200/200?random=4' },
];

const STORAGE_KEYS = {
  PRODUCTS: 'beach_app_products',
  ORDERS: 'beach_app_orders',
  TABLES: 'beach_app_tables',
  DB_CONFIG: 'beach_app_db_config'
};

let db: any = null; // Firestore instance

// --- Robust Storage Implementation ---
// Fallback em memória caso o LocalStorage seja bloqueado pelo navegador (Tracking Prevention)
const memoryStore = new Map<string, string>();

const safeStorage = {
  getItem: (key: string) => {
    try {
      // Tenta ler do localStorage
      const item = localStorage.getItem(key);
      // Se retornar null, pode ser que a escrita anterior tenha falhado no disco mas tenha salvo na memória
      if (item === null && memoryStore.has(key)) {
        return memoryStore.get(key) || null;
      }
      return item;
    } catch (e) {
      // Acesso bloqueado, usa memória volátil
      return memoryStore.get(key) || null;
    }
  },
  setItem: (key: string, value: string) => {
    // Salva na memória sempre para garantir consistência na sessão atual
    memoryStore.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // Silenciosamente ignora falha de escrita no disco (bloqueio de privacidade)
      // O app continuará funcionando via memoryStore
    }
  },
  removeItem: (key: string) => {
    memoryStore.delete(key);
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // Ignora erro
    }
  }
};

// Helper to check if we are using cloud DB
const isCloud = () => !!db;

export const StorageService = {
  // --- Initialization ---
  init: (config?: DatabaseConfig) => {
    // 1. Prioridade: Verifica se o arquivo firebaseConfig.ts foi preenchido corretamente pelo usuário
    if (!config && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('COLAR_')) {
        console.log("Usando configuração fixa do firebaseConfig.ts");
        config = firebaseConfig;
    }

    // 2. Fallback: Tenta carregar do LocalStorage (Configurado via Painel Admin anteriormente)
    if (!config) {
      const storedConfig = safeStorage.getItem(STORAGE_KEYS.DB_CONFIG);
      if (storedConfig) {
        try {
          config = JSON.parse(storedConfig);
        } catch (e) { console.error("Invalid DB Config stored"); }
      }
    }

    if (config && config.apiKey) {
      try {
        const app = initializeApp(config);
        db = getFirestore(app);
        console.log("Firebase initialized successfully");
        return true;
      } catch (error) {
        console.error("Failed to init Firebase", error);
        return false;
      }
    }
    return false;
  },

  saveConfig: (config: DatabaseConfig) => {
    safeStorage.setItem(STORAGE_KEYS.DB_CONFIG, JSON.stringify(config));
    StorageService.init(config);
  },

  clearConfig: () => {
    safeStorage.removeItem(STORAGE_KEYS.DB_CONFIG);
    db = null;
    window.location.reload();
  },

  isUsingCloud: () => isCloud(),

  // --- Subscriptions (Real-time) ---
  subscribeProducts: (callback: (products: Product[]) => void) => {
    if (isCloud()) {
      const q = query(collection(db, 'products'), orderBy('name'));
      return onSnapshot(q, (snapshot) => {
        const products = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Product));
        callback(products);
      });
    } else {
      // LocalStorage Polling Fallback
      const fetch = () => {
        const stored = safeStorage.getItem(STORAGE_KEYS.PRODUCTS);
        if (!stored) {
            safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(INITIAL_PRODUCTS));
            callback(INITIAL_PRODUCTS);
        } else {
            callback(JSON.parse(stored));
        }
      };
      fetch();
      const interval = setInterval(fetch, 2000);
      return () => clearInterval(interval);
    }
  },

  subscribeOrders: (callback: (orders: Order[]) => void) => {
    if (isCloud()) {
      const q = query(collection(db, 'orders'), orderBy('timestamp', 'desc'));
      return onSnapshot(q, (snapshot) => {
        const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Order));
        callback(orders);
      });
    } else {
      const fetch = () => {
        const stored = safeStorage.getItem(STORAGE_KEYS.ORDERS);
        callback(stored ? JSON.parse(stored) : []);
      };
      fetch();
      const interval = setInterval(fetch, 2000);
      return () => clearInterval(interval);
    }
  },

  subscribeTables: (callback: (tables: {[key: string]: any}) => void) => {
      if (isCloud()) {
          const q = query(collection(db, 'tables'));
          return onSnapshot(q, (snapshot) => {
              const tables: any = {};
              snapshot.docs.forEach(d => {
                  tables[d.id] = d.data();
              });
              callback(tables);
          });
      } else {
          const fetch = () => {
            const tables = JSON.parse(safeStorage.getItem(STORAGE_KEYS.TABLES) || '{}');
            callback(tables);
          };
          fetch();
          const interval = setInterval(fetch, 2000);
          return () => clearInterval(interval);
      }
  },

  // --- Actions ---
  saveProduct: async (product: Product) => {
    if (isCloud()) {
      try {
          // Se tem ID longo (>10 caracteres), assumimos que é edição de um existente no Firestore
          if (product.id && product.id.length > 10) { 
            const docRef = doc(db, 'products', product.id);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id, ...data } = product;
            await updateDoc(docRef, data);
          } else {
            // Novo Produto: Verifica duplicidade por NOME antes de criar
            const q = query(collection(db, 'products'), where('name', '==', product.name));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                // Produto já existe, vamos somar ao estoque!
                const existingDoc = querySnapshot.docs[0];
                const currentData = existingDoc.data();
                const currentStock = currentData.stock || 0;
                
                await updateDoc(existingDoc.ref, {
                    stock: currentStock + product.stock,
                    // Atualiza preço e descrição para o mais recente, se desejar
                    price: product.price,
                    description: product.description,
                    imageUrl: product.imageUrl || currentData.imageUrl
                });
                console.log(`Estoque atualizado para ${product.name}`);
            } else {
                // Não existe, cria novo
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { id, ...data } = product;
                await addDoc(collection(db, 'products'), data);
            }
          }
      } catch (error: any) {
          console.error("Erro no Firebase:", error);
          if (error.code === 'resource-exhausted' || error.message?.includes('exceeds')) {
              alert('A imagem é muito pesada para o banco gratuito. Tente uma foto menor.');
          }
          throw error;
      }
    } else {
      // Modo Local
      const products = JSON.parse(safeStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
      const existingIndex = products.findIndex((p: Product) => p.id === product.id);
      
      // Tenta achar por nome também para evitar duplicatas no local
      const nameIndex = products.findIndex((p: Product) => p.name === product.name && p.id !== product.id);

      if (existingIndex >= 0) {
        products[existingIndex] = product;
      } else if (nameIndex >= 0) {
         products[nameIndex].stock += product.stock;
         products[nameIndex].price = product.price; // Atualiza info
      } else {
        products.push(product);
      }
      safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    }
  },

  deleteProduct: async (id: string) => {
    if (isCloud()) {
      await deleteDoc(doc(db, 'products', id));
    } else {
      const products = JSON.parse(safeStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]').filter((p: Product) => p.id !== id);
      safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    }
  },

  createOrder: async (tableId: number, items: { product: Product, quantity: number }[], observation?: string) => {
    const orderData: Omit<Order, 'id'> = {
      tableId,
      status: OrderStatus.PENDING,
      timestamp: Date.now(),
      items: items.map(i => ({
        productId: i.product.id,
        name: i.product.name,
        price: i.product.price,
        quantity: i.quantity
      })),
      total: items.reduce((acc, curr) => acc + (curr.product.price * curr.quantity), 0),
      observation: observation || ''
    };

    if (isCloud()) {
        // Create Order
        await addDoc(collection(db, 'orders'), orderData);

        // Update Stock Atomically
        items.forEach(async (item) => {
             const pRef = doc(db, 'products', item.product.id);
             // Use Firestore increment with negative value to decrement
             await updateDoc(pRef, {
                 stock: increment(-item.quantity)
             });
        });
    } else {
      const products = JSON.parse(safeStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
      items.forEach(item => {
        const pIndex = products.findIndex((p: Product) => p.id === item.product.id);
        if (pIndex >= 0) {
          products[pIndex].stock = Math.max(0, products[pIndex].stock - item.quantity);
        }
      });
      safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));

      const newOrder = { ...orderData, id: Date.now().toString() };
      const orders = JSON.parse(safeStorage.getItem(STORAGE_KEYS.ORDERS) || '[]');
      orders.push(newOrder);
      safeStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
    }
  },

  updateOrderStatus: async (orderId: string, status: OrderStatus) => {
    if (isCloud()) {
      await updateDoc(doc(db, 'orders', orderId), { status });
      
      // If cancelled, restore stock logic (omitted for brevity)
    } else {
      const orders = JSON.parse(safeStorage.getItem(STORAGE_KEYS.ORDERS) || '[]');
      const order = orders.find((o: Order) => o.id === orderId);
      if (order) {
        if (status === OrderStatus.CANCELED && order.status !== OrderStatus.CANCELED) {
          const products = JSON.parse(safeStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
          order.items.forEach((item: any) => {
             const p = products.find((p: Product) => p.id === item.productId);
             if (p) p.stock += item.quantity;
          });
          safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
        }
        order.status = status;
        safeStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
      }
    }
  },

  requestTableClose: async (tableId: number, paymentMethod: string) => {
    if (isCloud()) {
       await setDoc(doc(db, 'tables', tableId.toString()), {
           status: TableStatus.CLOSING_REQUESTED,
           paymentMethod
       }, { merge: true });
    } else {
      const tables = JSON.parse(safeStorage.getItem(STORAGE_KEYS.TABLES) || '{}');
      tables[tableId] = { status: TableStatus.CLOSING_REQUESTED, paymentMethod };
      safeStorage.setItem(STORAGE_KEYS.TABLES, JSON.stringify(tables));
    }
  },

  finalizeTable: async (tableId: number) => {
    if (isCloud()) {
       await deleteDoc(doc(db, 'tables', tableId.toString()));
       // We do not delete orders, they stay in history
    } else {
      const tables = JSON.parse(safeStorage.getItem(STORAGE_KEYS.TABLES) || '{}');
      delete tables[tableId];
      safeStorage.setItem(STORAGE_KEYS.TABLES, JSON.stringify(tables));
    }
  },
  
  // Async helper for reports
  getOrdersOnce: async (): Promise<Order[]> => {
      if(isCloud()) {
          const snapshot = await getDocs(collection(db, 'orders'));
          return snapshot.docs.map(d => ({id: d.id, ...d.data()} as Order));
      } else {
          const stored = safeStorage.getItem(STORAGE_KEYS.ORDERS);
          return stored ? JSON.parse(stored) : [];
      }
  },

  // Diagnostic tool
  runDiagnostics: async () => {
    console.log("--- Diagnóstico Iniciado ---");
    if (isCloud()) {
        try {
            console.log("Verificando conexão com Firestore...");
            // Tenta buscar 1 produto para validar leitura
            const q = query(collection(db, 'products'), limit(1));
            await getDocs(q);
            console.log("Conexão Firestore: OK");
            alert("Conexão com Banco de Dados (Firebase) está OK!");
        } catch (e: any) {
            console.error("Conexão Firestore: ERRO", e);
            alert(`Erro ao conectar com Firebase: ${e.message}`);
        }
    } else {
        console.log("Modo Local (Offline/Fallback)");
        try {
            const key = 'test_diag_' + Date.now();
            safeStorage.setItem(key, 'ok');
            const val = safeStorage.getItem(key);
            safeStorage.removeItem(key);
            
            if (val === 'ok') {
                alert("Armazenamento Local (Navegador) está funcionando.");
            } else {
                 alert("Alerta: Armazenamento Local parece estar bloqueado.");
            }
        } catch (e: any) {
            alert(`Erro no Armazenamento Local: ${e.message}`);
        }
    }
  }
};