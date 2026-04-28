const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ─── Configuración ───────────────────────────────────────────────
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Historial de conversaciones por número de teléfono
const conversaciones = {};

// ─── Prompt del agente ───────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el asistente virtual de "Barbería El Maestro", una barbería profesional. Tu función es gestionar citas vía WhatsApp de forma amable, eficiente y natural en español.

SERVICIOS DISPONIBLES:
- Corte clásico: 30 min, €15
- Corte + Barba: 50 min, €25
- Afeitado navaja: 30 min, €20
- Degradado / Fade: 40 min, €18
- Arreglo de barba: 20 min, €12

BARBEROS: Carlos, Miguel, Andrés
HORARIOS: 10:00, 10:30, 11:00, 11:30, 12:00, 16:00, 16:30, 17:00, 17:30, 18:00
DÍAS: Lunes a Sábado

TU COMPORTAMIENTO:
- Saluda cálidamente al inicio
- Ayuda a reservar, modificar o cancelar citas
- Recoge: servicio, día, hora, barbero preferido y nombre del cliente
- Confirma los datos antes de guardar
- Si preguntan por precio o duración, informa con detalle
- Usa emojis moderadamente (✂️ 💈 📅 ✅)
- Sé conciso, máximo 3-4 líneas por mensaje
- Al confirmar una cita, da un resumen claro con todos los datos`;

// ─── Verificación del webhook (Meta lo llama una sola vez) ───────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── Recibir mensajes de WhatsApp ────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || message.type !== "text") return;

    const from = message.from; // Número del cliente
    const texto = message.text.body;

    console.log(`📩 Mensaje de ${from}: ${texto}`);

    // Inicializar historial si es nuevo usuario
    if (!conversaciones[from]) {
      conversaciones[from] = [];
    }

    // Añadir mensaje del usuario al historial
    conversaciones[from].push({
      role: "user",
      parts: [{ text: texto }],
    });

    // Llamar a Gemini
    const respuesta = await llamarGemini(conversaciones[from]);

    // Añadir respuesta al historial
    conversaciones[from].push({
      role: "model",
      parts: [{ text: respuesta }],
    });

    // Enviar respuesta por WhatsApp
    await enviarMensaje(from, respuesta);

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
});

// ─── Llamar a la API de Gemini ───────────────────────────────────
async function llamarGemini(historial) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: historial,
    generationConfig: {
      maxOutputTokens: 500,
      temperature: 0.7,
    },
  };

  const response = await axios.post(url, body);
  return response.data.candidates[0].content.parts[0].text;
}

// ─── Enviar mensaje por WhatsApp ─────────────────────────────────
async function enviarMensaje(to, texto) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: texto },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log(`✅ Respuesta enviada a ${to}`);
}

// ─── Arrancar servidor ───────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Servidor arrancado en puerto ${PORT}`);
});
