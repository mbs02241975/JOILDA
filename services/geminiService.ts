import { GoogleGenAI } from "@google/genai";

// Helper seguro para obter a chave sem quebrar o app
const getApiKey = () => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      // @ts-ignore
      return process.env.API_KEY;
    }
  } catch (e) {
    console.warn("Ambiente sem process.env definido");
  }
  return '';
};

const apiKey = getApiKey();
// Inicializa apenas se houver chave, senão cria uma instância dummy ou trata no método
const ai = apiKey ? new GoogleGenAI({ apiKey: apiKey }) : null;

export const GeminiService = {
  generateDailyReport: async (salesData: any) => {
    if (!ai || !apiKey) {
      console.warn("API Key não configurada ou Gemini não inicializado.");
      return "⚠️ Configuração de IA incompleta. Verifique se a variável de ambiente API_KEY foi definida no painel da Vercel.";
    }

    try {
      const model = ai.models;
      const prompt = `
        Atue como um gerente de restaurante experiente. Analise os dados de vendas abaixo de uma barraca de praia e forneça um resumo executivo.
        
        Dados de Vendas: ${JSON.stringify(salesData)}
        
        O relatório deve conter:
        1. Resumo do faturamento total.
        2. Item mais vendido.
        3. Sugestão para melhorar o estoque ou vendas baseada nos dados.
        4. Use formatação Markdown. Seja conciso e profissional.
      `;

      const response = await model.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      return response.text;
    } catch (error) {
      console.error("Erro ao chamar Gemini:", error);
      return "Erro ao gerar relatório inteligente. Verifique a conexão ou a chave de API.";
    }
  }
};