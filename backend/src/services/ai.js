import OpenAI from 'openai'
import * as dotenv from 'dotenv'
import { buscarDocumentos, formatearContexto } from './rag.js'
dotenv.config()

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
})

export async function extraer(mensaje) {
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
- El JSON debe ser válido`
        },
        { role: 'user', content: mensaje }
      ]
    })

    const raw = response.choices[0].message.content
    try {
      return JSON.parse(raw)
    } catch {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        try { return JSON.parse(match[0]) } catch {}
      }
    }
  } catch (error) {
    console.log(`❌ Error en extraer: ${error.message}`)
  }
  return FALLBACK
}

export async function responder(mensaje, datos, historial = [], resumen = '', tenant) {
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