const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const conversaciones = {};

const SYSTEM_PROMPT = "Eres el asistente virtual de Barberia El Maestro, una barberia profesional. Tu funcion es gestionar citas via WhatsApp de forma amable y eficiente en espanol. SERVICIOS: Corte clasico 30min 15 euros, Corte y Barba 50min 25 euros, Afeitado navaja 30min 20 euros, Degradado Fade 40min 18 euros, Arreglo de barba 20min 12 euros. BARBEROS: Carlos, Miguel, Andres. HORARIOS: 10:00 10:30 11:00 11:30 12:00 16:00 16:30 17:00 17:30 18:00. DIAS: Lunes a Sabado. Saluda calurosamente, ayuda a reservar modificar o cancelar citas, recoge servicio dia hora barbero y nombre del cliente, confirma los datos, usa emojis moderadamente, se conciso maximo 3 lineas por mensaje.";

app.get("/webhook", function(req, res) {
  var mode = req.query["hub.mode"];
  var token = req.query["hub.verify_token"];
  var challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", function(req, res) {
  res.sendStatus(200);
  try {
    var entry = req.body.entry && req.body.entry[0];
    var change = entry && entry.changes && entry.changes[0];
    var message = change && change.value && change.value.messages && change.value.messages[0];
    if (!message || message.type !== "text") return;
    var from = message.from;
    var texto = message.text.body;
    console.log("Mensaje de " + from + ": " + texto);
    if (!conversaciones[from]) {
      conversaciones[from] = [];
    }
    conversaciones[from].push({
      role: "user",
      parts: [{ text: texto }]
    });
    llamarGemini(conversaciones[from]).then(function(respuesta) {
      conversaciones[from].push({
        role: "model",
        parts: [{ text: respuesta }]
      });
      enviarMensaje(from, respuesta);
    }).catch(function(err) {
      console.log("Error Gemini: " + err.message);
    });
  } catch (error) {
    console.log("Error: " + error.message);
  }
});

function llamarGemini(historial) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" + GEMINI_API_KEY;
  var body = {
    contents: historial,
    generationConfig: {
      maxOutputTokens: 300,
      temperature: 0.7
    }
  };
  return axios.post(url, body).then(function(response) {
    return response.data.candidates[0].content.parts[0].text;
  });
}

function enviarMensaje(to, texto) {
  var url = "https://graph.facebook.com/v19.0/" + PHONE_NUMBER_ID + "/messages";
  return axios.post(url, {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: texto }
  }, {
    headers: {
      Authorization: "Bearer " + WHATSAPP_TOKEN,
      "Content-Type": "application/json"
    }
  }).then(function() {
    console.log("Respuesta enviada a " + to);
  });
}

var PORT = process.env.PORT || 8080;
app.listen(PORT, function() {
  console.log("Servidor arrancado en puerto " + PORT);
});
