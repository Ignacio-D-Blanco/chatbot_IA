import OpenAI from 'openai'
import * as dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { obtenerOCrearUsuario, guardarMensaje, obtenerContextoCompleto } from './db.js'
import { buscarDocumentos, formatearContexto } from './rag.js'
import { actualizarResumen } from './memoria.js'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())
// app.use(express.static(path.join(__dirname, '../public'))) -> para local

// para render

// Reemplazar todas las referencias a __dirname para el public por:
const rootDir = process.cwd()
console.log('rootDir:', rootDir)

app.use(express.static(path.join(rootDir, 'public')))
app.get('/', (req, res) => {
  res.sendFile(path.join(rootDir, 'public', 'index.html'))
})


const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
})


app.post('/chat', async (req, res) => {
  try {
    const { mensaje, phone = '5491100000000' } = req.body

    // 1. Usuario
    const usuario = await obtenerOCrearUsuario(phone)

    // 2. Guardar mensaje del usuario
    await guardarMensaje(usuario.id, 'user', mensaje)

    // 3. Contexto completo: resumen + recientes
    const { resumen, recientes } = await obtenerContextoCompleto(usuario.id)

    // 4. RAG
    const datos = await extraer(mensaje)
    const datosSeguro = datos ?? {
      intencion: 'OTRA',
      procedimiento: null,
      urgente: false,
      resumen: mensaje.slice(0, 50)
    }
    const respuesta = await responder(mensaje, datos, recientes, resumen)

    // 5. Guardar respuesta
    await guardarMensaje(usuario.id, 'assistant', respuesta)

    // 6. Actualizar resumen con los últimos mensajes
    // Lo hacemos async sin bloquear la respuesta al usuario
    const todosLosRecientes = [
      ...recientes,
      { role: 'user', content: mensaje },
      { role: 'assistant', content: respuesta }
    ]
    actualizarResumen(usuario.id, todosLosRecientes).catch(console.error)

    res.json({ respuesta, datos })

  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Error interno' })
  }
})


// Endpoint que simula recibir un webhook de WhatsApp
app.post('/webhook', async (req, res) => {
  // WhatsApp siempre espera un 200 OK inmediato
  // Si tardás más de 3 segundos en responder, reintenta el webhook
  res.status(200).send('OK')
  
  // Procesamos el mensaje después de confirmar recepción
  const body = req.body
  console.log('Webhook recibido:', JSON.stringify(body, null, 2))
  
  // Extraemos el mensaje según el formato real de WhatsApp Business API
  const mensaje = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body
  
  if (!mensaje) {
    console.log('No hay mensaje de texto en el webhook')
    return
  }
  
  console.log('Mensaje extraído:', mensaje)
  
  // Procesamos con nuestro pipeline existente
  const datos = await extraer(mensaje)
  const respuesta = await responder(mensaje, datos)
  
  console.log('Respuesta generada:', respuesta)
  // En producción acá llamarías a la API de WhatsApp para responder
})

// Verificación del webhook — WhatsApp lo requiere al configurar
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = 'mi_token_secreto_123'
  
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado por WhatsApp')
    res.status(200).send(challenge)
  } else {
    res.status(403).send('Token inválido')
  }
})

app.listen(3000, () => {
  console.log('Servidor iniciado en puerto 3000')
})

