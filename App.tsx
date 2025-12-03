import React, { useState, useEffect } from 'react';
import { ClientView } from './components/client/ClientView';
import { AdminDashboard } from './components/admin/AdminDashboard';

const App: React.FC = () => {
  const [view, setView] = useState<'landing' | 'client' | 'admin'>('landing');
  const [tableId, setTableId] = useState<number>(1);

  useEffect(() => {
    // Simple hash routing simulation since we don't have React Router
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#/admin')) {
        setView('admin');
      } else if (hash.startsWith('#/client')) {
        // Robust parsing: handles cases where split might return empty arrays
        const parts = hash.split('?');
        if (parts.length > 1) {
          const params = new URLSearchParams(parts[1]);
          const table = params.get('table');
          if (table) {
            setTableId(parseInt(table, 10));
            setView('client');
          } else {
            // Valid route but no table param, fallback to landing or default
            setView('landing');
          }
        } else {
          // Route #/client exists but no query params
          setView('landing');
        }
      } else {
        setView('landing');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Initial check

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateToClient = (id: number) => {
    window.location.hash = `#/client?table=${id}`;
  };

  const navigateToAdmin = () => {
    window.location.hash = '#/admin';
  };

  if (view === 'admin') {
    return <AdminDashboard />;
  }

  if (view === 'client') {
    return <ClientView tableId={tableId} />;
  }

  return (
    <div className="min-h-screen bg-brand-light flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md text-center">
        <div className="w-20 h-20 bg-brand text-white rounded-full flex items-center justify-center text-3xl mx-auto mb-6">
          <i className="fas fa-umbrella-beach"></i>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Barraca de Praia entre Família</h1>
        <p className="text-gray-500 mb-8">Selecione o modo de acesso.</p>

        <div className="space-y-4">
          <div className="border p-4 rounded-lg hover:bg-gray-50 transition cursor-pointer" onClick={() => navigateToAdmin()}>
            <h3 className="font-bold text-brand-dark"><i className="fas fa-user-shield mr-2"></i>Área Administrativa</h3>
            <p className="text-sm text-gray-400">Gestão de pedidos, estoque e relatórios</p>
          </div>

          <div className="border-t my-4"></div>
          
          <div className="text-left">
            <label className="block text-sm font-medium text-gray-700 mb-2">Simular Leitura de QR Code (Cliente)</label>
            <div className="flex gap-2">
               <input 
                 type="number" 
                 min="1" 
                 value={tableId} 
                 onChange={(e) => setTableId(parseInt(e.target.value))}
                 className="border rounded px-3 py-2 w-20 text-center"
               />
               <button 
                 onClick={() => navigateToClient(tableId)}
                 className="flex-1 bg-brand text-white rounded-lg hover:bg-brand-dark transition"
               >
                 Abrir Cardápio Mesa {tableId}
               </button>
            </div>
          </div>
        </div>
        
        <div className="mt-8 text-xs text-gray-400 border-t pt-4">
          <p>Desenvolvedor: Máximo Batista</p>
          <p>(71) 98286-2569</p>
        </div>
      </div>
    </div>
  );
};

export default App;