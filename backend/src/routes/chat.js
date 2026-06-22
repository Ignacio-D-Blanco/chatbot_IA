import { Router } from 'express'
import { obtenerOCrearUsuario, guardarMensaje, obtenerContextoCompleto } from '../db/db.js'
import { actualizarResumen } from '../services/memoria.js'
import { obtenerTenant } from '../db/tenant.js'
import { extraer, responder } from '../services/ai.js'

const router = Router()

router.post('/', async (req, res) => {
  try {
    const {
      mensaje,
      phone = '5491100000000',
      tenant_slug = 'clinica-dental-palermo'
    } = req.body

    const tenant = await obtenerTenant(tenant_slug)
    const usuario = await obtenerOCrearUsuario(phone, tenant.id)
    await guardarMensaje(usuario.id, 'user', mensaje, tenant.id)

    const { resumen, recientes } = await obtenerContextoCompleto(usuario.id)
    const datos = await extraer(mensaje)
    const respuesta = await responder(mensaje, datos, recientes, resumen, tenant)

    await guardarMensaje(usuario.id, 'assistant', respuesta, tenant.id)

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

export default router