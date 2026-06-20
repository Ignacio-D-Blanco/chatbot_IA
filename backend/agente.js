import OpenAI from 'openai'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
dotenv.config()

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// ── HERRAMIENTAS REALES ──────────────────────────────────────

async function verificarServicio({ nombre }) {
  const servicios = ['limpieza', 'extraccion', 'consulta', 'blanqueamiento', 'ortodoncia']
  const existe = servicios.some(s => nombre.toLowerCase().includes(s))
  return { existe, servicio_normalizado: existe ? nombre.toLowerCase() : null }
}

async function verificarDisponibilidad({ fecha, hora, servicio }) {
  // En producción consultarías Google Calendar o tu DB de turnos
  // Por ahora simulamos disponibilidad
  const horariosOcupados = ['09:00', '14:00', '16:00']
  const disponible = !horariosOcupados.includes(hora)
  
  return {
    disponible,
    profesional: disponible ? 'Dra. García' : null,
    alternativas: disponible ? [] : ['10:00', '11:00', '15:00']
  }
}

async function verificarUsuario({ phone }) {
  const { data } = await supabase
    .from('users')
    .select('id, name, phone')
    .eq('phone', phone)
    .single()
  
  return {
    registrado: !!data,
    usuario: data ?? null
  }
}

async function crearTurno({ user_id, servicio, fecha, hora }) {
  const fechaCompleta = new Date(`${fecha}T${hora}:00`)
  
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      user_id,
      procedure: servicio,
      date: fechaCompleta.toISOString(),
      status: 'confirmed'
    })
    .select()
    .single()

  if (error) return { exito: false, error: error.message }
  return { exito: true, turno_id: data.id }
}

async function buscarHorariosAlternativos({ servicio, fecha }) {
  // Simulamos horarios disponibles cercanos
  return {
    horarios: [
      { fecha, hora: '10:00' },
      { fecha, hora: '11:00' },
      { fecha: 'viernes', hora: '09:00' }
    ]
  }
}

async function checkTurnos({ user_id, fecha }) {
  const fechaInicio = new Date(`${fecha}T00:00:00`).toISOString()
  const fechaFin = new Date(`${fecha}T23:59:59`).toISOString()

  const { data } = await supabase
    .from('appointments')
    .select('id, procedure, date, status')
    .eq('user_id', user_id)
    .gte('date', fechaInicio)
    .lte('date', fechaFin)
    .eq('status', 'confirmed')

  return {
    tiene_turnos: data?.length > 0,
    turnos: data ?? []
  }
}

// ── DEFINICIÓN DE HERRAMIENTAS PARA EL LLM ──────────────────

const herramientas = [
  {
    type: 'function',
    function: {
      name: 'verificarServicio',
      description: 'Verifica si un servicio dental existe en el catálogo de la clínica',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del servicio a verificar' }
        },
        required: ['nombre']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verificarDisponibilidad',
      description: 'Verifica si hay disponibilidad para un turno en fecha y hora específica',
      parameters: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
          hora:  { type: 'string', description: 'Hora en formato HH:MM' },
          servicio: { type: 'string', description: 'Nombre del servicio' }
        },
        required: ['fecha', 'hora', 'servicio']
      }
    }
  },
  {
    type: 'function',
    function: {
        name: 'checkTurnos',
        description: 'Verifica si el usuario ya tiene turnos agendados en una fecha específica',
        parameters: {
        type: 'object',
        properties: {
            user_id: { type: 'string' },
            fecha:   { type: 'string', description: 'Fecha en formato YYYY-MM-DD' }
        },
        required: ['user_id', 'fecha']
        }
    }
    },
  {
    type: 'function',
    function: {
      name: 'verificarUsuario',
      description: 'Verifica si el usuario está registrado en la clínica',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Número de teléfono del usuario' }
        },
        required: ['phone']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'crearTurno',
      description: 'Crea un turno confirmado en el sistema',
      parameters: {
        type: 'object',
        properties: {
          user_id:  { type: 'string', description: 'ID del usuario' },
          servicio: { type: 'string', description: 'Nombre del servicio' },
          fecha:    { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
          hora:     { type: 'string', description: 'Hora en formato HH:MM' }
        },
        required: ['user_id', 'servicio', 'fecha', 'hora']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscarHorariosAlternativos',
      description: 'Busca horarios alternativos cuando no hay disponibilidad',
      parameters: {
        type: 'object',
        properties: {
          servicio: { type: 'string' },
          fecha:    { type: 'string' }
        },
        required: ['servicio', 'fecha']
      }
    }
  }
]

// ── MAPA DE FUNCIONES ────────────────────────────────────────

const funcionesDisponibles = {
  verificarServicio,
  verificarDisponibilidad,
  verificarUsuario,
  crearTurno,
  buscarHorariosAlternativos,
  checkTurnos
}

// ── EL LOOP DEL AGENTE ───────────────────────────────────────

export async function ejecutarAgente(mensajeUsuario, phone) {
  const mensajes = [
    {
      role: 'system',
      content: `Sos el asistente de la Clínica Dental Palermo.
Tenés acceso a herramientas para gestionar turnos.
Usá las herramientas necesarias para resolver completamente 
la solicitud del usuario antes de responder.
La fecha de hoy es ${new Date().toISOString().split('T')[0]}.
El teléfono del usuario es: ${phone}`
    },
    {
      role: 'user',
      content: mensajeUsuario
    }
  ]

  console.log('\n🤖 Agente iniciado')
  console.log(`📨 Mensaje: ${mensajeUsuario}\n`)

  // Loop del agente — máximo 10 iteraciones para evitar loops infinitos
  for (let i = 0; i < 10; i++) {
    const response = await client.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: mensajes,
      tools: herramientas,
      tool_choice: 'auto'
    })

    const mensaje = response.choices[0].message
    mensajes.push(mensaje)

    // Si no hay tool_calls, el agente terminó de razonar
    if (!mensaje.tool_calls || mensaje.tool_calls.length === 0) {
      console.log('✅ Agente completó el razonamiento\n')
      return mensaje.content
    }

    // Ejecutar cada herramienta que el agente pidió
    for (const toolCall of mensaje.tool_calls) {
        const nombreFuncion = toolCall.function.name
        const argumentos = JSON.parse(toolCall.function.arguments)

        console.log(`🔧 Ejecutando: ${nombreFuncion}`)
        console.log(`   Args: ${JSON.stringify(argumentos)}`)
        const funcion = funcionesDisponibles[nombreFuncion]

        if (!funcion) {
        console.log(`⚠️ Función no encontrada: ${nombreFuncion}`)
        mensajes.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Función ${nombreFuncion} no disponible` })
        })
        }
        const resultado = await funcion(argumentos)

        console.log(`   Resultado: ${JSON.stringify(resultado)}\n`)

        // Devolver el resultado al agente
        mensajes.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(resultado)
        })
        }
    }
    return 'No pude completar la solicitud. Por favor contactá a la clínica directamente.'
}

// ── TEST ─────────────────────────────────────────────────────

async function main() {
  const resultado = await ejecutarAgente(
    'Quiero sacar un turno para limpieza el jueves 26 a las 10hs',
    '5491155667788'
  )
  console.log('💬 Respuesta final:', resultado)
}

main()