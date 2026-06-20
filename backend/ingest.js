import { createClient } from '@supabase/supabase-js'
import { pipeline } from '@xenova/transformers'
import * as dotenv from 'dotenv'
import { documentos } from './documentos.js'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

async function ingestar() {
  console.log('Inicializando modelo de embeddings...')
  
  const extractor = await pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2'
  )

  console.log(`Procesando ${documentos.length} documentos...`)

  for (const doc of documentos) {
    // Generar embedding
    const output = await extractor(doc.content, {
      pooling: 'mean',
      normalize: true
    })
    const rawEmbedding = Array.from(output.data)
    const float32 = new Float32Array(rawEmbedding)
    const embedding = Array.from(float32)

    // Guardar en Supabase
    const { error } = await supabase
      .from('documents')
      .insert({
        content:   doc.content,
        embedding: embedding,
        metadata:  doc.metadata
      })

    if (error) {
      console.error(`Error en documento: ${error.message}`)
    } else {
      console.log(`✅ Ingestado: ${doc.metadata.tipo}`)
    }
  }

  console.log('\nIngestión completa.')
}

ingestar()
