
import { Router } from 'express'
import { obtenerOCrearUsuario, guardarMensaje, obtenerContextoCompleto } from '../db/db.js'
import { obtenerTenant } from '../db/tenant.js'
import { extraer, responder } from '../services/ai.js'

const router = Router()

router.post('/', async (req, res) => {
  res.status(200).send('OK')

  const body = req.body
  const mensaje = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body
  const phone = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from

  if (!mensaje) return

  try {
    const tenant = await obtenerTenant('clinica-dental-palermo')
    const usuario = await obtenerOCrearUsuario(phone ?? 'webhook-user', tenant.id)
    await guardarMensaje(usuario.id, 'user', mensaje, tenant.id)

    const { resumen, recientes } = await obtenerContextoCompleto(usuario.id)
    const datos = await extraer(mensaje)
    const respuesta = await responder(mensaje, datos, recientes, resumen, tenant)

    await guardarMensaje(usuario.id, 'assistant', respuesta, tenant.id)
    console.log('Respuesta generada:', respuesta)
  } catch (error) {
    console.error('Error en webhook:', error)
  }
})

router.get('/', (req, res) => {
  const VERIFY_TOKEN = 'mi_token_secreto_123'
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado por WhatsApp')
    res.status(200).send(challenge)
  } else {
    res.status(403).send('Token inválido')
  }
})

export default router