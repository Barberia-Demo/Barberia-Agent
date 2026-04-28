const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// =====================
// VARIABLES DE ENTORNO
// =====================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// =====================
// MEMORIA (simple)
// =====================
const conversaciones = {};
const locks = {};

// =====================
// PROMPT DEL SISTEMA
// =====================
const SYSTEM_PROMPT = `
Eres el asistente virtual de Barberia El Maestro.
Gestionas citas por WhatsApp de forma amable y eficiente en español.

SERVICIOS:
- Corte clasico 30min 15€
- Corte y Barba 50min 25€
- Afeitado navaja 30min 20€
- Degradado Fade 40min 18€
- Arreglo de barba 20min 12€

BARBEROS: Carlos, Miguel, Andres
HORARIOS: 10:00 a 12:00 / 16:00 a 18:00 (cada 30 min)
DIAS: Lunes a Sabado

REGLAS:
- No inventes horarios ni servicios
- Si falta información, pregunta
- Máximo 3 líneas por respuesta
- Usa emojis moderadamente 😊
- Siempre confirma datos antes de cerrar cita
`;

// =====================
// WEBHOOK VERIFICACIÓN
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// =====================
// WEBHOOK PRINCIPAL
// =====================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== "text" || !message.text?.body) return;

    const from = message.from;
    const texto = message.text.body;

    console.log(`Mensaje de ${from}: ${texto}`);

    // init historial
    if (!conversaciones[from]) {
      conversaciones[from] = [];
    }

    // lock anti-colisiones
    if (locks[from]) return;
    locks[from] = true;

    try {
      conversaciones[from].push({
        role: "user",
        parts: [{ text: texto }]
      });

      // limitar memoria
      if (conversaciones[from].length > 20) {
        conversaciones[from] = conversaciones[from].slice(-20);
      }

      const respuesta = await llamarGemini(conversaciones[from]);

      conversaciones[from].push({
        role: "model",
        parts: [{ text: respuesta }]
      });

      await enviarMensaje(from, respuesta);

    } finally {
      locks[from] = false;
    }

  } catch (error) {
    console.error("Error webhook:", error.message);
  }
});

// =====================
// GEMINI API
// =====================
async function llamarGemini(historial) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const contents = historial.map(m => ({
    role: m.role,
    parts: [{ text: m.parts[0].text }]
  }));

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents,
    generationConfig: {
      maxOutputTokens: 300,
      temperature: 0.7
    }
  };

  try {
    const response = await axios.post(url, body);

    const candidate = response?.data?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      return "Lo siento, no pude generar una respuesta en este momento.";
    }

    return text;

  } catch (err) {
    console.error("Error Gemini:", err.response?.data || err.message);
    return "Error al procesar la solicitud. Intenta de nuevo.";
  }
}

// =====================
// WHATSAPP SEND MESSAGE
// =====================
async function enviarMensaje(to, texto) {
  const url = `https
