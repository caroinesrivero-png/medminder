import { GoogleGenAI } from "@google/genai";

// The API key is expected to be set in the environment.
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE.API_KEY });

const systemInstruction = `Eres un asistente informativo y amigable para adolescentes que tienen preguntas sobre sus medicamentos. Tu propósito es dar información general y fácil de entender. NO eres un profesional médico. Al final de CADA respuesta, DEBES incluir este descargo de responsabilidad obligatorio: "Importante: Soy un asistente de IA y esta información no reemplaza el consejo de un médico. Siempre consulta a tu doctor o farmacéutico para cualquier pregunta médica."`;

export async function askAboutMedication(medicationName: string, question: string): Promise<string> {
  const prompt = `Tengo una pregunta sobre mi remedio "${medicationName}": ${question}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
      },
    });

    return response.text;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "Lo siento, tuve un problema para obtener una respuesta. Por favor, intenta de nuevo más tarde.";
  }
}


export async function getMedicationInfo(medicationName: string): Promise<string> {
  const prompt = `Explica de forma muy sencilla y concisa para qué se usa comúnmente el remedio "${medicationName}". Dirígete a un adolescente. Limita la respuesta a 2 o 3 frases cortas antes del descargo de responsabilidad.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
      },
    });

    return response.text;
  } catch (error) {
    console.error("Error calling Gemini API for med info:", error);
    return "Lo siento, tuve un problema para obtener la información. Por favor, intenta de nuevo más tarde.";
  }
}
