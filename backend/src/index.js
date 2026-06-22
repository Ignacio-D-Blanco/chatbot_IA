import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import * as dotenv from 'dotenv'
import chatRouter from './routes/chat.js'
import webhookRouter from './routes/webhook.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'))
})

// Montar rutas
app.use('/chat', chatRouter)
app.use('/webhook', webhookRouter)

app.listen(3000, () => {
  console.log('Servidor iniciado en puerto 3000')
})