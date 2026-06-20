import { createClient } from '@supabase/supabase-js'
import { pipeline } from '@xenova/transformers'
import * as dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

let extractor = null

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    )
  }
  return extractor
}

export async function buscarDocumentos(pregunta, limite = 3) {
  const ext = await getExtractor()
  
  const output = await ext(pregunta, {
    pooling: 'mean',
    normalize: true
  })
  const rawEmbedding = Array.from(output.data)
  const float32 = new Float32Array(rawEmbedding)
  const embedding = Array.from(float32)

  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_count: limite
  })

  if (error) throw error

  // Si la búsqueda vectorial devuelve resultados, usarlos
  if (data && data.length > 0) {
    console.log('📄 Documentos encontrados por vector:', data.length)
    return data
  }

  // Fallback — búsqueda por palabras clave en el contenido
  console.log('⚠️ Vector devolvió 0 — usando fallback por texto')
  
  const palabras = pregunta
    .toLowerCase()
    .replace(/[¿?¡!.,]/g, '')
    .split(' ')
    .filter(p => p.length > 3)

  const { data: fallback, error: fallbackError } = await supabase
    .from('documents')
    .select('id, content, metadata')
    .or(palabras.map(p => `content.ilike.%${p}%`).join(','))
    .limit(limite)

  if (fallbackError) throw fallbackError

  console.log('📄 Documentos encontrados por texto:', fallback?.length ?? 0)
  return fallback?.map(d => ({ ...d, similarity: 0.5 })) ?? []
}

export function formatearContexto(documentos) {
  return documentos
    .map((doc, i) => `[Documento ${i + 1}]\n${doc.content}`)
    .join('\n\n')
}