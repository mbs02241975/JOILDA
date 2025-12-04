
import React, { useState, useEffect, useRef } from 'react';
import { Order, OrderStatus, Product, Category, TableStatus, PaymentMethod } from '../../types';
import { StorageService, DatabaseConfig } from '../../services/storageService';
import { GeminiService } from '../../services/geminiService';

// --- Sound System using Web Audio API ---
type SoundType = 'classic' | 'modern' | 'digital' | 'alert' | 'mute';

const SoundManager = {
  play: (type: SoundType) => {
    if (type === 'mute') return;
    
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;

    const createOscillator = (freq: number, type: OscillatorType, startTime: number, duration: number, volume: number = 0.1) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(startTime);
      gain.gain.setValueAtTime(volume, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.stop(startTime + duration);
    };

    switch (type) {
      case 'classic': // Ding-Dong
        createOscillator(600, 'sine', now, 0.6);
        createOscillator(450, 'sine', now + 0.4, 0.8);
        break;
      case 'modern': // Soft Chime
        createOscillator(800, 'triangle', now, 0.3, 0.05);
        createOscillator(1200, 'sine', now + 0.1, 0.6, 0.05);
        break;
      case 'digital': // 8-bit Beep
        createOscillator(880, 'square', now, 0.1, 0.05);
        createOscillator(1760, 'square', now + 0.1, 0.1, 0.05);
        break;
      case 'alert': // Urgent
        createOscillator(400, 'sawtooth', now, 0.2, 0.05);
        createOscillator(400, 'sawtooth', now + 0.2, 0.2, 0.05);
        createOscillator(400, 'sawtooth', now + 0.4, 0.2, 0.05);
        break;
    }
  }
};

