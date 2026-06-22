import { obtenerOCrearUsuario, guardarMensaje, obtenerContextoCompleto } from '../db/db.js'
import { buscarDocumentos, formatearContexto } from '../services/rag.js'
import { actualizarResumen } from '../services/memoria.js'
import { obtenerTenant } from '../db/tenant.js'

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