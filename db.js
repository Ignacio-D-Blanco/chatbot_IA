import supabase from './supabase.js'

// Buscar o crear usuario por teléfono
export async function obtenerOCrearUsuario(phone, name = null) {
  // Primero buscamos si ya existe
  const { data: existente } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single()

  if (existente) return existente

  // Si no existe, lo creamos
  const { data: nuevo, error } = await supabase
    .from('users')
    .insert({ phone, name })
    .select()
    .single()

  if (error) throw error
  return nuevo
}

// Guardar un mensaje en el historial
export async function guardarMensaje(user_id, role, content) {
  const { error } = await supabase
    .from('conversations')
    .insert({ user_id, role, content })

  if (error) throw error
}

// Obtener historial de los últimos N mensajes
export async function obtenerHistorial(user_id, limite = 10) {
  const { data, error } = await supabase
    .from('conversations')
    .select('role, content')
    .eq('user_id', user_id)
    .order('created_at', { ascending: true })
    .limit(limite)

  if (error) throw error
  return data
}

// Guardar un turno
export async function guardarTurno(user_id, procedure, date = null) {
  const { data, error } = await supabase
    .from('appointments')
    .insert({ user_id, procedure, date })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function obtenerContextoCompleto(user_id) {
  // Traer resumen histórico
  const { data: summaryData } = await supabase
    .from('conversation_summaries')
    .select('summary')
    .eq('user_id', user_id)
    .single()

  const resumen = summaryData?.summary ?? ''

  // Traer últimos 5 mensajes recientes
  const { data: mensajesRecientes } = await supabase
    .from('conversations')
    .select('role, content')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(5)

  // Invertir para orden cronológico
  const recientes = (mensajesRecientes ?? []).reverse()

  return { resumen, recientes }
}