export const AdminDashboard: React.FC = () => {
  // --- Auth State ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState(false);

  const [activeTab, setActiveTab] = useState<'orders' | 'inventory' | 'reports' | 'qrcodes' | 'database'>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tables, setTables] = useState<{[key: string]: any}>({});
  
  // Inventory Edit State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // QR Code State
  const [qrTableId, setQrTableId] = useState<number>(1);
  const [baseUrl, setBaseUrl] = useState<string>('');

  // Reports State
  const [aiReport, setAiReport] = useState<string>('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  
  // Inicializa datas com o fuso local para evitar problemas de UTC
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-CA'); // YYYY-MM-DD local
  const [reportStartDate, setReportStartDate] = useState(dateStr);
  const [reportEndDate, setReportEndDate] = useState(dateStr);
  const [financialStats, setFinancialStats] = useState({ totalRevenue: 0, orderCount: 0, averageTicket: 0 });

  // Notification State
  const [selectedSound, setSelectedSound] = useState<SoundType>('classic');
  const [lastOrderCount, setLastOrderCount] = useState(0);
  const [notification, setNotification] = useState<{message: string, visible: boolean}>({ message: '', visible: false });
  
  // Database Config State
  const [dbConfig, setDbConfig] = useState<DatabaseConfig>({
      apiKey: '', authDomain: '', projectId: '', storageBucket: '', messagingSenderId: '', appId: ''
  });

  // To prevent sound playing on first load
  const firstLoadRef = useRef(true);

  // Initialize Base URL & Check Session Auth
  useEffect(() => {
    if (typeof window !== 'undefined') {
       const url = window.location.origin + window.location.pathname;
       setBaseUrl(url.endsWith('/') ? url.slice(0, -1) : url);
       
       // Check session storage for existing login
       if (sessionStorage.getItem('admin_auth') === 'true') {
           setIsAuthenticated(true);
       }
    }
  }, []);

  // Real-time Subscriptions (Only if authenticated)
  useEffect(() => {
    if (!isAuthenticated) return;

    // Products
    const unsubProducts = StorageService.subscribeProducts(setProducts);
    
    // Tables
    const unsubTables = StorageService.subscribeTables((data) => {
        setTables(data);
    });

    // Orders & Notifications Logic
    const unsubOrders = StorageService.subscribeOrders((newOrders) => {
        const sorted = newOrders.sort((a, b) => b.timestamp - a.timestamp);
        setOrders(sorted);

        const pendingOrders = sorted.filter(o => o.status === OrderStatus.PENDING);
        const pendingCount = pendingOrders.length;

        if (!firstLoadRef.current && pendingCount > lastOrderCount) {
            SoundManager.play(selectedSound);
            const diff = pendingCount - lastOrderCount;
            if (diff > 0) {
                setNotification({
                    message: `🔔 ${diff} Novo(s) Pedido(s)!`,
                    visible: true
                });
                setTimeout(() => setNotification(prev => ({ ...prev, visible: false })), 5000);
            }
        }

        if (firstLoadRef.current) firstLoadRef.current = false;
        setLastOrderCount(pendingCount);
    });

    return () => {
        unsubProducts();
        unsubTables();
        unsubOrders();
    };
  }, [selectedSound, lastOrderCount, isAuthenticated]);

  // Carregar dados financeiros quando a aba ou datas mudam
  useEffect(() => {
    if (isAuthenticated && activeTab === 'reports') {
        loadFinancialData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, activeTab, reportStartDate, reportEndDate]);

  const loadFinancialData = async () => {
      // CORREÇÃO DE FUSO HORÁRIO:
      // Ao criar Date a partir de string "YYYY-MM-DD", o JS assume UTC.
      // Adicionamos o horário T00:00:00 para forçar a interpretação como hora LOCAL do navegador.
      const start = new Date(reportStartDate + 'T00:00:00');
      const end = new Date(reportEndDate + 'T23:59:59.999');

      // Busca na coleção de histórico (orders_history) - DADOS FRIOS
      const historyOrders = await StorageService.getSalesHistory(start, end);
      
      const totalRevenue = historyOrders.reduce((acc, o) => acc + o.total, 0);
      const orderCount = historyOrders.length;
      
      setFinancialStats({
          totalRevenue,
          orderCount,
          averageTicket: orderCount ? totalRevenue / orderCount : 0
      });
  };

  const handleLogin = (e: React.FormEvent) => {
      e.preventDefault();
      // Simple hardcoded PIN for demo purposes
      if (passwordInput === '1234') {
          setIsAuthenticated(true);
          sessionStorage.setItem('admin_auth', 'true');
          setLoginError(false);
      } else {
          setLoginError(true);
          setPasswordInput('');
      }
  };

  const handleLogout = () => {
      setIsAuthenticated(false);
      sessionStorage.removeItem('admin_auth');
  };

  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    await StorageService.updateOrderStatus(orderId, newStatus);
  };

  const handleCloseTable = async (tableId: number) => {
    if (window.confirm(`Confirma o recebimento e fechamento da Mesa ${tableId}?`)) {
      await StorageService.finalizeTable(tableId);
      // Recarrega dados financeiros para refletir o fechamento
      setTimeout(() => loadFinancialData(), 1000);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProduct) {
      try {
        await StorageService.saveProduct(editingProduct);
        setIsEditModalOpen(false);
        setEditingProduct(null);
      } catch (error: any) {
        console.error(error);
        // Error handling is done in storageService, but we catch here to prevent crash
      }
    }
  };

  // --- Image Handling ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && editingProduct) {
      setIsProcessingImage(true);
      const file = e.target.files[0];
      const reader = new FileReader();
      
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Resize Logic using Canvas - EXTREME AGGRESSIVE RESIZE for Free Tier
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 250; // 250px ensures very small file size
          
          let width = img.width;
          let height = img.height;

          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Compress to JPEG 40% quality
          const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
          
          setEditingProduct({ ...editingProduct, imageUrl: dataUrl });
          setIsProcessingImage(false);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Receipt Printing ---
  const printReceipt = (tableId: number, ordersToPrint: Order[]) => {
    const tableOrders = ordersToPrint.filter(o => o.status !== OrderStatus.CANCELED);
    const total = tableOrders.reduce((acc, o) => acc + o.total, 0);
    const date = new Date().toLocaleString('pt-BR');
    
    // Aggregate items
    const itemsMap = new Map<string, {name: string, qty: number, price: number, total: number}>();
    tableOrders.forEach(order => {
      order.items.forEach(item => {
        const existing = itemsMap.get(item.productId);
        if (existing) {
          existing.qty += item.quantity;
          existing.total += item.price * item.quantity;
        } else {
          itemsMap.set(item.productId, {
            name: item.name,
            qty: item.quantity,
            price: item.price,
            total: item.price * item.quantity
          });
        }
      });
    });

    const printWindow = window.open('', '', 'width=400,height=600');
    if (printWindow) {
      printWindow.document.write(`
        <html>
        <head>
          <title>Cupom Mesa ${tableId}</title>
          <style>
            body { font-family: 'Courier New', monospace; padding: 20px; width: 300px; margin: 0 auto; }
            .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
            .item { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 12px; }
            .total { border-top: 1px dashed #000; margin-top: 10px; padding-top: 10px; font-weight: bold; font-size: 14px; text-align: right; }
            .footer { text-align: center; font-size: 10px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="header">
            <strong>BARRACA DE PRAIA<br/>ENTRE FAMÍLIA</strong><br/>
            ----------------<br/>
            FECHAMENTO DE CONTA<br/>
            MESA: ${tableId}<br/>
            ${date}
          </div>
          <div>
            ${Array.from(itemsMap.values()).map(item => `
              <div class="item">
                <span>${item.qty}x ${item.name}</span>
                <span>${item.total.toFixed(2)}</span>
              </div>
            `).join('')}
          </div>
          <div class="total">
            TOTAL: R$ ${total.toFixed(2)}
          </div>
          <div class="footer">
            Obrigado pela preferência!<br/>
            Volte Sempre.
          </div>
        </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    }
  };

  const generateAiReport = async () => {
    setIsLoadingAi(true);
    // Fetch historical orders for report
    // Correção de Fuso para o relatório IA também
    const start = new Date(reportStartDate + 'T00:00:00');
    const end = new Date(reportEndDate + 'T23:59:59.999');
    
    const historyOrders = await StorageService.getSalesHistory(start, end);

    const salesData = historyOrders.map(o => ({
      items: o.items.map(i => ({ name: i.name, qty: i.quantity })),
      total: o.total,
      date: new Date(o.timestamp).toLocaleDateString()
    }));
    
    if (salesData.length === 0) {
        setAiReport("Não há dados de vendas (pedidos finalizados) para o período selecionado.");
        setIsLoadingAi(false);
        return;
    }

    const report = await GeminiService.generateDailyReport(salesData);
    setAiReport(report);
    setIsLoadingAi(false);
  };

  const handleSaveDbConfig = (e: React.FormEvent) => {
      e.preventDefault();
      StorageService.saveConfig(dbConfig);
      alert("Configuração Salva! O sistema tentará conectar ao Firebase.");
      window.location.reload();
  };

  const getQrCodeLink = () => {
    let cleanBase = baseUrl.trim();
    if (!cleanBase.startsWith('http://') && !cleanBase.startsWith('https://')) {
        cleanBase = 'http://' + cleanBase;
    }
    cleanBase = cleanBase.endsWith('/') ? cleanBase.slice(0, -1) : cleanBase;
    return `${cleanBase}/#/client?table=${qrTableId}`;
  };

  const getQrCodeImageUrl = () => {
    const data = getQrCodeLink();
    return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(data)}`;
  };

  const printQrCode = () => {
    const qrUrl = getQrCodeImageUrl();
    const linkUrl = getQrCodeLink();

    const printWindow = window.open('', '', 'width=800,height=600');

    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Mesa ${qrTableId} - QR Code</title>
            <style>
              @page { size: A4; margin: 0; }
              @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
              body {
                margin: 0;
                padding: 0;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                background: white;
              }
              .page-container {
                width: 210mm;
                height: 297mm;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                border: 1px dotted #eee;
              }
              .card {
                border: 4px solid #333;
                border-radius: 30px;
                padding: 50px;
                text-align: center;
                width: 80%;
                max-width: 600px;
                background: white;
              }
              h1 { 
                margin: 0 0 10px 0; 
                font-size: 36px; 
                color: #222; 
                text-transform: uppercase; 
                letter-spacing: 1px;
                line-height: 1.2;
              }
              .subtitle {
                font-size: 20px;
                color: #666;
                margin-bottom: 30px;
              }
              .badge {
                background-color: #ff7043;
                color: white;
                font-size: 64px;
                font-weight: 800;
                padding: 15px 60px;
                border-radius: 60px;
                margin: 0 auto 30px auto;
                display: inline-block;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
              }
              .qr-box {
                border: 3px solid #00acc1;
                padding: 20px;
                display: inline-block;
                border-radius: 20px;
                margin-bottom: 30px;
                background: white;
              }
              img { width: 350px; height: 350px; display: block; }
              p { font-size: 26px; color: #444; margin: 10px 0; line-height: 1.5; font-weight: 500; }
              .footer { font-size: 16px; color: #999; margin-top: 40px; font-family: monospace; }
            </style>
          </head>
          <body>
            <div class="page-container">
              <div class="card">
                <h1>Barraca de Praia<br/>entre Família</h1>
                <div class="subtitle">Cardápio Digital</div>
                
                <div class="badge">MESA ${qrTableId}</div>
                
                <div class="qr-box">
                  <img src="${qrUrl}" alt="QR Code" />
                </div>
                
                <p>Aponte a câmera do seu celular<br/>para realizar seu pedido.</p>
                
                <div class="footer">
                  ${linkUrl}
                </div>
              </div>
            </div>
            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.print();
                  window.close();
                }, 800);
              }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  // Active orders shouldn't show PAID (archived) orders
  // Agora que movemos os pagos para outra coleção, o array 'orders' só tem ativos
  const activeOrders = orders.filter(o => o.status !== OrderStatus.CANCELED);
  const isLocalhost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');

  // --- Auth Gate ---
  if (!isAuthenticated) {
      return (
          <div className="min-h-screen bg-brand-light flex items-center justify-center p-4">
              <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm text-center">
                  <div className="w-16 h-16 bg-brand-dark text-white rounded-full flex items-center justify-center text-2xl mx-auto mb-4">
                      <i className="fas fa-lock"></i>
                  </div>
                  <h2 className="text-xl font-bold text-gray-800 mb-2">Acesso Restrito</h2>
                  <p className="text-gray-500 text-sm mb-6">Área exclusiva para administração.</p>
                  
                  <form onSubmit={handleLogin} className="space-y-4">
                      <div>
                          <input 
                              type="password" 
                              value={passwordInput}
                              onChange={(e) => setPasswordInput(e.target.value)}
                              placeholder="Digite a senha (1234)"
                              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-center text-lg tracking-widest focus:ring-brand focus:border-brand"
                              autoFocus
                          />
                      </div>
                      
                      {loginError && (
                          <div className="text-red-500 text-sm font-medium animate-pulse">
                              Senha incorreta. Tente novamente.
                          </div>
                      )}

                      <button 
                          type="submit"
                          className="w-full bg-brand text-white py-3 rounded-lg font-bold hover:bg-brand-dark transition shadow-lg"
                      >
                          Entrar
                      </button>
                      
                      <button 
                          type="button"
                          onClick={() => window.location.hash = ''}
                          className="text-gray-400 hover:text-gray-600 text-sm mt-4 block mx-auto"
                      >
                          Voltar ao Início
                      </button>
                  </form>
              </div>
          </div>
      );
  }

  // --- Main Dashboard ---
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row">
      {/* Global Notification Toast */}
      {notification.visible && (
        <div className="fixed top-4 right-4 z-50 bg-brand-orange text-white px-6 py-4 rounded-lg shadow-2xl flex items-center gap-4 animate-bounce">
          <i className="fas fa-bell text-2xl animate-swing"></i>
          <div>
            <h4 className="font-bold text-lg">Atenção!</h4>
            <p>{notification.message}</p>
          </div>
          <button onClick={() => setNotification(prev => ({...prev, visible: false}))} className="text-white/80 hover:text-white">
            <i className="fas fa-times"></i>
          </button>
        </div>
      )}

      {/* Sidebar */}
      <aside className="bg-brand-dark text-white w-full md:w-64 flex-shrink-0 p-4 flex flex-col">
        <div className="flex-1">
            <h1 className="text-2xl font-bold mb-8"><i className="fas fa-umbrella-beach mr-2"></i>Admin</h1>
            <nav className="space-y-2">
            <button 
                onClick={() => setActiveTab('orders')}
                className={`w-full text-left p-3 rounded transition ${activeTab === 'orders' ? 'bg-brand' : 'hover:bg-white/10'}`}
            >
                <i className="fas fa-clipboard-list w-6"></i> Pedidos
            </button>
            <button 
                onClick={() => setActiveTab('inventory')}
                className={`w-full text-left p-3 rounded transition ${activeTab === 'inventory' ? 'bg-brand' : 'hover:bg-white/10'}`}
            >
                <i className="fas fa-boxes w-6"></i> Estoque
            </button>
            <button 
                onClick={() => setActiveTab('reports')}
                className={`w-full text-left p-3 rounded transition ${activeTab === 'reports' ? 'bg-brand' : 'hover:bg-white/10'}`}
            >
                <i className="fas fa-chart-line w-6"></i> Finanças
            </button>
            <button 
                onClick={() => setActiveTab('qrcodes')}
                className={`w-full text-left p-3 rounded transition ${activeTab === 'qrcodes' ? 'bg-brand' : 'hover:bg-white/10'}`}
            >
                <i className="fas fa-qrcode w-6"></i> QR Mesas
            </button>
            <button 
                onClick={() => setActiveTab('database')}
                className={`w-full text-left p-3 rounded transition ${activeTab === 'database' ? 'bg-brand' : 'hover:bg-white/10'}`}
            >
                <i className="fas fa-database w-6"></i> Banco de Dados
            </button>
            </nav>
        </div>
        
        <div className="pt-4 border-t border-white/10 space-y-4">
            <button 
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 bg-red-500/20 text-red-100 hover:bg-red-500 hover:text-white p-2 rounded transition text-sm"
            >
                <i className="fas fa-sign-out-alt"></i> Sair do Painel
            </button>
            <div className="text-xs text-white/50">
                Status: {StorageService.isUsingCloud() ? <span className="text-green-400 font-bold">● Online (Firebase)</span> : <span className="text-yellow-400 font-bold">● Local (Demo)</span>}
                <div className="mt-2 text-[10px] opacity-70">
                    Dev: Máximo Batista
                </div>
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-auto h-screen">
        {activeTab === 'orders' && (
          <div className="space-y-6 pb-10">
            {/* Notification Settings Bar */}
            <div className="bg-white p-4 rounded shadow-sm flex flex-wrap items-center justify-between gap-4 border-l-4 border-brand">
              <div className="flex items-center gap-2">
                 <span className="font-bold text-gray-700"><i className="fas fa-volume-up mr-2"></i>Alerta Sonoro:</span>
                 <select 
                    value={selectedSound}
                    onChange={(e) => setSelectedSound(e.target.value as SoundType)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                 >
                   <option value="classic">Clássico (Ding-Dong)</option>
                   <option value="modern">Moderno (Suave)</option>
                   <option value="digital">Digital (Beep)</option>
                   <option value="alert">Alerta (Urgente)</option>
                   <option value="mute">Mudo</option>
                 </select>
                 <button 
                   onClick={() => SoundManager.play(selectedSound)}
                   className="bg-gray-200 hover:bg-gray-300 text-gray-600 px-2 py-1 rounded text-xs"
                   title="Testar Som"
                 >
                   <i className="fas fa-play"></i>
                 </button>
              </div>
              <div className="text-xs text-gray-500">
                Sistema em tempo real. Pedidos aparecem instantaneamente.
              </div>
            </div>

            {/* Active Tables needing attention */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(tables)
                .filter(([_, t]: [string, any]) => t.status === TableStatus.CLOSING_REQUESTED)
                .map(([id, t]: [string, any]) => {
                  const realTableId = parseInt(id);
                  const tableOrders = orders.filter(o => o.tableId === realTableId && o.status !== OrderStatus.CANCELED && o.status !== OrderStatus.PAID);
                  const totalConsumption = tableOrders.reduce((acc, o) => acc + o.total, 0);

                  return (
                    <div key={id} className="bg-red-50 border border-red-200 p-4 rounded-lg shadow-md animate-pulse">
                        <div className="flex justify-between items-start mb-2">
                            <h3 className="font-bold text-red-800 text-lg"><i className="fas fa-receipt mr-2"></i>Mesa {realTableId}</h3>
                            <span className="bg-red-200 text-red-800 text-xs px-2 py-1 rounded font-bold">FECHAMENTO</span>
                        </div>
                        
                        <div className="mb-4 text-sm text-gray-700 bg-white p-2 rounded border border-red-100">
                            <p><strong>Forma Pagto:</strong> {t.paymentMethod}</p>
                            <p><strong>Total Consumido:</strong> R$ {totalConsumption.toFixed(2)}</p>
                        </div>

                        <div className="flex gap-2">
                          <button 
                            onClick={() => printReceipt(realTableId, tableOrders)}
                            className="flex-1 bg-gray-700 text-white px-3 py-2 rounded text-sm hover:bg-gray-900"
                            title="Imprimir Cupom"
                          >
                            <i className="fas fa-print mr-1"></i> Imprimir
                          </button>
                          <button 
                            onClick={() => handleCloseTable(realTableId)}
                            className="flex-1 bg-red-600 text-white px-3 py-2 rounded text-sm hover:bg-red-700 font-bold"
                          >
                            <i className="fas fa-check mr-1"></i> Receber
                          </button>
                        </div>
                    </div>
                  );
              })}
            </div>

            <h2 className="text-xl font-bold text-gray-800 border-b pb-2">Pedidos Ativos</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {activeOrders.length === 0 && <p className="text-gray-500">Sem pedidos pendentes.</p>}
              {activeOrders.map(order => (
                <div key={order.id} className={`bg-white p-4 rounded shadow-sm border-l-4 relative overflow-hidden transition-all ${order.status === OrderStatus.PENDING ? 'border-yellow-400 ring-2 ring-yellow-100' : 'border-blue-400'}`}>
                  {/* New Badge */}
                  {order.status === OrderStatus.PENDING && (
                    <div className="absolute top-0 right-0 bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded-bl">Novo</div>
                  )}
                  
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-lg">Mesa {order.tableId}</span>
                    <span className="text-xs text-gray-400">{new Date(order.timestamp).toLocaleTimeString()}</span>
                  </div>
                  {order.observation && (
                      <div className="bg-yellow-50 text-yellow-800 text-sm p-2 rounded mb-2 border border-yellow-100">
                          <i className="fas fa-comment-alt mr-1"></i> <strong>Obs:</strong> {order.observation}
                      </div>
                  )}
                  <ul className="space-y-1 mb-4">
                    {order.items.map((item, idx) => (
                      <li key={idx} className="flex justify-between text-sm">
                        <span>{item.quantity}x {item.name}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2 mt-2">
                    {order.status === OrderStatus.PENDING && (
                      <button 
                        onClick={() => handleStatusChange(order.id, OrderStatus.PREPARING)}
                        className="flex-1 bg-blue-500 text-white py-1 rounded hover:bg-blue-600"
                      >
                        Preparar
                      </button>
                    )}
                    {order.status === OrderStatus.PREPARING && (
                      <button 
                        onClick={() => handleStatusChange(order.id, OrderStatus.DELIVERED)}
                        className="flex-1 bg-green-500 text-white py-1 rounded hover:bg-green-600"
                      >
                        Entregar
                      </button>
                    )}
                    <button 
                      onClick={() => handleStatusChange(order.id, OrderStatus.CANCELED)}
                      className="px-3 py-1 border border-red-300 text-red-500 rounded hover:bg-red-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'inventory' && (
          <div className="bg-white rounded shadow p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Controle de Estoque</h2>
              <button 
                onClick={() => {
                  setEditingProduct({
                    id: '', // Empty ID tells StorageService to CREATE NEW
                    name: '', description: '', price: 0,
                    stock: 0, category: Category.BEBIDAS,
                    imageUrl: ''
                  });
                  setIsEditModalOpen(true);
                }}
                className="bg-brand text-white px-4 py-2 rounded hover:bg-brand-dark"
              >
                <i className="fas fa-plus mr-2"></i> Novo Produto
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="p-3">Img</th>
                    <th className="p-3">Produto</th>
                    <th className="p-3">Categoria</th>
                    <th className="p-3 text-right">Preço</th>
                    <th className="p-3 text-center">Estoque</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <img src={p.imageUrl || 'https://via.placeholder.com/40'} alt="img" className="w-10 h-10 object-cover rounded bg-gray-100" />
                      </td>
                      <td className="p-3 font-medium">{p.name}</td>
                      <td className="p-3"><span className="bg-gray-100 px-2 py-1 rounded text-xs">{p.category}</span></td>
                      <td className="p-3 text-right">R$ {p.price.toFixed(2)}</td>
                      <td className={`p-3 text-center font-bold ${p.stock === 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {p.stock}
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <button 
                          onClick={() => { setEditingProduct(p); setIsEditModalOpen(true); }}
                          className="text-blue-500 hover:text-blue-700"
                        >
                          <i className="fas fa-edit"></i>
                        </button>
                        <button 
                          onClick={async () => { if(window.confirm('Excluir?')) { await StorageService.deleteProduct(p.id); } }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-6">
            
            {/* Financial Report Section */}
            <div className="bg-white p-6 rounded shadow border-l-4 border-green-500">
               <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
                 <h2 className="text-xl font-bold text-gray-800"><i className="fas fa-cash-register mr-2"></i>Relatório Financeiro</h2>
                 
                 <div className="flex gap-2 items-center mt-2 md:mt-0 bg-gray-50 p-2 rounded">
                    <span className="text-sm text-gray-600">Período:</span>
                    <input 
                      type="date" 
                      value={reportStartDate} 
                      onChange={(e) => setReportStartDate(e.target.value)}
                      className="border rounded px-2 py-1 text-sm"
                    />
                    <span className="text-gray-400">até</span>
                    <input 
                      type="date" 
                      value={reportEndDate} 
                      onChange={(e) => setReportEndDate(e.target.value)}
                      className="border rounded px-2 py-1 text-sm"
                    />
                    <button 
                       onClick={loadFinancialData} 
                       className="bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded text-gray-600"
                       title="Atualizar Dados"
                    >
                        <i className="fas fa-sync-alt"></i>
                    </button>
                 </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="bg-green-50 p-4 rounded-lg border border-green-100 text-center">
                     <div className="text-sm text-green-600 mb-1">Faturamento Total</div>
                     <div className="text-3xl font-bold text-green-800">R$ {financialStats.totalRevenue.toFixed(2)}</div>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-center">
                     <div className="text-sm text-blue-600 mb-1">Pedidos Finalizados</div>
                     <div className="text-3xl font-bold text-blue-800">{financialStats.orderCount}</div>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 text-center">
                     <div className="text-sm text-purple-600 mb-1">Ticket Médio</div>
                     <div className="text-3xl font-bold text-purple-800">R$ {financialStats.averageTicket.toFixed(2)}</div>
                  </div>
               </div>
            </div>

            <div className="bg-white p-6 rounded shadow">
              <h2 className="text-xl font-bold mb-4">Análise Inteligente (IA)</h2>
              <p className="text-gray-600 mb-4 text-sm">O Gemini analisa o desempenho e sugere melhorias baseadas nos dados do dia.</p>
              
              {!aiReport && (
                <button 
                  onClick={generateAiReport}
                  disabled={isLoadingAi}
                  className="bg-purple-600 text-white px-6 py-3 rounded-lg shadow hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {isLoadingAi ? (
                    <><i className="fas fa-spinner fa-spin"></i> Analisando...</>
                  ) : (
                    <><i className="fas fa-magic"></i> Gerar Análise</>
                  )}
                </button>
              )}

              {aiReport && (
                <div className="mt-6 bg-purple-50 border border-purple-100 p-6 rounded-lg prose max-w-none">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-purple-900 font-bold text-lg"><i className="fas fa-robot mr-2"></i>Análise do Gemini</h3>
                    <button onClick={() => setAiReport('')} className="text-gray-400 hover:text-gray-600 text-sm">Limpar</button>
                  </div>
                  <div className="whitespace-pre-wrap text-gray-800 leading-relaxed text-sm">
                    {aiReport}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'qrcodes' && (
          <div className="bg-white rounded shadow p-6 h-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Gerador de QR Code</h2>
            </div>
            
            <div className="flex flex-col lg:flex-row gap-8 h-full items-start">
              {/* Left Column: Settings */}
              <div className="w-full lg:w-1/2 space-y-6">
                
                <div className="bg-white p-5 border rounded-lg shadow-sm">
                    <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                        <i className="fas fa-network-wired text-brand"></i> Configuração de Acesso
                    </h3>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Endereço do Servidor (URL Base):</label>
                            <div className="flex gap-2">
                            <input 
                                type="text" 
                                value={baseUrl}
                                onChange={(e) => setBaseUrl(e.target.value)}
                                className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-brand focus:border-brand bg-gray-50 font-mono text-sm"
                                placeholder="Ex: 192.168.0.10:3000"
                            />
                            <button 
                                onClick={() => setBaseUrl(window.location.origin + window.location.pathname)}
                                className="bg-gray-200 px-3 py-2 rounded hover:bg-gray-300 text-gray-600"
                                title="Resetar para endereço atual"
                            >
                                <i className="fas fa-undo"></i>
                            </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Este é o link que será gravado no QR Code.
                            </p>
                        </div>

                        {isLocalhost && (
                        <div className="bg-orange-50 border-l-4 border-orange-400 p-4 text-sm">
                            <div className="flex items-start">
                                <div className="flex-shrink-0">
                                    <i className="fas fa-exclamation-triangle text-orange-400"></i>
                                </div>
                                <div className="ml-3">
                                    <h4 className="font-bold text-orange-800">Modo Local Detectado</h4>
                                    <p className="text-orange-700 mt-1">
                                        O sistema está rodando em <code>localhost</code>. Dispositivos externos (celulares) não conseguirão acessar.
                                    </p>
                                    <div className="mt-2 text-orange-800 font-medium">
                                        Para corrigir:
                                    </div>
                                    <ul className="list-disc list-inside text-orange-700 mt-1 space-y-1 text-xs">
                                        <li>Descubra o IP do seu computador (CMD &gt; <code>ipconfig</code>)</li>
                                        <li>Substitua "localhost" no campo acima pelo seu IP (Ex: <code>192.168.0.15:3000</code>)</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                        )}
                    </div>
                </div>

                <div className="bg-white p-5 border rounded-lg shadow-sm">
                    <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                        <i className="fas fa-chair text-brand"></i> Mesa
                    </h3>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Número da Mesa:</label>
                        <input 
                        type="number" 
                        min="1" 
                        value={qrTableId}
                        onChange={(e) => setQrTableId(parseInt(e.target.value) || 1)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:ring-brand focus:border-brand text-lg font-bold text-center"
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-3">
                   <a 
                     href={getQrCodeLink()} 
                     target="_blank" 
                     rel="noreferrer"
                     className="w-full bg-gray-100 text-gray-800 px-4 py-3 rounded-lg font-bold hover:bg-gray-200 flex items-center justify-center gap-2 text-center"
                   >
                     <i className="fas fa-external-link-alt"></i> Testar Link no Navegador
                   </a>
                   <button 
                     onClick={printQrCode}
                     className="w-full bg-brand-dark text-white px-4 py-3 rounded-lg shadow-md hover:bg-brand transition-colors flex items-center justify-center gap-2 text-lg font-bold"
                   >
                     <i className="fas fa-print"></i> Imprimir Placa da Mesa
                   </button>
                </div>
              </div>

              {/* Right Column: Preview */}
              <div className="w-full lg:w-1/2 flex justify-center bg-gray-50 rounded-xl border border-gray-200 p-8">
                <div id="printable-qr" className="bg-white p-6 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center shadow-lg max-w-sm w-full transform scale-90 origin-top">
                  <div className="card text-center">
                    <h1 className="text-2xl font-bold text-brand-dark mb-2">Barraca de Praia<br/>entre Família</h1>
                    <div className="bg-brand-orange text-white px-6 py-1 rounded-full text-lg font-bold mb-6 inline-block shadow-sm">Mesa {qrTableId}</div>
                    
                    <div className="border-4 border-brand rounded-xl p-2 mb-4 inline-block bg-white">
                      <img 
                        src={getQrCodeImageUrl()} 
                        alt={`QR Code Mesa ${qrTableId}`} 
                        className="w-48 h-48 object-contain"
                      />
                    </div>
                    
                    <p className="text-gray-600 font-medium text-center px-4">
                      Aponte a câmera do seu celular para acessar o nosso cardápio digital.
                    </p>
                    <div className="text-[10px] text-gray-400 mt-4 break-all px-4">{getQrCodeLink()}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'database' && (
            <div className="bg-white rounded shadow p-6 max-w-3xl mx-auto">
                <div className="text-center mb-8">
                   <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 text-blue-600 rounded-full mb-4">
                       <i className="fas fa-database text-3xl"></i>
                   </div>
                   <h2 className="text-2xl font-bold text-gray-800">Configuração de Banco de Dados</h2>
                   <p className="text-gray-600 max-w-lg mx-auto mt-2">
                       Conecte seu sistema ao <strong>Google Firebase</strong> para armazenar pedidos e estoque de forma segura.
                   </p>
                </div>

                {StorageService.isUsingCloud() ? (
                    <div className="space-y-4">
                      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                          <i className="fas fa-check-circle text-4xl text-green-500 mb-2"></i>
                          <h3 className="text-xl font-bold text-green-800">Sistema Conectado</h3>
                          <p className="text-green-700 mt-2">Seus dados estão sendo salvos na nuvem.</p>
                      </div>

                      <div className="bg-white border p-4 rounded-lg">
                          <h3 className="font-bold mb-2">Ferramentas de Diagnóstico</h3>
                          <button 
                             onClick={async () => {
                                 alert('Iniciando diagnóstico... verifique o console do navegador (F12)');
                                 await StorageService.runDiagnostics();
                                 alert('Diagnóstico concluído. Se houver produtos quebrados, tente recadastrá-los.');
                             }}
                             className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
                          >
                              <i className="fas fa-stethoscope mr-2"></i> Testar Conexão e Verificar Erros
                          </button>
                      </div>
                    </div>
                ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-8 text-sm text-yellow-800">
                        <i className="fas fa-info-circle mr-2"></i>
                        Atualmente você está usando o <strong>Modo Local</strong> (Navegador). Se limpar o histórico, os dados somem.
                    </div>
                )}

                <form onSubmit={handleSaveDbConfig} className="space-y-4 border-t pt-6 mt-6">
                    <h3 className="font-bold text-gray-700">Credenciais do Firebase</h3>
                    <p className="text-xs text-gray-500">Cole aqui o objeto de configuração do seu projeto Firebase.</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
                            <input type="text" required value={dbConfig.apiKey} onChange={e => setDbConfig({...dbConfig, apiKey: e.target.value})} className="w-full border rounded p-2 text-sm font-mono" placeholder="AIzaSy..." />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Auth Domain</label>
                            <input type="text" required value={dbConfig.authDomain} onChange={e => setDbConfig({...dbConfig, authDomain: e.target.value})} className="w-full border rounded p-2 text-sm font-mono" placeholder="projeto.firebaseapp.com" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Project ID</label>
                            <input type="text" required value={dbConfig.projectId} onChange={e => setDbConfig({...dbConfig, projectId: e.target.value})} className="w-full border rounded p-2 text-sm font-mono" placeholder="projeto-id" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Storage Bucket</label>
                            <input type="text" required value={dbConfig.storageBucket} onChange={e => setDbConfig({...dbConfig, storageBucket: e.target.value})} className="w-full border rounded p-2 text-sm font-mono" placeholder="projeto.appspot.com" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Messaging Sender ID</label>
                            <input type="text" required value={dbConfig.messagingSenderId} onChange={e => setDbConfig({...dbConfig, messagingSenderId: e.target.value})} className="w-full border rounded p-2 text-sm font-mono" placeholder="123456..." />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">App ID</label>
                            <input type="text" required value={dbConfig.appId} onChange={e => setDbConfig({...dbConfig, appId: e.target.value})} className="w-full border rounded p-2 text-sm font-mono" placeholder="1:123456:web:..." />
                        </div>
                    </div>

                    <div className="flex justify-end pt-4">
                        <button type="submit" className="bg-brand text-white px-6 py-3 rounded font-bold hover:bg-brand-dark transition">
                            Salvar e Conectar
                        </button>
                    </div>
                </form>
            </div>
        )}
      </main>

      {/* Product Edit Modal */}
      {isEditModalOpen && editingProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">Editar Produto</h3>
            <form onSubmit={handleSaveProduct} className="space-y-4">
              
              {/* Image Upload Section */}
              <div className="flex justify-center mb-4 flex-col items-center">
                 <div className="relative group mb-2">
                    {editingProduct.imageUrl ? (
                        <img src={editingProduct.imageUrl} alt="Preview" className="w-32 h-32 object-cover rounded-lg border-2 border-brand" />
                    ) : (
                        <div className="w-32 h-32 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400">
                            {isProcessingImage ? <i className="fas fa-spinner fa-spin text-2xl"></i> : <i className="fas fa-camera text-2xl"></i>}
                        </div>
                    )}
                    <button 
                       type="button" 
                       onClick={() => fileInputRef.current?.click()}
                       disabled={isProcessingImage}
                       className="absolute bottom-0 right-0 bg-brand text-white p-2 rounded-full shadow hover:bg-brand-dark"
                    >
                        <i className="fas fa-camera"></i>
                    </button>
                    <input 
                       type="file" 
                       ref={fileInputRef}
                       accept="image/*"
                       capture="environment" // Opens camera on mobile
                       onChange={handleImageUpload}
                       className="hidden" 
                    />
                 </div>
                 {isProcessingImage && <p className="text-xs text-center text-brand mt-1 animate-pulse">Comprimindo imagem...</p>}
                 
                 <div className="w-full">
                     <input 
                       type="text" 
                       placeholder="Ou cole o link da imagem (URL)" 
                       value={editingProduct.imageUrl} 
                       onChange={(e) => setEditingProduct({...editingProduct, imageUrl: e.target.value})}
                       className="w-full text-xs border border-gray-300 rounded p-1 text-center bg-gray-50"
                     />
                 </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Nome</label>
                <input type="text" required value={editingProduct.name} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} className="w-full border rounded p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Categoria</label>
                <select value={editingProduct.category} onChange={e => setEditingProduct({...editingProduct, category: e.target.value as Category})} className="w-full border rounded p-2">
                  {Object.values(Category).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">Preço</label>
                  <input type="number" step="0.01" required value={editingProduct.price} onChange={e => setEditingProduct({...editingProduct, price: parseFloat(e.target.value)})} className="w-full border rounded p-2" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">Estoque</label>
                  <input type="number" required value={editingProduct.stock} onChange={e => setEditingProduct({...editingProduct, stock: parseInt(e.target.value)})} className="w-full border rounded p-2" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Descrição</label>
                <textarea value={editingProduct.description} onChange={e => setEditingProduct({...editingProduct, description: e.target.value})} className="w-full border rounded p-2 h-20"></textarea>
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 py-2 border rounded hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={isProcessingImage} className="flex-1 py-2 bg-brand text-white rounded hover:bg-brand-dark disabled:bg-gray-400">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
