
import { Product, Category, Order, TableStatus, OrderStatus } from '../types';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, updateDoc, doc, deleteDoc, onSnapshot, query, orderBy, setDoc, getDocs, increment, where, limit, writeBatch } from 'firebase/firestore';
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
// Fallback em memória caso o LocalStorage seja bloqueado pelo navegador
const memoryStore = new Map<string, string>();

const safeStorage = {
  getItem: (key: string) => {
    try {
      const item = localStorage.getItem(key);
      if (item === null && memoryStore.has(key)) {
        return memoryStore.get(key) || null;
      }
      return item;
    } catch (e) {
      // Se der erro de segurança (Tracking Prevention), usa memória
      return memoryStore.get(key) || null;
    }
  },
  setItem: (key: string, value: string) => {
    memoryStore.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // Ignora erro de gravação, dados ficam só na memória
      console.warn('Storage bloqueado, usando memória volátil.');
    }
  },
  removeItem: (key: string) => {
    memoryStore.delete(key);
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // Ignore errors
    }
  }
};

const isCloud = () => !!db;

export const StorageService = {
  // --- Initialization ---
  init: (config?: DatabaseConfig) => {
    // 0. Verifica se já existe uma instância rodando e recupera o DB
    if (getApps().length > 0) {
        try {
            const app = getApp();
            db = getFirestore(app);
            console.log("Firebase recuperado da instância existente.");
            return true;
        } catch (e) {
            console.warn("Erro ao recuperar app existente, tentando reinicializar...");
        }
    }

    // 1. Prioridade Absoluta: Configuração Hardcoded do arquivo
    if (firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('COLAR_')) {
        config = firebaseConfig;
    } 
    else if (!config) {
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
        console.log("Firebase conectado com sucesso!");
        return true;
      } catch (error: any) {
        if (error.code === 'app/duplicate-app') {
            const app = getApp();
            db = getFirestore(app);
            return true;
        }
        console.error("Falha ao conectar Firebase", error);
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
      }, (error) => {
          console.error("Erro subscribeProducts:", error);
      });
    } else {
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
      // Monitora apenas pedidos ativos na coleção 'orders'
      const q = query(collection(db, 'orders'), orderBy('timestamp', 'desc'));
      return onSnapshot(q, (snapshot) => {
        const orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Order));
        callback(orders);
      }, (error) => {
         if (error.code === 'permission-denied') {
             // Silencia alerta repetitivo, mas loga erro
             console.error('Erro de Permissão Firebase');
         }
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
          if (product.id && product.id.length > 0) { 
            const docRef = doc(db, 'products', product.id);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id, ...data } = product;
            await updateDoc(docRef, data);
          } else {
            const q = query(collection(db, 'products'), where('name', '==', product.name));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                const existingDoc = querySnapshot.docs[0];
                const currentData = existingDoc.data();
                await updateDoc(existingDoc.ref, {
                    stock: (currentData.stock || 0) + product.stock,
                    price: product.price,
                    description: product.description,
                    imageUrl: product.imageUrl || currentData.imageUrl
                });
            } else {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { id, ...data } = product;
                await addDoc(collection(db, 'products'), data);
            }
          }
      } catch (error: any) {
          console.error("Erro saveProduct:", error);
          if (error.code === 'resource-exhausted') {
              alert('A imagem é muito pesada. Use Link (URL).');
          }
          throw error;
      }
    } else {
      const products = JSON.parse(safeStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
      const existingIndex = products.findIndex((p: Product) => p.id === product.id);
      
      if (!product.id || product.id.length < 5) product.id = 'local_' + Date.now();

      if (existingIndex >= 0) {
        products[existingIndex] = product;
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
        await addDoc(collection(db, 'orders'), orderData);
        items.forEach(async (item) => {
             const pRef = doc(db, 'products', item.product.id);
             await updateDoc(pRef, { stock: increment(-item.quantity) });
        });
    } else {
      const products = JSON.parse(safeStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
      items.forEach(item => {
        const pIndex = products.findIndex((p: Product) => p.id === item.product.id);
        if (pIndex >= 0) products[pIndex].stock = Math.max(0, products[pIndex].stock - item.quantity);
      });
      safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));

      const orders = JSON.parse(safeStorage.getItem(STORAGE_KEYS.ORDERS) || '[]');
      orders.push({ ...orderData, id: Date.now().toString() });
      safeStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
    }
  },

  updateOrderStatus: async (orderId: string, status: OrderStatus) => {
    if (isCloud()) {
      await updateDoc(doc(db, 'orders', orderId), { status });
    } else {
      const orders = JSON.parse(safeStorage.getItem(STORAGE_KEYS.ORDERS) || '[]');
      const order = orders.find((o: Order) => o.id === orderId);
      if (order) {
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

  // --- SOLUÇÃO NUCLEAR: Varredura total e movimentação física ---
  finalizeTable: async (tableId: number) => {
    if (isCloud()) {
       try {
           console.log(`NUCLEAR: Iniciando fechamento da mesa ${tableId}...`);

           // 1. Limpa o status da mesa (libera o alerta no painel)
           await deleteDoc(doc(db, 'tables', tableId.toString()));
           
           // 2. Busca TODOS os pedidos ativos (sem filtro no banco para evitar erro de índice)
           const querySnapshot = await getDocs(collection(db, 'orders'));
           
           // 3. Filtro MANUAL no código com conversão de tipos (String vs Number)
           const tableOrders = querySnapshot.docs.filter(d => {
               const data = d.data();
               // A mágica: Converte tudo para string antes de comparar
               // Isso resolve o problema de '1' !== 1
               return String(data.tableId) === String(tableId);
           });

           console.log(`Encontrados ${tableOrders.length} pedidos para arquivar.`);

           if (tableOrders.length === 0) {
               alert(`Mesa ${tableId} fechada. (AVISO: Não encontrei pedidos ativos para arquivar).`);
               return;
           }

           const batch = writeBatch(db);

           tableOrders.forEach((docSnap) => {
               const data = docSnap.data();
               
               // A. Cria uma cópia na coleção 'orders_history' (DADOS FRIOS)
               // Isso garante que o relatório financeiro tenha os dados
               const historyRef = doc(db, 'orders_history', docSnap.id);
               batch.set(historyRef, { 
                   ...data, 
                   status: OrderStatus.PAID,
                   archivedAt: Date.now() 
               });

               // B. Deleta da coleção 'orders' (DADOS QUENTES)
               // Isso garante que o celular NUNCA MAIS veja esses pedidos
               batch.delete(docSnap.ref);
           });

           await batch.commit();
           console.log(`Sucesso: ${tableOrders.length} pedidos arquivados.`);
           alert(`Mesa ${tableId} fechada! ${tableOrders.length} pedidos foram arquivados e contabilizados.`);

       } catch (error: any) {
           console.error("Erro fatal ao fechar mesa:", error);
           alert(`Erro ao fechar mesa: ${error.message}`);
       }

    } else {
      // Lógica Local
      const tables = JSON.parse(safeStorage.getItem(STORAGE_KEYS.TABLES) || '{}');
      delete tables[tableId];
      safeStorage.setItem(STORAGE_KEYS.TABLES, JSON.stringify(tables));
      
      const orders = JSON.parse(safeStorage.getItem(STORAGE_KEYS.ORDERS) || '[]');
      const updatedOrders = orders.map((o: Order) => {
          // eslint-disable-next-line eqeqeq
          if (o.tableId == tableId && o.status !== OrderStatus.CANCELED) {
              return { ...o, status: OrderStatus.PAID };
          }
          return o;
      });
      safeStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(updatedOrders));
    }
  },

  // --- Função para limpar mesa à força (apaga sem arquivar) em caso de erro ---
  forceClearTable: async (tableId: number) => {
      if (isCloud()) {
          try {
             await deleteDoc(doc(db, 'tables', tableId.toString()));
             const querySnapshot = await getDocs(collection(db, 'orders'));
             const tableOrders = querySnapshot.docs.filter(d => String(d.data().tableId) === String(tableId));
             
             const batch = writeBatch(db);
             tableOrders.forEach(d => batch.delete(d.ref));
             await batch.commit();
          } catch(e) { console.error(e); }
      }
  },
  
  getSalesHistory: async (startDate: Date, endDate: Date): Promise<Order[]> => {
      if(isCloud()) {
          // Busca histórico da coleção orders_history (Onde os dados pagos moram agora)
          const snapshot = await getDocs(collection(db, 'orders_history'));
          const history = snapshot.docs.map(d => ({id: d.id, ...d.data()} as Order));
          
          return history.filter(o => {
              const d = new Date(o.timestamp);
              return d >= startDate && d <= endDate;
          });
      } else {
          const stored = safeStorage.getItem(STORAGE_KEYS.ORDERS);
          const allOrders = stored ? JSON.parse(stored) : [];
          return allOrders.filter((o: Order) => {
              const d = new Date(o.timestamp);
              return o.status === OrderStatus.PAID && d >= startDate && d <= endDate;
          });
      }
  },

  getOrdersOnce: async (): Promise<Order[]> => {
      if(isCloud()) {
          const snapshot = await getDocs(collection(db, 'orders'));
          return snapshot.docs.map(d => ({id: d.id, ...d.data()} as Order));
      } else {
          const stored = safeStorage.getItem(STORAGE_KEYS.ORDERS);
          return stored ? JSON.parse(stored) : [];
      }
  },

  runDiagnostics: async () => {
    if (isCloud()) {
        try {
            const q = query(collection(db, 'products'), limit(1));
            await getDocs(q);
            alert("Conexão com Banco de Dados (Firebase) está OK!");
        } catch (e: any) {
            alert(`Erro ao conectar com Firebase: ${e.message}`);
        }
    } else {
        alert("Modo Local (Offline)");
    }
  }
};

StorageService.init();
