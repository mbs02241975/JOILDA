
import { Product, Category, Order, TableSession, TableStatus, OrderStatus } from '../types';
import { initializeApp, getApps, getApp } from 'firebase/app';
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
    // 0. Prevenção de duplicidade (Crítico para Mobile/React)
    // Se já existe uma instância do Firebase rodando, reutiliza ela.
    if (getApps().length > 0) {
        console.log("Firebase já inicializado. Reutilizando conexão.");
        try {
            const app = getApp();
            db = getFirestore(app);
            return true;
        } catch (e) {
            console.warn("Erro ao recuperar app existente, tentando reiniciar...");
        }
    }

    // 1. Prioridade Absoluta: Configuração Hardcoded (firebaseConfig.ts)
    // Isso garante que celulares sempre conectem, ignorando cache antigo ou localStorage
    if (firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('COLAR_')) {
        console.log("Inicializando conexão com credenciais fixas.");
        config = firebaseConfig;
    } 
    // 2. Fallback: LocalStorage (apenas se não tiver config fixa, o que é raro agora)
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
        // Se der erro de duplicidade por condição de corrida, recupera a instância
        if (error.code === 'app/duplicate-app') {
            const app = getApp();
            db = getFirestore(app);
            return true;
        }
        console.error("Falha ao conectar Firebase", error);
        return false;
      }
    }
    console.warn("Nenhuma configuração válida encontrada. Iniciando em modo OFFLINE (Local).");
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
          console.error("Erro ao assinar produtos:", error);
          if (error.code === 'permission-denied') {
              alert("ERRO NO CELULAR: Permissão negada pelo banco de dados. O Administrador precisa liberar o acesso no painel do Firebase (Regras).");
          }
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
          // Lógica Corrigida: Se o ID existe e não é vazio, é atualização.
          if (product.id && product.id.length > 0) { 
            const docRef = doc(db, 'products', product.id);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id, ...data } = product;
            await updateDoc(docRef, data);
            console.log("Produto atualizado com sucesso");
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
                    price: product.price,
                    description: product.description,
                    imageUrl: product.imageUrl || currentData.imageUrl
                });
                console.log(`Estoque atualizado para ${product.name}`);
            } else {
                // Não existe, cria novo (Firestore gera o ID)
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { id, ...data } = product; // Remove o ID vazio se existir
                await addDoc(collection(db, 'products'), data);
                console.log("Novo produto criado");
            }
          }
      } catch (error: any) {
          console.error("Erro no Firebase:", error);
          if (error.code === 'permission-denied') {
             alert('ERRO DE PERMISSÃO: O banco de dados está bloqueado. Vá no console do Firebase > Firestore Database > Regras e altere para "allow read, write: if true;"');
          } else if (error.code === 'resource-exhausted') {
              alert('A imagem é muito pesada para o banco gratuito. Tente usar o campo de Link (URL) em vez da câmera.');
          } else {
              alert(`Erro ao salvar: ${error.message}`);
          }
          throw error;
      }
    } else {
      // Modo Local
      const products = JSON.parse(safeStorage.getItem(STORAGE_KEYS.PRODUCTS) || '[]');
      const existingIndex = products.findIndex((p: Product) => p.id === product.id);
      
      const nameIndex = products.findIndex((p: Product) => p.name === product.name && p.id !== product.id);

      // Se é um produto novo sem ID (ou ID temp), gera um ID
      if (!product.id || product.id.length < 5) {
          product.id = 'local_' + Date.now();
      }

      try {
          if (existingIndex >= 0) {
            products[existingIndex] = product;
          } else if (nameIndex >= 0) {
             products[nameIndex].stock += product.stock;
             products[nameIndex].price = product.price;
             products[nameIndex].imageUrl = product.imageUrl || products[nameIndex].imageUrl;
          } else {
            products.push(product);
          }
          safeStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
      } catch (e) {
          alert('Memória do navegador cheia! Não foi possível salvar a imagem.');
      }
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
       // 1. Remove status de fechamento da mesa
       await deleteDoc(doc(db, 'tables', tableId.toString()));
       
       // 2. Busca todos os pedidos ativos dessa mesa para arquivar
       // CORREÇÃO: Busca tanto pelo número quanto pela string para garantir que acha tudo
       const q1 = query(collection(db, 'orders'), where('tableId', '==', tableId));
       const q2 = query(collection(db, 'orders'), where('tableId', '==', tableId.toString()));
       
       const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
       
       const updatePromises: Promise<void>[] = [];
       const docsProcessed = new Set();

       const processDoc = (d: any) => {
         if (docsProcessed.has(d.id)) return;
         docsProcessed.add(d.id);

         const data = d.data();
         if (data.status !== OrderStatus.CANCELED && data.status !== OrderStatus.PAID) {
            updatePromises.push(updateDoc(d.ref, { status: OrderStatus.PAID }));
         }
       };

       snap1.forEach(processDoc);
       snap2.forEach(processDoc);

       // Aguarda TODOS os pedidos serem atualizados antes de liberar
       await Promise.all(updatePromises);
       console.log(`Mesa ${tableId} finalizada. ${updatePromises.length} pedidos arquivados.`);

    } else {
      const tables = JSON.parse(safeStorage.getItem(STORAGE_KEYS.TABLES) || '{}');
      delete tables[tableId];
      safeStorage.setItem(STORAGE_KEYS.TABLES, JSON.stringify(tables));
      
      // Modo Local: Marca pedidos como pagos
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
            if (e.code === 'permission-denied') {
                alert("ERRO CRÍTICO: Permissão Negada. Verifique as 'Regras' do Firestore no console do Google.");
            } else {
                alert(`Erro ao conectar com Firebase: ${e.message}`);
            }
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

// --- AUTO-INITIALIZE ---
// Tenta conectar imediatamente usando as chaves fixas
StorageService.init();
