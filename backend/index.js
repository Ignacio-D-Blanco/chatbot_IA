import OpenAI from 'openai'
import * as dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { obtenerOCrearUsuario, guardarMensaje, obtenerContextoCompleto } from './db.js'
import { buscarDocumentos, formatearContexto } from './rag.js'
import { actualizarResumen } from './memoria.js'
import { obtenerTenant } from './tenant.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

// Detectar entorno automáticamente
const isDev = process.env.NODE_ENV !== 'production'
const publicPath = path.join(__dirname, 'public')

app.use(express.static(publicPath))
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'))
})


const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
})


app.post('/chat', async (req, res) => {
  try {
    const { 
      mensaje, 
      phone = '5491100000000',
      tenant_slug = 'clinica-dental-palermo'  // default para compatibilidad
    } = req.body
    const tenant = await obtenerTenant(tenant_slug)
    // 2. Usuario vinculado al tenant
    const usuario = await obtenerOCrearUsuario(phone, tenant.id)
    // 3. Guardar mensaje
    await guardarMensaje(usuario.id, 'user', mensaje, tenant.id)
    // 4. Contexto
    const { resumen, recientes } = await obtenerContextoCompleto(usuario.id)
    // 5. Extraer intención
    const datos = await extraer(mensaje)
    // 6. Responder usando el system prompt del tenant
    const respuesta = await responder(
      mensaje, 
      datos, 
      recientes, 
      resumen,
      tenant  // ← pasamos el tenant completo
    )
    // 7. Guardar respuesta
    await guardarMensaje(usuario.id, 'assistant', respuesta, tenant.id)
    // 8. Actualizar resumen
    actualizarResumen(usuario.id, [
      ...recientes,
      { role: 'user', content: mensaje },
      { role: 'assistant', content: respuesta }
    ]).catch(console.error)
    res.json({ respuesta, datos })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Error interno' })
  }
})


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

async function responder(mensaje, datos, historial = [], resumen = '', tenant) {
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
        content: `${tenant.system_prompt}

MEMORIA DEL PACIENTE:
${resumen || 'Primera conversación.'}

CONTEXTO DE DOCUMENTOS:
${contextoRAG}

DATOS DEL MENSAJE:
${contexto}

FORMATO: tono cálido y profesional, máximo 3 oraciones.`
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