// ETAPA 1 — solo devuelve la categoría como string
async function clasificar(mensaje) {
  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Sos un clasificador de intenciones para una clínica dental.
Devolvé ÚNICAMENTE una de estas categorías, sin texto adicional:

TURNO_NUEVO       — quiere agendar un turno nuevo
CANCELAR_TURNO    — quiere cancelar un turno existente
REPROGRAMAR_TURNO — quiere cambiar fecha u hora de un turno
PRECIO_CONSULTA   — pregunta por precios o costos
RECLAMO           — tiene un problema, queja o error
OTRA              — cualquier otra consulta

Reglas:
- Clasificá por intención, no por palabras exactas
- Si hay duda entre categorías, elegí OTRA
- Devolvé SOLO la categoría, sin explicaciones

Ejemplos:
Usuario: "Quiero mover mi turno para otro día"
Clasificación: REPROGRAMAR_TURNO

Usuario: "Me duele mucho, es urgente"
Clasificación: OTRA

Usuario: "Cuánto sale una limpieza?"
Clasificación: PRECIO_CONSULTA`
      },
      { role: 'user', content: mensaje }
    ]
  })

  // Limpiamos espacios y saltos de línea por las dudas
  return response.choices[0].message.content.trim()
}


// ETAPA 2 — devuelve objeto JSON parseado
async function extraer(mensaje) {
  const FALLBACK = {
    intencion: 'OTRA',
    procedimiento: null,
    urgente: false,
    resumen: mensaje.slice(0, 50)
  }

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `Sos un extractor de datos para una clínica dental.
Devolvé ÚNICAMENTE un JSON válido con esta estructura exacta,
sin texto adicional antes ni después:

{
  "intencion": "TURNO_NUEVO | CANCELAR_TURNO | REPROGRAMAR_TURNO | PRECIO_CONSULTA | RECLAMO | OTRA",
  "procedimiento": "string o null si no se menciona",
  "urgente": true o false,
  "resumen": "string de máximo 8 palabras"
}

Reglas:
- urgente es true si hay dolor, emergencia o el usuario lo indica
- procedimiento es null si no se menciona ninguno
- El JSON debe ser válido

Ejemplos:
Usuario: "Necesito sacar turno urgente para una extracción"
{"intencion":"TURNO_NUEVO","procedimiento":"extracción","urgente":true,"resumen":"Turno urgente para extracción dental"}

Usuario: "Quiero mover mi turno de limpieza al viernes"
{"intencion":"REPROGRAMAR_TURNO","procedimiento":"limpieza","urgente":false,"resumen":"Cambiar turno de limpieza al viernes"}`
        },
        { role: 'user', content: mensaje }
      ]
    })

    const raw = response.choices[0].message.content

    // Intento 1 — parseo directo
    try {
      return JSON.parse(raw)
    } catch {
      // Intento 2 — extraer JSON con regex
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          return JSON.parse(match[0])
        } catch {
          console.log(`❌ JSON inválido: ${raw}`)
        }
      }
    }
  } catch (error) {
    console.log(`❌ Error en extraer: ${error.message}`)
  }

  // Siempre devuelve algo válido
  console.log('⚠️ Usando fallback para extraer')
  return FALLBACK
}

async function responder(mensaje, datos, historial = [], resumen = '') {
  const docsRelevantes = await buscarDocumentos(mensaje)
  const contextoRAG = formatearContexto(docsRelevantes)

  const contexto = `
    Intención: ${datos.intencion}
    Procedimiento: ${datos.procedimiento ?? 'ninguno'}
    Urgente: ${datos.urgente ? 'SÍ' : 'no'}
    Resumen: ${datos.resumen}
  `.trim()

  const mensajesHistorial = historial.map(h => ({
    role: h.role,
    content: h.content
  }))

  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Sos el asistente virtual de Clínica Dental Palermo.

MEMORIA DEL PACIENTE:
${resumen || 'Primera conversación con este paciente.'}

CONTEXTO DE LA CLÍNICA:
${contextoRAG}

DATOS DEL MENSAJE:
${contexto}

INSTRUCCIONES:
- Usá la MEMORIA para personalizar la respuesta
- Si el paciente ya tiene turno agendado, mencionalo cuando sea relevante
- Usá el CONTEXTO para responder sobre precios y servicios
- Tono cálido y profesional, máximo 3 oraciones`
      },
      ...mensajesHistorial,
      { role: 'user', content: mensaje }
    ]
  })

  return response.choices[0].message.content.trim()
}

async function main() {
  for (const mensaje of mensajes) {
    await procesarMensaje(mensaje)
  }
}


