import supabase from '../db/supabase.js'


export async function obtenerResumen(user_id) {
  const { data } = await supabase
    .from('conversation_summaries')
    .select('summary')
    .eq('user_id', user_id)
    .single()
  return data?.summary ?? ''
}

export async function actualizarResumen(user_id, mensajesNuevos) {
  const resumenActual = await obtenerResumen(user_id)

  if (mensajesNuevos.length < 4) return resumenActual

  const conversacion = mensajesNuevos
    .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
    .join('\n')

  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Sos un sistema de memoria para un chatbot de clínica dental.
Tu tarea es actualizar el resumen de la conversación con un paciente.

RESUMEN ACTUAL:
${resumenActual || 'Sin historial previo.'}

MENSAJES NUEVOS A INCORPORAR:
${conversacion}

Generá un resumen actualizado que incluya:
- Nombre del paciente si se mencionó
- Tratamientos consultados o agendados
- Turnos existentes con fecha y hora
- Preferencias o información relevante mencionada
- Estado de cualquier gestión en curso

El resumen debe ser conciso (máximo 150 palabras) pero completo.
Devolvé ÚNICAMENTE el resumen, sin explicaciones.`
      }
    ]
  })
  const nuevoResumen = response.choices[0].message.content.trim()
  await supabase
    .from('conversation_summaries')
    .upsert({
      user_id,
      summary: nuevoResumen,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    })

  return nuevoResumen
}
